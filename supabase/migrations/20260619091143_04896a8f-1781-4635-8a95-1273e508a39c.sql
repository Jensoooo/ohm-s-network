ALTER TABLE public.material_usage
  ADD COLUMN IF NOT EXISTS artikel_id uuid,
  ADD COLUMN IF NOT EXISTS preis_pro_einheit numeric;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.material_usage TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.material_usage TO anon;
GRANT ALL ON public.material_usage TO service_role;

ALTER TABLE public.material_usage ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY "public_all_material_usage" ON public.material_usage
    FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;