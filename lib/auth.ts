import { NextRequest, NextResponse } from 'next/server';
import { assertSupabaseConfigured, supabase } from '@/lib/supabase';

/** 401 — missing, malformed, invalid, or expired JWT (see requireAuthenticatedUser). */
export function unauthorizedResponse() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

/** 403 — valid session but not allowed for this resource or action. */
export function forbiddenResponse(message = 'Forbidden') {
  return NextResponse.json({ error: message }, { status: 403 });
}

const STAFF_ROLES = new Set(['admin', 'super_admin']);

/**
 * Staff-only routes (e.g. order status updates, FCM broadcast).
 * Uses JWT + profiles.role; customers get 403 even with a valid token.
 */
export async function requireStaffUser(req: NextRequest): Promise<
  | { ok: true; user: { id: string; email: string | null }; role: string; location: string | null }
  | { ok: false; response: NextResponse }
> {
  const auth = await requireAuthenticatedUser(req);
  if (!auth.ok) return auth;

  assertSupabaseConfigured();
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role, location')
    .eq('id', auth.user.id)
    .maybeSingle();

  if (error) {
    console.error('requireStaffUser profile:', error);
    return { ok: false, response: forbiddenResponse() };
  }

  const role = typeof profile?.role === 'string' ? profile.role : '';
  if (!STAFF_ROLES.has(role)) {
    return { ok: false, response: forbiddenResponse() };
  }

  const location = typeof profile?.location === 'string' ? profile.location : null;
  return { ok: true, user: auth.user, role, location };
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

  assertSupabaseConfigured();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;

  return { id: data.user.id, email: data.user.email ?? null };
}

export async function requireAuthenticatedUser(req: NextRequest): Promise<
  | { ok: true; user: { id: string; email: string | null } }
  | { ok: false; response: NextResponse }
> {
  let user: { id: string; email: string | null } | null = null;
  try {
    user = await getAuthenticatedUser(req);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Internal Server Error';
    return { ok: false, response: NextResponse.json({ error: message }, { status: 500 }) };
  }
  if (!user) {
    return { ok: false, response: unauthorizedResponse() };
  }

  return { ok: true, user };
}
