# Backend Operations Manual (Vercel + Supabase + FCM)

Day-to-day operations for **manchicodes** (`https://manchicodes.vercel.app`): deployments, checkout/payments, push notifications, admin integration, and account deletion.

**Mobile integration:** see [FLUTTER_INTEGRATION.md](./FLUTTER_INTEGRATION.md) for the full API contract, schema mapping, and security rules.

---

## 1) What this backend is

| Layer | Technology |
|-------|------------|
| API | Next.js App Router (serverless on Vercel) |
| Database & auth | Supabase (Postgres + Auth) |
| Payments | Paystack (server-side only) |
| Push | Firebase Admin SDK (FCM) |

**Key code paths:**

| Area | Location |
|------|----------|
| API routes | `app/api/` |
| Auth (JWT + staff roles) | `lib/auth.ts` |
| Supabase service role client | `lib/supabase.ts` |
| Order validation & `order_items` | `lib/orders.ts`, `lib/optionGroups.ts` |
| Menu pricing (`display_price`, `price_delta`) | `lib/foodPricing.ts` |
| Payment helpers (`orderId` in metadata) | `lib/payments.ts` |
| FCM | `lib/fcm.ts` |

**Related project:** **foodbackend** is the staff admin panel. It talks to Supabase directly for menu/options and calls **only** `PATCH /api/orders/:id` on manchicodes for status updates (FCM).

---

## 2) Required environment variables (Vercel)

Set in **Vercel → Project → Settings → Environment Variables**.

### Core

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side DB access (never in mobile app) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Optional; used when staff JWT + RLS fallback is enabled |

### Paystack

| Variable | Purpose |
|----------|---------|
| `PAYSTACK_SECRET_KEY` | Initialize + verify transactions |

### Push notifications (FCM)

| Variable | Purpose |
|----------|---------|
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Firebase Admin SDK service account JSON string |

### Account deletion

| Variable | Purpose |
|----------|---------|
| `DELETED_USER_ID` | UUID of placeholder auth user for anonymized orders |

### Maps (optional)

| Variable | Purpose |
|----------|---------|
| `GOOGLE_MAPS_API_KEY` | `/api/maps/geocode` |

### Not used

- **`x-api-key` / `API_SECRET_KEY`** — not enforced by current code. Do not document as required for mobile clients.

### foodbackend (separate Vercel project)

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Same Supabase project |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Admin browser client |
| `BACKEND_URL` | `https://manchicodes.vercel.app` — **only** for `PATCH /api/orders/:id` |

---

## 3) Health check

```
GET /api/health
```

No auth. Reports Supabase, Paystack reachability, FCM JSON parseability, and missing env vars.

---

## 4) Authentication & security

### Mobile (customers)

- Sign in via Supabase Auth (`/api/auth/otp`, `/api/auth/verify`, etc.).
- Protected routes require: `Authorization: Bearer <supabase_access_token>`.
- Validated by `requireAuthenticatedUser` in `lib/auth.ts`.

### Staff (admin / super_admin)

- Same Bearer token from admin panel login.
- `requireStaffUser` checks `profiles.role` ∈ `{ admin, super_admin }`.
- Used for `PATCH /api/orders/:id`, `/api/fcm/broadcast`, `/api/admin/*` routes.

### Production security practices (implemented)

| Control | Where |
|---------|--------|
| No Paystack secret in client | Paystack routes server-only |
| No service role in mobile app | Flutter → manchicodes API only |
| Server-side price validation | `POST /api/orders` recomputes `expected_total` |
| Order ownership on payment | `paystack/initialize` verifies `metadata.orderId` belongs to user |
| User-scoped verify | `paystack/verify` checks `transactions.user_id` |
| Rate limits | Paystack init/verify, account delete |
| Staff location scoping | Branch `admin` can only PATCH orders for their `profiles.location` |

### Supabase RLS

Run in SQL Editor when setting up staff menu access:

- `supabase/rls_staff_menu.sql` — `is_staff()` policies on menu/order tables
- `supabase/display_pricing.sql` — `display_price`, `default_side_id`

---

## 5) Checkout & payments (production flow)

This is the **required** mobile flow. Orders are created **before** payment (intentional); the admin kitchen only sees **paid** orders.

