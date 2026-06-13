import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminDbErrorResponse } from '@/lib/adminDb';
import { refreshFoodDisplayPrice } from '@/lib/foodPricing';

export async function validateDefaultSide(
  db: SupabaseClient,
  groupId: string | number,
  defaultSideId: number
): Promise<{ ok: true; foodId: number } | { ok: false; response: NextResponse }> {
  const groupIdNum = Number(groupId);
  if (!Number.isFinite(groupIdNum)) {
    return { ok: false, response: NextResponse.json({ error: 'Invalid option group id' }, { status: 400 }) };
  }

  const { data: group, error: groupError } = await db
    .from('option_groups')
    .select('id, food_id')
    .eq('id', groupIdNum)
    .maybeSingle();

  if (groupError) {
    return { ok: false, response: adminDbErrorResponse(groupError) };
  }
  if (!group) {
    return { ok: false, response: NextResponse.json({ error: 'Option group not found' }, { status: 404 }) };
  }

  const { data: side, error: sideError } = await db
    .from('sides')
    .select('id, option_group_id')
    .eq('id', defaultSideId)
    .maybeSingle();

  if (sideError) {
    return { ok: false, response: adminDbErrorResponse(sideError) };
  }
  if (!side) {
    return { ok: false, response: NextResponse.json({ error: 'Side not found' }, { status: 404 }) };
  }

  const sideGroupId =
    side.option_group_id !== null && side.option_group_id !== undefined ? Number(side.option_group_id) : null;

  if (sideGroupId === groupIdNum) {
    return { ok: true, foodId: Number(group.food_id) };
  }

  const { data: link } = await db
    .from('food_sides')
    .select('food_id')
    .eq('side_id', defaultSideId)
    .eq('food_id', group.food_id)
    .maybeSingle();

  if (link) {
    const { error: attachError } = await db
      .from('sides')
      .update({ option_group_id: groupIdNum })
      .eq('id', defaultSideId);

    if (attachError) {
      return { ok: false, response: adminDbErrorResponse(attachError) };
    }

    return { ok: true, foodId: Number(group.food_id) };
  }

  return {
    ok: false,
    response: NextResponse.json(
      { error: 'default_side_id must belong to this option group' },
      { status: 400 }
    ),
  };
}

export async function setGroupPricingDefault(db: SupabaseClient, optionGroupId: number, sideId: number) {
  const check = await validateDefaultSide(db, optionGroupId, sideId);
  if (!check.ok) return check;

  const { error } = await db
    .from('option_groups')
    .update({ default_side_id: sideId })
    .eq('id', optionGroupId);

  if (error) {
    return { ok: false as const, response: adminDbErrorResponse(error) };
  }

  const displayPrice = await refreshFoodDisplayPrice(db, check.foodId);
  return { ok: true as const, foodId: check.foodId, displayPrice };
}
