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

## 2. Orders table (reference only)

Your `orders` table should have at least:

- `id` (e.g. `bigint` or `uuid` primary key)
- `user_id` (uuid or text) – used to look up FCM tokens for “order created” and “order status” notifications
- `status` – one of: `pending`, `preparing`, `delivered`, `cancelled`
- Other columns you already use: `total_amount`, `vat`, `delivery_address`, `location`, `items`, `created_at`, etc.

No change needed if you already have `user_id` and `status` on `orders`.

---

## 3. Auth / OTP

OTP is handled by **Supabase Auth** (signInWithOtp sends the email; verifyOtp validates the token). You do **not** need any extra SQL tables for OTP.

---

## Summary

- **Add:** `fcm_tokens` table (and optional RLS) as above.
- **Optional:** Ensure `orders.user_id` and `orders.status` exist and match the backend (they already do in your code).
- **No new tables** for auth/OTP; Supabase Auth covers that.