```
1. POST /api/orders          → orders (pending) + order_items rows
2. POST /api/paystack/initialize  → transactions (pending), metadata.orderId required
3. User pays on Paystack
4. GET /api/paystack/verify  → transactions.status = success, orders.pending → confirmed
5. Admin dashboard shows order (linked via transactions.metadata.orderId)
```

### `POST /api/orders`

- JWT required.
- Validates items, option `selections`, branch availability, delivery LGA → `transport_prices`.
- Writes:
  - **`orders`** — header + `items` JSONB (server snapshots)
  - **`order_items`** — one row per line (`food_id` or `side_id`, `options` snapshot)
- Triggers customer push `order_placed` (if FCM configured).

### `POST /api/paystack/initialize`

- JWT required.
- **`metadata.orderId` required** — must match `order_id` from step 1.
- Verifies order belongs to authenticated user.
- Stores `orderId` + `order_id` in `transactions.metadata`.
- **`amount` in kobo** (₦7,100 → `710000`).

### `GET /api/paystack/verify`

- JWT required; user must own the transaction.
- Updates `transactions.status` from Paystack.
- On success: sets `orders.status` from `pending` → `confirmed`.
- Returns `order_id` in JSON response.

### Admin visibility (foodbackend)

- Dashboard / Orders / Payments list **only orders with a verified transaction** (`status` = `success` or `completed`) where `metadata.orderId` (or `order_id`) matches `orders.id`.
- Unpaid `pending` orders exist in DB for the customer app but **do not** appear in admin until payment verifies.

---

## 6) Menu & option groups

### Customer menu

```
GET /api/menu?location=Chasemall
GET /api/foods?id=1&location=Chasemall
```

Returns foods with `option_groups`, `menu_price` / `display_price`, and `price_delta` on sides.

### Database tables

- `option_groups` — per-food customization (`default_side_id` = included in menu price)
- `sides` — options linked via `option_group_id`
- `food_availability` / `side_availability` — per-branch stock

### Admin menu editing

Handled in **foodbackend** via Supabase client (not `/api/admin/*` proxy). Staff must have `profiles.role` = `admin` or `super_admin` and RLS policies from `rls_staff_menu.sql`.

---

## 7) How the admin panel communicates

| Action | Method |
|--------|--------|
| View paid orders | foodbackend → Supabase (`orders` filtered by `transactions`) |
| Edit menu / options | foodbackend → Supabase directly |
| Update order status | foodbackend → `PATCH https://manchicodes.vercel.app/api/orders/:id` |

### Update order status (triggers FCM)

```
PATCH /api/orders/:id
Authorization: Bearer <admin_supabase_access_token>
Content-Type: application/json

{ "status": "preparing" }
```

Allowed: `pending`, `confirmed`, `preparing`, `delivering`, `delivered`, `cancelled`.

**Important:** Updating `orders` directly in Supabase bypasses FCM status pushes.

Implementation: `app/api/orders/[id]/route.ts`

---

## 8) FCM push notifications

### Token registration

```
POST /api/fcm/register
{ "fcm_token": "...", "device_id": "...", "platform": "ios|android" }
```

Stored in `public.fcm_tokens`.

### Automatic pushes

| Event | When |
|-------|------|
| Order placed | After `POST /api/orders` |
| Status changed | After staff `PATCH /api/orders/:id` |

Status message mapping: `lib/fcm.ts` → `statusMessages`.

### Broadcast (staff only)

```
POST /api/fcm/broadcast
{ "title": "...", "body": "...", "data": { "route": "home" } }
```

Also inserts into `user_notifications` with `user_id` null.

### In-app inbox

| Endpoint | Action |
|----------|--------|
| `GET /api/notifications` | List |
| `PATCH /api/notifications/:id` | Mark read |
| `POST /api/notifications` | Mark all read |

### iOS (APNs + FCM)

iOS push requires **APNs configured in Firebase** plus correct Flutter registration. Backend sends explicit APNs alert payloads (`lib/fcm.ts`).

**Firebase (one-time):** Project settings → Cloud Messaging → upload APNs Auth Key (.p8). Bundle ID must match Xcode.

