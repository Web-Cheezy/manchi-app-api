import { NextRequest, NextResponse } from 'next/server';
import { adminDbErrorResponse, requireStaffDatabase } from '@/lib/adminDb';

/**
 * POST /api/admin/option-groups
 * Body: { food_id, name, min_selections?, max_selections?, is_required?, display_order? }
 */
export async function POST(req: NextRequest) {
  const ctx = await requireStaffDatabase(req);
  if (!ctx.ok) return ctx.response;

  try {
    const body = await req.json();
    const foodId = Number(body.food_id);
    const name = typeof body.name === 'string' ? body.name.trim() : '';

    if (!Number.isFinite(foodId) || !name) {
      return NextResponse.json({ error: 'food_id and name are required' }, { status: 400 });
    }

    const minSelections = Number(body.min_selections ?? 0);
    const maxSelections = Number(body.max_selections ?? 1);
    const isRequired = Boolean(body.is_required);
    const displayOrder = Number(body.display_order ?? 0);

    if (!Number.isFinite(minSelections) || minSelections < 0) {
      return NextResponse.json({ error: 'min_selections must be >= 0' }, { status: 400 });
    }
    if (!Number.isFinite(maxSelections) || maxSelections < minSelections) {
      return NextResponse.json({ error: 'max_selections must be >= min_selections' }, { status: 400 });
    }

    const { data, error } = await ctx.db
      .from('option_groups')
      .insert([
        {
          food_id: foodId,
          name,
          min_selections: minSelections,
          max_selections: maxSelections,
          is_required: isRequired,
          display_order: displayOrder,
        },
      ])
      .select()
      .single();

    if (error) return adminDbErrorResponse(error);

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    console.error('Create option group error:', error);
    return adminDbErrorResponse(error);
  }
}
