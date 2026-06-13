import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { normalizeLocation } from '@/lib/utils';
import {
  decorateOptionGroupsForLocation,
  filterAvailabilityRows,
  resolveFoodStatus,
  type UnknownRecord,
} from '@/lib/availability';
import { attachFoodPricing, fetchPublicOptionGroupsForFood } from '@/lib/foodPricing';

/**
 * GET /api/menu?location=Chasemall
 * Aggregated menu: categories + foods with option_groups (names, sides, price_delta) and menu_price.
 */
export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const location = searchParams.get('location') ?? searchParams.get('store');
  const preferredLocation = normalizeLocation(location);

  try {
    const [{ data: categories, error: categoriesError }, { data: foodsRaw, error: foodsError }] = await Promise.all([
      supabase.from('categories').select('*').order('id'),
      supabase.from('foods').select('*,food_availability(*)').order('name'),
    ]);

    if (categoriesError) throw categoriesError;
    if (foodsError) throw foodsError;

    const foods = await Promise.all(
      (Array.isArray(foodsRaw) ? foodsRaw : []).map(async (food: unknown) => {
        const foodRecord: UnknownRecord = typeof food === 'object' && food !== null ? (food as UnknownRecord) : {};
        const filteredAvailability = filterAvailabilityRows(foodRecord['food_availability'], preferredLocation);
        const status = resolveFoodStatus({ ...foodRecord, food_availability: filteredAvailability }, preferredLocation);
        const foodId = Number(foodRecord['id']);
        const optionGroupsRaw = Number.isFinite(foodId)
          ? await fetchPublicOptionGroupsForFood(supabase, foodId)
          : [];
        const decorated = decorateOptionGroupsForLocation(optionGroupsRaw, preferredLocation);
        const priced = attachFoodPricing(
          { ...foodRecord, food_availability: filteredAvailability, status },
          decorated
        );

        return priced;
      })
    );

    return NextResponse.json({
      categories: categories ?? [],
      foods: foods.filter((food) => (food as UnknownRecord)['status'] !== 'unavailable'),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
