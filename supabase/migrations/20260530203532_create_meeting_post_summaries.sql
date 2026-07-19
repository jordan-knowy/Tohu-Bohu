CREATE TABLE IF NOT EXISTS public.meeting_post_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  meeting_id uuid NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  summary_text text,
  key_decisions jsonb DEFAULT '[]',
  action_items jsonb DEFAULT '[]',
  objections jsonb DEFAULT '[]',
  talking_time jsonb DEFAULT '[]',
  tags jsonb DEFAULT '[]',
  sources jsonb DEFAULT '[]',
  generated_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(meeting_id)
);

ALTER TABLE public.meeting_post_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_access" ON public.meeting_post_summaries
  FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM public.memberships WHERE user_id = auth.uid()
    )
  );
