import { NextRequest, NextResponse } from 'next/server';
import { createHmac } from 'node:crypto';
import { supabase } from '@/lib/supabase';
import { updateTransactionStatus } from '@/lib/db';
import {
  extractOrderIdFromMetadata,
  isPaidTransaction,
  orderAmountToKobo,
  isAmountWithinTolerance,
} from '@/lib/payments';
import { notifyOrderStatusChange } from '@/lib/fcm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SUPPORTED_EVENTS = new Set([
  'charge.success',
  'charge.failed',
  'charge.reversed',
  'charge.refunded',
  'transfer.success',
  'transfer.failed',
  'transfer.reversed',
]);

function isValidSignature(rawBody: Uint8Array, signatureHeader: string | null, secret: string): boolean {
  if (!signatureHeader) return false;
  const expected = createHmac('sha512', secret).update(Buffer.from(rawBody)).digest('hex');
  const a = signatureHeader;
  const b = expected;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

type PaystackEvent = {
  event: string;
  data?: {
    reference?: string;
    status?: string;
    metadata?: unknown;
    customer?: { email?: string } | null;
    amount?: number;
    id?: number | string;
    paid_at?: string | null;
  } | null;
};

export async function POST(req: NextRequest) {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) {
    console.error('[Paystack Webhook] PAYSTACK_SECRET_KEY is not set; returning 500 so Paystack retries.');
    return NextResponse.json({ error: 'Server missing Paystack secret key' }, { status: 500 });
  }

  const signatureHeader = req.headers.get('x-paystack-signature');
  const rawBody = await req.arrayBuffer();
  const rawBytes = new Uint8Array(rawBody);

  if (!isValidSignature(rawBytes, signatureHeader, secret)) {
    console.warn('[Paystack Webhook] Invalid signature; rejecting.');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let evt: PaystackEvent;
  try {
    evt = JSON.parse(Buffer.from(rawBytes).toString('utf8')) as PaystackEvent;
  } catch (parseErr) {
    console.error('[Paystack Webhook] Could not parse JSON body:', parseErr);
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const eventName = String(evt.event ?? '');
  const data = evt.data;
  const reference = typeof data?.reference === 'string' ? data.reference : null;
  const status = typeof data?.status === 'string' ? data.status.toLowerCase() : null;
  const chargedAmountKobo = typeof data?.amount === 'number' ? data.amount : null;

  if (!SUPPORTED_EVENTS.has(eventName)) {
    console.info('[Paystack Webhook] Ignoring unsupported event:', eventName);
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  if (!reference) {
    console.warn('[Paystack Webhook] Event missing transaction reference:', eventName);
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  try {
    const { data: txRow, error: txError } = await supabase
      .from('transactions')
      .select('id, user_id, status, metadata, reference')
      .eq('reference', reference)
      .maybeSingle();

    if (txError) {
      console.error('[Paystack Webhook] Error looking up transaction reference:', reference, txError);
      throw txError;
    }

    const tx = txRow as unknown as Record<string, unknown> | null;
    const txUserId = tx && typeof tx.user_id === 'string' ? tx.user_id : undefined;
    const txMetadata = tx?.metadata;

    const orderId = extractOrderIdFromMetadata(txMetadata) ?? extractOrderIdFromMetadata(data?.metadata);

    let orderRow: Record<string, unknown> | null = null;
    if (orderId !== null && txUserId) {
      const { data: orderLookup, error: orderLookupError } = await supabase
        .from('orders')
        .select('id, user_id, status, total_amount')
        .eq('id', orderId)
        .eq('user_id', txUserId)
        .maybeSingle();
      if (orderLookupError) {
        console.error('[Paystack Webhook] Error looking up order for webhook:', orderId, orderLookupError);
      } else if (orderLookup) {
        orderRow = orderLookup as unknown as Record<string, unknown>;
      }
    }

    if (eventName === 'charge.success' || isPaidTransaction(String(status ?? ''))) {
      if (!tx) {
        console.warn('[Paystack Webhook] charge.success but no transaction row for:', reference);
      }

      let orderTotalKobo: number | null = null;
      if (orderRow && orderRow.total_amount !== null && orderRow.total_amount !== undefined) {
        orderTotalKobo = orderAmountToKobo(orderRow.total_amount);
      }

      if (!isAmountWithinTolerance(chargedAmountKobo, orderTotalKobo)) {
        console.error('[Paystack Webhook] AMOUNT MISMATCH: charged amount', chargedAmountKobo,
          'kobo vs order total', orderTotalKobo, 'kobo; orderId:', orderId, 'reference:', reference,
          '— refusing to confirm order.');
        try {
          await updateTransactionStatus(reference, 'amount_mismatch');
        } catch (e) {
          console.error('[Paystack Webhook] Failed to flag transaction as amount_mismatch:', e);
        }
        return NextResponse.json({ ok: true }, { status: 200 });
      }

      try {
        await updateTransactionStatus(reference, status ?? 'success');
      } catch (e) {
        console.error('[Paystack Webhook] Failed to update transaction status:', reference, e);
      }

      if (orderId !== null && txUserId) {
        const { data: updatedRows, error: orderError } = await supabase
          .from('orders')
          .update({ status: 'confirmed' })
          .eq('id', orderId)
          .eq('user_id', txUserId)
          .in('status', ['pending'])
          .select('id, user_id, status');

        if (orderError) {
          console.error('[Paystack Webhook] Failed to confirm order:', orderId, orderError);
        } else if (Array.isArray(updatedRows) && updatedRows.length > 0) {
          const fcm = await notifyOrderStatusChange(txUserId, orderId, 'confirmed');
          console.info('[Paystack Webhook] Order confirmed via webhook:', {
            orderId,
            userId: txUserId,
            reference,
            fcmAttempted: fcm.attempted,
            fcmSuccess: fcm.success,
          });
        } else {
          console.info('[Paystack Webhook] Order already confirmed (idempotent skip):', {
            orderId,
            userId: txUserId,
            reference,
          });
        }
      } else {
        console.warn('[Paystack Webhook] charge.success missing orderId or userId:', {
          reference,
          orderId,
          userId: txUserId,
        });
      }
    } else if (status && typeof status === 'string') {
      try {
        await updateTransactionStatus(reference, status);
      } catch (e) {
        console.error('[Paystack Webhook] Failed to update transaction for event:', eventName, reference, e);
      }
    }
  } catch (e) {
    console.error('[Paystack Webhook] Unhandled error during event processing:', eventName, reference, e);
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
