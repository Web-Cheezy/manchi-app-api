# Flutter Integration Guide

Production integration guide for the **manchicodes** API (`https://manchicodes.vercel.app`).  
This backend is the **only** server your mobile app should call for checkout, Paystack, and privileged database work.

## Base configuration

| Setting | Value |
|--------|--------|
| Base URL | `https://manchicodes.vercel.app` |
| Content-Type | `application/json` on POST/PATCH bodies |
| Customer auth | `Authorization: Bearer <supabase_access_token>` |

### Security (read this first)

1. **JWT required** for orders, payments, profile, addresses, FCM, notifications, and account deletion. The backend validates the token with Supabase Auth on every request.
2. **Never put `SUPABASE_SERVICE_ROLE_KEY` or `PAYSTACK_SECRET_KEY` in the Flutter app.** Those live only on Vercel.
3. **Never insert orders directly into Supabase** from the app. Use `POST /api/orders` so the server validates prices, availability, and writes `order_items`.
4. **`x-api-key` is not enforced** by the current backend (legacy docs mentioned it; it is optional and unused). Do not rely on a client-side API key for security.
5. **Prices are server-validated.** `total_amount` is recomputed from menu data; mismatches return `400` with `expected_total`.
6. **Paystack verify is user-scoped.** A user can only verify transactions they own (`transactions.user_id`).
7. **Branch locations** must be exactly `Chasemall` or `Eromo` (matches `orders.location`, `food_availability.location`, `transactions.location`).

---

## Database schema (your Supabase tables)

This section maps API behavior to your live schema.

### Identity & staff

| Table | Purpose |
|-------|---------|
| `profiles` | `id` → `auth.users`. `role`: `customer` \| `admin` \| `super_admin`. `location`: `Chasemall` \| `Eromo` \| `All`. Mobile users are `customer`. |

### Menu

| Table | Purpose |
|-------|---------|
| `categories` | Menu sections (`id`, `name`, `image_url`). |
| `foods` | Main dishes. `price` = base price. `display_price` = menu card price (base + included options). `category_id` → `categories`. |
| `option_groups` | Per-food customization groups (`food_id`, `name`, `min_selections`, `max_selections`, `is_required`, `display_order`, `default_side_id`). |
| `sides` | Options inside a group (`option_group_id`, `name`, `price`, `type`, `image_url`). |
| `food_sides` | Legacy link table (food ↔ side). Still used as fallback when `option_groups` is empty. |
| `food_availability` | Per-branch stock: `food_id`, `location`, `status` (`available` \| `out_of_stock` \| `unavailable`). |
| `side_availability` | Same for sides. |

### Orders & payments

| Table | Purpose |
|-------|---------|
| `orders` | Header: `user_id`, `status`, `total_amount`, `vat`, `delivery_address`, `delivery_lat`/`lng`, `location`, `delivery_method` (`delivery` \| `pickup`), `items` (JSONB snapshots), `order_note`. |
| `order_items` | One row per cart line, created by `POST /api/orders`: `order_id`, `food_id` **or** `side_id`, `quantity`, `price_at_time`, `options` (JSONB snapshot). |
| `transactions` | Paystack rows: `reference`, `email`, `amount` (kobo), `status`, `user_id`, `metadata` (must include `orderId`), `location`. |

### Other

| Table | Purpose |
|-------|---------|
| `addresses` | Saved delivery addresses (`state`, `lga`, `area`, `street`, `house_number`, `is_default`). |
| `transport_prices` | Delivery fee by `lga` (`price` in naira). Used when `delivery_lga` is sent on orders. |
| `fcm_tokens` | Push notification tokens per device. |
| `user_notifications` | In-app notification inbox (`type`, `order_id`, `is_read`). |

### Order status lifecycle

| Phase | `orders.status` | `transactions.status` |
|-------|-----------------|------------------------|
| Cart submitted | `pending` | — |
| Paystack initialized | `pending` | `pending` |
| Payment verified | `confirmed` (auto) | `success` or `completed` |
| Kitchen / delivery | `preparing` → `delivering` → `delivered` | `success` |
| Cancelled | `cancelled` | may stay `success` (refunds are manual) |


## Pricing model (Chowdeck-style)

