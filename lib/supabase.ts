import { createClient } from '@supabase/supabase-js';

function decodeBase64Url(input: string): string | null {
  try {
    const pad = '='.repeat((4 - (input.length % 4)) % 4);
    const b64 = (input + pad).replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(b64, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

function getJwtRole(token: string): string | null {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  const payloadJson = decodeBase64Url(parts[1]);
  if (!payloadJson) return null;
  try {
    const payload = JSON.parse(payloadJson) as { role?: unknown };
    return typeof payload.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

export function isSupabaseConfigured(): boolean {
  return !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
}

export function assertSupabaseConfigured(): void {
  if (!isSupabaseConfigured()) {
    throw new Error('Missing Supabase environment variables');
  }
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const role = getJwtRole(key);
  if (role && role !== 'service_role') {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not a service_role key');
  }
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'invalid-service-role-key';

export const supabase = createClient(supabaseUrl, supabaseKey);
