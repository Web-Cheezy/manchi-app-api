# SQL schema to add (Supabase)

Run this in the Supabase SQL editor to support the new backend features (FCM and existing orders flow).

---

## 1. FCM tokens table

Required for push notifications: storing device FCM tokens and optional user association.

```sql
-- FCM tokens: one row per device token; optional user_id for targeted notifications.
-- Same token can be used for "admin broadcast" (we send to all tokens).
create table if not exists public.fcm_tokens (
  id            uuid primary key default gen_random_uuid(),
  fcm_token     text not null unique,
  user_id       uuid null references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_fcm_tokens_user_id on public.fcm_tokens(user_id);
create index if not exists idx_fcm_tokens_updated_at on public.fcm_tokens(updated_at);

-- Optional: RLS (allow service role to manage; restrict from anon/key if you use them)
alter table public.fcm_tokens enable row level security;

create policy "Service role can manage fcm_tokens"
  on public.fcm_tokens for all
  using (true)
  with check (true);
```

If you prefer not to reference `auth.users`, use a plain column and no FK:

```sql
create table if not exists public.fcm_tokens (
  id            uuid primary key default gen_random_uuid(),
  fcm_token     text not null unique,
  user_id       text null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
```

---

## 2. User notifications table (notification history / sync)

Stores every notification sent (order placed, status change, admin broadcast) so the app’s Notifications tab can show reliable history via `GET /api/notifications`, even when the app was closed or the user didn’t open from the notification.

```sql
-- user_notifications: one row per notification (per user or broadcast).
-- user_id NULL = broadcast (visible to all users).
create table if not exists public.user_notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid null references auth.users(id) on delete cascade,
  title      text not null,
  body       text not null,
  type       text not null default 'order_placed',  -- e.g. 'order_placed', 'order_status_changed', 'broadcast'
  order_id   text null,
  created_at timestamptz not null default now(),
  is_read    boolean not null default false
);

create index if not exists idx_user_notifications_user_id on public.user_notifications(user_id);
create index if not exists idx_user_notifications_created_at on public.user_notifications(created_at desc);
create index if not exists idx_user_notifications_user_read on public.user_notifications(user_id, is_read);

alter table public.user_notifications enable row level security;

create policy "Service role can manage user_notifications"
  on public.user_notifications for all
  using (true)
  with check (true);
```

If you use `text` for user ids elsewhere (e.g. no FK to `auth.users`):

```sql
create table if not exists public.user_notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    text null,
  title      text not null,
  body       text not null,
  type       text not null default 'order_placed',
  order_id   text null,
  created_at timestamptz not null default now(),
  is_read    boolean not null default false
);

create index if not exists idx_user_notifications_user_id on public.user_notifications(user_id);
create index if not exists idx_user_notifications_created_at on public.user_notifications(created_at desc);
```

---

## 3. Orders table (reference only)

Your `orders` table should have at least:

- `id` (e.g. `bigint` or `uuid` primary key)
- `user_id` (uuid or text) – used to look up FCM tokens for “order created” and “order status” notifications
- `status` – one of: `pending`, `preparing`, `delivered`, `cancelled`
- Other columns you already use: `total_amount`, `vat`, `delivery_address`, `location`, `items`, `created_at`, etc.

No change needed if you already have `user_id` and `status` on `orders`.

---

## 4. Auth / OTP

OTP is handled by **Supabase Auth** (signInWithOtp sends the email; verifyOtp validates the token). You do **not** need any extra SQL tables for OTP.

---

## 5. Account deletion support

The backend now supports `POST /api/account/delete`.

You do **not** need a new table for deleted accounts if you use a real placeholder Auth user and set:

```env
DELETED_USER_ID=e1ac7c48-b3eb-4b59-806e-3fe90469b532
```

### SQL to run

Run only this SQL in the Supabase SQL editor to support anonymization audit fields on `orders`:

```sql
alter table public.orders
  add column if not exists anonymized_at timestamptz,
  add column if not exists anonymized_reason text;
```

### Example only: what the backend route does internally

Do **not** run the block below as-is. It contains placeholder values like `REAL_USER_UUID_HERE` and is only showing the behavior performed by the backend route.

```sql
update public.orders
set
  user_id = 'e1ac7c48-b3eb-4b59-806e-3fe90469b532',
  delivery_address = null,
  delivery_lat = null,
  delivery_lng = null,
  location = null,
  anonymized_at = now(),
  anonymized_reason = 'optional user reason'
where user_id = 'REAL_USER_UUID_HERE';

delete from public.profiles where id = 'REAL_USER_UUID_HERE';
delete from public.addresses where user_id = 'REAL_USER_UUID_HERE';

-- Optional if these tables exist in your project:
delete from public.fcm_tokens where user_id = 'REAL_USER_UUID_HERE';
delete from public.user_notifications where user_id = 'REAL_USER_UUID_HERE';
```

If you want to manually test the example block, replace `REAL_USER_UUID_HERE` with an actual Supabase Auth user UUID first.

Important notes:
- `DELETED_USER_ID` must be a **real** Supabase Auth user UUID.
- The route deletes the Auth user **last** from the backend using `supabase.auth.admin.deleteUser(...)`.
- Keeping `orders.user_id` pointed at a valid placeholder user avoids foreign-key breakage.

---

## Summary

- **Add:** `fcm_tokens` table (and optional RLS) as above.
- **Add:** `user_notifications` table so the app can show notification history via `GET /api/notifications` and mark read via `PATCH /api/notifications/{id}`.
- **Optional:** Ensure `orders.user_id` and `orders.status` exist and match the backend (they already do in your code).
- **Optional:** Add `orders.anonymized_at` and `orders.anonymized_reason` for delete-account auditability.
- **No new tables** for auth/OTP; Supabase Auth covers that.
