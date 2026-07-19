-- Logo de marque par organisation (data URL webp stockée en base)
alter table public.organizations add column if not exists logo_url text;

-- RPC : définir le logo de l'org active (owner/admin de l'org OU super admin)
create or replace function public.set_org_logo(p_org uuid, p_logo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (
    select 1 from public.memberships m
    where m.organization_id = p_org and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  ) and not exists (
    select 1 from public.super_admins s where s.user_id = auth.uid()
  ) then
    raise exception 'not authorized';
  end if;
  -- garde-fou taille (data URL webp ~ < 700 Ko)
  if p_logo is not null and length(p_logo) > 700000 then
    raise exception 'logo too large';
  end if;
  update public.organizations
    set logo_url = p_logo, updated_at = now()
    where id = p_org;
end;
$$;

grant execute on function public.set_org_logo(uuid, text) to authenticated;
