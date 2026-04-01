import { supabase } from './supabase';

// Helper to handle Supabase errors
const handleSupabaseError = (error: unknown) => {
  console.error('[DB Error]', error);
  // Don't throw immediately if it's just a column missing error during development
  // but for now we throw to be safe
  const message =
    typeof error === 'object' && error !== null && 'message' in error ? String((error as { message?: unknown }).message) : undefined;
  throw new Error(message || 'Database operation failed');
};

export async function saveTransaction(
  reference: string, 
  email: string, 
  amount: number, 
  userId?: string, 
  metadata?: unknown,
  location?: string
) {
  const payload: Record<string, unknown> = { reference, email, amount, status: 'pending' };
  
  // Only add these if they exist (and assuming columns exist)
  if (userId) payload.user_id = userId;
  if (metadata) payload.metadata = metadata;
  if (location) payload.location = location;

  const { data, error } = await supabase
    .from('transactions')
    .insert([payload])
    .select()
    .single();

  if (error) handleSupabaseError(error);
  return data;
}

export async function updateTransactionStatus(reference: string, status: string) {
  const { data, error } = await supabase
    .from('transactions')
    .update({ status })
    .eq('reference', reference)
    .select()
    .single();

  if (error) handleSupabaseError(error);
  return data;
}

export async function getTransaction(reference: string) {
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('reference', reference)
    .single();

  if (error) handleSupabaseError(error);
  return data;
}

export async function getUserTransactions(email: string) {
    const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('email', email)
        .order('created_at', { ascending: false });

    if (error) handleSupabaseError(error);
    return data;
}

// --- FCM tokens (for push notifications) ---

export async function upsertFcmToken(fcmToken: string, userId?: string | null) {
  const { data, error } = await supabase
    .from('fcm_tokens')
    .upsert(
      {
        fcm_token: fcmToken,
        user_id: userId ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'fcm_token' }
    )
    .select()
    .single();

  if (error) handleSupabaseError(error);
  return data;
}

export async function getFcmTokensByUserId(userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('fcm_tokens')
    .select('fcm_token')
    .eq('user_id', userId);

  if (error) handleSupabaseError(error);
  return (data ?? []).map((r) => r.fcm_token).filter(Boolean);
}

export async function getAllFcmTokens(): Promise<string[]> {
  const { data, error } = await supabase
    .from('fcm_tokens')
    .select('fcm_token');

  if (error) handleSupabaseError(error);
  return (data ?? []).map((r) => r.fcm_token).filter(Boolean);
}

// --- User notifications (history for Notifications tab) ---

export type NotificationType = 'order_placed' | 'order_status_changed' | 'broadcast';

export async function insertUserNotification(
  userId: string | null,
  title: string,
  body: string,
  type: NotificationType,
  orderId?: string | number | null
) {
  const { data, error } = await supabase
    .from('user_notifications')
    .insert({
      user_id: userId ?? null,
      title,
      body,
      type,
      order_id: orderId != null ? String(orderId) : null,
    })
    .select()
    .single();

  if (error) handleSupabaseError(error);
  return data;
}

export async function getUserNotifications(userId: string) {
  const { data, error } = await supabase
    .from('user_notifications')
    .select('*')
    .or(`user_id.eq.${userId},user_id.is.null`)
    .order('created_at', { ascending: false });

  if (error) handleSupabaseError(error);
  return data ?? [];
}

export async function markNotificationRead(id: string, userId: string) {
  const { data, error } = await supabase
    .from('user_notifications')
    .update({ is_read: true })
    .eq('id', id)
    .or(`user_id.eq.${userId},user_id.is.null`)
    .select()
    .single();

  if (error) handleSupabaseError(error);
  return data;
}

/** Mark all notifications for this user (and broadcasts) as read. */
export async function markAllNotificationsRead(userId: string) {
  const { error } = await supabase
    .from('user_notifications')
    .update({ is_read: true })
    .or(`user_id.eq.${userId},user_id.is.null`);

  if (error) handleSupabaseError(error);
}
