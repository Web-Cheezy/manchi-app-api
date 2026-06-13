import { supabase } from '@/lib/supabase';
import { resolveSideStatus, type UnknownRecord, isSchemaMismatch } from '@/lib/availability';
import { buildSelectionPricingFields, computeDisplayPrice } from '@/lib/foodPricing';

export type OptionGroupRow = {
  id: number;
  food_id: number;
  name: string;
  min_selections: number;
  max_selections: number;
  is_required: boolean;
  display_order: number;
  default_side_id?: number | null;
  sides?: UnknownRecord[];
};

export type OrderItemOptionsSnapshot = {
  food_id: number;
  food_name: string;
  base_price: number;
  display_price: number;
  price_adjustment: number;
  selections: Array<{
    group_id: number;
    group: string;
    item_id: number;
    name: string;
    price: number;
    price_delta: number;
    is_pricing_default: boolean;
    quantity: number;
  }>;
  item_total: number;
};

export type LineSelectionInput = {
  group_id?: number;
  item_id: number;
  quantity: number;
};

const OPTION_GROUPS_SELECT =
  'id,food_id,name,min_selections,max_selections,is_required,display_order,default_side_id,sides(id,name,price,type,image_url,option_group_id,side_availability(*))';

export async function fetchOptionGroupsForFoods(foodIds: number[]): Promise<Map<number, OptionGroupRow[]>> {
  const result = new Map<number, OptionGroupRow[]>();
  if (foodIds.length === 0) return result;

  const selects = [
    OPTION_GROUPS_SELECT,
    'id,food_id,name,min_selections,max_selections,is_required,display_order,sides(id,name,price,type,image_url,option_group_id,side_availability(*))',
    'id,food_id,name,min_selections,max_selections,is_required,display_order,sides(id,name,price,option_group_id)',
  ];

  let data: unknown[] | null = null;
  let lastError: unknown = null;

  for (const select of selects) {
    const response = await supabase.from('option_groups').select(select).in('food_id', foodIds).order('display_order', { ascending: true });
    if (!response.error) {
      data = Array.isArray(response.data) ? response.data : [];
      lastError = null;
      break;
    }
    lastError = response.error;
    if (!isSchemaMismatch(response.error)) break;
  }

  if (lastError) {
    if (isSchemaMismatch(lastError)) return result;
    throw lastError;
  }

  for (const row of data ?? []) {
    const record = row as OptionGroupRow;
    const foodId = Number(record.food_id);
    if (!Number.isFinite(foodId)) continue;
    const existing = result.get(foodId) ?? [];
    existing.push(record);
    result.set(foodId, existing);
  }

  return result;
}

export function parseLineSelections(item: UnknownRecord): LineSelectionInput[] {
  const rawSelections = item['selections'];
  if (Array.isArray(rawSelections) && rawSelections.length > 0) {
    const parsed: LineSelectionInput[] = [];
    for (const raw of rawSelections) {
      const row: UnknownRecord = typeof raw === 'object' && raw !== null ? (raw as UnknownRecord) : {};
      const itemId = Number(row.item_id ?? row.id);
      const groupId = row.group_id !== undefined && row.group_id !== null ? Number(row.group_id) : undefined;
      const quantity = Number(row.quantity ?? 1);
      if (!Number.isFinite(itemId) || !Number.isFinite(quantity) || quantity <= 0) continue;
      parsed.push({ group_id: Number.isFinite(groupId) ? groupId : undefined, item_id: itemId, quantity });
    }
    return parsed;
  }

  const rawOptions = item['options'];
  if (!Array.isArray(rawOptions)) return [];

  const parsed: LineSelectionInput[] = [];
  for (const raw of rawOptions) {
    const row: UnknownRecord = typeof raw === 'object' && raw !== null ? (raw as UnknownRecord) : {};
    const itemId = Number(row.item_id ?? row.id);
    const groupId = row.group_id !== undefined && row.group_id !== null ? Number(row.group_id) : undefined;
    const quantity = Number(row.quantity ?? 1);
    if (!Number.isFinite(itemId) || !Number.isFinite(quantity) || quantity <= 0) continue;
    parsed.push({ group_id: Number.isFinite(groupId) ? groupId : undefined, item_id: itemId, quantity });
  }
  return parsed;
}

