import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { validateRequest, unauthorizedResponse, requireAuthenticatedUser } from '@/lib/auth';

export async function GET(req: NextRequest) {
  if (!validateRequest(req)) return unauthorizedResponse();
  const auth = await requireAuthenticatedUser(req);
  if (!auth.ok) return auth.response;

  try {
    const { data, error } = await supabase
      .from('addresses')
      .select('*')
      .eq('user_id', auth.user.id)
      .order('is_default', { ascending: false }) // Show default first
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json(data);
  } catch (error: unknown) {
    console.error('Fetch Addresses Error:', error);
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
    const { 
      // Fields from Flutter App
      state, 
      lga, 
      area, 
      street, 
      house_number, houseNumber,
      is_default, isDefault,
      
      // Keep title if passed (though likely not in your new model)
      title, 
    } = body;

    const resolvedIsDefault = is_default ?? isDefault;
    const resolvedHouseNumber = house_number ?? houseNumber;

    if (!state || !lga || !area || !street || !resolvedHouseNumber) {
      return NextResponse.json({ 
        error: 'Missing required fields',
        received: { 
          state, 
          lga, 
          area, 
          street, 
          houseNumber: resolvedHouseNumber 
        }
      }, { status: 400 });
    }

    // If setting as default, unset others first for this user
    if (resolvedIsDefault) {
      await supabase
        .from('addresses')
        .update({ is_default: false })
        .eq('user_id', auth.user.id);
    }

    // Construct title if not provided
    const finalTitle = title ?? `${resolvedHouseNumber} ${street}`;

    const { data, error } = await supabase
      .from('addresses')
      .insert([{
        user_id: auth.user.id,
        title: finalTitle,
        state,
        lga,
        area,
        street,
        house_number: resolvedHouseNumber,
        is_default: resolvedIsDefault || false
      }])
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json(data);
  } catch (error: unknown) {
    console.error('Create Address Error:', error);
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
