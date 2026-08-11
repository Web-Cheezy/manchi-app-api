import { NextRequest, NextResponse } from 'next/server';
import { requireAuthenticatedUser } from '@/lib/auth';
import { getTransaction, updateTransactionStatus } from '@/lib/db';
import {
  extractOrderIdFromMetadata,
  isPaidTransaction,
  orderAmountToKobo,
  isAmountWithinTolerance,
} from '@/lib/payments';
import { supabase } from '@/lib/supabase';
import { getClientIp, rateLimit } from '@/lib/rateLimit';
import { notifyOrderStatusChange } from '@/lib/fcm';

export async function GET(req: NextRequest) {
  const auth = await requireAuthenticatedUser(req);
  if (!auth.ok) return auth.response;

  const searchParams = req.nextUrl.searchParams;
  const reference = searchParams.get('reference');

  if (!reference) {
    return NextResponse.json(
      { error: 'Transaction reference is required' },
      { status: 400 }
    );
  }

  try {
    const ip = getClientIp(req);
    const rl = rateLimit(`paystack:verify:${ip}:${auth.user.id}`, 20, 10 * 60 * 1000);
    if (!rl.ok) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const existing = await getTransaction(reference).catch(() => null);
    const existingRecord = typeof existing === 'object' && existing !== null ? (existing as Record<string, unknown>) : null;
    const existingUserId = existingRecord ? existingRecord.user_id : null;
    if (!existingRecord || existingUserId !== auth.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const secretKey = process.env.PAYSTACK_SECRET_KEY;
    if (!secretKey) {
        console.error('PAYSTACK_SECRET_KEY is not defined');
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }

    const paystackResponse = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${secretKey}`,
      },
    });

    const data = await paystackResponse.json();

    if (!paystackResponse.ok) {
      return NextResponse.json(
        { error: data.message || 'Failed to verify transaction' },
        { status: paystackResponse.status }
      );
    }

    const transactionData = data.data;
    const status = transactionData.status;

    const orderId =
      extractOrderIdFromMetadata(existingRecord.metadata) ??
      extractOrderIdFromMetadata(transactionData.metadata);

    const chargedAmountKobo = typeof transactionData.amount === 'number' ? transactionData.amount : null;
    let orderTotalKobo: number | null = null;
    let amountMismatch = false;

    if (isPaidTransaction(status) && orderId !== null) {
      const { data: orderRow, error: orderLookupErr } = await supabase
        .from('orders')
        .select('id, user_id, status, total_amount')
        .eq('id', orderId)
        .eq('user_id', auth.user.id)
        .maybeSingle();
      if (orderLookupErr) {
        console.error('[Paystack Verify] Error looking up order for amount check:', orderId, orderLookupErr);
      } else if (orderRow && (orderRow as unknown as Record<string, unknown>).total_amount !== null && (orderRow as unknown as Record<string, unknown>).total_amount !== undefined) {
        orderTotalKobo = orderAmountToKobo((orderRow as unknown as Record<string, unknown>).total_amount);
      }

      if (!isAmountWithinTolerance(chargedAmountKobo, orderTotalKobo)) {
        console.error('[Paystack Verify] AMOUNT MISMATCH: charged amount', chargedAmountKobo,
          'kobo vs order total', orderTotalKobo, 'kobo; orderId:', orderId, 'reference:', reference,
          '— refusing to confirm order.');
        amountMismatch = true;
        try {
          await updateTransactionStatus(reference, 'amount_mismatch');
        } catch (e) {
          console.error('[Paystack Verify] Failed to flag transaction as amount_mismatch:', e);
        }
      }
    }

    if (!amountMismatch) {
      try {
        await updateTransactionStatus(reference, status);
      } catch (e) {
        console.error('[Paystack Verify] Failed to update transaction status:', reference, e);
      }
    }

    if (isPaidTransaction(status) && orderId !== null && !amountMismatch) {
      const { data: updatedRows, error: orderError } = await supabase
        .from('orders')
        .update({ status: 'confirmed' })
        .eq('id', orderId)
        .eq('user_id', auth.user.id)
        .in('status', ['pending'])
        .select('id');

      if (orderError) {
        console.error('[Paystack Verify] Failed to confirm order:', orderId, orderError);
      } else if (Array.isArray(updatedRows) && updatedRows.length > 0) {
        const fcm = await notifyOrderStatusChange(auth.user.id, orderId, 'confirmed');
        console.info('[Paystack Verify] Order confirmed via verify endpoint:', {
          orderId,
          userId: auth.user.id,
          reference,
          fcmAttempted: fcm.attempted,
          fcmSuccess: fcm.success,
        });
      } else {
        console.info('[Paystack Verify] Order already confirmed (idempotent skip):', {
          orderId,
          userId: auth.user.id,
          reference,
        });
      }
    }

    return NextResponse.json({
      status: amountMismatch ? 'amount_mismatch' : status,
      message: transactionData.gateway_response,
      amount: transactionData.amount,
      reference: transactionData.reference,
      paid_at: transactionData.paid_at,
      order_id: orderId,
      amount_mismatch: amountMismatch || undefined,
    });

  } catch (error) {
    console.error('Error verifying Paystack transaction:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
