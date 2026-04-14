import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getClientIp, normalizeEmail, rateLimit } from '@/lib/rateLimit';

export async function POST(req: NextRequest) {
  try {
    const { email, token } = await req.json();

    if (!email || !token) {
      return NextResponse.json({ error: 'Email and token are required' }, { status: 400 });
    }

    const ip = getClientIp(req);
    const emailNorm = normalizeEmail(email);
    const rl = rateLimit(`auth:verify:${ip}:${emailNorm}`, 10, 10 * 60 * 1000);
    if (!rl.ok) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const { data, error } = await supabase.auth.verifyOtp({
      email: emailNorm,
      token,
      type: 'email',
    });

    if (error) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 400 });
    }

    return NextResponse.json(data);
  } catch (error: unknown) {
    console.error('Verify OTP Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
