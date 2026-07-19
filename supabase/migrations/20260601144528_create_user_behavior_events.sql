-- Table de tracking comportemental utilisateur
CREATE TABLE IF NOT EXISTS public.user_behavior_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_type    text NOT NULL,
  -- 'brief_open' | 'brief_close' | 'brief_tab' | 'brief_click'
  -- 'profile_open' | 'profile_close' | 'profile_tab'
  entity_id     text,           -- meeting_id ou contact_id
  entity_type   text,           -- 'meeting' | 'contact'
  tab           text,           -- onglet actif au moment de l'événement
  duration_ms   int4,           -- durée en ms (pour les events *_close)
  metadata      jsonb,          -- données arbitraires (element cliqué, etc.)
  created_at    timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ubev_user_id_idx ON public.user_behavior_events(user_id);
CREATE INDEX IF NOT EXISTS ubev_event_type_idx ON public.user_behavior_events(event_type);
CREATE INDEX IF NOT EXISTS ubev_created_at_idx ON public.user_behavior_events(created_at DESC);

ALTER TABLE public.user_behavior_events ENABLE ROW LEVEL SECURITY;

-- L'utilisateur peut insérer ses propres événements
CREATE POLICY "ubev_insert_own" ON public.user_behavior_events
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- Le super admin peut tout lire (via is_super_admin flag)
CREATE POLICY "ubev_superadmin_read" ON public.user_behavior_events
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.super_admins WHERE user_id = auth.uid())
    OR user_id = auth.uid()
  );
