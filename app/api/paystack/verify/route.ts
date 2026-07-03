import { NextRequest, NextResponse } from 'next/server';
import { requireAuthenticatedUser } from '@/lib/auth';
import { getTransaction, updateTransactionStatus } from '@/lib/db';
import { extractOrderIdFromMetadata, isPaidTransaction } from '@/lib/payments';
import { supabase } from '@/lib/supabase';
import { getClientIp, rateLimit } from '@/lib/rateLimit';

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

    await updateTransactionStatus(reference, status);

    let orderId =
      extractOrderIdFromMetadata(existingRecord.metadata) ??
      extractOrderIdFromMetadata(transactionData.metadata);

    if (isPaidTransaction(status) && orderId !== null) {
      await supabase
        .from('orders')
        .update({ status: 'confirmed' })
        .eq('id', orderId)
        .eq('user_id', auth.user.id)
        .eq('status', 'pending');
    }

    return NextResponse.json({
      status,
      message: transactionData.gateway_response,
      amount: transactionData.amount,
      reference: transactionData.reference,
      paid_at: transactionData.paid_at,
      order_id: orderId,
    });

  } catch (error) {
    console.error('Error verifying Paystack transaction:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
