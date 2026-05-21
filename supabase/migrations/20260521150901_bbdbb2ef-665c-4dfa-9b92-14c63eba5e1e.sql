CREATE TABLE IF NOT EXISTS public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  address text,
  phone text,
  email text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_all_customers" ON public.customers FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER customers_touch_updated_at
BEFORE UPDATE ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS template_type text;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS floors jsonb NOT NULL DEFAULT '[]'::jsonb;