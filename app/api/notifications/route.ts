import { NextRequest, NextResponse } from 'next/server';
import { validateRequest, unauthorizedResponse } from '@/lib/auth';
import { getUserNotifications, markAllNotificationsRead } from '@/lib/db';

/**
 * GET /api/notifications?userId=...
 * Returns notifications for the user (including broadcasts where user_id is null), newest first.
 * Response: { "notifications": [...] } – each item has id, user_id, title, body, type, order_id, created_at, is_read (snake_case).
 */
export async function GET(req: NextRequest) {
  if (!validateRequest(req)) return unauthorizedResponse();

  const userId = req.nextUrl.searchParams.get('userId');
  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }

  try {
    const notifications = await getUserNotifications(userId);
    return NextResponse.json({ notifications });
  } catch (error) {
    console.error('Get notifications error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

/**
 * POST /api/notifications/clear
 * Body or query: userId (required).
 * Marks all notifications for the user (and broadcasts they see) as read. Returns 204 on success.
 */
export async function POST(req: NextRequest) {
  if (!validateRequest(req)) return unauthorizedResponse();

  let userId: string | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    userId = body.userId ?? body.user_id ?? req.nextUrl.searchParams.get('userId');
  } catch {
    userId = req.nextUrl.searchParams.get('userId');
  }

  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }

  try {
    await markAllNotificationsRead(userId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('Clear notifications error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
