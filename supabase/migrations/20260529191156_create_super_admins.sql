CREATE TABLE IF NOT EXISTS public.super_admins (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  email      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.super_admins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admin_self_select" ON public.super_admins
  FOR SELECT USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.super_admins WHERE user_id = auth.uid()
  );
$$;

-- Seed jordan.knowy@gmail.com si l'utilisateur existe déjà dans auth.users
INSERT INTO public.super_admins (user_id, email)
SELECT id, email
FROM auth.users
WHERE email = 'jordan.knowy@gmail.com'
  AND NOT EXISTS (
    SELECT 1 FROM public.super_admins WHERE email = 'jordan.knowy@gmail.com'
  )
LIMIT 1;
