import { NextRequest, NextResponse } from 'next/server';
import { requireAuthenticatedUser } from '@/lib/auth';
import { deleteFcmToken } from '@/lib/db';
import { getClientIp } from '@/lib/rateLimit';

export async function POST(req: NextRequest) {
  const auth = await requireAuthenticatedUser(req);
  if (!auth.ok) {
    console.warn('FCM unregister unauthorized', {
      ip: getClientIp(req),
      userAgent: req.headers.get('user-agent'),
    });
    return auth.response;
  }

  try {
    const body = await req.json();
    const { fcm_token: fcmToken } = body;

    if (!fcmToken || typeof fcmToken !== 'string') {
      console.warn('FCM unregister invalid payload', {
        userId: auth.user.id,
        ip: getClientIp(req),
        userAgent: req.headers.get('user-agent'),
      });
      return NextResponse.json(
        { error: 'fcm_token is required and must be a string' },
        { status: 400 }
      );
    }

    await deleteFcmToken(fcmToken, auth.user.id);

    console.info('FCM token unregistered', {
      userId: auth.user.id,
      ip: getClientIp(req),
      userAgent: req.headers.get('user-agent'),
    });

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error('FCM unregister error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
