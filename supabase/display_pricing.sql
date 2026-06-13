-- Display pricing (Chowdeck-style): menu shows display_price built from base + admin-selected included options.
-- Run in Supabase SQL Editor after option_groups exists.

ALTER TABLE public.foods
  ADD COLUMN IF NOT EXISTS display_price numeric;

COMMENT ON COLUMN public.foods.price IS 'Base price before included option add-ons';
COMMENT ON COLUMN public.foods.display_price IS 'Menu price = base + sum(default_side_id option prices). Shown on cards and as starting total in customization.';

ALTER TABLE public.option_groups
  ADD COLUMN IF NOT EXISTS default_side_id bigint REFERENCES public.sides(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.option_groups.default_side_id IS 'Admin-selected side included in foods.display_price for this group. Customer sees +0 when this side is selected.';

CREATE INDEX IF NOT EXISTS idx_option_groups_default_side_id ON public.option_groups(default_side_id);

-- Recompute one food's display_price from base + included option selections.
CREATE OR REPLACE FUNCTION public.recompute_food_display_price(p_food_id bigint)
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT
    COALESCE(f.price, 0)
    + COALESCE((
      SELECT SUM(COALESCE(s.price, 0))
      FROM public.option_groups og
      JOIN public.sides s ON s.id = og.default_side_id
      WHERE og.food_id = p_food_id
        AND og.default_side_id IS NOT NULL
    ), 0)
  FROM public.foods f
  WHERE f.id = p_food_id;
$$;

-- Backfill display_price from base price where unset.
UPDATE public.foods
SET display_price = price
WHERE display_price IS NULL;

-- Recompute all foods that have option groups with included selections.
UPDATE public.foods f
SET display_price = public.recompute_food_display_price(f.id)
WHERE EXISTS (
  SELECT 1
  FROM public.option_groups og
  WHERE og.food_id = f.id
    AND og.default_side_id IS NOT NULL
);
