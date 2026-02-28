import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { validateRequest, unauthorizedResponse } from '@/lib/auth';

export async function GET(req: NextRequest) {
  if (!validateRequest(req)) return unauthorizedResponse();

  const searchParams = req.nextUrl.searchParams;
  const userId = searchParams.get('userId');

  if (!userId) {
    return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
  }

  try {
    const { data, error } = await supabase
      .from('addresses')
      .select('*')
      .eq('user_id', userId)
      .order('is_default', { ascending: false }) // Show default first
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Fetch Addresses Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!validateRequest(req)) return unauthorizedResponse();

  try {
    const body = await req.json();
    const { 
      user_id, userId,
      title, 
      address_line_1, addressLine1,
      address_line_2, addressLine2,
      city, 
      state, 
      zip_code, zipCode,
      country, 
      is_default, isDefault
    } = body;

    const resolvedUserId = user_id ?? userId;
    const resolvedAddressLine1 = address_line_1 ?? addressLine1;
    const resolvedAddressLine2 = address_line_2 ?? addressLine2;
    const resolvedZipCode = zip_code ?? zipCode;
    const resolvedIsDefault = is_default ?? isDefault;

    if (!resolvedUserId || !title || !resolvedAddressLine1 || !city) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // If setting as default, unset others first for this user
    if (resolvedIsDefault) {
      await supabase
        .from('addresses')
        .update({ is_default: false })
        .eq('user_id', resolvedUserId);
    }

    const { data, error } = await supabase
      .from('addresses')
      .insert([{
        user_id: resolvedUserId,
        title,
        address_line_1: resolvedAddressLine1,
        address_line_2: resolvedAddressLine2,
        city,
        state,
        zip_code: resolvedZipCode,
        country: country || 'Nigeria',
        is_default: resolvedIsDefault || false
      }])
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Create Address Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
