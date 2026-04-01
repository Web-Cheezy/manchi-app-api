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
  const searchParams = req.nextUrl.searchParams;
  const foodId = searchParams.get('id');
  const categoryId = searchParams.get('categoryId');
  const store = searchParams.get('store');
  const location = searchParams.get('location');
  const state = searchParams.get('state');

  const preferredLocation = normalizeLocation(location ?? store);
  const storeCode = store ? normalizeLocation(store) : undefined;
  const locationCode = location ? normalizeLocation(location) : undefined;
  const storeValues = storeCode ? (storeCode === 'Eromo' ? ['Eromo', 'Aurora'] : [storeCode]) : undefined;
  const locationValues = locationCode ? (locationCode === 'Eromo' ? ['Eromo', 'Aurora'] : [locationCode]) : undefined;

  try {
    if (foodId) {
      const runQuery = async (withJoins: boolean, applyFilters: boolean) => {
        if (withJoins) {
          let query = supabase
            .from('foods')
            .select('*,food_availability(*),food_sides(side:sides(*))')
            .eq('id', foodId);

          if (applyFilters) {
            if (state) query = query.eq('state', state);
            if (storeValues) query = storeValues.length > 1 ? query.in('store', storeValues) : query.eq('store', storeValues[0]);
            if (locationValues) query = locationValues.length > 1 ? query.in('location', locationValues) : query.eq('location', locationValues[0]);
          }

          const { data, error } = await query.single();
          return { data, error };
        }

        let query = supabase.from('foods').select('*').eq('id', foodId);

        if (applyFilters) {
          if (state) query = query.eq('state', state);
          if (storeValues) query = storeValues.length > 1 ? query.in('store', storeValues) : query.eq('store', storeValues[0]);
          if (locationValues) query = locationValues.length > 1 ? query.in('location', locationValues) : query.eq('location', locationValues[0]);
        }

        const { data, error } = await query.single();
        return { data, error };
      };

      let { data, error } = await runQuery(true, true);
      if (error && isSchemaMismatch(error)) {
        ({ data, error } = await runQuery(false, true));
      }
      if (error && isSchemaMismatch(error)) {
        ({ data, error } = await runQuery(true, false));
      }
      if (error && isSchemaMismatch(error)) {
        ({ data, error } = await runQuery(false, false));
      }
      if (error) throw error;
      if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

      const dataRecord: UnknownRecord = typeof data === 'object' && data !== null ? (data as UnknownRecord) : {};
      const availabilityValue = dataRecord['food_availability'];
      const filteredAvailability =
        Array.isArray(availabilityValue) && preferredLocation
          ? availabilityValue.filter((row: unknown) => {
              const rowRecord: UnknownRecord = typeof row === 'object' && row !== null ? (row as UnknownRecord) : {};
              const rawLocation = rowRecord['location'] ?? rowRecord['store'];
              const normalized = normalizeLocation(typeof rawLocation === 'string' ? rawLocation : undefined);
              return normalized === preferredLocation;
            })
          : availabilityValue;

      const resolvedStatus = resolveFoodStatus({ ...dataRecord, food_availability: filteredAvailability }, preferredLocation);
      if (resolvedStatus === 'unavailable') {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }

      return NextResponse.json({ ...dataRecord, ...(filteredAvailability !== undefined ? { food_availability: filteredAvailability } : {}), status: resolvedStatus });
    } else {
      const runQuery = async (withJoins: boolean, applyFilters: boolean) => {
        if (withJoins) {
          let query = supabase.from('foods').select('*,food_availability(*)').order('name');

          if (applyFilters) {
            if (categoryId) query = query.eq('category_id', categoryId);
            if (state) query = query.eq('state', state);
            if (storeValues) query = storeValues.length > 1 ? query.in('store', storeValues) : query.eq('store', storeValues[0]);
            if (locationValues) query = locationValues.length > 1 ? query.in('location', locationValues) : query.eq('location', locationValues[0]);
          }

          const { data, error } = await query;
          return { data, error };
        }

        let query = supabase.from('foods').select('*').order('name');

        if (applyFilters) {
          if (categoryId) query = query.eq('category_id', categoryId);
          if (state) query = query.eq('state', state);
          if (storeValues) query = storeValues.length > 1 ? query.in('store', storeValues) : query.eq('store', storeValues[0]);
          if (locationValues) query = locationValues.length > 1 ? query.in('location', locationValues) : query.eq('location', locationValues[0]);
        }

        const { data, error } = await query;
        return { data, error };
      };

      let { data, error } = await runQuery(true, true);
      if (error && isSchemaMismatch(error)) {
        ({ data, error } = await runQuery(false, true));
      }
      if (error && isSchemaMismatch(error)) {
        ({ data, error } = await runQuery(true, false));
      }
      if (error && isSchemaMismatch(error)) {
        ({ data, error } = await runQuery(false, false));
      }
      if (error) throw error;

      const foods = Array.isArray(data) ? data : [];
      const filtered = foods
        .map((food: unknown) => {
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
          const resolvedStatus = resolveFoodStatus({ ...foodRecord, food_availability: filteredAvailability }, preferredLocation);
          return { ...foodRecord, ...(filteredAvailability !== undefined ? { food_availability: filteredAvailability } : {}), status: resolvedStatus };
        })
        .filter((food) => (food as UnknownRecord)['status'] !== 'unavailable');

      return NextResponse.json(filtered);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
