# Backend Documentation & Integration Guide (Current Implementation)

This document reflects the backend as it is currently implemented in this repository.

---

## 1) Architecture Overview

This backend is built using **Next.js (App Router)** and **Supabase**. It functions as a set of serverless API routes under `app/api/*`.

### Core technologies

- Framework: Next.js (App Router)
- Database: Supabase Postgres
- Auth: Supabase Auth (JWT Bearer tokens)
- Payments: Paystack
- Push notifications: Firebase Admin SDK (FCM)
- Optional utilities: Google Maps Geocoding proxy (only if enabled)

---

## 2) Authentication & Authorization

### 2.1 JWT authentication (primary)

Most user-specific routes require:

- `Authorization: Bearer <supabase_access_token>`

The token is validated by Supabase (`supabase.auth.getUser(token)`): [auth.ts](file:///c:/Users/ronni/Desktop/manchicodes/lib/auth.ts#L57-L84)

Common responses:

- `401 Unauthorized` → missing/invalid/expired JWT
- `403 Forbidden` → valid JWT but role/location not permitted

### 2.2 Staff-only authorization (admin dashboard)

Staff routes require:

1) a valid JWT, and
2) `profiles.role` in `admin` or `super_admin`

Implementation: [requireStaffUser](file:///c:/Users/ronni/Desktop/manchicodes/lib/auth.ts#L20-L46)

Location scoping:

- `admin` users can only update orders that match their `profiles.location` (unless their location is `All`)
- `super_admin` can update any order

Enforced in: [orders/[id] PATCH](file:///c:/Users/ronni/Desktop/manchicodes/app/api/orders/%5Bid%5D/route.ts#L45-L60)

---

## 3) Required Environment Variables (Server)

These must be configured in Vercel (and locally if you run the backend locally):

```env
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
PAYSTACK_SECRET_KEY=...
FIREBASE_SERVICE_ACCOUNT_JSON=... # Firebase service account JSON (stringified)
DELETED_USER_ID=...               # UUID of a real placeholder Supabase Auth user
```

Quick check:

- `GET /api/health` reports configuration + connectivity: [health route](file:///c:/Users/ronni/Desktop/manchicodes/app/api/health/route.ts)

---

## 4) Database Integration (Supabase)

The backend uses `@supabase/supabase-js` with the **service role** key on the server. This allows the backend to perform privileged operations (and not be blocked by RLS).

Client initialization: [supabase.ts](file:///c:/Users/ronni/Desktop/manchicodes/lib/supabase.ts)

---

## 5) API Routes (Current)

All routes live under: [app/api](file:///c:/Users/ronni/Desktop/manchicodes/app/api)

### 5.1 System health

- `GET /api/health` → env checks + Supabase + Paystack + FCM parseability

### 5.2 Addresses

Resource: `app/api/addresses/*`

- `GET /api/addresses` (JWT required)
- `POST /api/addresses` (JWT required)
- `PUT /api/addresses/:id` (JWT required)
- `DELETE /api/addresses/:id` (JWT required)

### 5.3 Orders (customer)

- `POST /api/orders` (JWT required)
  - Creates an order and inserts `order_items`.
  - Sends an “order placed” push notification (if the user has tokens and FCM is configured).
  - Supports food and side line-items.

Items model (summary):

- each item must include either `food_id` (for food) or `side_id` (for side)
- `options` are treated as selected sides/add-ons

### 5.4 Orders (staff/admin)

- `PATCH /api/orders/:id` (staff-only JWT required)
  - Updates `orders.status`
  - If status changed and `orders.user_id` exists, sends a status-change push
  - Logs a structured push result to Vercel logs (`Order status push result`)

Route: [orders/[id] PATCH](file:///c:/Users/ronni/Desktop/manchicodes/app/api/orders/%5Bid%5D/route.ts)

### 5.5 Payments (Paystack)

Routes:

- `POST /api/paystack/initialize` (JWT required)
- `GET /api/paystack/verify?reference=...` (JWT required)

### 5.6 Notifications (in-app inbox)

Routes (JWT required):

- `GET /api/notifications` → list
- `POST /api/notifications` → mark all read
- `PATCH /api/notifications/:id` → mark one read

### 5.7 Push notifications (FCM)

Token registration (JWT required):

- `POST /api/fcm/register` → stores device token in `public.fcm_tokens`: [fcm/register](file:///c:/Users/ronni/Desktop/manchicodes/app/api/fcm/register/route.ts)

Optional (JWT required):

- `POST /api/fcm/unregister` → deletes a token for this user: [fcm/unregister](file:///c:/Users/ronni/Desktop/manchicodes/app/api/fcm/unregister/route.ts)

Broadcast (“campaign”) (staff-only JWT required):

- `POST /api/fcm/broadcast` → sends to all tokens and stores a broadcast notification row: [fcm/broadcast](file:///c:/Users/ronni/Desktop/manchicodes/app/api/fcm/broadcast/route.ts)

FCM implementation + message mapping:

- [fcm.ts](file:///c:/Users/ronni/Desktop/manchicodes/lib/fcm.ts)

### 5.8 Account deletion

- `POST /api/account/delete` (JWT required)

Key behaviors:

- Requires server env `DELETED_USER_ID` (placeholder Auth user)
- Reassigns orders to the placeholder user and clears delivery PII
- Deletes related rows (profiles, addresses, and optionally fcm_tokens + user_notifications)
- Deletes the Supabase Auth user last (falls back to soft delete if hard delete fails)

Route: [account delete](file:///c:/Users/ronni/Desktop/manchicodes/app/api/account/delete/route.ts)

### 5.9 Transport prices

- `GET /api/transport_prices?lga=...` (JWT required)

### 5.10 Maps (optional)

- `GET /api/maps/geocode?address=...`
- `POST /api/maps/geocode` with `{ address }` or `{ lat, lng }`

This route requires `GOOGLE_MAPS_API_KEY` only if you actively use it: [maps/geocode](file:///c:/Users/ronni/Desktop/manchicodes/app/api/maps/geocode/route.ts)

---

## 6) How Clients Should Call This API

### Base URL

Use your deployed domain (no `/api` suffix in the base):

```text
https://<your-backend-domain>
```

### Global headers (typical)

```json
{
  "Content-Type": "application/json",
  "Authorization": "Bearer <supabase_access_token>"
}
```

Staff routes use the same header, but the token must belong to a user with `profiles.role` set to `admin` or `super_admin`.

### Error format

Errors follow the standard shape:

- `{ "error": "..." }` with appropriate status codes (`400/401/403/404/422/500`)

---

## 7) Operational Notes (Vercel Logs)

When staff updates order status, the backend logs:

- `Order status push result { configured, attempted, success, failure, invalid_tokens_removed, notification_saved, ... }`

If pushes fail:

- `[FCM] Not configured; skipping send.` → missing/invalid `FIREBASE_SERVICE_ACCOUNT_JSON`
- `messaging/registration-token-not-registered` → token is stale (user needs to open the app to re-register)

---

## 8) Reference Manual

For the day-to-day operational manual (campaigns, Vercel logs, workflows), see:

- [OPERATIONS_MANUAL.md](file:///c:/Users/ronni/Desktop/manchicodes/OPERATIONS_MANUAL.md)
