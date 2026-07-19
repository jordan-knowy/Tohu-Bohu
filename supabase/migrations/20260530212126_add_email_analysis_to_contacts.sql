ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS email_analysis jsonb;
COMMENT ON COLUMN public.contacts.email_analysis IS 'Cognitive/relational insights extracted by AI from email body analysis. Never contains raw email content.';
