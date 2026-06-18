import type { SupabaseClient } from '@supabase/supabase-js';
import { isSchemaMismatch, type UnknownRecord } from '@/lib/availability';
import type { OptionGroupRow } from '@/lib/optionGroups';

export const OPTION_GROUPS_PRICING_SELECT =
  'id,food_id,name,min_selections,max_selections,is_required,display_order,default_side_id,sides(id,name,price,type,image_url,option_group_id,side_availability(*))';

export function sideUnitPrice(side: UnknownRecord): number {
  const price = Number(side['price']);
  return Number.isFinite(price) && price >= 0 ? price : 0;
}

/** Required groups must be chosen at checkout; their included option is part of menu price. */
export function isRequiredOptionGroup(group: Pick<OptionGroupRow, 'is_required' | 'min_selections'>): boolean {
  const min = Math.max(0, Number(group.min_selections ?? 0));
  return Boolean(group.is_required) || min > 0;
}

/** Menu card / list price. Computes from groups when present; otherwise uses stored display_price. */
export function effectiveMenuPrice(food: UnknownRecord, groups?: OptionGroupRow[]): number {
  const base = Number(food['price']);
  const basePrice = Number.isFinite(base) && base >= 0 ? base : 0;

  if (groups && groups.length > 0) {
    const computed = computeDisplayPrice(basePrice, groups);
    const stored = Number(food['display_price']);
    // Admin-set display_price wins when defaults are not fully configured in DB.
    if (Number.isFinite(stored) && stored >= basePrice && stored > computed) {
      return stored;
    }
    return computed;
  }

  const stored = Number(food['display_price']);
  if (Number.isFinite(stored) && stored >= 0) return stored;
  return basePrice;
}

/** base + sum(price of each group's admin-selected default_side_id). */
export function computeDisplayPrice(basePrice: number, groups: OptionGroupRow[]): number {
  let total = basePrice;
  for (const group of groups) {
    const defaultId = resolvePricingDefaultSideId(group, group.sides ?? []);
    if (defaultId === null) continue;

    const defaultSide = (group.sides ?? []).find((s) => Number(s['id']) === defaultId);
    if (defaultSide) total += sideUnitPrice(defaultSide);
  }
  return total;
}

/** Explicit admin default, else cheapest side in group (pricing baseline for deltas). */
export function resolvePricingDefaultSideId(
  group: Pick<OptionGroupRow, 'default_side_id'>,
  rawSides: UnknownRecord[]
): number | null {
  const explicit = group.default_side_id;
  if (explicit !== null && explicit !== undefined && Number.isFinite(Number(explicit))) {
    return Number(explicit);
  }

  const sides = Array.isArray(rawSides) ? rawSides : [];
  if (sides.length === 0) return null;

  let cheapestId: number | null = null;
  let cheapestPrice = Infinity;
  for (const sideRaw of sides) {
    const side: UnknownRecord = typeof sideRaw === 'object' && sideRaw !== null ? sideRaw : {};
    const sideId = Number(side['id']);
    const sidePrice = sideUnitPrice(side);
    if (!Number.isFinite(sideId)) continue;
    if (sidePrice < cheapestPrice) {
      cheapestPrice = sidePrice;
      cheapestId = sideId;
    }
  }
  return cheapestId;
}

/** Unit line price for checkout: base + all selected option prices. */
export function computeUnitPriceFromSelections(basePrice: number, selections: Array<{ price: number; quantity: number }>): number {
  const optionsTotal = selections.reduce((sum, s) => sum + s.price * s.quantity, 0);
  return basePrice + optionsTotal;
}

/** Unit price via display + deltas (equivalent to base + selected). */
export function computeUnitPriceFromDisplay(
  displayPrice: number,
  selections: Array<{ price_delta: number; quantity: number }>
): number {
  const adjustment = selections.reduce((sum, s) => sum + s.price_delta * s.quantity, 0);
  return displayPrice + adjustment;
}

export function getDefaultSidePrice(group: OptionGroupRow): number {
  const defaultId = resolvePricingDefaultSideId(group, group.sides ?? []);
  if (defaultId === null) return 0;
  const defaultSide = (group.sides ?? []).find((s) => Number(s['id']) === defaultId);
  return defaultSide ? sideUnitPrice(defaultSide) : 0;
}

