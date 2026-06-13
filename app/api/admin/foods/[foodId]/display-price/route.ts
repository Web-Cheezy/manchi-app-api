import { NextRequest, NextResponse } from 'next/server';
import { adminDbErrorResponse, requireStaffDatabase } from '@/lib/adminDb';
import { refreshFoodDisplayPrice } from '@/lib/foodPricing';

/**
 * POST /api/admin/foods/:foodId/display-price
 * Recomputes foods.display_price from base price + default_side_id on each option group.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ foodId: string }> }
) {
  const ctx = await requireStaffDatabase(_req);
  if (!ctx.ok) return ctx.response;

  try {
    const { foodId } = await params;
    const id = Number(foodId);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: 'Invalid food id' }, { status: 400 });
    }

    const displayPrice = await refreshFoodDisplayPrice(ctx.db, id);
    if (displayPrice === null) {
      return NextResponse.json({ error: 'Display pricing columns not available' }, { status: 501 });
    }

    return NextResponse.json({ food_id: id, display_price: Number(displayPrice) });
  } catch (error) {
    console.error('Refresh display price error:', error);
    return adminDbErrorResponse(error);
  }
}
