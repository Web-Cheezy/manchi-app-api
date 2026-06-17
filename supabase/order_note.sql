-- Customer order note (optional instructions at checkout).
-- Run in Supabase SQL Editor.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS order_note text;

COMMENT ON COLUMN public.orders.order_note IS 'Optional customer instructions for the order (e.g. no onions, extra spicy).';
