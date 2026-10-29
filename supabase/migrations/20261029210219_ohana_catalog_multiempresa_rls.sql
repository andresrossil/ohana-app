-- Ohana MVP: private catalog. Membership provisioning is an administrative operation.
create table public.companies (
 id uuid primary key default gen_random_uuid(),
 name text not null check (length(trim(name)) between 1 and 120),
 currency text not null default 'GTQ' check(currency ~ '^[A-Z]{3}$'),
 created_at timestamptz not null default now()
);
create table public.company_members (
 company_id uuid not null references public.companies(id),
 user_id uuid not null references auth.users(id) on delete cascade,
 role text not null check(role in ('admin','editor','viewer')),
 primary key(company_id,user_id)
);
create index company_members_user_idx on public.company_members(user_id,company_id);
alter table public.company_members enable row level security;
revoke all on public.company_members from anon,authenticated;
grant select on public.company_members to authenticated;
create policy own_membership on public.company_members for select to authenticated using(user_id=(select auth.uid()));

create table public.units (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 name text not null check(length(trim(name)) between 1 and 80),
 symbol text not null check(length(trim(symbol)) between 1 and 16),
 dimension text not null check(dimension in ('mass','volume','count')),
 base_factor numeric(20,8) not null check(base_factor > 0),
 active boolean not null default true,
 unique(company_id,id), unique(company_id,symbol)
);
create table public.suppliers (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 name text not null check(length(trim(name)) between 1 and 160),
 contact text not null default '', website_url text check(website_url ~ '^https?://[^[:space:]]+$'),
 notes text not null default '', active boolean not null default true,
 created_at timestamptz not null default now(), unique(company_id,id)
);
create table public.raw_materials (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 name text not null check(length(trim(name)) between 1 and 160),
 unit_id uuid not null, notes text not null default '', active boolean not null default true,
 created_at timestamptz not null default now(), unique(company_id,id),
 foreign key(company_id,unit_id) references public.units(company_id,id)
);
create index raw_materials_unit_idx on public.raw_materials(company_id,unit_id);
create table public.presentations (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 raw_material_id uuid not null, supplier_id uuid not null, unit_id uuid not null,
 name text not null check(length(trim(name)) between 1 and 160),
 quantity numeric(20,8) not null check(quantity>0),
 product_url text check(product_url ~ '^https?://[^[:space:]]+$'),
 active boolean not null default true, created_at timestamptz not null default now(),
 unique(company_id,id),
 foreign key(company_id,raw_material_id) references public.raw_materials(company_id,id),
 foreign key(company_id,supplier_id) references public.suppliers(company_id,id),
 foreign key(company_id,unit_id) references public.units(company_id,id)
);
create index presentations_material_idx on public.presentations(company_id,raw_material_id);
create index presentations_supplier_idx on public.presentations(company_id,supplier_id);
create index presentations_unit_idx on public.presentations(company_id,unit_id);
create table public.price_history (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 presentation_id uuid not null, amount numeric(18,4) not null check(amount>=0),
 currency text not null default 'GTQ' check(currency ~ '^[A-Z]{3}$'),
 effective_on date not null default current_date, notes text not null default '',
 created_at timestamptz not null default now(), created_by uuid not null default auth.uid() references auth.users(id),
 foreign key(company_id,presentation_id) references public.presentations(company_id,id)
);
create index price_history_latest_idx on public.price_history(company_id,presentation_id,effective_on desc,created_at desc,id desc);
create index price_history_created_by_idx on public.price_history(created_by);

-- Catalog fields that change the meaning of historical prices are immutable.
create function public.guard_catalog_identity() returns trigger language plpgsql set search_path = '' as $$
begin
 if new.company_id is distinct from old.company_id then raise exception 'La empresa no se puede cambiar'; end if;
 if tg_table_name = 'units' then
  if new.dimension is distinct from old.dimension or new.base_factor is distinct from old.base_factor then
   raise exception 'Crea otra unidad para cambiar la conversión';
  end if;
 elsif tg_table_name = 'raw_materials' then
  if new.unit_id is distinct from old.unit_id then raise exception 'La unidad base no se puede cambiar'; end if;
 elsif tg_table_name = 'presentations' then
  if new.raw_material_id is distinct from old.raw_material_id or new.supplier_id is distinct from old.supplier_id or new.unit_id is distinct from old.unit_id or new.quantity is distinct from old.quantity then
   raise exception 'Crea otra presentación para cambiar su contenido o proveedor';
  end if;
 end if;
 return new;
