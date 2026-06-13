import { NextRequest, NextResponse } from 'next/server';
import { adminDbErrorResponse, requireStaffDatabase } from '@/lib/adminDb';
import { refreshFoodDisplayPrice } from '@/lib/foodPricing';
import { setGroupPricingDefault } from '@/lib/adminOptionGroups';

function wantsMenuPriceDefault(body: Record<string, unknown>): boolean {
  return Boolean(body.set_as_menu_price_default ?? body.is_pricing_default ?? body.include_in_menu_price);
}

/**
 * POST /api/admin/sides
 * Body: { name, price, option_group_id, type?, image_url?, set_as_menu_price_default? }
 */
export async function POST(req: NextRequest) {
  const ctx = await requireStaffDatabase(req);
  if (!ctx.ok) return ctx.response;

  try {
    const body = await req.json();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const price = Number(body.price);
    const optionGroupId = Number(body.option_group_id ?? body.group_id);

    if (!name || !Number.isFinite(price) || price < 0) {
      return NextResponse.json({ error: 'name and price are required' }, { status: 400 });
    }
    if (!Number.isFinite(optionGroupId)) {
      return NextResponse.json({ error: 'option_group_id is required' }, { status: 400 });
    }

    const { data: group, error: groupError } = await ctx.db
      .from('option_groups')
      .select('id, food_id')
      .eq('id', optionGroupId)
      .maybeSingle();

    if (groupError) return adminDbErrorResponse(groupError);
    if (!group) {
      return NextResponse.json(
        { error: `Option group not found (id=${optionGroupId})` },
        { status: 404 }
      );
    }

    const payload: Record<string, unknown> = {
      name,
      price,
      option_group_id: optionGroupId,
      type: typeof body.type === 'string' ? body.type : 'standard',
    };
    if (typeof body.image_url === 'string' && body.image_url.trim()) {
      payload.image_url = body.image_url.trim();
    }

    const { data, error } = await ctx.db.from('sides').insert([payload]).select().single();
    if (error) return adminDbErrorResponse(error);

    const { error: linkError } = await ctx.db
      .from('food_sides')
      .upsert({ food_id: group.food_id, side_id: data.id, is_required: false }, { onConflict: 'food_id,side_id' });

    if (linkError) console.warn('food_sides link warning:', linkError.message);

    let foodDisplayPrice: number | null = null;

    if (wantsMenuPriceDefault(body)) {
      const setDefault = await setGroupPricingDefault(ctx.db, optionGroupId, Number(data.id));
      if (!setDefault.ok) return setDefault.response;
      foodDisplayPrice = setDefault.displayPrice;
    } else {
      foodDisplayPrice = await refreshFoodDisplayPrice(ctx.db, Number(group.food_id));
    }

    return NextResponse.json(
      {
        ...data,
        food_display_price: foodDisplayPrice,
        is_pricing_default: wantsMenuPriceDefault(body),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Create side error:', error);
    return adminDbErrorResponse(error);
  }
}

/**
 * PATCH /api/admin/sides
 * Body: { id, name?, price?, option_group_id?, type?, image_url?, set_as_menu_price_default? }
 */
export async function PATCH(req: NextRequest) {
  const ctx = await requireStaffDatabase(req);
  if (!ctx.ok) return ctx.response;

  try {
    const body = await req.json();
    const id = Number(body.id);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const updatePayload: Record<string, unknown> = {};
    if (typeof body.name === 'string' && body.name.trim()) updatePayload.name = body.name.trim();
    if (body.price !== undefined) {
      const price = Number(body.price);
      if (!Number.isFinite(price) || price < 0) {
        return NextResponse.json({ error: 'price is invalid' }, { status: 400 });
      }
      updatePayload.price = price;
    }
    if (body.option_group_id !== undefined) updatePayload.option_group_id = Number(body.option_group_id);
    if (body.type !== undefined) updatePayload.type = body.type;
    if (body.image_url !== undefined) updatePayload.image_url = body.image_url;

    let sideRecord: Record<string, unknown> | null = null;

    if (Object.keys(updatePayload).length > 0) {
      const { data, error } = await ctx.db.from('sides').update(updatePayload).eq('id', id).select().single();
      if (error) return adminDbErrorResponse(error);
      sideRecord = data;
    } else {
      const { data, error } = await ctx.db.from('sides').select('*').eq('id', id).maybeSingle();
      if (error) return adminDbErrorResponse(error);
      if (!data) return NextResponse.json({ error: 'Side not found' }, { status: 404 });
      sideRecord = data;
    }

    const optionGroupId = Number(
      body.option_group_id ?? sideRecord?.option_group_id ?? body.group_id
    );

    if (wantsMenuPriceDefault(body)) {
      if (!Number.isFinite(optionGroupId)) {
        return NextResponse.json({ error: 'option_group_id is required to set menu price default' }, { status: 400 });
      }

      const setDefault = await setGroupPricingDefault(ctx.db, optionGroupId, id);
      if (!setDefault.ok) return setDefault.response;

      return NextResponse.json({
        ...sideRecord,
        is_pricing_default: true,
        food_display_price: setDefault.displayPrice,
      });
    }

    if (sideRecord?.option_group_id) {
      const { data: group } = await ctx.db
        .from('option_groups')
        .select('food_id')
        .eq('id', sideRecord.option_group_id)
        .maybeSingle();

      if (group?.food_id) {
        await refreshFoodDisplayPrice(ctx.db, Number(group.food_id));
      }
    }

    return NextResponse.json(sideRecord);
  } catch (error) {
    console.error('Update side error:', error);
    return adminDbErrorResponse(error);
  }
}
