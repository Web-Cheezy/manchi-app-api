# Backend Operations Manual (Vercel + Supabase + FCM)

This document is the day-to-day manual for operating the backend: deployments, push notifications (FCM), admin order status updates, mobile app integration, and account deletion.

---

## 1) What This Backend Is

- Framework: Next.js (App Router) serverless API routes
- Data: Supabase (Postgres + Auth)
- Payments: Paystack
- Push notifications: Firebase Admin SDK (FCM)

Key folders:

- API routes: [app/api](file:///c:/Users/ronni/Desktop/manchicodes/app/api)
- Auth helpers: [auth.ts](file:///c:/Users/ronni/Desktop/manchicodes/lib/auth.ts)
- Supabase client (service-role): [supabase.ts](file:///c:/Users/ronni/Desktop/manchicodes/lib/supabase.ts)
- FCM sending logic: [fcm.ts](file:///c:/Users/ronni/Desktop/manchicodes/lib/fcm.ts)

---

## 2) Required Environment Variables (Vercel)

Set these in **Vercel → Project → Settings → Environment Variables**.

### Core

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

### Push Notifications (FCM)

- `FIREBASE_SERVICE_ACCOUNT_JSON`
  - Must be a valid JSON string for a Firebase service account (Admin SDK key).
  - If this is missing or malformed, pushes will not send.

### Account Deletion

- `DELETED_USER_ID`
  - UUID of a real Supabase Auth user that acts as the placeholder “deleted user”.

### Paystack

- `PAYSTACK_SECRET_KEY`

### Optional / legacy

- This backend currently does **not** enforce `x-api-key` for requests. Some older docs mention an API key header; those are historical and not used by the current code.

---

## 3) Health Check (Quick Operational Test)

Endpoint:

- `GET /api/health` → returns overall status and per-service checks

What it checks:

- Supabase connectivity
- Paystack network reachability
- Firebase JSON presence + parseability

Implementation: [health route](file:///c:/Users/ronni/Desktop/manchicodes/app/api/health/route.ts)

---

## 4) Authentication Model (How Requests Are Authorized)

This backend primarily uses **Supabase JWTs**.

### Mobile app (customer)

- The app signs in with Supabase Auth.
- For user-specific routes it calls the backend with:
  - `Authorization: Bearer <supabase_access_token>`

The backend validates this token using Supabase: [requireAuthenticatedUser](file:///c:/Users/ronni/Desktop/manchicodes/lib/auth.ts#L68-L84)

### Admin users (staff)

- Staff endpoints require the same `Authorization: Bearer <token>` header.
- The backend then checks `profiles.role` for `admin` / `super_admin`: [requireStaffUser](file:///c:/Users/ronni/Desktop/manchicodes/lib/auth.ts#L20-L46)

Location scoping:

- Regular `admin` users are restricted to orders for their location; `super_admin` can update any order.
- Enforced inside the status update route: [orders/[id] PATCH](file:///c:/Users/ronni/Desktop/manchicodes/app/api/orders/%5Bid%5D/route.ts#L45-L60)

---

## 5) How the Mobile App Communicates With the Backend

Typical customer flows:

### Orders

- Create order: `POST /api/orders` (JWT required)
- Order history: `GET /api/orders?userId=...` (JWT required in current implementation)

Order creation also triggers an “order placed” push (if FCM configured and token exists): [notifyOrderCreated](file:///c:/Users/ronni/Desktop/manchicodes/lib/fcm.ts#L140-L155)

### Payments

- Initialize: `POST /api/paystack/initialize` (JWT required)
- Verify: `GET /api/paystack/verify?reference=...` (JWT required)

### Notifications inbox (in-app history)

- List: `GET /api/notifications` (JWT required): [notifications route](file:///c:/Users/ronni/Desktop/manchicodes/app/api/notifications/route.ts#L9-L22)
- Mark all read: `POST /api/notifications` (JWT required)
- Mark one read: `PATCH /api/notifications/:id` (JWT required): [notifications/[id]](file:///c:/Users/ronni/Desktop/manchicodes/app/api/notifications/%5Bid%5D/route.ts)

---

## 6) How the Admin Panel Communicates With the Backend

To ensure pushes are sent, the admin panel must call the backend API route that performs the update and triggers FCM.

### Update order status (the important one)

- Endpoint: `PATCH /api/orders/:id`
- Headers:
  - `Authorization: Bearer <admin_supabase_access_token>`
  - `Content-Type: application/json`
- Body:
  - `{ "status": "pending|confirmed|preparing|delivering|delivered|cancelled" }`

Implementation: [orders/[id] PATCH](file:///c:/Users/ronni/Desktop/manchicodes/app/api/orders/%5Bid%5D/route.ts#L7-L87)

Important:

- If the admin panel updates the `orders` table directly via Supabase client, **no push** will be sent because the backend trigger code will be bypassed.

---

## 7) FCM Push Notifications (Operations + Campaigns)

This backend supports:

1) Per-user notifications:

- Order placed
- Order status changes

2) Broadcast notifications (“campaigns”) to all registered tokens:

- Staff-only broadcast endpoint

### 7.1 How tokens get into the database

The app registers device tokens using:

- `POST /api/fcm/register` (JWT required)
- Body minimally requires: `{ "fcm_token": "..." }`

Route: [fcm/register](file:///c:/Users/ronni/Desktop/manchicodes/app/api/fcm/register/route.ts)

Stored in `public.fcm_tokens`.

### 7.2 How to send a “campaign” (broadcast)

Endpoint:

- `POST /api/fcm/broadcast` (staff-only JWT required)

Body:

```json
{
  "title": "Promo",
  "body": "Free delivery today!",
  "data": { "route": "home", "type": "broadcast" }
}
```

Route: [fcm/broadcast](file:///c:/Users/ronni/Desktop/manchicodes/app/api/fcm/broadcast/route.ts)

What it does:

- Sends to all tokens via FCM
- Saves a broadcast row into `public.user_notifications` (with `user_id` null) so the app can show it in history

### 7.3 Order status notifications

When staff updates an order’s status, the backend sends the user a push using the status message mapping:

- `pending`, `confirmed`, `preparing`, `delivering`, `delivered`, `cancelled`

Mapping is defined in: [statusMessages](file:///c:/Users/ronni/Desktop/manchicodes/lib/fcm.ts#L157-L182)

### 7.4 iOS (Apple devices) notes

iOS delivery requires APNs configuration in Firebase:

- Firebase Console → Project Settings → Cloud Messaging → Apple app configuration
- Use APNs Auth Key (.p8) (recommended)

If APNs is missing/misconfigured, iOS will not receive pushes even if Android works.

---

## 8) Vercel Logs: What You’ll See and What It Means

### 8.1 Order status push result

When a staff order status update triggers a push, the backend logs:

`Order status push result { ... }`

This is logged in: [orders/[id] PATCH](file:///c:/Users/ronni/Desktop/manchicodes/app/api/orders/%5Bid%5D/route.ts#L71-L81)

Fields:

- `configured`
  - `true`: Firebase JSON is present and parseable
  - `false`: FCM not configured; no push attempt will be made
- `attempted`
  - number of tokens fetched for the user
- `success`, `failure`
  - counts from Firebase send result
- `invalid_tokens_removed`
  - number of tokens removed from `fcm_tokens` because Firebase reported they are invalid
- `notification_saved`
  - whether the in-app notification was saved to `user_notifications`

### 8.2 Common FCM warnings/errors

- `[FCM] Not configured; skipping send.`
  - `FIREBASE_SERVICE_ACCOUNT_JSON` missing or invalid
- `messaging/registration-token-not-registered`
  - the stored device token is stale (reinstall / token rotated)
  - backend removes it automatically (`invalid_tokens_removed` increments)
- `[FCM] Some sends failed: [...]`
  - one or more tokens failed; inspect `errorInfo.code` in the log for exact reason

FCM send logic: [sendToTokens](file:///c:/Users/ronni/Desktop/manchicodes/lib/fcm.ts#L61-L123)

---

## 9) Account Deletion (How It’s Configured)

Endpoint:

- `POST /api/account/delete` (JWT required)

Implementation: [account deletion route](file:///c:/Users/ronni/Desktop/manchicodes/app/api/account/delete/route.ts)

What it does:

1) Rate-limits deletion attempts (per user + IP)
2) Requires `DELETED_USER_ID` env var:
   - must be a real Supabase Auth user
   - must not equal the current user
3) Anonymizes orders:
   - reassigns `orders.user_id` to `DELETED_USER_ID`
   - clears delivery PII fields
   - sets `anonymized_at` and optional `anonymized_reason`
4) Deletes user-owned rows:
   - `profiles`, `addresses`
   - optional: `fcm_tokens`, `user_notifications` (if tables exist)
5) Deletes the Supabase Auth user:
   - tries hard delete first
   - if Supabase returns “Database error deleting user”, it retries with soft delete

Operational requirement:

- Create and keep a dedicated “deleted user” account in Supabase Auth and store its UUID in `DELETED_USER_ID`.

---

## 10) SQL: Token & Notification Tables (Reference)

If you need to create/extend the notification-related tables, see:

- [SQL_SCHEMA_ADDITIONS.md](file:///c:/Users/ronni/Desktop/manchicodes/SQL_SCHEMA_ADDITIONS.md)

Key tables:

- `public.fcm_tokens` (device tokens)
- `public.user_notifications` (in-app notification history)

---

## 11) Day-2 Operations Checklist

### Push notifications not sending

1) Check `GET /api/health` → `checks.fcm`
2) Check Vercel logs for `[FCM] Not configured`
3) If configured is true but success is 0:
   - check for `registration-token-not-registered`
   - the user needs to open the app again so it re-registers a fresh token
4) If only iOS fails:
   - confirm APNs setup in Firebase

### Users report “I didn’t get a push”

- Confirm there is a row for that user in `public.fcm_tokens`
- Trigger an order status update and review the `Order status push result` log
- Check if `invalid_tokens_removed > 0` (stale tokens were present)

### Admin updates status but user doesn’t get push

- Ensure the admin panel is calling `PATCH /api/orders/:id` (not direct Supabase table updates)
- Ensure the admin user has `profiles.role` set to `admin` or `super_admin`

---

## 12) Security Notes

- Never commit secrets to git (service role keys, Paystack secret, Firebase private key).
- Rotate secrets if exposed.
- Consider Supabase storage policies to prevent public bucket listing if you store user content.