**Flutter:** Request permission → `getToken()` → `POST /api/fcm/register` with `"platform": "ios"` **after login**. Re-register on token refresh.

**Verify tokens:**

```sql
SELECT platform, count(*) FROM fcm_tokens GROUP BY platform;
```

No `ios` rows = no iPhone pushes. See `FLUTTER_INTEGRATION.md` → Push notifications → iOS.

### Forgot password

| Endpoint | Body |
|----------|------|
| `POST /api/auth/forgot-password` | `{ "email" }` — sends 6-digit OTP (no link) |
| `POST /api/auth/reset-password` | `{ "email", "token", "password" }` — min 8 chars |

---

## 9) Vercel logs

### Order status push

After staff PATCH, look for:

```
Order status push result { configured, attempted, success, failure, invalid_tokens_removed, notification_saved }
```

### FCM warnings

| Log | Meaning |
|-----|---------|
| `[FCM] Not configured` | `FIREBASE_SERVICE_ACCOUNT_JSON` missing/invalid |
| `registration-token-not-registered` | Stale token removed from `fcm_tokens` |

---

## 10) Account deletion

```
POST /api/account/delete
Authorization: Bearer <token>
```

1. Rate-limited per user + IP  
2. Requires valid `DELETED_USER_ID` env  
3. Anonymizes orders (`user_id` → placeholder, clears delivery PII, sets `anonymized_at`)  
4. Deletes `profiles`, `addresses`, FCM tokens, notifications  
5. Deletes or soft-deletes Supabase Auth user  

---

## 11) Database schema reference

Core tables (see [FLUTTER_INTEGRATION.md](./FLUTTER_INTEGRATION.md) for field-level detail):

| Table | Role |
|-------|------|
| `profiles` | Users; `role`, `location` for staff |
| `categories`, `foods`, `option_groups`, `sides` | Menu |
| `food_availability`, `side_availability` | Branch stock |
| `orders`, `order_items` | Checkout |
| `transactions` | Paystack payments (`metadata.orderId` links to orders) |
| `transport_prices` | Delivery fee by LGA |
| `addresses` | Saved addresses |
| `fcm_tokens`, `user_notifications` | Push |

SQL migrations: `supabase/display_pricing.sql`, `supabase/order_note.sql`, `supabase/rls_staff_menu.sql`

---

## 12) Day-2 troubleshooting

### Order in DB but not in admin

1. Was Paystack verify called and returned `success`?
2. Does `transactions.metadata` contain `orderId` matching `orders.id`?
3. Is `transactions.status` = `success` or `completed`?

### Paystack initialize returns 400

- Missing `metadata.orderId`
- Order does not belong to the paying user
- Order id typo

### `order_items` empty but `orders.items` has JSON

- App inserted into `orders` directly instead of `POST /api/orders`. Fix the mobile client.

### Push not sent on status update

- Admin must use `PATCH /api/orders/:id`, not direct Supabase update
- Admin `profiles.role` must be `admin` or `super_admin`
- Check `GET /api/health` → FCM configured

### Build/deploy fails on Vercel

- Run `npm run build` locally in `manchicodes`
- Admin API routes under `app/api/admin/*` must compile (TypeScript in `lib/foodPricing.ts`)

---

## 13) Security checklist

- [ ] Never commit `SUPABASE_SERVICE_ROLE_KEY`, `PAYSTACK_SECRET_KEY`, or Firebase private keys
- [ ] Rotate secrets if exposed
- [ ] Mobile app uses JWT only — no service role
- [ ] `rls_staff_menu.sql` applied in Supabase
- [ ] `transactions_rls.sql` applied for admin payment views (foodbackend)
- [ ] Paystack initialize requires `orderId` in production
- [ ] Admin panel `BACKEND_URL` points to manchicodes, not foodbackend itself

---

## 14) Deploy checklist

1. `git push` → Vercel auto-deploys **manchicodes**
2. Confirm `GET /api/health` is healthy
3. Confirm `GET /api/admin/foods/1/option-groups` returns **401 JSON** (not HTML 404) if using admin API routes
4. Deploy **foodbackend** separately
5. Smoke test: create order → pay → verify → order appears in admin
