import { NextRequest, NextResponse } from 'next/server';
import { requireAuthenticatedUser } from '@/lib/auth';
import { saveTransaction } from '@/lib/db';
import { extractOrderIdFromMetadata } from '@/lib/payments';
import { supabase } from '@/lib/supabase';
import { normalizeLocation } from '@/lib/utils';
import { getClientIp, normalizeEmail, rateLimit } from '@/lib/rateLimit';

export async function POST(req: NextRequest) {
  const auth = await requireAuthenticatedUser(req);
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json();
    const { email, amount, userId, metadata, location } = body;
    void userId;

    const ip = getClientIp(req);
    const emailNorm = normalizeEmail(email);
    const rl = rateLimit(`paystack:init:${ip}:${emailNorm}`, 10, 10 * 60 * 1000);
    if (!rl.ok) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    if (!email || !amount) {
      return NextResponse.json(
        { error: 'Email and amount are required' },
        { status: 400 }
      );
    }

    const orderId = extractOrderIdFromMetadata(metadata);
    if (orderId === null) {
      return NextResponse.json(
        { error: 'metadata.orderId is required (use the order_id returned from POST /api/orders)' },
        { status: 400 }
      );
    }

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, user_id')
      .eq('id', orderId)
      .maybeSingle();

    if (orderError) throw orderError;
    if (!order || order.user_id !== auth.user.id) {
      return NextResponse.json({ error: 'Invalid order for payment' }, { status: 400 });
    }

    const paystackMetadata = {
      ...(typeof metadata === 'object' && metadata !== null ? metadata : {}),
      orderId: String(orderId),
      order_id: orderId,
      user_id: auth.user.id,
      location: location,
    };
    const secretKey = process.env.PAYSTACK_SECRET_KEY;
    if (!secretKey) {
        console.error('PAYSTACK_SECRET_KEY is not defined');
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }

    // Call Paystack API (metadata links payment → order for admin dashboard)
    const paystackResponse = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        amount,
        metadata: paystackMetadata,
      }),
    });

    const data = await paystackResponse.json();

    if (!paystackResponse.ok) {
      return NextResponse.json(
        { error: data.message || 'Failed to initialize transaction' },
        { status: paystackResponse.status }
      );
    }

    // 3. Save to Database (Proxy requirement)
    // We save the reference so we can verify it later
    const reference = data.data.reference;
    
    // We try to save extra fields if the DB supports them, otherwise they are ignored if column doesn't exist
    // (Ensure you update your Supabase table schema to include user_id and metadata if you want them saved)
    const normalizedLocation = normalizeLocation(location);
    await saveTransaction(reference, email, amount, auth.user.id, paystackMetadata, normalizedLocation);

    // 4. Return result to Flutter app
    return NextResponse.json({
      authorization_url: data.data.authorization_url,
      reference: data.data.reference,
      access_code: data.data.access_code,
    });

  } catch (error) {
    console.error('Error initializing Paystack transaction:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