When you call `GET /api/menu?location=Chasemall` or `GET /api/foods?id=…&location=…`:

- **`menu_price`** (on each food) = `foods.display_price` or computed from `price` + each group's `default_side_id`.
- Each side in `option_groups[].sides[]` includes **`price_delta`**: extra cost vs the included default (`+₦0` when `is_pricing_default` is true).
- **Checkout total per line** = `menu_price + sum(price_delta × qty)` for selected options (equivalent to base + full option prices).

Always use **live API prices** at checkout; do not trust stale UI-only numbers.

---

## Recommended menu fetch

Prefer the aggregated endpoint:

```
GET /api/menu?location=Chasemall
```

Response shape:

```json
{
  "categories": [{ "id": 1, "name": "Rice Meals" }],
  "foods": [
    {
      "id": 1,
      "name": "Manchi Rice Meal",
      "price": 5000,
      "display_price": 6500,
      "menu_price": 6500,
      "option_groups": [
        {
          "id": 1,
          "name": "Protein",
          "min_selections": 1,
          "max_selections": 1,
          "is_required": true,
          "sides": [
            {
              "id": 13,
              "name": "Chicken",
              "price": 1500,
              "price_delta": 0,
              "is_pricing_default": true
            }
          ]
        }
      ]
    }
  ]
}
```

Legacy: `GET /api/foods`, `GET /api/categories`, `GET /api/sides` still work; `GET /api/foods?id=1&location=Chasemall` returns one food with `option_groups` when configured.

Delivery fee:

```
GET /api/transport_prices?lga=Ikeja
```

---

## Authentication

| Endpoint | Auth | Body / notes |
|----------|------|----------------|
| `POST /api/auth/otp` | None | `{ "email": "user@example.com" }` |
| `POST /api/auth/verify` | None | `{ "email", "token" }` → `{ session, user }` |
| `POST /api/auth/login` | None | Email/password if enabled |
| `POST /api/auth/signup` | None | Registration |
| `POST /api/auth/forgot-password` | None | Send OTP to email (existing accounts only) |
| `POST /api/auth/reset-password` | None | `{ "email", "token", "password" }` — verify OTP, set new password |
| `GET /api/auth/user` | Bearer | Current user |
| `POST /api/auth/signout` | Bearer | Ends session |

Store `session.access_token` and send it as `Authorization: Bearer …` on protected routes.

### Forgot password (OTP, no link)

1. **`POST /api/auth/forgot-password`**

```json
{ "email": "user@example.com" }
```

Response (always the same, for security):

```json
{ "message": "If an account exists for this email, a verification code has been sent." }
```

User receives a **6-digit code** by email (same Supabase OTP email as login).

2. **`POST /api/auth/reset-password`**

```json
{
  "email": "user@example.com",
  "token": "123456",
  "password": "newSecurePassword123"
}
```

- `password` minimum **8 characters**
- On success, returns the same session object as login (auto sign-in), or a success message if sign-in fails after update

There is **no reset link** — only email + OTP + new password.

---

## Profile & addresses

### Profile

- `GET /api/profile?userId=<uuid>` — Bearer required; user can only read own profile.
- `POST /api/profile` — `{ "id", "full_name", "phone_number" }` upsert into `profiles`.

### Addresses

- `GET /api/addresses` — list for authenticated user.
- `POST /api/addresses` — create (`state`, `lga`, `area`, `street`, `house_number`, `title`, `is_default`).
- `PUT /api/addresses/:id` — update.
- `DELETE /api/addresses/:id` — delete.

---

## Orders (production checkout)

### Step 1 — Create order

```
POST /api/orders
Authorization: Bearer <token>
```

**Body example:**

```json
{
  "total_amount": 7100,
  "vat": 0,
  "delivery_address": "12 Example St, Port Harcourt",
  "location": "Chasemall",
  "delivery_method": "delivery",
  "delivery_lga": "Port Harcourt",
  "order_note": "No onions please.",
  "items": [
    {
      "food_id": 1,
      "quantity": 1,
      "price_at_time": 7100,
      "selections": [
        { "group_id": 1, "item_id": 13, "quantity": 1 },
        { "group_id": 2, "item_id": 3, "quantity": 1 },
        { "group_id": 3, "item_id": 7, "quantity": 1 }
      ]
    }
  ]
}
```

