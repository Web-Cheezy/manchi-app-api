import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { validateRequest, unauthorizedResponse } from '@/lib/auth';
import { notifyOrderStatusChange } from '@/lib/fcm';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!validateRequest(req)) return unauthorizedResponse();

  try {
    const { id } = await params;
    const body = await req.json();
    const { status } = body;

    if (!id) {
      return NextResponse.json({ error: 'Order id is required' }, { status: 400 });
    }
    if (!status || typeof status !== 'string') {
      return NextResponse.json({ error: 'status is required' }, { status: 400 });
    }

    const validStatuses = ['pending', 'preparing', 'delivered', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return NextResponse.json(
        { error: `status must be one of: ${validStatuses.join(', ')}` },
        { status: 400 }
      );
    }

    // Get current order to read user_id and previous status
    const { data: existing, error: fetchError } = await supabase
      .from('orders')
      .select('id, user_id, status')
      .eq('id', id)
      .single();

    if (fetchError || !existing) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    const { data: updated, error } = await supabase
      .from('orders')
      .update({ status })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    // Notify customer on status change (pending→preparing, preparing→delivered, or cancelled)
    const prev = existing.status as string;
    if (existing.user_id && prev !== status) {
      notifyOrderStatusChange(existing.user_id, existing.id, status).catch((e) =>
        console.error('FCM order status notify:', e)
      );
    }

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Update order error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
