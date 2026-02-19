import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { validateRequest, unauthorizedResponse } from '@/lib/auth';

export async function GET(req: NextRequest) {
  if (!validateRequest(req)) return unauthorizedResponse();

  const searchParams = req.nextUrl.searchParams;
  const userId = searchParams.get('userId');

  try {
    let query = supabase.from('orders').select('*').order('created_at', { ascending: false });

    // Filter by user if provided
    if (userId) {
      query = query.eq('user_id', userId);
    }

    const { data, error } = await query;

    if (error) throw error;

    return NextResponse.json({ orders: data });
  } catch (error: any) {
    console.error('Fetch Orders Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!validateRequest(req)) return unauthorizedResponse();

  try {
    const body = await req.json();
    const {
      user_id,
      userId,
      total_amount,
      totalAmount,
      vat,
      status,
      delivery_address,
      deliveryAddress,
      location,
      items,
    } = body;

    const resolvedUserId = user_id ?? userId;
    const resolvedTotalAmount = total_amount ?? totalAmount;
    const resolvedDeliveryAddress = delivery_address ?? deliveryAddress;
    
    if (!resolvedUserId || !items || !resolvedTotalAmount) {
        return NextResponse.json({ error: 'Missing required order fields' }, { status: 400 });
    }

    // 1. Create the Order
    const { data: orderData, error: orderError } = await supabase
      .from('orders')
      .insert([{
        user_id: resolvedUserId,
        total_amount: resolvedTotalAmount,
        vat: vat || 0,
        status: status || 'pending',
        delivery_address: resolvedDeliveryAddress,
        location
      }])
      .select()
      .single();

    if (orderError) throw orderError;

    // 2. Add Order Items
    const orderItems = items.map((item: any) => ({
      order_id: orderData.id,
      food_id: item.food_id,
      quantity: item.quantity,
      price_at_time: item.price_at_time,
      options: item.options
    }));

    const { error: itemsError } = await supabase
      .from('order_items')
      .insert(orderItems);

    if (itemsError) {
      // In a real production app, we might want to rollback the order creation here
      // But Supabase doesn't support multi-statement transactions via client easily without RPC
      console.error('Error creating order items:', itemsError);
      return NextResponse.json({ error: 'Order created but items failed' }, { status: 500 });
    }

    return NextResponse.json({ 
      message: 'Order created successfully',
      order_id: orderData.id 
    });

  } catch (error: any) {
    console.error('Create Order Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
