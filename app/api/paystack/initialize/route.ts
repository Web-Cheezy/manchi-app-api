import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { requireAuthenticatedUser } from '@/lib/auth';
import {
  saveTransaction,
  patchTransaction,
  isUniqueViolation,
} from '@/lib/db';
import { extractOrderIdFromMetadata } from '@/lib/payments';
import { supabase } from '@/lib/supabase';
import { normalizeLocation } from '@/lib/utils';
import { getClientIp, normalizeEmail, rateLimit } from '@/lib/rateLimit';

const ALLOWED_CALLBACK_SCHEMES: readonly string[] = [
  'manchi://',
];

function isAllowedCallbackUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  return ALLOWED_CALLBACK_SCHEMES.some((scheme) => trimmed.startsWith(scheme));
}

function generatePaystackReference(): string {
  return `manchi_${Date.now().toString(36)}_${randomBytes(8).toString('hex')}`;
}

function orderAmountToPaystackKobo(totalAmountNaira: unknown): number | null {
  const naira = Number(totalAmountNaira);
  if (!Number.isFinite(naira) || naira <= 0) return null;
  return Math.round(naira * 100);
}

export async function POST(req: NextRequest) {
  const auth = await requireAuthenticatedUser(req);
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json();
    const { email, userId, metadata, location, callback_url } = body as Record<string, unknown>;
    void userId;

    const ip = getClientIp(req);
    const emailNorm = normalizeEmail(email as unknown);
    const rl = rateLimit(`paystack:init:${ip}:${emailNorm}`, 10, 10 * 60 * 1000);
    if (!rl.ok) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    if (!email || !emailNorm) {
      return NextResponse.json({ error: 'Valid email is required' }, { status: 400 });
    }

    const orderId = extractOrderIdFromMetadata(metadata);
    if (orderId === null) {
      return NextResponse.json(
        { error: 'metadata.orderId is required (use the order_id returned from POST /api/orders)' },
        { status: 400 }
      );
    }

    const normalizedLocation = normalizeLocation(location as string | undefined | null);
    if (normalizedLocation !== 'Chasemall' && normalizedLocation !== 'Eromo') {
      return NextResponse.json({ error: 'Invalid or missing location' }, { status: 400 });
    }

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, user_id, status, total_amount')
      .eq('id', orderId)
      .maybeSingle();

    if (orderError) throw orderError;
    if (!order || order.user_id !== auth.user.id) {
      return NextResponse.json({ error: 'Invalid order for payment' }, { status: 404 });
    }

    const orderStatus = String(order.status ?? '').toLowerCase();
    if (orderStatus === 'confirmed' || orderStatus === 'delivered' || orderStatus === 'delivering' || orderStatus === 'preparing') {
      return NextResponse.json(
        { error: `Order already ${orderStatus}` },
        { status: 409 }
      );
    }
    if (orderStatus === 'cancelled') {
      return NextResponse.json({ error: 'Order is cancelled' }, { status: 409 });
    }
    if (orderStatus !== 'pending') {
      return NextResponse.json(
        { error: `Unexpected order status: ${orderStatus}` },
        { status: 409 }
      );
    }

    const amountKobo = orderAmountToPaystackKobo(order.total_amount);
    if (amountKobo === null) {
      return NextResponse.json(
        { error: 'Order has no valid amount; cannot initialize payment' },
        { status: 400 }
      );
    }

    const paystackMetadata: Record<string, unknown> = {
      ...(typeof metadata === 'object' && metadata !== null ? (metadata as Record<string, unknown>) : {}),
      orderId: String(orderId),
      order_id: orderId,
      user_id: auth.user.id,
      location: normalizedLocation,
    };

    const secretKey = process.env.PAYSTACK_SECRET_KEY;
    if (!secretKey) {
      console.error('PAYSTACK_SECRET_KEY is not defined');
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }

    let pendingConflictRef: string | null = null;
    const freshReference = generatePaystackReference();

    try {
      await saveTransaction(
        freshReference,
        emailNorm,
        amountKobo,
        auth.user.id,
        paystackMetadata,
        normalizedLocation,
        orderId
      );
    } catch (insertErr) {
      if (isUniqueViolation(insertErr)) {
        console.info('[Paystack Initialize] Unique violation on pending claim for order:', orderId, 'user:', auth.user.id, '— reusing existing pending tx.');
        const { data: conflictRow, error: conflictErr } = await supabase
          .from('transactions')
          .select('reference, status, metadata')
          .eq('user_id', auth.user.id)
          .eq('order_id', orderId)
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (conflictErr) {
          console.warn('[Paystack Initialize] Failed to look up conflicting pending tx:', conflictErr);
        } else if (conflictRow && typeof (conflictRow as unknown as Record<string, unknown>).reference === 'string') {
          pendingConflictRef = String((conflictRow as unknown as Record<string, unknown>).reference);
        }
      } else {
        throw insertErr;
      }
    }

    let reuseAuthUrl: string | null = null;
    let reuseAccessCode: string | null = null;
    let reuseReference: string | null = null;

    const tryReuseFromReference = async (existingRef: string, existingMetaFromRow: Record<string, unknown> | null): Promise<{ ok: boolean; authUrl: string | null; accessCode: string | null }> => {
      try {
        const verifyRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(existingRef)}`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${secretKey}` },
        });
        if (!verifyRes.ok) return { ok: false, authUrl: null, accessCode: null };
        const verifyJson = await verifyRes.json();
        const txStatus = String(verifyJson?.data?.status ?? '').toLowerCase();
        const isReusable = txStatus === 'pending' || txStatus === '' || !txStatus;
        if (!isReusable) return { ok: false, authUrl: null, accessCode: null };
        let authUrl: string | null = typeof verifyJson?.data?.authorization_url === 'string' ? (verifyJson.data.authorization_url as string) : null;
        let accessCode: string | null = typeof verifyJson?.data?.access_code === 'string' ? (verifyJson.data.access_code as string) : null;
        if (!authUrl && existingMetaFromRow && typeof existingMetaFromRow.authorization_url === 'string') {
          authUrl = existingMetaFromRow.authorization_url as string;
        }
        if (!accessCode && existingMetaFromRow && typeof existingMetaFromRow.access_code === 'string') {
          accessCode = existingMetaFromRow.access_code as string;
        }
        if (!authUrl && !accessCode) return { ok: false, authUrl: null, accessCode: null };
        return { ok: true, authUrl, accessCode };
      } catch (e) {
        console.warn('[Paystack Initialize] Verify of existing tx failed; creating new transaction.', e);
        return { ok: false, authUrl: null, accessCode: null };
      }
    };

    if (pendingConflictRef) {
      const { data: row, error: rowErr } = await supabase
        .from('transactions')
        .select('reference, status, metadata')
        .eq('reference', pendingConflictRef)
        .maybeSingle();
      const rowMeta = !rowErr && row && typeof (row as unknown as Record<string, unknown>).metadata === 'object'
        ? (row as unknown as Record<string, unknown>).metadata as Record<string, unknown>
        : null;
      const reuse = await tryReuseFromReference(pendingConflictRef, rowMeta);
      if (reuse.ok && reuse.authUrl) {
        reuseReference = pendingConflictRef;
        reuseAuthUrl = reuse.authUrl;
        reuseAccessCode = reuse.accessCode;
      }
    }

    if (!reuseReference) {
      const { data: existingRow, error: existingErr } = await supabase
        .from('transactions')
        .select('reference, status, metadata')
        .eq('user_id', auth.user.id)
        .eq('order_id', orderId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!existingErr && existingRow && typeof (existingRow as unknown as Record<string, unknown>).reference === 'string') {
        const existingRef = String((existingRow as unknown as Record<string, unknown>).reference);
        const existingMeta = typeof (existingRow as unknown as Record<string, unknown>).metadata === 'object'
          ? (existingRow as unknown as Record<string, unknown>).metadata as Record<string, unknown>
          : null;
        const reuse = await tryReuseFromReference(existingRef, existingMeta);
        if (reuse.ok && reuse.authUrl) {
          reuseReference = existingRef;
          reuseAuthUrl = reuse.authUrl;
          reuseAccessCode = reuse.accessCode;
        }
      }
    }

    if (reuseReference && reuseAuthUrl) {
      return NextResponse.json({
        authorization_url: reuseAuthUrl,
        reference: reuseReference,
        access_code: reuseAccessCode ?? '',
        reused_pending: true,
      });
    }

    const paystackBody: Record<string, unknown> = {
      email: emailNorm,
      amount: amountKobo,
      metadata: paystackMetadata,
      reference: freshReference,
    };
    if (isAllowedCallbackUrl(callback_url)) {
      paystackBody.callback_url = callback_url.trim();
    } else if (typeof callback_url === 'string' && callback_url.trim()) {
      console.warn('[Paystack Initialize] Stripping invalid callback_url (scheme not allowed):', callback_url);
    }

    const paystackResponse = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(paystackBody),
    });

    const data = await paystackResponse.json();

    if (!paystackResponse.ok) {
      return NextResponse.json(
        { error: data.message || 'Failed to initialize transaction' },
        { status: paystackResponse.status }
      );
    }

    const returnedReference = typeof data.data?.reference === 'string' ? (data.data.reference as string) : freshReference;
    const authorizationUrl = typeof data.data?.authorization_url === 'string'
      ? (data.data.authorization_url as string)
      : null;
    const accessCode = typeof data.data?.access_code === 'string'
      ? (data.data.access_code as string)
      : null;
    if (!authorizationUrl) {
      return NextResponse.json(
        { error: 'Paystack did not return a valid checkout authorization_url' },
        { status: 502 }
      );
    }

    const metaWithUrls: Record<string, unknown> = {
      ...paystackMetadata,
      authorization_url: authorizationUrl,
      access_code: accessCode,
    };

    try {
      await patchTransaction(freshReference, { metadata: metaWithUrls });
    } catch (e) {
      console.error('Error patching initialized transaction metadata:', e);
    }

    return NextResponse.json({
      authorization_url: authorizationUrl,
      reference: returnedReference,
      access_code: accessCode ?? '',
    });

  } catch (error) {
    console.error('Error initializing Paystack transaction:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
