-- Keep the canonical V6 ledger fed before marker detection and scoring.
-- The source cursor is ordered by insertion time and id so a busy interval
-- cannot permanently hide records beyond the first page.
alter table scoring.foundation_checkpoint
  drop constraint foundation_checkpoint_worker_check;
alter table scoring.foundation_checkpoint
  add constraint foundation_checkpoint_worker_check
  check(worker in ('score','detect','classify','ingest'));

create or replace function public.v6_ingest_source_page(
  p_after_created_at timestamptz default null,
  p_after_id uuid default null,
  p_organization_id uuid default null,
  p_limit integer default 500
) returns setof jsonb
language sql stable security definer
set search_path=pg_catalog,public as $$
  select jsonb_build_object(
    'id',m.id,'organization_id',m.organization_id,'contact_id',m.contact_id,
    'thread_id',m.thread_id,'provider',m.provider,'external_message_id',m.external_message_id,
    'direction',m.direction,'sent_at',m.sent_at,'created_at',m.created_at,
    'source_owner_user_id',m.source_owner_user_id,
    'metadata',jsonb_build_object('user_id',m.metadata->>'user_id'),
    'account_id',c.company_id
  )
  from public.communication_messages m
  join public.contacts c on c.id=m.contact_id and c.organization_id=m.organization_id
  where (p_organization_id is null or m.organization_id=p_organization_id)
    and (p_after_created_at is null or (m.created_at,m.id) > (p_after_created_at,coalesce(p_after_id,'00000000-0000-0000-0000-000000000000'::uuid)))
  order by m.created_at,m.id
  limit greatest(1,least(p_limit,500));
$$;
revoke all on function public.v6_ingest_source_page(timestamptz,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.v6_ingest_source_page(timestamptz,uuid,uuid,integer) to service_role;
create index if not exists communication_messages_v6_ingest_cursor
  on public.communication_messages(created_at,id);

-- The previous import incorrectly equated a contact assignment and complete
-- metadata fields with verified identity and complete source coverage. New
-- immutable revisions restore unknown status without deleting any source.
with latest as (
  select distinct on (dyad_id,revision_id) dyad_id,revision_id,payload
  from scoring.foundation_revision
  where kind='event' and payload->>'sourceVersion'='message-adapter-v1'
  order by dyad_id,revision_id,recorded_at desc
)
insert into scoring.foundation_revision(dyad_id,kind,revision_id,recorded_at,payload)
select dyad_id,'event',revision_id,clock_timestamp(),
  payload || jsonb_build_object('recordedAt',clock_timestamp(),'identityQuality','unknown','completeness','unknown')
from latest where payload->>'identityQuality'='verified' or payload->>'completeness'='complete';

with latest as (
  select distinct on (dyad_id,revision_id) dyad_id,revision_id,payload
  from scoring.foundation_revision where kind='quality'
  order by dyad_id,revision_id,recorded_at desc
)
insert into scoring.foundation_revision(dyad_id,kind,revision_id,recorded_at,payload)
select dyad_id,'quality',revision_id,clock_timestamp(),
  payload || jsonb_build_object('recordedAt',clock_timestamp(),
    'reliability',null,'reliabilityEvidence','[]'::jsonb,
    'identity','unknown','diarization','unknown','completeness','unknown','expectedChannels',null)
from latest where payload->>'identity'='verified' or payload->>'completeness'='complete';

insert into scoring.foundation_checkpoint(worker,cursor)
select 'ingest',jsonb_build_object('createdAt',m.created_at,'id',m.id)
from public.communication_messages m
where exists (
  select 1 from scoring.foundation_revision r
  where r.kind='event'
    and r.revision_id='message:'||m.id::text||':'||coalesce(m.source_owner_user_id::text,m.metadata->>'user_id')
)
order by m.created_at desc,m.id desc limit 1
on conflict(worker) do nothing;

select cron.unschedule(jobid) from cron.job where jobname='tohu-bohu-v6-ingest-events';
select cron.schedule(
  'tohu-bohu-v6-ingest-events',
  '5-55/10 * * * *',
  $job$select private.dispatch_scheduled_edge('v6-ingest-events', '{}'::jsonb, 60000);$job$
);
