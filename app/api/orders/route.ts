import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireAuthenticatedUser } from '@/lib/auth';
import { normalizeLocation } from '@/lib/utils';
import { notifyOrderCreated } from '@/lib/fcm';
import { getTransportPriceForLga, parseOrderLines, parseOrderNote, validateAndBuildOrderLines } from '@/lib/orders';
import { isSchemaMismatch } from '@/lib/availability';

export async function GET(req: NextRequest) {
  const auth = await requireAuthenticatedUser(req);
  if (!auth.ok) return auth.response;

  try {
    const { data, error } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .eq('user_id', auth.user.id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json({ orders: data });
  } catch (error) {
    console.error('Fetch Orders Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuthenticatedUser(req);
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json();
    const {
      total_amount,
      totalAmount,
      vat,
      status,
      delivery_address,
      deliveryAddress,
      location,
      items,
      delivery_method,
      deliveryMethod,
      lga,
      delivery_lga,
      deliveryLga,
      delivery_fee,
      deliveryFee,
    } = body;

    const resolvedTotalAmount = total_amount ?? totalAmount;
    const resolvedDeliveryAddress = delivery_address ?? deliveryAddress;
    const resolvedDeliveryMethod =
      typeof (delivery_method ?? deliveryMethod) === 'string' && String(delivery_method ?? deliveryMethod).trim()
        ? String(delivery_method ?? deliveryMethod).trim().toLowerCase()
        : 'delivery';
    const resolvedDeliveryLga =
      typeof (delivery_lga ?? deliveryLga ?? lga) === 'string' && String(delivery_lga ?? deliveryLga ?? lga).trim()
        ? String(delivery_lga ?? deliveryLga ?? lga).trim()
        : null;
    const clientDeliveryFeeRaw = delivery_fee ?? deliveryFee;
    const clientDeliveryFee =
      clientDeliveryFeeRaw !== undefined && clientDeliveryFeeRaw !== null && clientDeliveryFeeRaw !== ''
        ? Number(clientDeliveryFeeRaw)
        : null;

    const normalizedLocation = normalizeLocation(location);

    if (!items || resolvedTotalAmount === undefined || resolvedTotalAmount === null) {
      return NextResponse.json({ error: 'Missing required order fields' }, { status: 400 });
    }

    if (normalizedLocation !== 'Chasemall' && normalizedLocation !== 'Eromo') {
      return NextResponse.json({ error: 'Invalid location' }, { status: 400 });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'items must be a non-empty array' }, { status: 400 });
    }

    const totalNumber = Number(resolvedTotalAmount);
    if (!Number.isFinite(totalNumber) || totalNumber < 0) {
      return NextResponse.json({ error: 'total_amount must be a valid number' }, { status: 400 });
    }

    const parsed = parseOrderLines(items);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }

    const validated = await validateAndBuildOrderLines(parsed.lines, normalizedLocation);
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: validated.status });
    }

    const vatNumber = Number(vat ?? 0);
    let computedDeliveryFee = 0;

    if (resolvedDeliveryMethod !== 'pickup') {
      if (resolvedDeliveryLga) {
        computedDeliveryFee = await getTransportPriceForLga(resolvedDeliveryLga);
      } else if (clientDeliveryFee !== null && Number.isFinite(clientDeliveryFee) && clientDeliveryFee >= 0) {
        computedDeliveryFee = clientDeliveryFee;
      } else {
        return NextResponse.json({ error: 'delivery_lga is required for delivery orders' }, { status: 400 });
      }
    }

    const expectedTotal =
      validated.computedItemsTotal +
      validated.computedOptionsTotal +
      computedDeliveryFee +
      (Number.isFinite(vatNumber) ? vatNumber : 0);

    if (expectedTotal > 0 && Math.abs(totalNumber - expectedTotal) > 0.01) {
      return NextResponse.json(
        {
          error: 'Invalid total_amount',
          expected_total: expectedTotal,
        },
        { status: 400 }
      );
    }

    const lineSnapshots = validated.lines.map((line) => line.optionsSnapshot).filter(Boolean);
    const orderNote = parseOrderNote(body as Record<string, unknown>);

    const orderPayload: Record<string, unknown> = {
      user_id: auth.user.id,
      total_amount: totalNumber,
      vat: vat || 0,
      status: status || 'pending',
      delivery_address: resolvedDeliveryAddress,
      location: normalizedLocation,
      items: lineSnapshots,
      delivery_method: resolvedDeliveryMethod,
    };

    if (orderNote) {
      orderPayload.order_note = orderNote;
    }

    let { data: orderData, error: orderError } = await supabase
      .from('orders')
      .insert([orderPayload])
      .select()
      .single();

    if (orderError && isSchemaMismatch(orderError) && orderNote) {
      delete orderPayload.order_note;
      ({ data: orderData, error: orderError } = await supabase
        .from('orders')
        .insert([orderPayload])
        .select()
        .single());
    }

    if (orderError) throw orderError;

    const orderItems = validated.lines.map((line) => ({
      order_id: orderData.id,
      food_id: line.food_id,
      side_id: line.side_id,
      quantity: line.quantity,
      price_at_time:
        line.kind === 'food' && line.optionsSnapshot && typeof line.optionsSnapshot === 'object' && 'base_price' in line.optionsSnapshot
          ? Number((line.optionsSnapshot as { base_price: number }).base_price)
          : line.price_at_time,
      options: line.optionsSnapshot,
    }));

    const { error: itemsError } = await supabase.from('order_items').insert(orderItems);

    if (itemsError) {
      console.error('Error creating order items:', itemsError);
      return NextResponse.json({ error: 'Order created but items failed' }, { status: 500 });
    }

    notifyOrderCreated(auth.user.id, orderData.id).catch((e) => console.error('FCM order created notify:', e));

    return NextResponse.json({
      message: 'Order created successfully',
      order_id: orderData.id,
      order_note: orderNote,
    });
  } catch (error) {
    console.error('Create Order Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
