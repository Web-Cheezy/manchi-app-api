import { NextRequest, NextResponse } from 'next/server';
import { requireAuthenticatedUser } from '@/lib/auth';
import { getClientIp, rateLimit } from '@/lib/rateLimit';
import { assertSupabaseConfigured, supabase } from '@/lib/supabase';

const DELETE_ACCOUNT_LIMIT = 3;
const DELETE_ACCOUNT_WINDOW_MS = 15 * 60 * 1000;

function isMissingRelationOrColumn(error: unknown): boolean {
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message?: unknown }).message ?? '').toLowerCase()
      : '';

  return (
    message.includes('relation') ||
    message.includes('does not exist') ||
    message.includes('schema cache') ||
    message.includes('column')
  );
}

async function deleteOptionalRows(table: string, userId: string) {
  const { error } = await supabase.from(table).delete().eq('user_id', userId);

  if (error && !isMissingRelationOrColumn(error)) {
    throw error;
  }
}

function getDeletedUserId(): string {
  return process.env.DELETED_USER_ID?.trim() ?? '';
}

export async function POST(req: NextRequest) {
  const auth = await requireAuthenticatedUser(req);
  if (!auth.ok) return auth.response;

  const ip = getClientIp(req);
  const limiter = rateLimit(`account-delete:${auth.user.id}:${ip}`, DELETE_ACCOUNT_LIMIT, DELETE_ACCOUNT_WINDOW_MS);
  if (!limiter.ok) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      { status: 429 }
    );
  }

  try {
    assertSupabaseConfigured();

    const rawBody = await req.json().catch(() => ({}));
    const reason =
      typeof rawBody?.reason === 'string' && rawBody.reason.trim()
        ? rawBody.reason.trim().slice(0, 500)
        : null;

    const deletedUserId = getDeletedUserId();
    if (!deletedUserId) {
      return NextResponse.json(
        { error: 'Server misconfiguration: DELETED_USER_ID is not set' },
        { status: 500 }
      );
    }

    if (deletedUserId === auth.user.id) {
      return NextResponse.json(
        { error: 'Server misconfiguration: DELETED_USER_ID cannot match the authenticated user' },
        { status: 500 }
      );
    }

    const { data: placeholderUser, error: placeholderError } = await supabase.auth.admin.getUserById(deletedUserId);
    if (placeholderError || !placeholderUser?.user) {
      return NextResponse.json(
        { error: 'Server misconfiguration: DELETED_USER_ID does not reference a valid auth user' },
        { status: 500 }
      );
    }

    if (reason) {
      console.info('Account deletion requested', {
        userId: auth.user.id,
        reason,
      });
    }

    const { error: ordersError } = await supabase
      .from('orders')
      .update({
        user_id: deletedUserId,
        delivery_address: null,
        delivery_lat: null,
        delivery_lng: null,
        location: null,
        anonymized_at: new Date().toISOString(),
        anonymized_reason: reason,
      })
      .eq('user_id', auth.user.id);

    if (ordersError) throw ordersError;

    const { error: profileError } = await supabase
      .from('profiles')
      .delete()
      .eq('id', auth.user.id);

    if (profileError) throw profileError;

    const { error: addressesError } = await supabase
      .from('addresses')
      .delete()
      .eq('user_id', auth.user.id);

    if (addressesError) throw addressesError;

    await deleteOptionalRows('fcm_tokens', auth.user.id);
    await deleteOptionalRows('user_notifications', auth.user.id);

    const { error: deleteAuthError } = await supabase.auth.admin.deleteUser(auth.user.id);
    if (deleteAuthError) throw deleteAuthError;

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('Account deletion error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
