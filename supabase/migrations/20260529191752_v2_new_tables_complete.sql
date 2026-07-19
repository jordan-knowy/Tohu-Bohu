
-- ─── 1. Colonnes sur tables existantes ───────────────────────────────────────
ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS is_external          boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS has_decision_maker   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS category             text,
  ADD COLUMN IF NOT EXISTS location             text,
  ADD COLUMN IF NOT EXISTS crm_synced           boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS crm_external_url     text,
  ADD COLUMN IF NOT EXISTS crm_sync_status      text CHECK (crm_sync_status IN ('pending','synced','error')),
  ADD COLUMN IF NOT EXISTS confidence_score     integer CHECK (confidence_score BETWEEN 0 AND 100);

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS crm_synced           boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS title_confirmed      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tenure_start_date    date,
  ADD COLUMN IF NOT EXISTS location             text,
  ADD COLUMN IF NOT EXISTS influence_level      integer CHECK (influence_level BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS badge                text CHECK (badge IN ('champion','decider','gatekeeper','blocker'));

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS linkedin_profile_data jsonb;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS total_licenses       integer NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS active_licenses      integer NOT NULL DEFAULT 0;

ALTER TABLE connectors
  DROP CONSTRAINT IF EXISTS connectors_provider_check;
ALTER TABLE connectors
  ADD CONSTRAINT connectors_provider_check
    CHECK (provider IN ('google','microsoft','linkedin','hubspot','salesforce','pipedrive','attio','zoom','teams'));

ALTER TABLE meeting_participants
  ADD COLUMN IF NOT EXISTS participant_job_title text;

-- ─── 2. knowy_activity_events ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS knowy_activity_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_type      text NOT NULL CHECK (event_type IN (
    'notification_urgent','notification_important','notification_info',
    'profile_enriched','brief_ready','crm_sync','alert','birthday','job_change'
  )),
  title           text NOT NULL,
  description     text,
  entity_link     text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kae_org_created ON knowy_activity_events (organization_id, created_at DESC);
ALTER TABLE knowy_activity_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "members_select_activity" ON knowy_activity_events;
CREATE POLICY "members_select_activity" ON knowy_activity_events
  FOR SELECT USING (organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid()));

-- ─── 3. weekly_impact_stats ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS weekly_impact_stats (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id             uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  week_start          date NOT NULL,
  profiles_enriched   integer NOT NULL DEFAULT 0,
  insights_captured   integer NOT NULL DEFAULT 0,
  meetings_count      integer NOT NULL DEFAULT 0,
  active_contacts     integer NOT NULL DEFAULT 0,
  crm_synced_count    integer NOT NULL DEFAULT 0,
  crm_total_count     integer NOT NULL DEFAULT 0,
  time_saved_minutes  integer NOT NULL DEFAULT 0,
  evolution_pct       numeric(5,2) NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id, week_start)
);
ALTER TABLE weekly_impact_stats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "members_select_weekly" ON weekly_impact_stats;
CREATE POLICY "members_select_weekly" ON weekly_impact_stats
  FOR SELECT USING (organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid()));

-- ─── 4. relationship_snapshots ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS relationship_snapshots (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id               uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  contact_id            uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  engagement_score      integer NOT NULL DEFAULT 0 CHECK (engagement_score BETWEEN 0 AND 100),
  score_evolution       integer NOT NULL DEFAULT 0,
  phase                 text NOT NULL DEFAULT 'stagnant' CHECK (phase IN ('growth','stagnant','decline')),
  phase_started_at      timestamptz NOT NULL DEFAULT now(),
  last_contact_at       timestamptz,
  last_contact_type     text CHECK (last_contact_type IN ('email','meeting','slack','linkedin')),
  reciprocity_pct       integer CHECK (reciprocity_pct BETWEEN 0 AND 100),
  avg_frequency_days    integer,
  next_recommended_days integer,
  crm_synced            boolean NOT NULL DEFAULT false,
  snapshot_date         date NOT NULL DEFAULT CURRENT_DATE,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id, contact_id, snapshot_date)
);
CREATE INDEX IF NOT EXISTS idx_rs_contact ON relationship_snapshots (organization_id, contact_id, snapshot_date DESC);
ALTER TABLE relationship_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "members_select_snapshots" ON relationship_snapshots;
CREATE POLICY "members_select_snapshots" ON relationship_snapshots
  FOR ALL USING (organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid()));

-- ─── 5. contact_alerts ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contact_alerts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id      uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  alert_type      text NOT NULL CHECK (alert_type IN ('cooling','job_change','news','birthday')),
  message         text NOT NULL,
  is_read         boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ca_contact ON contact_alerts (organization_id, contact_id, created_at DESC);
ALTER TABLE contact_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "members_select_contact_alerts" ON contact_alerts;
CREATE POLICY "members_select_contact_alerts" ON contact_alerts
  FOR ALL USING (organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid()))
  WITH CHECK (organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid()));

-- ─── 6. contact_topics ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contact_topics (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id          uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  topic               text NOT NULL,
  mention_count       integer NOT NULL DEFAULT 1,
  last_mentioned_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, contact_id, topic)
);
ALTER TABLE contact_topics ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "members_select_topics" ON contact_topics;
CREATE POLICY "members_select_topics" ON contact_topics
  FOR SELECT USING (organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid()));

-- ─── 7. contact_career_path ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS contact_career_path (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id      uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  job_title       text NOT NULL,
  company_name    text NOT NULL,
  start_date      date,
  end_date        date,
  sector          text,
  is_current      boolean NOT NULL DEFAULT false,
  badges          text[] NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE contact_career_path ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "members_select_career" ON contact_career_path;
CREATE POLICY "members_select_career" ON contact_career_path
  FOR SELECT USING (organization_id IN (SELECT organization_id FROM memberships WHERE user_id = auth.uid()));

-- ─── 8. Unique constraints pour upserts Gmail (DO block pour IF NOT EXISTS) ──
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_comm_threads_external'
  ) THEN
    ALTER TABLE communication_threads
      ADD CONSTRAINT uq_comm_threads_external
      UNIQUE (organization_id, provider, external_thread_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_comm_messages_external'
  ) THEN
    ALTER TABLE communication_messages
      ADD CONSTRAINT uq_comm_messages_external
      UNIQUE (organization_id, provider, external_message_id);
  END IF;
END $$;
