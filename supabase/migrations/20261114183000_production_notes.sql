create table public.production_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  author_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null default '' check (length(title)<=150),
  body text not null default '' check (length(body)<=100000),
  updated_at timestamptz not null default now()
);
create index production_notes_owner on public.production_notes(company_id, author_id, updated_at desc);
alter table public.production_notes enable row level security;
revoke all on public.production_notes from public, anon, authenticated;
grant select, delete on public.production_notes to authenticated;
grant insert(company_id,title,body), update(title,body,updated_at) on public.production_notes to authenticated;
create policy own_notes on public.production_notes for all to authenticated
  using (author_id=(select auth.uid()) and public.company_permission(company_id,'read','production'))
  with check (author_id=(select auth.uid()) and public.company_permission(company_id,'read','production'));
