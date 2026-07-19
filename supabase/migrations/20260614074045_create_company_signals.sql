-- Veille d'actualités d'entreprise (Feed signaux Home) — LinkedIn / presse / web, structuré par IA
CREATE TABLE public.company_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
  family text NOT NULL DEFAULT 'presence',          -- risque|levier|marche|croissance|mobilite|churn|presence
  title text NOT NULL,
  summary text,
  source text,                                       -- LinkedIn | Presse | Web | Registres
  source_url text,
  observed_at timestamptz,
  confidence numeric(3,2),
  status text NOT NULL DEFAULT 'candidate',          -- candidate | validated | dismissed
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, company_id, title)
);

CREATE INDEX idx_company_signals_org ON public.company_signals(organization_id, observed_at DESC);

ALTER TABLE public.company_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY company_signals_member_all ON public.company_signals
  FOR ALL USING (private.is_org_member(organization_id))
  WITH CHECK (private.is_org_member(organization_id));

COMMENT ON TABLE public.company_signals IS 'Veille actualités entreprise (Feed signaux Home) : LinkedIn/presse/web structuré par IA. Zéro-hallu : chaque signal porte source + date.';
