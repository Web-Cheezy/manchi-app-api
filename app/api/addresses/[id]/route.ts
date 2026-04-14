import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireAuthenticatedUser } from '@/lib/auth';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuthenticatedUser(req);
  if (!auth.ok) return auth.response;

  try {
    const { id } = await params;
    const body = await req.json();
    
    const { 
      state, 
      lga, 
      area, 
      street, 
      house_number, houseNumber,
      is_default, isDefault,
      title, 
    } = body;

    const resolvedIsDefault = is_default ?? isDefault;
    const resolvedHouseNumber = house_number ?? houseNumber;

    const { data: existingRaw, error: existingError } = await supabase
      .from('addresses')
      .select('id, user_id')
      .eq('id', id)
      .single();

    const existing = existingRaw as { id: string; user_id: string } | null;

    if (existingError || !existing) {
      return NextResponse.json({ error: 'Address not found' }, { status: 404 });
    }

    if (existing.user_id !== auth.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Handle setting as default
    if (resolvedIsDefault === true) {
      await supabase
        .from('addresses')
        .update({ is_default: false })
        .eq('user_id', auth.user.id)
        .neq('id', id);
    }

    // Construct update payload with exact fields
    const updatePayload: Record<string, unknown> = {};
    
    if (state !== undefined) updatePayload.state = state;
    if (lga !== undefined) updatePayload.lga = lga;
    if (area !== undefined) updatePayload.area = area;
    if (street !== undefined) updatePayload.street = street;
    if (resolvedHouseNumber !== undefined) updatePayload.house_number = resolvedHouseNumber;
    if (title !== undefined) updatePayload.title = title;
    if (resolvedIsDefault !== undefined) updatePayload.is_default = resolvedIsDefault;
    
    // Only update if we have fields to update
    if (Object.keys(updatePayload).length === 0) {
        return NextResponse.json({ message: 'No fields to update' });
    }

    const { data, error } = await supabase
      .from('addresses')
      .update(updatePayload)
      .eq('id', id)
      .eq('user_id', auth.user.id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json(data);
  } catch (error: unknown) {
    console.error('Update Address Error:', error);
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuthenticatedUser(req);
  if (!auth.ok) return auth.response;

  try {
    const { id } = await params;
    
    const { error } = await supabase
      .from('addresses')
      .delete()
      .eq('id', id)
      .eq('user_id', auth.user.id);

    if (error) throw error;

    return NextResponse.json({ message: 'Address deleted successfully' });
  } catch (error: unknown) {
    console.error('Delete Address Error:', error);
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
