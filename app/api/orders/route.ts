import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { requireAuthenticatedUser } from '@/lib/auth';
import { normalizeLocation } from '@/lib/utils';
import { notifyOrderCreated } from '@/lib/fcm';

type AvailabilityStatus = 'available' | 'out_of_stock' | 'unavailable';
type UnknownRecord = Record<string, unknown>;
type OrderItemKind = 'food' | 'side';
type ParsedOption = {
  id: number;
  quantity: number;
  price_at_time: number;
  raw: UnknownRecord;
};
type ParsedOrderItem = {
  kind: OrderItemKind;
  food_id: number | null;
  side_id: number | null;
  quantity: number;
  price_at_time: number;
  options: ParsedOption[];
};

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

function resolveSideStatus(side: unknown, preferredLocation?: string): AvailabilityStatus {
  const sideRecord: UnknownRecord = typeof side === 'object' && side !== null ? (side as UnknownRecord) : {};

  const availabilityValue = sideRecord['side_availability'];
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
    sideRecord['availability_status'],
    sideRecord['availability'],
    sideRecord['status'],
    typeof sideRecord['is_available'] === 'boolean' ? (sideRecord['is_available'] ? 'available' : 'unavailable') : undefined,
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

async function runFoodsQuery(foodIds: number[], withJoins: boolean, includePrice: boolean) {
  const selectBase = includePrice
    ? 'id,price,status,availability_status,availability,is_available'
    : 'id,status,availability_status,availability,is_available';

  if (withJoins) {
    return await supabase
      .from('foods')
      .select(`${selectBase},food_availability(*)`)
      .in('id', foodIds);
  }

  return await supabase
    .from('foods')
    .select(selectBase)
    .in('id', foodIds);
}

async function runSidesQuery(sideIds: number[], withJoins: boolean, includePrice: boolean) {
  const selectBase = includePrice
    ? 'id,price,status,availability_status,availability,is_available'
    : 'id,status,availability_status,availability,is_available';

  if (withJoins) {
    return await supabase
      .from('sides')
      .select(`${selectBase},side_availability(*)`)
      .in('id', sideIds);
  }

  return await supabase
    .from('sides')
    .select(selectBase)
    .in('id', sideIds);
}

async function fetchFoodsForValidation(foodIds: number[]) {
  let { data, error } = await runFoodsQuery(foodIds, true, true);
  if (error && isSchemaMismatch(error)) {
    ({ data, error } = await runFoodsQuery(foodIds, false, true));
  }
  if (error && isSchemaMismatch(error)) {
    ({ data, error } = await runFoodsQuery(foodIds, true, false));
    if (error && isSchemaMismatch(error)) {
      ({ data, error } = await runFoodsQuery(foodIds, false, false));
    }
  }

  return { data, error };
}

async function fetchSidesForValidation(sideIds: number[]) {
  let { data, error } = await runSidesQuery(sideIds, true, true);
  if (error && isSchemaMismatch(error)) {
    ({ data, error } = await runSidesQuery(sideIds, false, true));
  }
  if (error && isSchemaMismatch(error)) {
    ({ data, error } = await runSidesQuery(sideIds, true, false));
    if (error && isSchemaMismatch(error)) {
      ({ data, error } = await runSidesQuery(sideIds, false, false));
    }
  }

  return { data, error };
}

export async function GET(req: NextRequest) {
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

    const parsedItems: ParsedOrderItem[] = [];
    for (const rawItem of items as unknown[]) {
      const item: UnknownRecord = typeof rawItem === 'object' && rawItem !== null ? (rawItem as UnknownRecord) : {};
      const itemType = typeof item.item_type === 'string' ? item.item_type.trim().toLowerCase() : '';
      const hasFoodId = item.food_id !== null && item.food_id !== undefined && String(item.food_id).trim() !== '';
      const hasSideId = item.side_id !== null && item.side_id !== undefined && String(item.side_id).trim() !== '';
      const kind: OrderItemKind | null =
        hasFoodId || itemType === 'food' ? 'food' : hasSideId || itemType === 'side' ? 'side' : null;

      if (!kind) {
        return NextResponse.json({ error: 'Each item must have food_id or side_id' }, { status: 422 });
      }

      const rawPrimaryId = kind === 'food' ? item.food_id : item.side_id;
      const primaryId = Number(rawPrimaryId);
      const quantity = Number(item.quantity ?? 1);
      const priceAtTime = Number(item.price_at_time ?? item.price ?? 0);

      if (!Number.isFinite(primaryId) || !Number.isFinite(quantity) || quantity <= 0) {
        return NextResponse.json({ error: 'Each item must include a valid id and quantity' }, { status: 422 });
      }

      const rawOptions = Array.isArray(item.options) ? item.options : [];
      const parsedOptions: ParsedOption[] = [];

      for (const rawOption of rawOptions) {
        const option: UnknownRecord = typeof rawOption === 'object' && rawOption !== null ? (rawOption as UnknownRecord) : {};
        const optionId = Number(option.id);
        const optionQuantity = Number(option.quantity ?? 1);
        const optionPrice = Number(option.price ?? option.price_at_time ?? 0);

        if (!Number.isFinite(optionId) || !Number.isFinite(optionQuantity) || optionQuantity <= 0) {
          return NextResponse.json({ error: 'Each option must include a valid id and quantity' }, { status: 422 });
        }

        parsedOptions.push({
          id: optionId,
          quantity: optionQuantity,
          price_at_time: Number.isFinite(optionPrice) ? optionPrice : 0,
          raw: option,
        });
      }

      parsedItems.push({
        kind,
        food_id: kind === 'food' ? primaryId : null,
        side_id: kind === 'side' ? primaryId : null,
        quantity,
        price_at_time: Number.isFinite(priceAtTime) ? priceAtTime : 0,
        options: parsedOptions,
      });
    }

    if (parsedItems.length === 0) {
      return NextResponse.json({ error: 'No valid order items' }, { status: 400 });
    }

    const foodIds = Array.from(new Set(parsedItems.map((item) => item.food_id).filter((id): id is number => id !== null)));
    const sideIds = Array.from(new Set(parsedItems.map((item) => item.side_id).filter((id): id is number => id !== null)));
    const optionIds = Array.from(new Set(parsedItems.flatMap((item) => item.options.map((option) => option.id))));

    let foods: unknown[] | null = [];
    if (foodIds.length > 0) {
      const { data, error } = await fetchFoodsForValidation(foodIds);
      if (error) {
        console.error('Order validation foods lookup error:', error);
        return NextResponse.json({ error: 'Unable to validate items' }, { status: 500 });
      }
      foods = Array.isArray(data) ? data : [];
    }

    let sides: unknown[] | null = [];
    const allSideIds = Array.from(new Set([...sideIds, ...optionIds]));
    if (allSideIds.length > 0) {
      const { data, error } = await fetchSidesForValidation(allSideIds);
      if (error) {
        console.error('Order validation sides lookup error:', error);
        return NextResponse.json({ error: 'Unable to validate items' }, { status: 500 });
      }
      sides = Array.isArray(data) ? data : [];
    }

    const foodById = new Map<number, UnknownRecord>();
    for (const food of Array.isArray(foods) ? foods : []) {
      const record: UnknownRecord = typeof food === 'object' && food !== null ? (food as UnknownRecord) : {};
      const id = Number(record.id);
      if (Number.isFinite(id)) foodById.set(id, record);
    }

    const sideById = new Map<number, UnknownRecord>();
    for (const side of Array.isArray(sides) ? sides : []) {
      const record: UnknownRecord = typeof side === 'object' && side !== null ? (side as UnknownRecord) : {};
      const id = Number(record.id);
      if (Number.isFinite(id)) sideById.set(id, record);
    }

    let computedTotal = 0;
    let canComputeTotal = true;

    for (const item of parsedItems) {
      const baseRecord = item.kind === 'food' ? foodById.get(item.food_id as number) : sideById.get(item.side_id as number);
      if (!baseRecord) {
        return NextResponse.json({ error: 'Invalid order item' }, { status: 400 });
      }

      const statusResolved =
        item.kind === 'food'
          ? resolveFoodStatus(baseRecord, normalizedLocation)
          : resolveSideStatus(baseRecord, normalizedLocation);
      if (statusResolved !== 'available') {
        return NextResponse.json({ error: 'Item not available' }, { status: 400 });
      }

      const price = Number(baseRecord.price);
      if (!Number.isFinite(price) || price < 0) {
        canComputeTotal = false;
      } else {
        computedTotal += price * item.quantity;
      }

      for (const option of item.options) {
        const optionRecord = sideById.get(option.id);
        if (!optionRecord) {
          return NextResponse.json({ error: 'Invalid item option' }, { status: 400 });
        }

        const optionStatus = resolveSideStatus(optionRecord, normalizedLocation);
        if (optionStatus !== 'available') {
          return NextResponse.json({ error: 'Item option not available' }, { status: 400 });
        }

        const optionPrice = Number(optionRecord.price);
        if (!Number.isFinite(optionPrice) || optionPrice < 0) {
          canComputeTotal = false;
        } else {
          computedTotal += optionPrice * option.quantity * item.quantity;
        }
      }
    }

    const vatNumber = Number(vat ?? 0);
    const expectedTotal = canComputeTotal ? computedTotal + (Number.isFinite(vatNumber) ? vatNumber : 0) : null;
    if (expectedTotal !== null && Number.isFinite(expectedTotal) && expectedTotal > 0) {
      const difference = Math.abs(totalNumber - expectedTotal);
      if (difference > 0.01) {
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
      side_id: item.side_id,
      quantity: item.quantity,
      price_at_time: item.price_at_time,
      options: item.options.map((option) => option.raw),
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
