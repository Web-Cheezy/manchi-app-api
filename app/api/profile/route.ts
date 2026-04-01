import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { validateRequest, unauthorizedResponse, requireAuthenticatedUser } from '@/lib/auth';

export async function GET(req: NextRequest) {
  if (!validateRequest(req)) return unauthorizedResponse();
  const auth = await requireAuthenticatedUser(req);
  if (!auth.ok) return auth.response;

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', auth.user.id)
      .single();

    if (error) throw error;

    return NextResponse.json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!validateRequest(req)) return unauthorizedResponse();
  const auth = await requireAuthenticatedUser(req);
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json();
    const { full_name, phone_number } = body;

    const { data, error } = await supabase
      .from('profiles')
      .upsert({ id: auth.user.id, full_name, phone_number })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
