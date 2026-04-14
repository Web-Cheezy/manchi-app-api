import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getClientIp, normalizeEmail, rateLimit } from '@/lib/rateLimit';

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const ip = getClientIp(req);
    const emailNorm = normalizeEmail(email);
    const rl = rateLimit(`auth:otp:${ip}:${emailNorm}`, 3, 10 * 60 * 1000);
    if (!rl.ok) {
      return NextResponse.json({ message: 'If an account exists, an OTP has been sent' }, { status: 200 });
    }

    const cooldown = rateLimit(`auth:otp:cooldown:${emailNorm}`, 1, 60 * 1000);
    if (!cooldown.ok) {
      return NextResponse.json({ message: 'If an account exists, an OTP has been sent' }, { status: 200 });
    }

    const { error } = await supabase.auth.signInWithOtp({
      email: emailNorm,
      options: {
        shouldCreateUser: false,
      },
    });

    if (error) {
      return NextResponse.json({ message: 'If an account exists, an OTP has been sent' }, { status: 200 });
    }

    return NextResponse.json({ message: 'If an account exists, an OTP has been sent' }, { status: 200 });
  } catch (error: unknown) {
    console.error('OTP Error:', error);
    return NextResponse.json({ message: 'If an account exists, an OTP has been sent' }, { status: 200 });
  }
}
