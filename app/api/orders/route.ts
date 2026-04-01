import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { validateRequest, unauthorizedResponse, requireAuthenticatedUser } from '@/lib/auth';
import { normalizeLocation } from '@/lib/utils';
import { notifyOrderCreated } from '@/lib/fcm';

type AvailabilityStatus = 'available' | 'out_of_stock' | 'unavailable';
type UnknownRecord = Record<string, unknown>;

function normalizeAvailabilityStatus(value: unknown): AvailabilityStatus | undefined {
  if (value === null || value === undefined) return undefined;
  const v = String(value).trim().toLowerCase();
  if (v === 'available') return 'available';
  if (v === 'out_of_stock' || v === 'out-of-stock' || v === 'outofstock') return 'out_of_stock';
  if (v === 'unavailable') return 'unavailable';
  return undefined;
}

function resolveFoodStatus(food: unknown, preferredLocation?: string): AvailabilityStatus {
  const foodRecord: UnknownRecord = typeof food === 'object' && food !== null ? (food as UnknownRecord) : {};

  const availabilityValue = foodRecord['food_availability'];
  if (Array.isArray(availabilityValue) && availabilityValue.length > 0) {
    const availabilityRows = preferredLocation
      ? availabilityValue.filter((row: unknown) => {
          const rowRecord: UnknownRecord = typeof row === 'object' && row !== null ? (row as UnknownRecord) : {};
          const rawLocation = rowRecord['location'] ?? rowRecord['store'];
          const normalized = normalizeLocation(typeof rawLocation === 'string' ? rawLocation : undefined);
          return normalized === preferredLocation;
        })
      : availabilityValue;

    const firstRow: UnknownRecord | undefined =
      typeof availabilityRows?.[0] === 'object' && availabilityRows?.[0] !== null
        ? (availabilityRows[0] as UnknownRecord)
        : undefined;

    const nestedStatus = normalizeAvailabilityStatus(firstRow?.['status']);
    if (nestedStatus) return nestedStatus;
  }

  const candidates = [
    foodRecord['availability_status'],
    foodRecord['availability'],
    foodRecord['status'],
    typeof foodRecord['is_available'] === 'boolean' ? (foodRecord['is_available'] ? 'available' : 'unavailable') : undefined,
  ];

  for (const candidate of candidates) {
    const status = normalizeAvailabilityStatus(candidate);
    if (status) return status;
  }

  return 'available';
}

function isSchemaMismatch(error: unknown): boolean {
  const msg = String((error as { message?: unknown } | null)?.message ?? '').toLowerCase();
  return msg.includes('does not exist') || msg.includes('schema cache') || msg.includes('column') || msg.includes('relation');
}

