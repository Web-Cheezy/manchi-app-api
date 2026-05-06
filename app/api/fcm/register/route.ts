import { NextRequest, NextResponse } from 'next/server';
import { requireAuthenticatedUser } from '@/lib/auth';
import { upsertFcmToken } from '@/lib/db';
import { getClientIp } from '@/lib/rateLimit';

export async function POST(req: NextRequest) {
  const auth = await requireAuthenticatedUser(req);
  if (!auth.ok) {
    console.warn('FCM register unauthorized', {
      ip: getClientIp(req),
      userAgent: req.headers.get('user-agent'),
    });
    return auth.response;
  }

  try {
    const body = await req.json();
    const { fcm_token: fcmToken, device_id, platform, app_version } = body;

    if (!fcmToken || typeof fcmToken !== 'string') {
      console.warn('FCM register invalid payload', {
        userId: auth.user.id,
        ip: getClientIp(req),
        userAgent: req.headers.get('user-agent'),
      });
      return NextResponse.json(
        { error: 'fcm_token is required and must be a string' },
        { status: 400 }
      );
    }

    await upsertFcmToken(fcmToken, auth.user.id, {
      device_id: typeof device_id === 'string' && device_id.trim() ? device_id.trim().slice(0, 200) : null,
      platform: typeof platform === 'string' && platform.trim() ? platform.trim().slice(0, 50) : null,
      app_version: typeof app_version === 'string' && app_version.trim() ? app_version.trim().slice(0, 50) : null,
    });

    console.info('FCM token registered', {
      userId: auth.user.id,
      ip: getClientIp(req),
      userAgent: req.headers.get('user-agent'),
      platform: typeof platform === 'string' ? platform.trim().slice(0, 50) : null,
    });

    return NextResponse.json({ message: 'FCM token registered' });
  } catch (error) {
    console.error('FCM register error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
