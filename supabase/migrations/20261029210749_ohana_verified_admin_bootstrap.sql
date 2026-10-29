create schema if not exists ohana_private;
revoke all on schema ohana_private from public,anon,authenticated;
create table ohana_private.admin_bootstrap (
 email text primary key, company_id uuid not null references public.companies(id),
 claimed_by uuid references auth.users(id), check(email=lower(email))
);
alter table ohana_private.admin_bootstrap enable row level security;
revoke all on ohana_private.admin_bootstrap from public,anon,authenticated;
-- Private administrator allowlist is provisioned outside version control.
-- The existing production allowlist and memberships are preserved.

-- Runs only as an auth.users trigger, never as a client RPC.
-- Email confirmation is mandatory; no user-controlled metadata is trusted.
create function ohana_private.claim_verified_admin() returns trigger
language plpgsql security definer set search_path='' as $$
declare target_company uuid;
begin
 if new.email_confirmed_at is null or new.email is null then return new; end if;
 update ohana_private.admin_bootstrap set claimed_by=new.id
 where email=lower(new.email) and claimed_by is null
 returning company_id into target_company;
 if target_company is not null then
  insert into public.company_members(company_id,user_id,role)
  values(target_company,new.id,'admin') on conflict do nothing;
 end if;
 return new;
end $$;
revoke all on function ohana_private.claim_verified_admin() from public,anon,authenticated;
create trigger ohana_claim_verified_admin after insert or update of email_confirmed_at on auth.users
for each row execute function ohana_private.claim_verified_admin();
