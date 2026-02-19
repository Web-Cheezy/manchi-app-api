import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { validateRequest, unauthorizedResponse } from '@/lib/auth';

export async function POST(req: NextRequest) {
  if (!validateRequest(req)) return unauthorizedResponse();

  try {
    const { email } = await req.json();

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const { error } = await supabase.auth.signInWithOtp({
      email,
    });

    if (error) throw error;

    return NextResponse.json({ message: 'OTP sent successfully' });
  } catch (error: any) {
    console.error('OTP Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
