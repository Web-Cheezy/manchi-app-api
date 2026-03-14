/**
 * FCM (Firebase Cloud Messaging) helper.
 * Set FIREBASE_SERVICE_ACCOUNT_JSON (stringified JSON) in env to enable sending.
 * If not set, send functions no-op and return.
 */

import * as admin from 'firebase-admin';
import { getFcmTokensByUserId, getAllFcmTokens } from './db';

let app: admin.app.App | null = null;

function getMessaging(): admin.messaging.Messaging | null {
  if (app) return app.messaging();
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!json) return null;
  try {
    const cred = JSON.parse(json) as admin.ServiceAccount;
    app = admin.initializeApp({ credential: admin.credential.cert(cred) });
    return app.messaging();
  } catch (e) {
    console.error('[FCM] Invalid FIREBASE_SERVICE_ACCOUNT_JSON:', e);
    return null;
  }
}

export interface FcmPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

async function sendToTokens(tokens: string[], payload: FcmPayload): Promise<void> {
  if (tokens.length === 0) return;
  const messaging = getMessaging();
  if (!messaging) {
    console.warn('[FCM] Not configured; skipping send.');
    return;
  }
  const message: admin.messaging.MulticastMessage = {
    tokens,
    notification: { title: payload.title, body: payload.body },
    data: payload.data ?? {},
    android: { priority: 'high' },
    apns: { payload: { aps: { sound: 'default' } } },
  };
  try {
    const res = await messaging.sendEachForMulticast(message);
    if (res.failureCount > 0) {
      console.warn('[FCM] Some sends failed:', res.responses.filter((r) => !r.success));
    }
  } catch (e) {
    console.error('[FCM] Send error:', e);
  }
}

/** Send to a specific user's registered devices. */
export async function sendToUser(userId: string, payload: FcmPayload): Promise<void> {
  const tokens = await getFcmTokensByUserId(userId);
  await sendToTokens(tokens, payload);
}

/** Send to all registered devices (admin broadcast). */
export async function sendToAll(payload: FcmPayload): Promise<void> {
  const tokens = await getAllFcmTokens();
  await sendToTokens(tokens, payload);
}

/** Notify customer that their order was placed. */
export async function notifyOrderCreated(userId: string, orderId: number): Promise<void> {
  await sendToUser(userId, {
    title: 'Order placed',
    body: 'Thank you for ordering with us. Your order is now being processed.',
    data: { order_id: String(orderId), route: 'order_history', type: 'order_placed' },
  });
}

const statusMessages: Record<string, { title: string; body: string }> = {
  pending: {
    title: 'Order received',
    body: 'We have received your order and will confirm it shortly.',
  },
  confirmed: {
    title: 'Order confirmed',
    body: 'Your order has been confirmed and will soon be prepared.',
  },
  preparing: {
    title: 'Order is being prepared',
    body: 'Our kitchen is preparing your order.',
  },
  delivering: {
    title: 'Order out for delivery',
    body: 'Your order is on its way.',
  },
  delivered: {
    title: 'Order delivered',
    body: 'Your order has been delivered. Enjoy your meal!',
  },
  cancelled: {
    title: 'Order cancelled',
    body: 'Your order has been cancelled. If this is unexpected, please contact support.',
  },
};

/** Notify customer of order status change. */
export async function notifyOrderStatusChange(
  userId: string,
  orderId: number,
  status: string
): Promise<void> {
  const message = statusMessages[status];
  if (!message) return;

  await sendToUser(userId, {
    title: message.title,
    body: message.body,
    data: {
      order_id: String(orderId),
      status,
      type: 'order_status_changed',
      route: 'order_history',
    },
  });
}
