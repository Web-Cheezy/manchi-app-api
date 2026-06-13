import { supabase } from '@/lib/supabase';
import {
  isSchemaMismatch,
  resolveFoodStatus,
  resolveSideStatus,
  type UnknownRecord,
} from '@/lib/availability';
import {
  computeLineTotals,
  fetchOptionGroupsForFoods,
  parseLineSelections,
  validateFoodLineSelections,
  type LineSelectionInput,
  type OrderItemOptionsSnapshot,
} from '@/lib/optionGroups';

export type OrderItemKind = 'food' | 'side';

export type ParsedOrderLine = {
  kind: OrderItemKind;
  food_id: number | null;
  side_id: number | null;
  quantity: number;
  price_at_time: number;
  selections: LineSelectionInput[];
  optionsSnapshot: OrderItemOptionsSnapshot | UnknownRecord | null;
};

async function fetchSidesByIds(sideIds: number[]) {
  if (sideIds.length === 0) return new Map<number, UnknownRecord>();

  const fullResult = await supabase
    .from('sides')
    .select('id,name,price,option_group_id,side_availability(*)')
    .in('id', sideIds);

  let rows: unknown[] | null = fullResult.data;
  let error = fullResult.error;

  if (error && isSchemaMismatch(error)) {
    const fallback = await supabase.from('sides').select('id,name,price,option_group_id').in('id', sideIds);
    rows = fallback.data;
    error = fallback.error;
  }
  if (error) throw error;

  const map = new Map<number, UnknownRecord>();
  for (const side of Array.isArray(rows) ? rows : []) {
    const record: UnknownRecord = typeof side === 'object' && side !== null ? (side as UnknownRecord) : {};
    const id = Number(record.id);
    if (Number.isFinite(id)) map.set(id, record);
  }
  return map;
}

async function fetchFoodsByIds(foodIds: number[]) {
  if (foodIds.length === 0) return new Map<number, UnknownRecord>();

  const fullResult = await supabase
    .from('foods')
    .select('id,name,price,display_price,status,availability_status,availability,is_available,food_availability(*)')
    .in('id', foodIds);

  let rows: unknown[] | null = fullResult.data;
  let error = fullResult.error;

  if (error && isSchemaMismatch(error)) {
    const fallback = await supabase.from('foods').select('id,name,price').in('id', foodIds);
    rows = fallback.data;
    error = fallback.error;
  }
  if (error) throw error;

  const map = new Map<number, UnknownRecord>();
  for (const food of Array.isArray(rows) ? rows : []) {
    const record: UnknownRecord = typeof food === 'object' && food !== null ? (food as UnknownRecord) : {};
    const id = Number(record.id);
    if (Number.isFinite(id)) map.set(id, record);
  }
  return map;
}

async function fetchLegacyFoodSideIds(foodIds: number[]): Promise<Map<number, Set<number>>> {
  const map = new Map<number, Set<number>>();
  if (foodIds.length === 0) return map;

  const { data, error } = await supabase.from('food_sides').select('food_id,side_id').in('food_id', foodIds);
  if (error) {
    if (isSchemaMismatch(error)) return map;
    throw error;
  }

  for (const row of Array.isArray(data) ? data : []) {
    const record = row as { food_id: number; side_id: number };
    const foodId = Number(record.food_id);
    const sideId = Number(record.side_id);
    if (!Number.isFinite(foodId) || !Number.isFinite(sideId)) continue;
    const set = map.get(foodId) ?? new Set<number>();
    set.add(sideId);
    map.set(foodId, set);
  }
  return map;
}

export function parseOrderLines(items: unknown[]): { ok: true; lines: ParsedOrderLine[] } | { ok: false; error: string; status: number } {
  const lines: ParsedOrderLine[] = [];

  for (const rawItem of items) {
    const item: UnknownRecord = typeof rawItem === 'object' && rawItem !== null ? (rawItem as UnknownRecord) : {};
    const itemType = typeof item.item_type === 'string' ? item.item_type.trim().toLowerCase() : '';
    const hasFoodId = item.food_id !== null && item.food_id !== undefined && String(item.food_id).trim() !== '';
    const hasSideId = item.side_id !== null && item.side_id !== undefined && String(item.side_id).trim() !== '';
    const kind: OrderItemKind | null =
      hasFoodId || itemType === 'food' ? 'food' : hasSideId || itemType === 'side' ? 'side' : null;

    if (!kind) {
      return { ok: false, error: 'Each item must have food_id or side_id', status: 422 };
    }

    const rawPrimaryId = kind === 'food' ? item.food_id : item.side_id;
    const primaryId = Number(rawPrimaryId);
    const quantity = Number(item.quantity ?? 1);
    const priceAtTime = Number(item.price_at_time ?? item.price ?? 0);

    if (!Number.isFinite(primaryId) || !Number.isFinite(quantity) || quantity <= 0) {
      return { ok: false, error: 'Each item must include a valid id and quantity', status: 422 };
    }

    lines.push({
      kind,
      food_id: kind === 'food' ? primaryId : null,
      side_id: kind === 'side' ? primaryId : null,
      quantity,
      price_at_time: Number.isFinite(priceAtTime) ? priceAtTime : 0,
      selections: parseLineSelections(item),
      optionsSnapshot: null,
    });
  }

  if (lines.length === 0) {
    return { ok: false, error: 'No valid order items', status: 400 };
  }

  return { ok: true, lines };
}

