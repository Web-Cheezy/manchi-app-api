import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { getBearerToken, requireStaffUser } from '@/lib/auth';
import { assertSupabaseConfigured, getJwtRole, isSupabaseConfigured } from '@/lib/supabase';

function getServiceRoleClient(): SupabaseClient {
  assertSupabaseConfigured();
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function getStaffJwtClient(accessToken: string): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Admin DB client for staff routes.
 * - Uses service role when SUPABASE_SERVICE_ROLE_KEY is a real service_role JWT (bypasses RLS).
 * - Otherwise uses the staff user's Bearer token + anon key (requires rls_staff_menu.sql policies).
 */
export function resolveAdminDatabaseClient(req: NextRequest): { ok: true; db: SupabaseClient } | { ok: false; response: NextResponse } {
  if (!isSupabaseConfigured()) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Missing Supabase environment variables' }, { status: 500 }),
    };
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (getJwtRole(serviceKey) === 'service_role') {
    return { ok: true, db: getServiceRoleClient() };
  }

  const token = getBearerToken(req);
  const staffDb = token ? getStaffJwtClient(token) : null;
  if (!staffDb) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            'Server misconfiguration: set SUPABASE_SERVICE_ROLE_KEY to your service role key, or set NEXT_PUBLIC_SUPABASE_ANON_KEY and run supabase/rls_staff_menu.sql',
        },
        { status: 500 }
      ),
    };
  }

  return { ok: true, db: staffDb };
}

export async function requireStaffDatabase(req: NextRequest): Promise<
  | {
      ok: true;
      staff: { user: { id: string; email: string | null }; role: string; location: string | null };
      db: SupabaseClient;
    }
  | { ok: false; response: NextResponse }
> {
  const staff = await requireStaffUser(req);
  if (!staff.ok) return staff;

  const dbResult = resolveAdminDatabaseClient(req);
  if (!dbResult.ok) return dbResult;

  return { ok: true, staff: staff, db: dbResult.db };
}

export function isRlsViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String((error as { code?: unknown }).code) : '';
  const message = 'message' in error ? String((error as { message?: unknown }).message ?? '').toLowerCase() : '';
  return code === '42501' || message.includes('row-level security');
}

export function adminDbErrorResponse(error: unknown): NextResponse {
  if (isRlsViolation(error)) {
    return NextResponse.json(
      {
        error:
          'Database permission denied (RLS). Run supabase/rls_staff_menu.sql in Supabase, and ensure SUPABASE_SERVICE_ROLE_KEY is your service role key (not the anon key).',
      },
      { status: 403 }
    );
  }

  const message = getDbErrorMessage(error);
  console.error('[adminDb]', message, error);
  return NextResponse.json({ error: message }, { status: 500 });
}

function getDbErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = String((error as { message?: unknown }).message ?? '').trim();
    if (message) return message;
  }
  return 'Internal Server Error';
}
