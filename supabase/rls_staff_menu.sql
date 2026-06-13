-- Run in Supabase SQL Editor after creating option_groups.
-- Allows admin + super_admin to manage menu tables when using authenticated JWT (admin dashboard or API fallback).

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('admin', 'super_admin')
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_staff() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_staff() TO anon;

-- option_groups
ALTER TABLE public.option_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "option_groups public read" ON public.option_groups;
CREATE POLICY "option_groups public read"
  ON public.option_groups FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "option_groups staff write" ON public.option_groups;
CREATE POLICY "option_groups staff write"
  ON public.option_groups FOR ALL
  TO authenticated
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

-- sides (option items)
ALTER TABLE public.sides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sides public read" ON public.sides;
CREATE POLICY "sides public read"
  ON public.sides FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "sides staff write" ON public.sides;
CREATE POLICY "sides staff write"
  ON public.sides FOR ALL
  TO authenticated
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

-- food_sides links
ALTER TABLE public.food_sides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "food_sides public read" ON public.food_sides;
CREATE POLICY "food_sides public read"
  ON public.food_sides FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "food_sides staff write" ON public.food_sides;
CREATE POLICY "food_sides staff write"
  ON public.food_sides FOR ALL
  TO authenticated
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

-- foods
ALTER TABLE public.foods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "foods public read" ON public.foods;
CREATE POLICY "foods public read"
  ON public.foods FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "foods staff write" ON public.foods;
CREATE POLICY "foods staff write"
  ON public.foods FOR ALL
  TO authenticated
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

-- categories
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "categories public read" ON public.categories;
CREATE POLICY "categories public read"
  ON public.categories FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "categories staff write" ON public.categories;
CREATE POLICY "categories staff write"
  ON public.categories FOR ALL
  TO authenticated
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

-- availability toggles
ALTER TABLE public.food_availability ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "food_availability public read" ON public.food_availability;
CREATE POLICY "food_availability public read"
  ON public.food_availability FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "food_availability staff write" ON public.food_availability;
CREATE POLICY "food_availability staff write"
  ON public.food_availability FOR ALL
  TO authenticated
  USING (public.is_staff())
  WITH CHECK (public.is_staff());

ALTER TABLE public.side_availability ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "side_availability public read" ON public.side_availability;
CREATE POLICY "side_availability public read"
  ON public.side_availability FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "side_availability staff write" ON public.side_availability;
CREATE POLICY "side_availability staff write"
  ON public.side_availability FOR ALL
  TO authenticated
  USING (public.is_staff())
  WITH CHECK (public.is_staff());
