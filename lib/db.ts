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
  metadata?: any
) {
  const payload: any = { reference, email, amount, status: 'pending' };
  
  // Only add these if they exist (and assuming columns exist)
  if (userId) payload.user_id = userId;
  if (metadata) payload.metadata = metadata;

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
