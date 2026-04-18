import { NextRequest, NextResponse } from 'next/server';
import { requireAuthenticatedUser } from '@/lib/auth';
import { markNotificationRead } from '@/lib/db';

/**
 * PATCH /api/notifications/:id
 * Marks the notification as read. Identity from JWT; user can only mark rows that belong to them or global broadcasts.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuthenticatedUser(req);
  if (!auth.ok) return auth.response;

  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));

    if (!id) {
      return NextResponse.json({ error: 'Notification id is required' }, { status: 400 });
    }
    void body;

    const notification = await markNotificationRead(id, auth.user.id);
    return NextResponse.json(notification);
  } catch (error) {
    console.error('Mark notification read error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
