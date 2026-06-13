import { NextRequest, NextResponse } from 'next/server';
import { adminDbErrorResponse, requireStaffDatabase } from '@/lib/adminDb';
import { fetchAdminOptionGroupsForFood } from '@/lib/foodPricing';

/**
 * GET /api/admin/foods/:foodId/option-groups
 * Staff menu editor: full option tree including unavailable sides.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ foodId: string }> }
) {
  const ctx = await requireStaffDatabase(req);
  if (!ctx.ok) return ctx.response;

  try {
    const { foodId } = await params;
    const id = Number(foodId);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: 'Invalid food id' }, { status: 400 });
    }

    const optionGroups = await fetchAdminOptionGroupsForFood(ctx.db, id);
    return NextResponse.json({ option_groups: optionGroups });
  } catch (error) {
    console.error('Admin list option groups error:', error);
    return adminDbErrorResponse(error);
  }
}
