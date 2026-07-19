ALTER TABLE public.communication_messages ADD COLUMN IF NOT EXISTS subject text;
ALTER TABLE public.communication_threads ADD COLUMN IF NOT EXISTS participant_count int4 DEFAULT 0;
