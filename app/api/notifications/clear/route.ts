import { NextRequest, NextResponse } from 'next/server';
import { validateRequest, unauthorizedResponse, requireAuthenticatedUser } from '@/lib/auth';
import { markAllNotificationsRead } from '@/lib/db';

export async function POST(req: NextRequest) {
  if (!validateRequest(req)) return unauthorizedResponse();
  const auth = await requireAuthenticatedUser(req);
  if (!auth.ok) return auth.response;

  try {
    await markAllNotificationsRead(auth.user.id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('Clear notifications error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