| Field | Rules |
|-------|--------|
| `location` | `Chasemall` or `Eromo` |
| `delivery_method` | `delivery` or `pickup` |
| `delivery_lga` | Required for delivery (looks up `transport_prices`) |
| `order_note` | Optional, max 500 chars. Aliases: `orderNote`, `note`, `customer_note` |
| `items[].food_id` | Food line — use with `selections` |
| `items[].side_id` | Standalone side line — set `item_type`: `"side"`, no `food_id` |
| `items[].selections` | `{ group_id, item_id, quantity }` — `item_id` is `sides.id` |
| `price_at_time` | Client hint; server validates against DB |

**Do not** send `side_id` on food lines. **Do not** send pre-built snapshot JSON in `items`.

**Response:**

```json
{
  "message": "Order created successfully",
  "order_id": 123,
  "order_note": "No onions please."
}
```

**What the API writes:**

1. **`orders`** — one row (`status`: `pending`, `items`: array of snapshots).
2. **`order_items`** — one row per cart line:

| Column | Food line example |
|--------|-------------------|
| `food_id` | `1` |
| `side_id` | `null` |
| `quantity` | `1` |
| `price_at_time` | base price (e.g. `5000`) |
| `options` | server snapshot (see below) |

### Stored snapshot (API output — not your request body)

Written to both `orders.items[]` and `order_items.options`:

```json
{
  "food_id": 1,
  "food_name": "Manchi Rice Meal",
  "base_price": 5000,
  "display_price": 6500,
  "price_adjustment": 600,
  "selections": [
    {
      "group_id": 1,
      "group": "Protein",
      "item_id": 13,
      "name": "Chicken",
      "price": 1500,
      "price_delta": 0,
      "is_pricing_default": true,
      "quantity": 1
    }
  ],
  "item_total": 7100
}
```

### Step 2 — Initialize Paystack

```
POST /api/paystack/initialize
Authorization: Bearer <token>
```

```json
{
  "email": "user@example.com",
  "amount": 710000,
  "location": "Chasemall",
  "metadata": { "orderId": "123" }
}
```

| Field | Rules |
|-------|--------|
| `metadata.orderId` | **Required.** Must be `order_id` from step 1. |
| `amount` | Total in **kobo** (₦7,100 → `710000`) |
| `location` | Same branch as the order |

Server checks the order belongs to the authenticated user and stores `orderId` + `order_id` in `transactions.metadata`.

Open `authorization_url` in WebView / browser.

### Step 3 — Verify payment

```
GET /api/paystack/verify?reference=<reference>
Authorization: Bearer <token>
```

On `status: "success"`:

- `transactions.status` → `success`
- `orders.status` → `confirmed` (if still `pending`)
- Response includes `order_id`

```json
{
  "status": "success",
  "reference": "T123…",
  "amount": 710000,
  "paid_at": "2026-06-13T12:00:00.000Z",
  "order_id": 123
}
```

Only after verify succeeds should the app show “Payment successful”. The kitchen/admin sees the order after this step.

### Order history

```
GET /api/orders
Authorization: Bearer <token>
```

Returns the authenticated user's orders with nested `order_items`.

```
GET /api/orders/:id
Authorization: Bearer <token> (owner) or staff JWT (admin app)
```

### User transactions

```
GET /api/transactions?email=user@example.com
Authorization: Bearer <token>
```

---

## Push notifications & inbox

| Endpoint | Purpose |
|----------|---------|
| `POST /api/fcm/register` | Bearer required — save device token after login |
| `POST /api/fcm/unregister` | Remove token on logout |
| `GET /api/notifications` | In-app inbox (`user_notifications`) |
| `PATCH /api/notifications/:id` | Mark one read |
| `POST /api/notifications/clear` | Mark all read |

### Register FCM token (required for push)

```
POST /api/fcm/register
Authorization: Bearer <token>
```

```json
{
  "fcm_token": "<firebase_device_token>",
  "device_id": "unique-install-id",
  "platform": "ios",
  "app_version": "1.0.0"
}
```