export function validateFoodLineSelections(params: {
  foodId: number;
  lineQuantity: number;
  selections: LineSelectionInput[];
  groups: OptionGroupRow[];
  sideById: Map<number, UnknownRecord>;
  preferredLocation?: string;
}): { ok: true; snapshot: OrderItemOptionsSnapshot } | { ok: false; error: string } {
  const { foodId, lineQuantity, selections, groups, sideById, preferredLocation } = params;

  const groupById = new Map<number, OptionGroupRow>();
  const allowedSideIds = new Set<number>();
  for (const group of groups) {
    groupById.set(group.id, group);
    for (const side of group.sides ?? []) {
      const sideId = Number(side['id']);
      if (Number.isFinite(sideId)) allowedSideIds.add(sideId);
    }
  }

  const countsByGroup = new Map<number, number>();
  const snapshotSelections: OrderItemOptionsSnapshot['selections'] = [];

  for (const selection of selections) {
    const side = sideById.get(selection.item_id);
    if (!side) {
      return { ok: false, error: `Invalid selection for food ${foodId}` };
    }

    if (!allowedSideIds.has(selection.item_id)) {
      return { ok: false, error: `Selection does not belong to food ${foodId}` };
    }

    const sideGroupId = Number(side['option_group_id']);
    if (!Number.isFinite(sideGroupId) || !groupById.has(sideGroupId)) {
      return { ok: false, error: `Selection is not linked to a valid option group` };
    }

    if (selection.group_id !== undefined && selection.group_id !== sideGroupId) {
      return { ok: false, error: `Selection group mismatch for item ${selection.item_id}` };
    }

    const status = resolveSideStatus(side, preferredLocation);
    if (status !== 'available') {
      return { ok: false, error: `Selected option is not available` };
    }

    const group = groupById.get(sideGroupId)!;
    const pricing = buildSelectionPricingFields(group, side);

    countsByGroup.set(sideGroupId, (countsByGroup.get(sideGroupId) ?? 0) + selection.quantity);

    snapshotSelections.push({
      group_id: sideGroupId,
      group: group.name,
      item_id: selection.item_id,
      name: String(side['name'] ?? ''),
      price: pricing.price,
      price_delta: pricing.price_delta,
      is_pricing_default: pricing.is_pricing_default,
      quantity: selection.quantity,
    });
  }

  for (const group of groups) {
    const count = countsByGroup.get(group.id) ?? 0;
    const min = Math.max(0, Number(group.min_selections ?? 0));
    const max = Math.max(min, Number(group.max_selections ?? 1));
    const required = Boolean(group.is_required) || min > 0;

    if (required && count < Math.max(1, min)) {
      return { ok: false, error: `Option group "${group.name}" requires at least ${Math.max(1, min)} selection(s)` };
    }
    if (count < min) {
      return { ok: false, error: `Option group "${group.name}" requires at least ${min} selection(s)` };
    }
    if (count > max) {
      return { ok: false, error: `Option group "${group.name}" allows at most ${max} selection(s)` };
    }
  }

  return {
    ok: true,
    snapshot: {
      food_id: foodId,
      food_name: '',
      base_price: 0,
      display_price: 0,
      price_adjustment: 0,
      selections: snapshotSelections,
      item_total: 0,
    },
  };
}

export function computeLineTotals(
  snapshot: OrderItemOptionsSnapshot,
  foodName: string,
  basePrice: number,
  lineQuantity: number,
  groups: OptionGroupRow[] = []
): OrderItemOptionsSnapshot {
  const displayPrice = computeDisplayPrice(basePrice, groups);
  const unitFromBase = basePrice + snapshot.selections.reduce((sum, s) => sum + s.price * s.quantity, 0);
  const unitFromDisplay = displayPrice + snapshot.selections.reduce((sum, s) => sum + s.price_delta * s.quantity, 0);
  const unitTotal = Math.abs(unitFromBase - unitFromDisplay) > 0.02 ? unitFromBase : unitFromDisplay;
  const priceAdjustment = unitTotal - displayPrice;

  return {
    ...snapshot,
    food_name: foodName,
    base_price: basePrice,
    display_price: displayPrice,
    price_adjustment: priceAdjustment,
    item_total: unitTotal * lineQuantity,
  };
}
