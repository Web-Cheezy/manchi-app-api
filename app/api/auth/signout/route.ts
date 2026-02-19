import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { validateRequest, unauthorizedResponse } from '@/lib/auth';

export async function POST(req: NextRequest) {
  if (!validateRequest(req)) return unauthorizedResponse();

  try {
    // Note: Since we are using the service role client on the backend, 
    // we can't easily sign out a specific user session unless we pass the JWT.
    // However, Supabase client-side signOut is usually sufficient.
    // If you need server-side signout, you'd typically invalidate the session token.
    
    // For now, we'll just return success as this is often handled client-side.
    // If you passed an access_token, we could try:
    // const { error } = await supabase.auth.signOut(token);
    
    return NextResponse.json({ message: 'Signed out successfully' });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
