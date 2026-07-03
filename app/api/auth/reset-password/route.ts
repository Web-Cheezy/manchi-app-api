import { NextRequest, NextResponse } from 'next/server';
import { validateNewPassword } from '@/lib/passwordAuth';
import { supabase } from '@/lib/supabase';
import { getClientIp, normalizeEmail, rateLimit } from '@/lib/rateLimit';

/**
 * POST /api/auth/reset-password
 * Body: { "email", "token", "password" }
 * Verifies email OTP, sets new password, returns session (same shape as login).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const emailNorm = normalizeEmail(body?.email);
    const token = typeof body?.token === 'string' ? body.token.trim() : '';
    const passwordCheck = validateNewPassword(body?.password);

    if (!emailNorm || !token) {
      return NextResponse.json({ error: 'Email and verification code are required' }, { status: 400 });
    }

    if (!passwordCheck.ok) {
      return NextResponse.json({ error: passwordCheck.error }, { status: 400 });
    }

    const ip = getClientIp(req);
    const rl = rateLimit(`auth:reset:${ip}:${emailNorm}`, 10, 15 * 60 * 1000);
    if (!rl.ok) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp({
      email: emailNorm,
      token,
      type: 'email',
    });

    if (verifyError || !verifyData?.user?.id) {
      return NextResponse.json({ error: 'Invalid or expired verification code' }, { status: 400 });
    }

    const userId = verifyData.user.id;

    const { error: updateError } = await supabase.auth.admin.updateUserById(userId, {
      password: passwordCheck.password,
    });

    if (updateError) {
      console.error('Reset password update error:', updateError);
      return NextResponse.json({ error: 'Could not update password' }, { status: 500 });
    }

    const { data: authData, error: signInError } = await supabase.auth.signInWithPassword({
      email: emailNorm,
      password: passwordCheck.password,
    });

    if (signInError) {
      return NextResponse.json({
        message: 'Password updated successfully. Please sign in with your new password.',
      });
    }

    return NextResponse.json(authData);
  } catch (error) {
    console.error('Reset password error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
