import { normalizeLocation } from '@/lib/utils';

export type AvailabilityStatus = 'available' | 'out_of_stock' | 'unavailable';
export type UnknownRecord = Record<string, unknown>;

export function normalizeAvailabilityStatus(value: unknown): AvailabilityStatus | undefined {
  if (value === null || value === undefined) return undefined;
  const v = String(value).trim().toLowerCase();
  if (v === 'available') return 'available';
  if (v === 'out_of_stock' || v === 'out-of-stock' || v === 'outofstock') return 'out_of_stock';
  if (v === 'unavailable') return 'unavailable';
  return undefined;
}

export function isSchemaMismatch(error: unknown): boolean {
  const msg = String((error as { message?: unknown } | null)?.message ?? '').toLowerCase();
  return msg.includes('does not exist') || msg.includes('schema cache') || msg.includes('column') || msg.includes('relation');
}

export function filterAvailabilityRows(rows: unknown, preferredLocation?: string): unknown {
  if (!Array.isArray(rows)) return rows;
  if (!preferredLocation) return rows;

  return rows.filter((row: unknown) => {
    const rowRecord: UnknownRecord = typeof row === 'object' && row !== null ? (row as UnknownRecord) : {};
    const rawLocation = rowRecord['location'] ?? rowRecord['store'];
    const normalized = normalizeLocation(typeof rawLocation === 'string' ? rawLocation : undefined);
    return normalized === preferredLocation;
  });
}

export function resolveFoodStatus(food: unknown, preferredLocation?: string): AvailabilityStatus {
  const foodRecord: UnknownRecord = typeof food === 'object' && food !== null ? (food as UnknownRecord) : {};

  const availabilityValue = foodRecord['food_availability'];
  if (Array.isArray(availabilityValue) && availabilityValue.length > 0) {
    const availabilityRows = filterAvailabilityRows(availabilityValue, preferredLocation) as unknown[];
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

export function resolveSideStatus(side: unknown, preferredLocation?: string): AvailabilityStatus {
  const sideRecord: UnknownRecord = typeof side === 'object' && side !== null ? (side as UnknownRecord) : {};

  const availabilityValue = sideRecord['side_availability'];
  if (Array.isArray(availabilityValue) && availabilityValue.length > 0) {
    const availabilityRows = filterAvailabilityRows(availabilityValue, preferredLocation) as unknown[];
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

/** Filter nested side_availability on menu option items for the active store. */
export function decorateSideForLocation(side: unknown, preferredLocation?: string): UnknownRecord {
  const sideRecord: UnknownRecord = typeof side === 'object' && side !== null ? (side as UnknownRecord) : {};
  const availabilityValue = sideRecord['side_availability'];
  const filteredAvailability = filterAvailabilityRows(availabilityValue, preferredLocation);
  const status = resolveSideStatus({ ...sideRecord, side_availability: filteredAvailability }, preferredLocation);

  return {
    ...sideRecord,
    ...(filteredAvailability !== undefined ? { side_availability: filteredAvailability } : {}),
    status,
  };
}

export function decorateOptionGroupsForLocation(groups: unknown, preferredLocation?: string): UnknownRecord[] {
  if (!Array.isArray(groups)) return [];

  return groups
    .map((group: unknown) => {
      const groupRecord: UnknownRecord = typeof group === 'object' && group !== null ? (group as UnknownRecord) : {};
      const rawSides = groupRecord['sides'];
      const sides = Array.isArray(rawSides)
        ? rawSides
            .map((side) => decorateSideForLocation(side, preferredLocation))
            .filter((side) => side['status'] !== 'unavailable')
        : [];

      return { ...groupRecord, sides } as UnknownRecord;
    })
    .sort((a, b) => Number(a['display_order'] ?? 0) - Number(b['display_order'] ?? 0));
}