| Field | Required | Notes |
|-------|----------|--------|
| `fcm_token` | Yes | From `FirebaseMessaging.instance.getToken()` |
| `platform` | Strongly recommended | `"ios"` or `"android"` — stored in `fcm_tokens.platform` |
| `device_id` | Recommended | Stable per install; helps debug duplicate tokens |

**When to call:** After the user logs in **and** after notification permission is granted. Re-call on token refresh (`onTokenRefresh`).

Stored in `public.fcm_tokens` (`fcm_token`, `user_id`, `platform`, `device_id`, `app_version`, `last_seen_at`).

### iOS push (APNs + FCM) — critical setup

iOS does **not** receive pushes from FCM alone. You need **both**:

#### 1. Firebase Console (one-time, not in code)

1. Add an **iOS app** to the same Firebase project as Android (bundle ID must match Xcode).
2. Upload your **APNs Authentication Key** (.p8) or APNs certificate:
   - Firebase Console → Project settings → **Cloud Messaging** → Apple app configuration → **APNs Authentication Key**.
3. Enable **Push Notifications** capability in Xcode → Signing & Capabilities.
4. Enable **Background Modes** → **Remote notifications** (recommended).

Without APNs in Firebase, Android push works but **iOS silently fails**.

#### 2. Flutter app (iOS)

```dart
// After login, before register:
final settings = await FirebaseMessaging.instance.requestPermission(
  alert: true,
  badge: true,
  sound: true,
);
if (settings.authorizationStatus == AuthorizationStatus.authorized) {
  final token = await FirebaseMessaging.instance.getToken();
  // POST /api/fcm/register with platform: "ios"
}

FirebaseMessaging.instance.onTokenRefresh.listen((token) {
  // Re-register with backend
});
```

- Request permission **before** `getToken()` on iOS.
- Register token **after** login (endpoint requires Bearer JWT).
- Handle foreground messages with `FirebaseMessaging.onMessage` if you show in-app banners.

#### 3. Backend (already implemented)

- FCM sends with explicit **APNs alert** payload (`title`, `body`, `sound`, `badge`).
- Invalid iOS tokens are removed from `fcm_tokens` when Firebase reports `registration-token-not-registered`.

#### 4. Verify iOS tokens in Supabase

```sql
SELECT platform, count(*) FROM fcm_tokens GROUP BY platform;
```

If `platform = 'ios'` count is 0, the app is not registering iOS tokens (permission, timing, or missing APNs config).

#### Android note

Create a notification channel id `manchi_orders` in Flutter (`AndroidNotificationChannel`) to match backend high-priority delivery.

---

## Maps

```
POST /api/maps/geocode
{ "address": "…" }
```

```
POST /api/maps/geocode
{ "lat": 4.8156, "lng": 7.0498 }
```

Requires `GOOGLE_MAPS_API_KEY` on the server.

---

## Account deletion

```
POST /api/account/delete
Authorization: Bearer <token>
```

Requires `DELETED_USER_ID` configured on the server. See `OPERATIONS_MANUAL.md`.

---

## Health check

```
GET /api/health
```

No auth. Use for monitoring (Supabase, Paystack, FCM config).

---

## Common mistakes (avoid these)

| Mistake | Why it fails |
|---------|----------------|
| Inserting into `orders` from Flutter Supabase client | Skips validation; `order_items` empty; admin may show bad JSON |
| Paystack without `metadata.orderId` | `400` on initialize; admin never links payment |
| Wrong `amount` unit (naira instead of kobo) | Paystack charge mismatch |
| `location: "chasemall"` (wrong case) | `400 Invalid location` |
| Trusting client `total_amount` without server check | `400 Invalid total_amount` |
| Using `options: [{ side_id: 3 }]` without `item_id` | Prefer `selections`; legacy `side_id` in options is accepted but discouraged |

---

## Flutter `BackendService` checklist

Implement a single service class that:

1. Stores the Supabase session and attaches `Authorization: Bearer …`.
2. Loads menu via `GET /api/menu?location=…`.
3. Checkout: `POST /api/orders` → `POST /api/paystack/initialize` → WebView → `GET /api/paystack/verify`.
4. Never calls Supabase REST for `orders` / `order_items` inserts.
5. Uses `selections` with `group_id` + `item_id` from `option_groups` in the menu response.
6. Sends `delivery_lga` for delivery orders.
7. Registers FCM token after login.