import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { validateRequest, unauthorizedResponse } from '@/lib/auth';

export async function POST(req: NextRequest) {
  // 1. Security Check
  if (!validateRequest(req)) {
    return unauthorizedResponse();
  }

  try {
    const { email, password, data } = await req.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    // 2. Call Supabase Auth
    // Default metadata: role='customer', location=null (customers don't manage locations)
    const userMetadata = {
      ...(data || {}),
      role: 'customer', 
      location: null 
    };

    const { data: authData, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: userMetadata,
        emailRedirectTo: undefined,
      },
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // Send OTP to verify email (app will call /api/auth/verify with email + token)
    const { error: otpError } = await supabase.auth.signInWithOtp({ email });

    if (otpError) {
      console.error('OTP send after signup:', otpError);
      // User is created; return success but inform that OTP send failed
      return NextResponse.json({
        ...authData,
        message: 'Account created. Check your email for the verification code.',
        otp_sent: false,
        otp_error: otpError.message,
      });
    }

    return NextResponse.json({
      ...authData,
      message: 'Account created. Check your email for the verification code.',
      otp_sent: true,
    });

  } catch (error) {
    console.error('Signup Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
