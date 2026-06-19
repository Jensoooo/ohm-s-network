CREATE TABLE IF NOT EXISTS public.material_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  area_id uuid REFERENCES public.areas(id) ON DELETE SET NULL,
  raw_text text NOT NULL,
  menge numeric,
  einheit text,
  artikel_name text,
  artikel_id uuid,
  preis_pro_einheit numeric,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.material_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_all_material_usage" ON public.material_usage
  FOR ALL USING (true) WITH CHECK (true);