/** Attach is_pricing_default, price_delta, and pricing_default_side_id for customer UI. */
export function enrichOptionGroupsWithPricing(groups: UnknownRecord[]): UnknownRecord[] {
  if (!Array.isArray(groups)) return [];

  return groups.map((groupRaw) => {
    const group: UnknownRecord = typeof groupRaw === 'object' && groupRaw !== null ? (groupRaw as UnknownRecord) : {};
    const rawSides = group['sides'];
    const sidesList = Array.isArray(rawSides) ? (rawSides as UnknownRecord[]) : [];
    const groupRow = group as OptionGroupRow;
    const pricingDefaultId = resolvePricingDefaultSideId(groupRow, sidesList);

    const sides = sidesList.map((sideRaw) => {
      const side: UnknownRecord = typeof sideRaw === 'object' && sideRaw !== null ? sideRaw : {};
      const sideId = Number(side['id']);
      const sidePrice = sideUnitPrice(side);
      const isDefault =
        pricingDefaultId !== null && Number.isFinite(pricingDefaultId) && sideId === pricingDefaultId;

      let defaultPrice = 0;
      if (pricingDefaultId !== null && Number.isFinite(pricingDefaultId)) {
        const defaultSide = sidesList.find((s) => Number(s['id']) === pricingDefaultId);
        defaultPrice = defaultSide ? sideUnitPrice(defaultSide) : 0;
      }

      const priceDelta =
        pricingDefaultId !== null && Number.isFinite(pricingDefaultId) ? sidePrice - defaultPrice : sidePrice;

      return {
        ...side,
        is_pricing_default: isDefault,
        price_delta: priceDelta,
      };
    });

    return {
      ...group,
      name: typeof group['name'] === 'string' && group['name'].trim() ? group['name'].trim() : groupDisplayName(group),
      pricing_default_side_id: pricingDefaultId,
      sides,
    };
  });
}

function groupDisplayName(group: UnknownRecord): string {
  const name = typeof group['name'] === 'string' ? group['name'].trim() : '';
  if (name) return name;
  const type = typeof group['type'] === 'string' ? group['type'].trim() : '';
  if (type) return type.charAt(0).toUpperCase() + type.slice(1);
  const id = Number(group['id']);
  return Number.isFinite(id) ? `Options ${id}` : 'Options';
}

function unwrapLinkedSide(link: UnknownRecord): UnknownRecord | null {
  const nested = link['sides'] ?? link['side'];
  if (Array.isArray(nested)) {
    const first = nested[0];
    return typeof first === 'object' && first !== null ? (first as UnknownRecord) : null;
  }
  return typeof nested === 'object' && nested !== null ? (nested as UnknownRecord) : null;
}

/** Load groups + default side prices for display_price recompute (no nested join dependency). */
export async function fetchOptionGroupsForPricing(
  db: SupabaseClient,
  foodId: number
): Promise<OptionGroupRow[]> {
  const groupSelects = [
    'id,food_id,name,min_selections,max_selections,is_required,display_order,default_side_id',
    'id,food_id,name,min_selections,max_selections,is_required,display_order',
  ] as const;

  let groups: OptionGroupRow[] = [];
  for (const select of groupSelects) {
    const { data, error } = await db
      .from('option_groups')
      .select(select)
      .eq('food_id', foodId)
      .order('display_order', { ascending: true });

    if (!error) {
      groups = (Array.isArray(data) ? data : []) as unknown as OptionGroupRow[];
      break;
    }
    if (!isSchemaMismatch(error) && !isQueryShapeError(error)) throw error;
  }

  if (groups.length === 0) return groups;

  const defaultSideIds = [
    ...new Set(
      groups
        .map((group) => group.default_side_id)
        .filter((id): id is number => id !== null && id !== undefined && Number.isFinite(Number(id)))
        .map((id) => Number(id))
    ),
  ];

  const sidesById = new Map<number, UnknownRecord>();
  if (defaultSideIds.length > 0) {
    const { data: sidesRaw, error: sidesError } = await db
      .from('sides')
      .select('id,name,price')
      .in('id', defaultSideIds);

    if (sidesError) throw sidesError;
    for (const side of Array.isArray(sidesRaw) ? sidesRaw : []) {
      const record = side as UnknownRecord;
      sidesById.set(Number(record['id']), record);
    }
  }

  return groups.map((group) => {
    const defaultId = group.default_side_id;
    const defaultSide =
      defaultId !== null && defaultId !== undefined ? sidesById.get(Number(defaultId)) : undefined;
    return {
      ...group,
      sides: defaultSide ? [defaultSide] : [],
    };
  });
}

