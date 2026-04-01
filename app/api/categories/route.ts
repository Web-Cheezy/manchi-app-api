import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { normalizeLocation } from '@/lib/utils';

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
  try {
    const searchParams = req.nextUrl.searchParams;
    const store = searchParams.get('store');
    const location = searchParams.get('location');
    const state = searchParams.get('state');

    if (!store && !location && !state) {
      const { data, error } = await supabase.from('categories').select('*').order('id');
      if (error) throw error;
      return NextResponse.json(data);
    }

    const preferredLocation = normalizeLocation(location ?? store);
    const storeCode = store ? normalizeLocation(store) : undefined;
    const locationCode = location ? normalizeLocation(location) : undefined;
    const storeValues = storeCode ? (storeCode === 'Eromo' ? ['Eromo', 'Aurora'] : [storeCode]) : undefined;
    const locationValues = locationCode ? (locationCode === 'Eromo' ? ['Eromo', 'Aurora'] : [locationCode]) : undefined;

    const runFoodsQuery = async (withJoins: boolean, applyFilters: boolean) => {
      if (withJoins) {
        let query = supabase
          .from('foods')
          .select('category_id,status,availability_status,availability,is_available,food_availability(*)');

        if (applyFilters) {
          if (state) query = query.eq('state', state);
          if (storeValues) query = storeValues.length > 1 ? query.in('store', storeValues) : query.eq('store', storeValues[0]);
          if (locationValues) query = locationValues.length > 1 ? query.in('location', locationValues) : query.eq('location', locationValues[0]);
        }

        const { data, error } = await query;
        return { data, error };
      }

      let query = supabase.from('foods').select('category_id,status,availability_status,availability,is_available');

      if (applyFilters) {
        if (state) query = query.eq('state', state);
        if (storeValues) query = storeValues.length > 1 ? query.in('store', storeValues) : query.eq('store', storeValues[0]);
        if (locationValues) query = locationValues.length > 1 ? query.in('location', locationValues) : query.eq('location', locationValues[0]);
      }

      const { data, error } = await query;
      return { data, error };
    };

    let { data: foods, error: foodsError } = await runFoodsQuery(true, true);
    if (foodsError && isSchemaMismatch(foodsError)) {
      ({ data: foods, error: foodsError } = await runFoodsQuery(false, true));
    }
    if (foodsError && isSchemaMismatch(foodsError)) {
      ({ data: foods, error: foodsError } = await runFoodsQuery(true, false));
    }
    if (foodsError && isSchemaMismatch(foodsError)) {
      ({ data: foods, error: foodsError } = await runFoodsQuery(false, false));
    }
    if (foodsError) {
      const { data, error } = await supabase.from('categories').select('*').order('id');
      if (error) throw error;
      return NextResponse.json(data);
    }

    const categoryIds = new Set<string | number>();
    for (const food of Array.isArray(foods) ? foods : []) {
      const foodRecord: UnknownRecord = typeof food === 'object' && food !== null ? (food as UnknownRecord) : {};
      const availabilityValue = foodRecord['food_availability'];
      const filteredAvailability =
        Array.isArray(availabilityValue) && preferredLocation
          ? availabilityValue.filter((row: unknown) => {
              const rowRecord: UnknownRecord = typeof row === 'object' && row !== null ? (row as UnknownRecord) : {};
              const rawLocation = rowRecord['location'] ?? rowRecord['store'];
              const normalized = normalizeLocation(typeof rawLocation === 'string' ? rawLocation : undefined);
              return normalized === preferredLocation;
            })
          : availabilityValue;

      const status = resolveFoodStatus({ ...foodRecord, food_availability: filteredAvailability }, preferredLocation);
      if (status === 'unavailable') continue;
      const categoryId = foodRecord['category_id'];
      if (categoryId !== null && categoryId !== undefined) {
        categoryIds.add(categoryId as string | number);
      }
    }

    const ids = Array.from(categoryIds);
    if (ids.length === 0) return NextResponse.json([]);

    const { data, error } = await supabase.from('categories').select('*').in('id', ids).order('id');
    if (error) throw error;
    return NextResponse.json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
