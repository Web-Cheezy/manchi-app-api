import { NextRequest, NextResponse } from 'next/server';
import { requireAuthenticatedUser } from '@/lib/auth';
import { deleteFcmToken } from '@/lib/db';

export async function POST(req: NextRequest) {
  const auth = await requireAuthenticatedUser(req);
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json();
    const { fcm_token: fcmToken } = body;

    if (!fcmToken || typeof fcmToken !== 'string') {
      return NextResponse.json(
        { error: 'fcm_token is required and must be a string' },
        { status: 400 }
      );
    }

    await deleteFcmToken(fcmToken, auth.user.id);

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('FCM unregister error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