export async function refreshFoodDisplayPrice(db: SupabaseClient, foodId: number): Promise<number | null> {
  let { data: food, error: foodError } = await db.from('foods').select('id,price,display_price').eq('id', foodId).single();

  if (foodError && isSchemaMismatch(foodError)) return null;
  if (foodError || !food) throw foodError ?? new Error('Food not found');

  let groups: OptionGroupRow[] = [];
  try {
    groups = await fetchOptionGroupsForPricing(db, foodId);
  } catch (error) {
    if (isSchemaMismatch(error) || isQueryShapeError(error)) {
      return Number(food.price);
    }
    throw error;
  }

  const basePrice = Number(food.price);
  const displayPrice = computeDisplayPrice(Number.isFinite(basePrice) ? basePrice : 0, groups);

  const { error: updateError } = await db.from('foods').update({ display_price: displayPrice }).eq('id', foodId);
  if (updateError && isSchemaMismatch(updateError)) return displayPrice;
  if (updateError) throw updateError;

  return displayPrice;
}

export function buildSelectionPricingFields(
  group: OptionGroupRow,
  side: UnknownRecord
): { price: number; price_delta: number; is_pricing_default: boolean } {
  const sideId = Number(side['id']);
  const price = sideUnitPrice(side);

  const defaultId = resolvePricingDefaultSideId(group, group.sides ?? [side]);
  const isDefault = defaultId !== null && sideId === defaultId;
  const defaultPrice = getDefaultSidePrice({ ...group, sides: group.sides ?? [side] });
  const priceDelta = defaultId !== null && Number.isFinite(defaultId) ? price - defaultPrice : price;

  return { price, price_delta: priceDelta, is_pricing_default: isDefault };
}

function isQueryShapeError(error: unknown): boolean {
  if (isSchemaMismatch(error)) return true;
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message?: unknown }).message ?? '').toLowerCase()
      : '';
  return (
    message.includes('relationship') ||
    message.includes('could not find') ||
    message.includes('pgrst200') ||
    message.includes('schema cache')
  );
}

const ADMIN_OPTION_GROUP_SELECTS = [
  OPTION_GROUPS_PRICING_SELECT,
  'id,food_id,name,min_selections,max_selections,is_required,display_order,default_side_id,sides(id,name,price,type,image_url,option_group_id,side_availability(*))',
  'id,food_id,name,min_selections,max_selections,is_required,display_order,default_side_id,sides(id,name,price,type,image_url,option_group_id)',
  'id,food_id,name,min_selections,max_selections,is_required,display_order,default_side_id,sides(id,name,price,option_group_id)',
] as const;

