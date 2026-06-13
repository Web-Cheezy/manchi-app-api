import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { normalizeLocation } from '@/lib/utils';
import {
  decorateOptionGroupsForLocation,
  filterAvailabilityRows,
  isSchemaMismatch,
  resolveFoodStatus,
  type UnknownRecord,
} from '@/lib/availability';
import { attachFoodPricing, effectiveMenuPrice, fetchPublicOptionGroupsForFood } from '@/lib/foodPricing';

const LEGACY_FOOD_SELECT = '*,food_availability(*),food_sides(is_required,side:sides(*,side_availability(*)))';

async function attachPricingToFood(foodRecord: UnknownRecord, preferredLocation?: string) {
  const foodId = Number(foodRecord['id']);
  const optionGroupsRaw = Number.isFinite(foodId)
    ? await fetchPublicOptionGroupsForFood(supabase, foodId)
    : [];
  const decorated = decorateOptionGroupsForLocation(optionGroupsRaw, preferredLocation);
  return attachFoodPricing(foodRecord, decorated);
}

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const foodId = searchParams.get('id');
  const categoryId = searchParams.get('categoryId');
  const store = searchParams.get('store');
  const location = searchParams.get('location');

  const preferredLocation = normalizeLocation(location ?? store);

  try {
    if (foodId) {
      let { data, error } = await supabase.from('foods').select('*,food_availability(*)').eq('id', foodId).single();

      let usedLegacy = false;
      if (error && isSchemaMismatch(error)) {
        ({ data, error } = await supabase.from('foods').select(LEGACY_FOOD_SELECT).eq('id', foodId).single());
        usedLegacy = true;
      }
      if (error) throw error;
      if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

      const dataRecord: UnknownRecord = typeof data === 'object' && data !== null ? (data as UnknownRecord) : {};
      const filteredAvailability = filterAvailabilityRows(dataRecord['food_availability'], preferredLocation);
      const resolvedStatus = resolveFoodStatus({ ...dataRecord, food_availability: filteredAvailability }, preferredLocation);

      if (resolvedStatus === 'unavailable') {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }

      const priced = usedLegacy
        ? { ...dataRecord, menu_price: effectiveMenuPrice(dataRecord), has_options: false, option_groups: [], base_price: Number(dataRecord['price']) || 0 }
        : await attachPricingToFood(dataRecord, preferredLocation);

      const payload: UnknownRecord = {
        ...priced,
        food_availability: filteredAvailability,
        status: resolvedStatus,
      };

      if (usedLegacy) {
        payload.food_sides = dataRecord['food_sides'];
        payload.has_options = Array.isArray(dataRecord['food_sides']) && dataRecord['food_sides'].length > 0;
      }

      return NextResponse.json(payload);
    }

    let query = supabase.from('foods').select('*,food_availability(*)').order('name');
    if (categoryId) query = query.eq('category_id', categoryId);

    const { data, error } = await query;
    if (error) throw error;

    const foods = (Array.isArray(data) ? data : [])
      .map((food: unknown) => {
        const foodRecord: UnknownRecord = typeof food === 'object' && food !== null ? (food as UnknownRecord) : {};
        const filteredAvailability = filterAvailabilityRows(foodRecord['food_availability'], preferredLocation);
        const resolvedStatus = resolveFoodStatus({ ...foodRecord, food_availability: filteredAvailability }, preferredLocation);
        return {
          ...foodRecord,
          food_availability: filteredAvailability,
          status: resolvedStatus,
          base_price: Number(foodRecord['price']) || 0,
          menu_price: effectiveMenuPrice(foodRecord),
        };
      })
      .filter((food) => (food as UnknownRecord)['status'] !== 'unavailable');

    return NextResponse.json(foods);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
