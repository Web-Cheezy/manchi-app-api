import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export function validateRequest(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key');
  const validApiKey = process.env.API_SECRET_KEY;

  if (!apiKey || apiKey !== validApiKey) {
    return false;
  }
  return true;
}

export function unauthorizedResponse() {
  return NextResponse.json(
    { error: 'Unauthorized: Invalid API Key' },
    { status: 401 }
  );
}

export function getBearerToken(req: NextRequest): string | null {
  const raw = req.headers.get('authorization') ?? req.headers.get('Authorization');
  if (!raw) return null;
  const parts = raw.split(' ');
  if (parts.length !== 2) return null;
  if (parts[0].toLowerCase() !== 'bearer') return null;
  return parts[1] || null;
}

export async function getAuthenticatedUser(req: NextRequest): Promise<{ id: string; email: string | null } | null> {
  const token = getBearerToken(req);
  if (!token) return null;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;

  return { id: data.user.id, email: data.user.email ?? null };
}

export async function requireAuthenticatedUser(req: NextRequest): Promise<
  | { ok: true; user: { id: string; email: string | null } }
  | { ok: false; response: NextResponse }
> {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  return { ok: true, user };
}
