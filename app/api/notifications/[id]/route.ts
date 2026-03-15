import { NextRequest, NextResponse } from 'next/server';
import { validateRequest, unauthorizedResponse } from '@/lib/auth';
import { markNotificationRead } from '@/lib/db';

/**
 * PATCH /api/notifications/:id
 * Body: { "is_read": true, "userId": string } (userId required for auth; is_read can be true to mark read).
 * Marks the notification as read. User can only mark notifications that belong to them or broadcasts.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!validateRequest(req)) return unauthorizedResponse();

  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const userId = body.userId ?? body.user_id ?? req.nextUrl.searchParams.get('userId');

    if (!id) {
      return NextResponse.json({ error: 'Notification id is required' }, { status: 400 });
    }
    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    const notification = await markNotificationRead(id, userId);
    return NextResponse.json(notification);
  } catch (error) {
    console.error('Mark notification read error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
