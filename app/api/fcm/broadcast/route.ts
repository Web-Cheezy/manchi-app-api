import { NextRequest, NextResponse } from 'next/server';
import { validateRequest, unauthorizedResponse } from '@/lib/auth';
import { sendToAll } from '@/lib/fcm';
import { insertUserNotification } from '@/lib/db';

/**
 * Admin broadcast: send a push notification to all registered FCM tokens.
 * Body: { "title": string, "body": string, "data"?: Record<string, string> }
 */
export async function POST(req: NextRequest) {
  if (!validateRequest(req)) return unauthorizedResponse();

  try {
    const payload = await req.json();
    const { title, body: messageBody, data } = payload;

    if (!title || !messageBody) {
      return NextResponse.json(
        { error: 'title and body are required' },
        { status: 400 }
      );
    }

    await sendToAll({
      title: String(title),
      body: String(messageBody),
      data: data && typeof data === 'object' ? data : undefined,
    });

    await insertUserNotification(null, String(title), String(messageBody), 'broadcast').catch(
      (e) => console.error('Save broadcast notification:', e)
    );

    return NextResponse.json({ message: 'Broadcast sent' });
  } catch (error) {
    console.error('FCM broadcast error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
