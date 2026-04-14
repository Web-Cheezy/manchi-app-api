import { NextRequest, NextResponse } from 'next/server';
import { requireAuthenticatedUser } from '@/lib/auth';
import { getTransaction, updateTransactionStatus } from '@/lib/db';
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

    // 2. Call Paystack Verify API
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
    const status = transactionData.status; // 'success', 'abandoned', 'failed'

    // 3. Update Database (Proxy requirement)
    await updateTransactionStatus(reference, status);

    // 4. Return result to Flutter app
    return NextResponse.json({
      status: status,
      message: transactionData.gateway_response,
      amount: transactionData.amount,
      reference: transactionData.reference,
      paid_at: transactionData.paid_at,
    });

  } catch (error) {
    console.error('Error verifying Paystack transaction:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
