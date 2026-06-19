CREATE TABLE public.material_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  area_id uuid REFERENCES public.areas(id) ON DELETE SET NULL,
  raw_text text NOT NULL,
  menge numeric,
  einheit text,
  artikel_name text,
  created_at timestamp with time zone DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.material_usage TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.material_usage TO anon;
GRANT ALL ON public.material_usage TO service_role;

ALTER TABLE public.material_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_all_material_usage" ON public.material_usage FOR ALL USING (true) WITH CHECK (true);