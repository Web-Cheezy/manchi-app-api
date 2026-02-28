import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { validateRequest, unauthorizedResponse } from '@/lib/auth';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!validateRequest(req)) return unauthorizedResponse();

  try {
    const { id } = await params;
    const body = await req.json();
    
    const { 
      user_id, userId,
      state, 
      lga, 
      area, 
      street, 
      house_number, houseNumber,
      is_default, isDefault,
      title, 
    } = body;

    const resolvedUserId = user_id ?? userId;
    const resolvedIsDefault = is_default ?? isDefault;
    const resolvedHouseNumber = house_number ?? houseNumber;

    // Handle setting as default
    if (resolvedIsDefault === true) {
      let targetUserId = resolvedUserId;

      // If user_id is not provided, fetch it from the address
      if (!targetUserId) {
        const { data: addressData } = await supabase
          .from('addresses')
          .select('user_id')
          .eq('id', id)
          .single();
        
        targetUserId = addressData?.user_id;
      }

      if (targetUserId) {
        // Unset other defaults for this user
        await supabase
          .from('addresses')
          .update({ is_default: false })
          .eq('user_id', targetUserId)
          .neq('id', id); 
      }
    }

    // Construct update payload with exact fields
    const updatePayload: any = {};
    
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
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Update Address Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!validateRequest(req)) return unauthorizedResponse();

  try {
    const { id } = await params;
    
    const { error } = await supabase
      .from('addresses')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return NextResponse.json({ message: 'Address deleted successfully' });
  } catch (error: any) {
    console.error('Delete Address Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
