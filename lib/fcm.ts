/**
 * FCM (Firebase Cloud Messaging) helper.
 * Set FIREBASE_SERVICE_ACCOUNT_JSON (stringified JSON) in env to enable sending.
 * If not set, send functions no-op and return.
 */

import * as admin from 'firebase-admin';
import { deleteFcmTokens, getAllFcmTokens, getFcmTokensByUserId, insertUserNotification } from './db';

let app: admin.app.App | null = null;

function getServiceAccountEnv(): string | null {
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (json && json.trim()) return json;
  const legacy = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (legacy && legacy.trim()) return legacy;
  return null;
}

function isValidServiceAccount(value: unknown): value is admin.ServiceAccount & { project_id: string; client_email: string; private_key: string } {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.project_id === 'string' && typeof v.client_email === 'string' && typeof v.private_key === 'string';
}

function normalizePrivateKey(cred: { private_key: string }): void {
  cred.private_key = cred.private_key.replace(/\\n/g, '\n');
}

function getMessaging(): admin.messaging.Messaging | null {
  if (app) return app.messaging();
  if (admin.apps.length > 0) {
    app = admin.app();
    return app.messaging();
  }
  const json = getServiceAccountEnv();
  if (!json) return null;
  try {
    const credRaw = JSON.parse(json) as unknown;
    if (!isValidServiceAccount(credRaw)) {
      console.error('[FCM] Invalid Firebase service account JSON: missing required fields');
      return null;
    }
    normalizePrivateKey(credRaw);
    const cred = credRaw as admin.ServiceAccount;
    app = admin.initializeApp({ credential: admin.credential.cert(cred) });
    console.info('[FCM] Initialized', { project_id: credRaw.project_id, client_email: credRaw.client_email });
    return app.messaging();
  } catch (e) {
    console.error('[FCM] Invalid Firebase service account JSON:', e);
    return null;
  }
}

export async function fcmSelfTest(): Promise<{ ok: boolean; message: string }> {
  const json = getServiceAccountEnv();
  if (!json) return { ok: false, message: 'Missing FIREBASE_SERVICE_ACCOUNT_JSON' };

  let credRaw: unknown;
  try {
    credRaw = JSON.parse(json) as unknown;
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Invalid JSON' };
  }

  if (!isValidServiceAccount(credRaw)) {
    return { ok: false, message: 'Firebase service account missing required fields' };
  }
  normalizePrivateKey(credRaw);

  try {
    const credential = admin.credential.cert(credRaw as admin.ServiceAccount) as unknown as { getAccessToken?: () => Promise<unknown> };
    if (typeof credential.getAccessToken !== 'function') {
      return { ok: false, message: 'Firebase credential does not support access tokens' };
    }
    await credential.getAccessToken();
    return { ok: true, message: 'Firebase OAuth access token OK' };
  } catch (e) {
    const message =
      e && typeof e === 'object' && 'message' in e ? String((e as { message?: unknown }).message ?? 'OAuth error') : 'OAuth error';
    return { ok: false, message };
  }
}

export interface FcmPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

export type FcmSendResult = {
  configured: boolean;
  attempted: number;
  success: number;
  failure: number;
  invalid_tokens_removed: number;
  notification_saved?: boolean;
};

function isInvalidRegistrationTokenError(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: unknown }).code ?? '') : '';
  return code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token';
}

async function sendToTokens(tokens: string[], payload: FcmPayload): Promise<{ result: FcmSendResult; invalidTokens: string[] }> {
  if (tokens.length === 0) {
    return {
      result: { configured: true, attempted: 0, success: 0, failure: 0, invalid_tokens_removed: 0 },
      invalidTokens: [],
    };
  }
  const messaging = getMessaging();
  if (!messaging) {
    console.warn('[FCM] Not configured; skipping send.');
    return {
      result: { configured: false, attempted: tokens.length, success: 0, failure: tokens.length, invalid_tokens_removed: 0 },
      invalidTokens: [],
    };
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
    const invalidTokens: string[] = [];
    for (let i = 0; i < res.responses.length; i++) {
      const r = res.responses[i];
      if (!r.success && r.error && isInvalidRegistrationTokenError(r.error)) {
        invalidTokens.push(tokens[i]);
      }
    }

    let removed = 0;
    if (invalidTokens.length > 0) {
      try {
        await deleteFcmTokens(invalidTokens);
        removed = invalidTokens.length;
      } catch (e) {
        console.error('[FCM] Failed to remove invalid tokens:', e);
      }
    }

    if (res.failureCount > 0) {
      console.warn('[FCM] Some sends failed:', res.responses.filter((r) => !r.success));
    }
    return {
      result: {
        configured: true,
        attempted: tokens.length,
        success: res.successCount,
        failure: res.failureCount,
        invalid_tokens_removed: removed,
      },
      invalidTokens,
    };
  } catch (e) {
    console.error('[FCM] Send error:', e);
    return {
      result: { configured: true, attempted: tokens.length, success: 0, failure: tokens.length, invalid_tokens_removed: 0 },
      invalidTokens: [],
    };
  }
}

/** Send to a specific user's registered devices. */
export async function sendToUser(userId: string, payload: FcmPayload): Promise<FcmSendResult> {
  const tokens = await getFcmTokensByUserId(userId);
  if (tokens.length === 0) {
    console.info('FCM send skipped: no tokens for user', { userId });
  }
  const { result } = await sendToTokens(tokens, payload);
  return result;
}

/** Send to all registered devices (admin broadcast). */
export async function sendToAll(payload: FcmPayload): Promise<FcmSendResult> {
  const tokens = await getAllFcmTokens();
  const { result } = await sendToTokens(tokens, payload);
  return result;
}

/** Notify customer that their order was placed. */
export async function notifyOrderCreated(userId: string, orderId: number): Promise<FcmSendResult> {
  const title = 'Order placed';
  const body = 'Thank you for ordering with us. Your order is now being processed.';
  const result = await sendToUser(userId, {
    title,
    body,
    data: { order_id: String(orderId), route: 'order_history', type: 'order_placed' },
  });
  let notificationSaved = false;
  await insertUserNotification(userId, title, body, 'order_placed', orderId)
    .then(() => {
      notificationSaved = true;
    })
    .catch((e) => console.error('[FCM] Save notification:', e));
  return { ...result, notification_saved: notificationSaved };
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
): Promise<FcmSendResult> {
  const message = statusMessages[status];
  if (!message) {
    return { configured: true, attempted: 0, success: 0, failure: 0, invalid_tokens_removed: 0, notification_saved: false };
  }

  const result = await sendToUser(userId, {
    title: message.title,
    body: message.body,
    data: {
      order_id: String(orderId),
      status,
      type: 'order_status_changed',
      route: 'order_history',
    },
  });
  let notificationSaved = false;
  await insertUserNotification(userId, message.title, message.body, 'order_status_changed', orderId)
    .then(() => {
      notificationSaved = true;
    })
    .catch((e) => console.error('[FCM] Save notification:', e));
  return { ...result, notification_saved: notificationSaved };
}
