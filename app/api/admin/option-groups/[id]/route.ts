import { NextRequest, NextResponse } from 'next/server';
import { adminDbErrorResponse, requireStaffDatabase } from '@/lib/adminDb';
import { refreshFoodDisplayPrice } from '@/lib/foodPricing';
import { validateDefaultSide } from '@/lib/adminOptionGroups';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await requireStaffDatabase(req);
  if (!ctx.ok) return ctx.response;

  try {
    const { id } = await params;
    const body = await req.json();
    const updatePayload: Record<string, unknown> = {};

    if (typeof body.name === 'string' && body.name.trim()) updatePayload.name = body.name.trim();
    if (body.min_selections !== undefined) {
      const min = Number(body.min_selections);
      if (!Number.isFinite(min) || min < 0) {
        return NextResponse.json({ error: 'min_selections must be >= 0' }, { status: 400 });
      }
      updatePayload.min_selections = min;
    }
    if (body.max_selections !== undefined) {
      const max = Number(body.max_selections);
      if (!Number.isFinite(max)) {
        return NextResponse.json({ error: 'max_selections is invalid' }, { status: 400 });
      }
      updatePayload.max_selections = max;
    }
    if (body.is_required !== undefined) updatePayload.is_required = Boolean(body.is_required);
    if (body.display_order !== undefined) updatePayload.display_order = Number(body.display_order);

    if (body.default_side_id !== undefined) {
      if (body.default_side_id === null) {
        updatePayload.default_side_id = null;
      } else {
        const defaultSideId = Number(body.default_side_id);
        if (!Number.isFinite(defaultSideId)) {
          return NextResponse.json({ error: 'default_side_id is invalid' }, { status: 400 });
        }
        const check = await validateDefaultSide(ctx.db, id, defaultSideId);
        if (!check.ok) return check.response;
        updatePayload.default_side_id = defaultSideId;
      }
    }

    if (Object.keys(updatePayload).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const { data, error } = await ctx.db
      .from('option_groups')
      .update(updatePayload)
      .eq('id', id)
      .select('*')
      .single();

    if (error) return adminDbErrorResponse(error);

    const foodId = Number(data.food_id);
    const displayPrice = Number.isFinite(foodId) ? await refreshFoodDisplayPrice(ctx.db, foodId) : null;

    return NextResponse.json({
      ...data,
      food_display_price: displayPrice !== null ? Number(displayPrice) : null,
    });
  } catch (error) {
    console.error('Update option group error:', error);
    return adminDbErrorResponse(error);
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await requireStaffDatabase(req);
  if (!ctx.ok) return ctx.response;

  try {
    const { id } = await params;

    const { data: group } = await ctx.db.from('option_groups').select('food_id').eq('id', id).maybeSingle();

    const { error: unlinkError } = await ctx.db.from('sides').update({ option_group_id: null }).eq('option_group_id', id);
    if (unlinkError) return adminDbErrorResponse(unlinkError);

    const { error } = await ctx.db.from('option_groups').delete().eq('id', id);
    if (error) return adminDbErrorResponse(error);

    if (group?.food_id) {
      await refreshFoodDisplayPrice(ctx.db, Number(group.food_id));
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('Delete option group error:', error);
    return adminDbErrorResponse(error);
  }
}