export async function GET(req: NextRequest) {
  if (!validateRequest(req)) return unauthorizedResponse();
  const auth = await requireAuthenticatedUser(req);
  if (!auth.ok) return auth.response;

  try {
    const query = supabase
      .from('orders')
      .select('*')
      .eq('user_id', auth.user.id)
      .order('created_at', { ascending: false });

    const { data, error } = await query;

    if (error) throw error;

    return NextResponse.json({ orders: data });
  } catch (error) {
    console.error('Fetch Orders Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!validateRequest(req)) return unauthorizedResponse();
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
    } = body;

    const resolvedTotalAmount = total_amount ?? totalAmount;
    const resolvedDeliveryAddress = delivery_address ?? deliveryAddress;
    
    // Normalize location to ensure it matches Admin configuration (e.g. "Chasemall" vs full address)
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

    const parsedItems = items
      .map((item: UnknownRecord) => {
        const foodId = item.food_id ?? item.id;
        const quantity = Number(item.quantity ?? 1);
        const priceAtTime = Number(item.price_at_time ?? item.price ?? 0);
        const options = item.options ?? [];

        if (!Number.isFinite(Number(foodId)) || !Number.isFinite(quantity) || quantity <= 0) return null;

        return {
          food_id: Number(foodId),
          quantity,
          price_at_time: Number.isFinite(priceAtTime) ? priceAtTime : 0,
          options,
        };
      })
      .filter(Boolean) as Array<{ food_id: number; quantity: number; price_at_time: number; options: unknown }>;

    if (parsedItems.length === 0) {
      return NextResponse.json({ error: 'No valid order items' }, { status: 400 });
    }

    const foodIds = Array.from(new Set(parsedItems.map((i) => i.food_id)));
    const runFoodsQuery = async (withJoins: boolean, includePrice: boolean) => {
      const selectBase = includePrice
        ? 'id,price,status,availability_status,availability,is_available'
        : 'id,status,availability_status,availability,is_available';

      if (withJoins) {
        const { data, error } = await supabase
          .from('foods')
          .select(`${selectBase},food_availability(*)`)
          .in('id', foodIds);
        return { data, error };
      }

      const { data, error } = await supabase
        .from('foods')
        .select(selectBase)
        .in('id', foodIds);
      return { data, error };
    };

    let { data: foods, error: foodsError } = await runFoodsQuery(true, true);
    if (foodsError && isSchemaMismatch(foodsError)) {
      ({ data: foods, error: foodsError } = await runFoodsQuery(false, true));
    }
    if (foodsError && isSchemaMismatch(foodsError)) {
      ({ data: foods, error: foodsError } = await runFoodsQuery(true, false));
      if (foodsError && isSchemaMismatch(foodsError)) {
        ({ data: foods, error: foodsError } = await runFoodsQuery(false, false));
      }
    }
    if (foodsError) {
      return NextResponse.json({ error: 'Unable to validate items' }, { status: 500 });
    }

    const foodById = new Map<number, UnknownRecord>();
    for (const food of Array.isArray(foods) ? foods : []) {
      const record: UnknownRecord = typeof food === 'object' && food !== null ? (food as UnknownRecord) : {};
      const id = Number(record.id);
      if (Number.isFinite(id)) foodById.set(id, record);
    }

    let computedBaseTotal = 0;
    let canComputeTotal = true;

    for (const item of parsedItems) {
      const food = foodById.get(item.food_id);
      if (!food) return NextResponse.json({ error: 'Invalid order item' }, { status: 400 });
      const statusResolved = resolveFoodStatus(food, normalizedLocation);
      if (statusResolved !== 'available') {
        return NextResponse.json({ error: 'Item not available' }, { status: 400 });
      }

      const priceRaw = food.price;
      const price = Number(priceRaw);
      if (!Number.isFinite(price) || price < 0) {
        canComputeTotal = false;
      } else {
        computedBaseTotal += price * item.quantity;
      }
    }

    if (canComputeTotal && Number.isFinite(computedBaseTotal) && computedBaseTotal > 0) {
      if (totalNumber < computedBaseTotal) {
        return NextResponse.json({ error: 'Invalid total_amount' }, { status: 400 });
      }
    }

    // 1. Create the Order
    const { data: orderData, error: orderError } = await supabase
      .from('orders')
      .insert([{
        user_id: auth.user.id,
        total_amount: totalNumber,
        vat: vat || 0,
        status: status || 'pending',
        delivery_address: resolvedDeliveryAddress,
        location: normalizedLocation,
        items,
        delivery_method,
      }])
      .select()
      .single();

    if (orderError) throw orderError;

    // 2. Add Order Items
    const orderItems = parsedItems.map((item) => ({
      order_id: orderData.id,
      food_id: item.food_id,
      quantity: item.quantity,
      price_at_time: item.price_at_time,
      options: item.options,
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

    // Notify customer (fire-and-forget)
    notifyOrderCreated(auth.user.id, orderData.id).catch((e) =>
      console.error('FCM order created notify:', e)
    );

    return NextResponse.json({ 
      message: 'Order created successfully',
      order_id: orderData.id 
    });

  } catch (error) {
    console.error('Create Order Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
