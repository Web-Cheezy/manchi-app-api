import { NextRequest, NextResponse } from 'next/server';
import { adminDbErrorResponse, requireStaffDatabase } from '@/lib/adminDb';

type ItemType = 'food' | 'side';

/**
 * PATCH /api/admin/availability
 * Quick sold-out toggle for inventory view.
 * Body: { type: "food"|"side", id: number, location: string, status: "available"|"out_of_stock"|"unavailable" }
 */
export async function PATCH(req: NextRequest) {
  const ctx = await requireStaffDatabase(req);
  if (!ctx.ok) return ctx.response;

  try {
    const body = await req.json();
    const type = body.type as ItemType;
    const id = Number(body.id);
    const location = typeof body.location === 'string' ? body.location.trim() : '';
    const status = typeof body.status === 'string' ? body.status.trim().toLowerCase() : '';

    if ((type !== 'food' && type !== 'side') || !Number.isFinite(id) || !location || !status) {
      return NextResponse.json({ error: 'type, id, location, and status are required' }, { status: 400 });
    }

    const table = type === 'food' ? 'food_availability' : 'side_availability';
    const idColumn = type === 'food' ? 'food_id' : 'side_id';

    const { data: existing, error: fetchError } = await ctx.db
      .from(table)
      .select('id')
      .eq(idColumn, id)
      .eq('location', location)
      .maybeSingle();

    if (fetchError) return adminDbErrorResponse(fetchError);

    if (existing?.id) {
      const { data, error } = await ctx.db
        .from(table)
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select()
        .single();
      if (error) return adminDbErrorResponse(error);
      return NextResponse.json(data);
    }

    const { data, error } = await ctx.db
      .from(table)
      .insert([{ [idColumn]: id, location, status }])
      .select()
      .single();

    if (error) return adminDbErrorResponse(error);
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    console.error('Availability toggle error:', error);
    return adminDbErrorResponse(error);
  }
}