/** Admin editor: load option groups + sides with nested-select fallbacks and manual join if needed. */
export async function fetchAdminOptionGroupsForFood(db: SupabaseClient, foodId: number): Promise<UnknownRecord[]> {
  for (const select of ADMIN_OPTION_GROUP_SELECTS) {
    const { data, error } = await db
      .from('option_groups')
      .select(select as string)
      .eq('food_id', foodId)
      .order('display_order', { ascending: true });

    if (!error) {
      const groups = Array.isArray(data) ? (data as unknown as UnknownRecord[]) : [];
      return enrichOptionGroupsWithPricing(groups);
    }
    if (!isQueryShapeError(error)) throw error;
  }

  const { data: groupsRaw, error: groupsError } = await db
    .from('option_groups')
    .select('*')
    .eq('food_id', foodId)
    .order('display_order', { ascending: true });

  if (groupsError) throw groupsError;

  const groups = Array.isArray(groupsRaw) ? groupsRaw : [];
  if (groups.length === 0) return [];

  const groupIds = groups.map((g) => Number((g as { id: unknown }).id)).filter((id) => Number.isFinite(id));

  let sides: UnknownRecord[] = [];
  if (groupIds.length > 0) {
    const { data: sidesRaw, error: sidesError } = await db
      .from('sides')
      .select('id,name,price,type,image_url,option_group_id,side_availability(*)')
      .in('option_group_id', groupIds);

    if (sidesError && isQueryShapeError(sidesError)) {
      const fallback = await db.from('sides').select('id,name,price,option_group_id').in('option_group_id', groupIds);
      if (fallback.error) throw fallback.error;
      sides = Array.isArray(fallback.data) ? (fallback.data as UnknownRecord[]) : [];
    } else if (sidesError) {
      throw sidesError;
    } else {
      sides = Array.isArray(sidesRaw) ? (sidesRaw as UnknownRecord[]) : [];
    }
  }

  const sidesByGroup = new Map<number, UnknownRecord[]>();
  for (const side of sides) {
    const groupId = Number(side['option_group_id']);
    if (!Number.isFinite(groupId)) continue;
    const list = sidesByGroup.get(groupId) ?? [];
    list.push(side);
    sidesByGroup.set(groupId, list);
  }

  const merged = groups.map((group) => {
    const record = group as UnknownRecord;
    const groupId = Number(record['id']);
    return {
      ...record,
      sides: sidesByGroup.get(groupId) ?? [],
    };
  });

  return enrichOptionGroupsWithPricing(merged);
}

function groupsHaveSides(groups: UnknownRecord[]): boolean {
  return groups.some((group) => Array.isArray(group['sides']) && (group['sides'] as unknown[]).length > 0);
}

async function manualJoinOptionGroupsWithSides(
  db: SupabaseClient,
  groups: UnknownRecord[]
): Promise<UnknownRecord[]> {
  if (groups.length === 0) return [];

  const groupIds = groups
    .map((g) => Number(g['id']))
    .filter((id) => Number.isFinite(id));

  let sides: UnknownRecord[] = [];
  if (groupIds.length > 0) {
    const { data: sidesRaw, error: sidesError } = await db
      .from('sides')
      .select('id,name,price,type,image_url,option_group_id,side_availability(*)')
      .in('option_group_id', groupIds);

    if (sidesError && isQueryShapeError(sidesError)) {
      const fallback = await db.from('sides').select('id,name,price,option_group_id').in('option_group_id', groupIds);
      if (fallback.error) throw fallback.error;
      sides = Array.isArray(fallback.data) ? (fallback.data as UnknownRecord[]) : [];
    } else if (sidesError) {
      throw sidesError;
    } else {
      sides = Array.isArray(sidesRaw) ? (sidesRaw as UnknownRecord[]) : [];
    }
  }

  const sidesByGroup = new Map<number, UnknownRecord[]>();
  for (const side of sides) {
    const groupId = Number(side['option_group_id']);
    if (!Number.isFinite(groupId)) continue;
    const list = sidesByGroup.get(groupId) ?? [];
    list.push(side);
    sidesByGroup.set(groupId, list);
  }

  return groups.map((group) => {
    const groupId = Number(group['id']);
    return {
      ...group,
      sides: sidesByGroup.get(groupId) ?? [],
    };
  });
}

