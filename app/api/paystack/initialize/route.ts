import { NextRequest, NextResponse } from 'next/server';
import { requireAuthenticatedUser } from '@/lib/auth';
import { saveTransaction } from '@/lib/db';
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

    const secretKey = process.env.PAYSTACK_SECRET_KEY;
    if (!secretKey) {
        console.error('PAYSTACK_SECRET_KEY is not defined');
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }

    // 2. Call Paystack API
    // We pass metadata to Paystack so it's returned in webhooks/verification
    const paystackMetadata = {
      ...metadata,
      user_id: auth.user.id, // Custom field to track which user made this payment
      location: location // Save location in metadata for Paystack reference
    };

    const paystackResponse = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        email, 
        amount,
        metadata: paystackMetadata
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
