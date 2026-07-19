-- Spec-32 — Typage de compte & modulation du moteur de priorisation
-- type ∈ {acquisition, account_management, partenaire}, NULL = « à qualifier » (zéro-hallu)

CREATE TYPE account_type_enum AS ENUM ('acquisition', 'account_management', 'partenaire');

ALTER TABLE public.companies
  ADD COLUMN account_type account_type_enum DEFAULT NULL,
  ADD COLUMN account_type_confidence numeric(3,2) DEFAULT NULL
    CHECK (account_type_confidence IS NULL OR (account_type_confidence >= 0 AND account_type_confidence <= 1)),
  ADD COLUMN account_type_source text DEFAULT NULL;

COMMENT ON COLUMN public.companies.account_type IS 'Spec-32: type de compte (acquisition/account_management/partenaire). NULL = à qualifier.';
COMMENT ON COLUMN public.companies.account_type_confidence IS 'Spec-32: confiance 0-1. Sous le seuil τ=0.60 le type doit être traité comme NULL.';
COMMENT ON COLUMN public.companies.account_type_source IS 'Spec-32: preuve sourcée du typage (CRM lifecycle, contrat, facture...).';
