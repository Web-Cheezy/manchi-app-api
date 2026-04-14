import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getClientIp, normalizeEmail, rateLimit } from '@/lib/rateLimit';

export async function POST(req: NextRequest) {
  try {
    const { email, password, data } = await req.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    const ip = getClientIp(req);
    const emailNorm = normalizeEmail(email);
    const rl = rateLimit(`auth:signup:${ip}:${emailNorm}`, 5, 15 * 60 * 1000);
    if (!rl.ok) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const userMetadata = {
      ...(data || {}),
      role: 'customer', 
      location: null 
    };

    const { error: createError } = await supabase.auth.admin.createUser({
      email: emailNorm,
      password,
      email_confirm: true,
      user_metadata: userMetadata,
    });

    if (createError) {
      return NextResponse.json({ error: createError.message }, { status: 400 });
    }

    const { data: authData, error: signInError } = await supabase.auth.signInWithPassword({
      email: emailNorm,
      password,
    });

    if (signInError) {
      return NextResponse.json({ error: signInError.message }, { status: 401 });
    }

    return NextResponse.json(authData);

  } catch (error) {
    console.error('Signup Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
