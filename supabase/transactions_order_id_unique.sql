-- #1: Add real order_id column to transactions (currently only in metadata->>orderId).
-- Run in Supabase SQL Editor BEFORE applying the partial unique index below.

alter table public.transactions
  add column if not exists order_id bigint null;

-- Optional FK (recommended; skip if you prefer loose coupling):
-- alter table public.transactions
--   add constraint transactions_order_id_fkey
--   foreign key (order_id) references public.orders(id) on delete set null;

create index if not exists idx_transactions_order_id
  on public.transactions(order_id);

-- #2: Backfill order_id from existing metadata JSON (idempotent).
update public.transactions
set order_id = (metadata->>'orderId')::bigint
where order_id is null
  and metadata is not null
  and jsonb_typeof(metadata->'orderId') in ('string', 'number');

-- Also backfill from order_id key in metadata (both spellings exist in code).
update public.transactions
set order_id = (metadata->>'order_id')::bigint
where order_id is null
  and metadata is not null
  and jsonb_typeof(metadata->'order_id') in ('string', 'number');

-- #3: Check for existing duplicates BEFORE creating the partial unique index.
-- If this returns any rows, resolve them (delete the older / extra pending rows)
-- before applying the create unique index line below.
--
--   select user_id, order_id, count(*) as n
--   from public.transactions
--   where status = 'pending' and order_id is not null
--   group by user_id, order_id
--   having count(*) > 1;
--
-- Suggested resolution for duplicates (keeps newest per group; uncomment to run):
--
--   delete from public.transactions
--   where id in (
--     select id from (
--       select id, row_number() over (
--         partition by user_id, order_id
--         order by created_at desc
--       ) as rn
--       from public.transactions
--       where status = 'pending' and order_id is not null
--     ) t
--     where t.rn > 1
--   );

-- #4: The partial unique index. Enforces "at most one pending transaction per (user, order)".
create unique index if not exists uq_transactions_user_order_pending
  on public.transactions(user_id, order_id)
  where status = 'pending';
