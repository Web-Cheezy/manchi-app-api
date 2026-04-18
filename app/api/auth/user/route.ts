import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { getBearerToken, unauthorizedResponse } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const token = getBearerToken(req);

  if (!token) {
    return unauthorizedResponse();
  }

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      return unauthorizedResponse();
    }

    return NextResponse.json({ user });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
