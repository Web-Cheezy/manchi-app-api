import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getClientIp, normalizeEmail, rateLimit } from '@/lib/rateLimit';

const GENERIC_MESSAGE = 'If an account exists for this email, a verification code has been sent.';

/**
 * POST /api/auth/forgot-password
 * Body: { "email": "user@example.com" }
 * Sends a 6-digit OTP to the email (existing accounts only). No reset link.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const emailNorm = normalizeEmail(body?.email);

    if (!emailNorm) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const ip = getClientIp(req);
    const rl = rateLimit(`auth:forgot:${ip}:${emailNorm}`, 3, 10 * 60 * 1000);
    if (!rl.ok) {
      return NextResponse.json({ message: GENERIC_MESSAGE }, { status: 200 });
    }

    const cooldown = rateLimit(`auth:forgot:cooldown:${emailNorm}`, 1, 60 * 1000);
    if (!cooldown.ok) {
      return NextResponse.json({ message: GENERIC_MESSAGE }, { status: 200 });
    }

    const { error } = await supabase.auth.signInWithOtp({
      email: emailNorm,
      options: {
        shouldCreateUser: false,
      },
    });

    if (error) {
      console.warn('Forgot password OTP send:', error.message);
    }

    return NextResponse.json({ message: GENERIC_MESSAGE }, { status: 200 });
  } catch (error) {
    console.error('Forgot password error:', error);
    return NextResponse.json({ message: GENERIC_MESSAGE }, { status: 200 });
  }
}
