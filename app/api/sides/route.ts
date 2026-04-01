import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { validateRequest, unauthorizedResponse } from '@/lib/auth';
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

export async function GET(req: NextRequest) {
  if (!validateRequest(req)) return unauthorizedResponse();

  try {
    const searchParams = req.nextUrl.searchParams;
    const store = searchParams.get('store');
    const location = searchParams.get('location');
    const state = searchParams.get('state');

    const preferredLocation = normalizeLocation(location ?? store);
    const storeCode = store ? normalizeLocation(store) : undefined;
    const locationCode = location ? normalizeLocation(location) : undefined;
    const storeValues = storeCode ? (storeCode === 'Eromo' ? ['Eromo', 'Aurora'] : [storeCode]) : undefined;
    const locationValues = locationCode ? (locationCode === 'Eromo' ? ['Eromo', 'Aurora'] : [locationCode]) : undefined;

    const runQuery = async (withJoins: boolean) => {
      if (withJoins) {
        let query = supabase
          .from('sides')
          .select('*,side_availability(*)')
          .neq('type', 'extra')
          .order('name');

        if (state) query = query.eq('state', state);
        if (storeValues) query = storeValues.length > 1 ? query.in('store', storeValues) : query.eq('store', storeValues[0]);
        if (locationValues) query = locationValues.length > 1 ? query.in('location', locationValues) : query.eq('location', locationValues[0]);

        const { data, error } = await query;
        return { data, error };
      }

      let query = supabase.from('sides').select('*').neq('type', 'extra').order('name');

      if (state) query = query.eq('state', state);
      if (storeValues) query = storeValues.length > 1 ? query.in('store', storeValues) : query.eq('store', storeValues[0]);
      if (locationValues) query = locationValues.length > 1 ? query.in('location', locationValues) : query.eq('location', locationValues[0]);

      const { data, error } = await query;
      return { data, error };
    };

    let { data, error } = await runQuery(true);
    if (error && isSchemaMismatch(error)) {
      ({ data, error } = await runQuery(false));
    }
    if (error) throw error;

    const sides = Array.isArray(data) ? data : [];
    const filtered = sides
      .map((side: unknown) => {
        const sideRecord: UnknownRecord = typeof side === 'object' && side !== null ? (side as UnknownRecord) : {};
        const availabilityValue = sideRecord['side_availability'];
        const filteredAvailability =
          Array.isArray(availabilityValue) && preferredLocation
            ? availabilityValue.filter((row: unknown) => {
                const rowRecord: UnknownRecord = typeof row === 'object' && row !== null ? (row as UnknownRecord) : {};
                const rawLocation = rowRecord['location'] ?? rowRecord['store'];
                const normalized = normalizeLocation(typeof rawLocation === 'string' ? rawLocation : undefined);
                return normalized === preferredLocation;
              })
            : availabilityValue;
        const resolvedStatus = resolveSideStatus({ ...sideRecord, side_availability: filteredAvailability }, preferredLocation);
        return { ...sideRecord, ...(filteredAvailability !== undefined ? { side_availability: filteredAvailability } : {}), status: resolvedStatus };
      })
      .filter((side) => (side as UnknownRecord)['status'] !== 'unavailable');

    return NextResponse.json(filtered);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
