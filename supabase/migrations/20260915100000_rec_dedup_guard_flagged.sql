-- Correctif dédup recommandations (centralisé, flag-gated). Empêche une reco
-- TERMINALE (completed/dismissed) de revenir sans nouveau fait significatif postérieur.
-- × per-user reste dans account_recommendation_user_state (inchangé, non touché ici).
-- Rollback = UPDATE feature_flags SET enabled=false WHERE key='scoring_v6_dedup'.

create or replace function private.flag_enabled_for_org(p_key text, p_org uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select case when not enabled then false
      when rollout->>'mode' = 'all' then true
      when rollout->>'mode' = 'orgs' then (rollout->'org_ids') ? p_org::text
      else false end
    from public.feature_flags where key = p_key), false)
$$;

create or replace function public.account_rec_dedup_guard()
returns trigger language plpgsql security definer set search_path = public, private, pg_temp as $$
declare v_terminal_at timestamptz; v_new_fact boolean;
begin
  if new.dedup_key is null then new.dedup_key := new.company_id::text || '|' || coalesce(new.category,''); end if;
  if not private.flag_enabled_for_org('scoring_v6_dedup', new.organization_id) then return new; end if;

  select coalesce(r.completed_at, r.dismissed_at, r.updated_at) into v_terminal_at
  from public.account_recommendations r
  where r.organization_id = new.organization_id and r.company_id = new.company_id
    and r.dedup_key = new.dedup_key and r.status in ('completed','dismissed')
  order by coalesce(r.completed_at, r.dismissed_at, r.updated_at) desc
  limit 1;

  if v_terminal_at is null then return new; end if; -- pas de reco terminale de même identité → laisser passer

  if new.origin_fact_id is not null then
    -- identité précise : le fait d'origine de CETTE reco doit être postérieur à la terminaison
    select exists(
      select 1 from public.account_facts f
      where f.id = new.origin_fact_id and coalesce(f.last_seen_at, f.occurred_at) > v_terminal_at
    ) into v_new_fact;
  else
    -- producteur ne trace pas encore origin_fact_id (score-batch, account-strategic-reading actuellement) :
    -- repli honnête = un fait significatif quelconque pour ce compte, postérieur à la terminaison.
    select exists(
      select 1 from public.account_facts f
      where f.organization_id = new.organization_id and f.company_id = new.company_id
        and f.status = 'active' and coalesce(f.last_seen_at, f.occurred_at) > v_terminal_at
    ) into v_new_fact;
  end if;

  if not v_new_fact then return null; end if; -- reco terminale traitée, aucun fait nouveau → ne pas recréer
  return new;
end $$;

drop trigger if exists account_rec_dedup_guard_trg on public.account_recommendations;
create trigger account_rec_dedup_guard_trg before insert on public.account_recommendations
for each row execute function public.account_rec_dedup_guard();

insert into public.feature_flags (key, enabled, rollout, description) values
  ('scoring_v6_dedup', true, '{"mode":"orgs","org_ids":["10d6a550-8ee0-4e81-9356-875cb6ad8c80","a4a85f3e-7759-4c5d-94b1-42f013ae35cb"]}'::jsonb, 'Dédup recos : une reco terminale (completed/dismissed) ne revient pas sans nouveau fait significatif postérieur (org_ids = organisations témoins)')
on conflict (key) do update set enabled=excluded.enabled, rollout=excluded.rollout, updated_at=now();
notify pgrst, 'reload schema';