async function fetchOptionGroupsFromFoodSides(db: SupabaseClient, foodId: number): Promise<UnknownRecord[]> {
  const linkSelects = [
    'is_required, side_id, sides(id,name,price,type,image_url,option_group_id,side_availability(*))',
    'is_required, side_id, sides(id,name,price,option_group_id)',
  ] as const;

  let links: UnknownRecord[] = [];
  for (const select of linkSelects) {
    const { data, error } = await db.from('food_sides').select(select).eq('food_id', foodId);
    if (!error) {
      links = Array.isArray(data) ? (data as UnknownRecord[]) : [];
      break;
    }
    if (!isQueryShapeError(error) && !isSchemaMismatch(error)) throw error;
  }

  if (links.length === 0) return [];

  const sidesByGroupId = new Map<number, UnknownRecord[]>();
  const requiredByGroupId = new Map<number, boolean>();

  for (const link of links) {
    const side = unwrapLinkedSide(link);
    if (!side) continue;
    const groupId = Number(side['option_group_id']);
    if (!Number.isFinite(groupId)) continue;

    const list = sidesByGroupId.get(groupId) ?? [];
    list.push(side);
    sidesByGroupId.set(groupId, list);

    if (Boolean(link['is_required'])) {
      requiredByGroupId.set(groupId, true);
    }
  }

  if (sidesByGroupId.size === 0) return [];

  const groupIds = [...sidesByGroupId.keys()];
  const { data: groupsRaw, error: groupsError } = await db
    .from('option_groups')
    .select('id,food_id,name,min_selections,max_selections,is_required,display_order,default_side_id')
    .in('id', groupIds)
    .order('display_order', { ascending: true });

  if (groupsError && !isSchemaMismatch(groupsError) && !isQueryShapeError(groupsError)) {
    throw groupsError;
  }

  const groupById = new Map<number, UnknownRecord>();
  for (const group of Array.isArray(groupsRaw) ? groupsRaw : []) {
    const record = group as UnknownRecord;
    const id = Number(record['id']);
    if (Number.isFinite(id)) groupById.set(id, record);
  }

  return groupIds.map((groupId, index) => {
    const existing = groupById.get(groupId);
    const sides = sidesByGroupId.get(groupId) ?? [];
    const inferredRequired = requiredByGroupId.get(groupId) ?? false;

    return {
      id: groupId,
      food_id: foodId,
      name: existing ? groupDisplayName(existing) : `Options ${groupId}`,
      min_selections: inferredRequired ? 1 : Number(existing?.['min_selections'] ?? 0),
      max_selections: Number(existing?.['max_selections'] ?? 1),
      is_required: Boolean(existing?.['is_required']) || inferredRequired,
      display_order: Number(existing?.['display_order'] ?? index),
      default_side_id: existing?.['default_side_id'] ?? null,
      sides,
    };
  });
}

/** Customer API: full option groups with names, sides, and pricing deltas. */
export async function fetchPublicOptionGroupsForFood(
  db: SupabaseClient,
  foodId: number
): Promise<UnknownRecord[]> {
  for (const select of ADMIN_OPTION_GROUP_SELECTS) {
    const { data, error } = await db
      .from('option_groups')
      .select(select as string)
      .eq('food_id', foodId)
      .order('display_order', { ascending: true });

    if (!error) {
      const groups = Array.isArray(data) ? (data as unknown as UnknownRecord[]) : [];
      if (groupsHaveSides(groups)) {
        return enrichOptionGroupsWithPricing(groups);
      }
      const joined = await manualJoinOptionGroupsWithSides(db, groups);
      if (groupsHaveSides(joined)) {
        return enrichOptionGroupsWithPricing(joined);
      }
      if (joined.length > 0) {
        return enrichOptionGroupsWithPricing(joined);
      }
      break;
    }
    if (!isQueryShapeError(error)) throw error;
  }

  const { data: groupsRaw, error: groupsError } = await db
    .from('option_groups')
    .select('*')
    .eq('food_id', foodId)
    .order('display_order', { ascending: true });

  if (!groupsError) {
    const groups = Array.isArray(groupsRaw) ? (groupsRaw as unknown as UnknownRecord[]) : [];
    const joined = await manualJoinOptionGroupsWithSides(db, groups);
    if (joined.length > 0) {
      return enrichOptionGroupsWithPricing(joined);
    }
  }

  const fromFoodSides = await fetchOptionGroupsFromFoodSides(db, foodId);
  if (fromFoodSides.length > 0) {
    return enrichOptionGroupsWithPricing(fromFoodSides);
  }

  return [];
}

export function attachFoodPricing(
  foodRecord: UnknownRecord,
  optionGroups: UnknownRecord[]
): UnknownRecord {
  const groups = optionGroups as unknown as OptionGroupRow[];
  const basePrice = Number(foodRecord['price']);
  const safeBase = Number.isFinite(basePrice) && basePrice >= 0 ? basePrice : 0;

  return {
    ...foodRecord,
    base_price: safeBase,
    option_groups: groups,
    has_options: groups.length > 0,
    menu_price: effectiveMenuPrice(foodRecord, groups),
  };
}