end $$;
revoke execute on function public.guard_catalog_identity() from public,anon,authenticated;

create function public.validate_presentation() returns trigger language plpgsql set search_path = '' as $$
declare material_dimension text; package_dimension text;
begin
 select u.dimension into material_dimension from public.raw_materials m join public.units u on u.company_id=m.company_id and u.id=m.unit_id where m.company_id=new.company_id and m.id=new.raw_material_id;
 select dimension into package_dimension from public.units where company_id=new.company_id and id=new.unit_id;
 if material_dimension is null or package_dimension is null or material_dimension <> package_dimension then raise exception 'Las unidades deben ser compatibles'; end if;
 return new;
end $$;
revoke execute on function public.validate_presentation() from public,anon,authenticated;
create trigger validate_presentation before insert or update on public.presentations for each row execute function public.validate_presentation();

do $$
declare t text;
begin
 foreach t in array array['companies','units','suppliers','raw_materials','presentations','price_history'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon, authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  if t='companies' then
   execute 'create policy members_read on public.companies for select to authenticated using(id in (select company_id from public.company_members where user_id=(select auth.uid())))';
  else
   execute format('create policy members_read on public.%I for select to authenticated using(company_id in (select company_id from public.company_members where user_id=(select auth.uid())))',t);
   execute format('grant insert on public.%I to authenticated',t);
   execute format('create policy editors_insert on public.%I for insert to authenticated with check(company_id in (select company_id from public.company_members where user_id=(select auth.uid()) and role in (''admin'',''editor'')) %s)',t,case when t='price_history' then 'and created_by=(select auth.uid())' else '' end);
   if t <> 'price_history' then
    execute format('grant update on public.%I to authenticated',t);
    execute format('create policy editors_update on public.%I for update to authenticated using(company_id in (select company_id from public.company_members where user_id=(select auth.uid()) and role in (''admin'',''editor''))) with check(company_id in (select company_id from public.company_members where user_id=(select auth.uid()) and role in (''admin'',''editor'')))',t);
    execute format('create trigger immutable_identity before update on public.%I for each row execute function public.guard_catalog_identity()',t);
   end if;
  end if;
 end loop;
end $$;

create view public.current_prices with(security_invoker=true) as
select p.*, h.amount, h.currency, h.effective_on,
 h.amount / (p.quantity * pu.base_factor / mu.base_factor) as cost_per_material_unit
from public.presentations p
join public.units pu on pu.company_id=p.company_id and pu.id=p.unit_id
join public.raw_materials m on m.company_id=p.company_id and m.id=p.raw_material_id
join public.units mu on mu.company_id=m.company_id and mu.id=m.unit_id
left join lateral (
 select amount,currency,effective_on from public.price_history h
 where h.company_id=p.company_id and h.presentation_id=p.id and h.effective_on <= current_date
 order by h.effective_on desc,h.created_at desc,h.id desc limit 1
) h on true;
revoke all on public.current_prices from anon,authenticated;
grant select on public.current_prices to authenticated;
insert into public.companies(name) values ('Ohana');
insert into public.units(company_id,name,symbol,dimension,base_factor)
select c.id,u.name,u.symbol,u.dimension,u.factor from public.companies c
cross join (values ('Gramo','g','mass',1::numeric),('Kilogramo','kg','mass',1000),('Libra','lb','mass',453.59237),('Mililitro','ml','volume',1),('Litro','l','volume',1000),('Unidad','ud','count',1)) u(name,symbol,dimension,factor)
where c.name='Ohana';
