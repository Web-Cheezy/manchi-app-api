import { supabase } from './supabase';

// Helper to handle Supabase errors
const handleSupabaseError = (error: any) => {
  console.error('[DB Error]', error);
  // Don't throw immediately if it's just a column missing error during development
  // but for now we throw to be safe
  throw new Error(error.message || 'Database operation failed');
};

export async function saveTransaction(
  reference: string, 
  email: string, 
  amount: number, 
  userId?: string, 
  metadata?: any,
  location?: string
) {
  const payload: any = { reference, email, amount, status: 'pending' };
  
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
