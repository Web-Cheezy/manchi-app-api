import { NextRequest, NextResponse } from 'next/server';
import { validateRequest, unauthorizedResponse } from '@/lib/auth';
import { upsertFcmToken } from '@/lib/db';

export async function POST(req: NextRequest) {
  if (!validateRequest(req)) return unauthorizedResponse();

  try {
    const body = await req.json();
    const { fcm_token: fcmToken, user_id: userId } = body;

    if (!fcmToken || typeof fcmToken !== 'string') {
      return NextResponse.json(
        { error: 'fcm_token is required and must be a string' },
        { status: 400 }
      );
    }

    await upsertFcmToken(fcmToken, userId ?? undefined);

    return NextResponse.json({ message: 'FCM token registered' });
  } catch (error) {
    console.error('FCM register error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