export async function validateAndBuildOrderLines(
  lines: ParsedOrderLine[],
  normalizedLocation: string
): Promise<
  | { ok: true; lines: ParsedOrderLine[]; computedItemsTotal: number; computedOptionsTotal: number }
  | { ok: false; error: string; status: number }
> {
  const foodIds = Array.from(new Set(lines.map((l) => l.food_id).filter((id): id is number => id !== null)));
  const sideLineIds = Array.from(new Set(lines.map((l) => l.side_id).filter((id): id is number => id !== null)));
  const selectionIds = Array.from(new Set(lines.flatMap((l) => l.selections.map((s) => s.item_id))));
  const allSideIds = Array.from(new Set([...sideLineIds, ...selectionIds]));

  const [foodById, sideById, groupsByFood, legacySides] = await Promise.all([
    fetchFoodsByIds(foodIds),
    fetchSidesByIds(allSideIds),
    fetchOptionGroupsForFoods(foodIds),
    fetchLegacyFoodSideIds(foodIds),
  ]);

  let computedItemsTotal = 0;
  let computedOptionsTotal = 0;

  for (const line of lines) {
    if (line.kind === 'side') {
      const side = sideById.get(line.side_id as number);
      if (!side) return { ok: false, error: 'Invalid order item', status: 400 };
      if (resolveSideStatus(side, normalizedLocation) !== 'available') {
        return { ok: false, error: 'Item not available', status: 400 };
      }
      const price = Number(side.price);
      if (!Number.isFinite(price) || price < 0) return { ok: false, error: 'Invalid item price', status: 400 };
      computedItemsTotal += price * line.quantity;
      line.optionsSnapshot = {
        side_id: line.side_id,
        side_name: String(side.name ?? ''),
        price: price,
        item_total: price * line.quantity,
      };
      continue;
    }

    const foodId = line.food_id as number;
    const food = foodById.get(foodId);
    if (!food) return { ok: false, error: 'Invalid order item', status: 400 };
    if (resolveFoodStatus(food, normalizedLocation) !== 'available') {
      return { ok: false, error: 'Item not available', status: 400 };
    }

    const basePrice = Number(food.price);
    if (!Number.isFinite(basePrice) || basePrice < 0) {
      return { ok: false, error: 'Invalid item price', status: 400 };
    }

    const groups = groupsByFood.get(foodId) ?? [];

    if (groups.length > 0) {
      const validated = validateFoodLineSelections({
        foodId,
        lineQuantity: line.quantity,
        selections: line.selections,
        groups,
        sideById,
        preferredLocation: normalizedLocation,
      });
      if (!validated.ok) return { ok: false, error: validated.error, status: 400 };

      line.optionsSnapshot = computeLineTotals(
        validated.snapshot,
        String(food.name ?? ''),
        basePrice,
        line.quantity,
        groups
      );

      const optionsUnit = validated.snapshot.selections.reduce((sum, s) => sum + s.price * s.quantity, 0);
      computedItemsTotal += basePrice * line.quantity;
      computedOptionsTotal += optionsUnit * line.quantity;
    } else if (line.selections.length > 0) {
      const allowed = legacySides.get(foodId) ?? new Set<number>();
      const legacySelections: OrderItemOptionsSnapshot['selections'] = [];

      for (const selection of line.selections) {
        const side = sideById.get(selection.item_id);
        if (!side) return { ok: false, error: 'Invalid item option', status: 400 };
        if (allowed.size > 0 && !allowed.has(selection.item_id)) {
          return { ok: false, error: 'Option does not belong to this food', status: 400 };
        }
        if (resolveSideStatus(side, normalizedLocation) !== 'available') {
          return { ok: false, error: 'Item option not available', status: 400 };
        }
        const optionPrice = Number(side.price);
        const unitPrice = Number.isFinite(optionPrice) && optionPrice >= 0 ? optionPrice : 0;
        legacySelections.push({
          group_id: 0,
          group: 'Extras',
          item_id: selection.item_id,
          name: String(side.name ?? ''),
          price: unitPrice,
          price_delta: unitPrice,
          is_pricing_default: false,
          quantity: selection.quantity,
        });
        computedOptionsTotal += unitPrice * selection.quantity * line.quantity;
      }

      line.optionsSnapshot = computeLineTotals(
        { food_id: foodId, food_name: '', base_price: basePrice, display_price: basePrice, price_adjustment: 0, selections: legacySelections, item_total: 0 },
        String(food.name ?? ''),
        basePrice,
        line.quantity
      );
      computedItemsTotal += basePrice * line.quantity;
    } else {
      line.optionsSnapshot = computeLineTotals(
        { food_id: foodId, food_name: String(food.name ?? ''), base_price: basePrice, display_price: basePrice, price_adjustment: 0, selections: [], item_total: 0 },
        String(food.name ?? ''),
        basePrice,
        line.quantity
      );
      computedItemsTotal += basePrice * line.quantity;
    }
  }

  return { ok: true, lines, computedItemsTotal, computedOptionsTotal };
}

export async function getTransportPriceForLga(lga: string): Promise<number> {
  const cleanedLga = lga.trim();
  if (!cleanedLga || cleanedLga.length > 120) return 3500;

  const { data, error } = await supabase.from('transport_prices').select('price').eq('lga', cleanedLga).maybeSingle();
  if (error || !data) return 3500;

  const price = Number(data.price);
  return Number.isFinite(price) && price >= 0 ? Math.round(price) : 3500;
}
