-- Four business roles; legacy company tiers are retained as compatibility permissions.
create schema if not exists access_private;
revoke all on schema access_private from public,anon;
grant usage on schema access_private to authenticated;
create table public.business_roles(code text primary key,name text not null);
insert into public.business_roles values('platform_admin','Superadministrador de plataforma'),('corporation_admin','Administrador de corporación'),('company_admin','Administrador de empresa'),('operator','Usuario operativo');
create table public.corporations(id uuid primary key default gen_random_uuid(),name text not null check(length(trim(name)) between 1 and 120),active boolean not null default true,created_at timestamptz not null default now());
create table public.corporation_members(corporation_id uuid not null references public.corporations(id),user_id uuid not null references auth.users(id),role text not null default 'corporation_admin' check(role='corporation_admin') references public.business_roles(code),primary key(corporation_id,user_id));
create index corporation_members_user on public.corporation_members(user_id,corporation_id);
create table access_private.platform_admins(user_id uuid primary key references auth.users(id));
alter table access_private.platform_admins enable row level security;
revoke all on access_private.platform_admins from public,anon,authenticated;
create table public.user_profiles(user_id uuid primary key references auth.users(id),display_name text not null default '' check(length(display_name)<=120));
insert into public.user_profiles(user_id) select id from auth.users;
alter table public.companies add column corporation_id uuid references public.corporations(id),add column active boolean not null default true,add column logo_path text;
create index companies_corporation on public.companies(corporation_id);
alter table public.company_members add column business_role text generated always as(case when role='admin' then 'company_admin' else 'operator' end) stored references public.business_roles(code);
create table public.company_module_access(company_id uuid not null,user_id uuid not null,module text not null check(module in('catalog','inventory','production','sales','reports')),can_read boolean not null default true,can_write boolean not null default false check(not can_write or can_read),primary key(company_id,user_id,module),foreign key(company_id,user_id) references public.company_members(company_id,user_id) on delete cascade);
create table public.company_settings(company_id uuid primary key references public.companies(id),details jsonb not null default '{}' check(jsonb_typeof(details)='object'),appearance jsonb not null default '{}' check(jsonb_typeof(appearance)='object'),updated_at timestamptz not null default now());
create table public.countries(code text primary key check(code~'^[A-Z]{2}$'),name text not null,active boolean not null default true);
insert into public.countries values('GT','Guatemala'),('MX','México'),('US','Estados Unidos'),('SV','El Salvador'),('HN','Honduras'),('CR','Costa Rica'),('PA','Panamá'),('CO','Colombia'),('ES','España');
create table public.currencies(code text primary key check(code~'^[A-Z]{3}$'),name text not null,active boolean not null default true);
insert into public.currencies values('GTQ','Quetzal'),('MXN','Peso mexicano'),('USD','Dólar estadounidense'),('EUR','Euro'),('HNL','Lempira'),('CRC','Colón costarricense'),('COP','Peso colombiano');
do $$ declare c record; corp uuid;begin
 for c in select * from public.companies where corporation_id is null loop
  insert into public.corporations(name) values(c.name) returning id into corp;
  update public.companies set corporation_id=corp,logo_path=case when name='Ohana' then 'brand:ohana' else null end where id=c.id;
  insert into public.corporation_members(corporation_id,user_id) select corp,user_id from public.company_members where company_id=c.id and role='admin';
  insert into public.company_settings(company_id) values(c.id);
 end loop;
end $$;

-- No platform-admin bypass in commercial access. All checks use live DB assignments.
create function access_private.company_permission(p_company uuid,p_action text,p_module text default 'catalog') returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.companies c left join public.corporations corp on corp.id=c.corporation_id where c.id=p_company and (p_action='manage' or (c.active and coalesce(corp.active,true))) and (
 exists(select 1 from public.corporation_members cm where cm.corporation_id=c.corporation_id and cm.user_id=auth.uid())
 or exists(select 1 from public.company_members m where m.company_id=c.id and m.user_id=auth.uid() and (m.role='admin' or p_action<>'manage' and coalesce((select case when p_action='read' then a.can_read else a.can_write end from public.company_module_access a where a.company_id=m.company_id and a.user_id=m.user_id and a.module=p_module),case when p_module='catalog' then p_action='read' or m.role='editor' else false end)))))
$$;
create function public.company_permission(p_company uuid,p_action text,p_module text default 'catalog') returns boolean language sql stable security invoker set search_path='' as $$ select access_private.company_permission(p_company,p_action,p_module) $$;
create function access_private.corporation_permission(p_corporation uuid) returns boolean language sql stable security definer set search_path='' as $$ select auth.uid() is not null and exists(select 1 from public.corporation_members where corporation_id=p_corporation and user_id=auth.uid()) $$;
create function public.corporation_permission(p_corporation uuid) returns boolean language sql stable security invoker set search_path='' as $$select access_private.corporation_permission(p_corporation)$$;
create function access_private.can_create_corporation() returns boolean language sql stable security definer set search_path='' as $$ select auth.uid() is not null and (exists(select 1 from public.corporation_members where user_id=auth.uid()) or exists(select 1 from access_private.platform_admins where user_id=auth.uid())) $$;
create function public.can_create_corporation() returns boolean language sql stable security invoker set search_path='' as $$select access_private.can_create_corporation()$$;

-- Read boundaries for the existing catalog and batch records are changed together.
do $$ declare t text; p record; check_text text;begin
 for t in select unnest(array['companies','units','suppliers','raw_materials','presentations','price_history','catalog_batches','catalog_origins','products','catalog_identifiers','catalog_sku_counters']) loop
  for p in select policyname from pg_policies where schemaname='public' and tablename=t loop execute format('drop policy %I on public.%I',p.policyname,t);end loop;
  execute format('create policy scoped_read on public.%I for select to authenticated using(public.company_permission(%s,''read''))',t,case when t='companies' then 'id' else 'company_id' end);
  if t not in('companies','catalog_identifiers','catalog_sku_counters') then
   check_text:='public.company_permission(company_id,''write'')';
   if t in('price_history','catalog_batches') then check_text:=check_text||' and created_by=(select auth.uid())';end if;
   execute format('create policy scoped_insert on public.%I for insert to authenticated with check(%s)',t,check_text);
   if t<>'price_history' then execute format('create policy scoped_update on public.%I for update to authenticated using(%s) with check(%s)',t,check_text,check_text);end if;
  end if;
 end loop;
 create policy scoped_origin_delete on public.catalog_origins for delete to authenticated using(public.company_permission(company_id,'manage'));
end $$;
-- Update older RPCs and protected identifier triggers to use the same authority.
do $$ declare f record; def text; old_condition text;begin
 for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','catalog_private') and p.prokind='f' loop
  def:=pg_get_functiondef(f.oid);
  old_condition:='not exists(select 1 from public.company_members where company_id=p_company and user_id=auth.uid() and role in(''admin'',''editor''))';
  if position(old_condition in def)>0 then def:=replace(def,old_condition,'not public.company_permission(p_company,''write'')');execute def;end if;
  old_condition:='not exists(select 1 from public.company_members where company_id=c and user_id=u and role in(''admin'',''editor''))';
  if position(old_condition in def)>0 then def:=replace(def,old_condition,'not public.company_permission(c,''write'')');execute def;end if;
 end loop;
end $$;

alter table public.business_roles enable row level security;
alter table public.corporations enable row level security;
alter table public.corporation_members enable row level security;
alter table public.user_profiles enable row level security;
alter table public.company_module_access enable row level security;
alter table public.company_settings enable row level security;
alter table public.countries enable row level security;
alter table public.currencies enable row level security;
revoke all on public.business_roles,public.corporations,public.corporation_members,public.user_profiles,public.company_module_access,public.company_settings,public.countries,public.currencies from public,anon,authenticated;
grant select on public.business_roles,public.corporations,public.corporation_members,public.company_module_access,public.company_settings,public.countries,public.currencies to authenticated;
grant select,insert,update on public.user_profiles to authenticated;
create policy roles_read on public.business_roles for select to authenticated using(true);
create policy countries_read on public.countries for select to authenticated using(true);
create policy currencies_read on public.currencies for select to authenticated using(true);
create policy corporations_read on public.corporations for select to authenticated using(public.corporation_permission(id) or exists(select 1 from public.companies c where c.corporation_id=id));
create policy corporation_members_read on public.corporation_members for select to authenticated using(user_id=(select auth.uid()) or public.corporation_permission(corporation_id));
create policy modules_read on public.company_module_access for select to authenticated using(user_id=(select auth.uid()) or public.company_permission(company_id,'manage'));
create policy settings_read on public.company_settings for select to authenticated using(public.company_permission(company_id,'read'));
create policy profiles_read on public.user_profiles for select to authenticated using(user_id=(select auth.uid()));
create policy profiles_insert on public.user_profiles for insert to authenticated with check(user_id=(select auth.uid()));
create policy profiles_update on public.user_profiles for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create policy membership_managers_read on public.company_members for select to authenticated using(public.company_permission(company_id,'manage'));

-- Fixed action whitelist; no arbitrary SQL, role assignment, or global auth directory.
create function access_private.manage_structure(p_action text,p_id uuid,p_name text,p_parent uuid default null,p_active boolean default true) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;begin
 if auth.uid() is null then raise exception 'Inicia sesión' using errcode='42501';end if;
 if length(trim(p_name)) not between 1 and 120 then raise exception 'Nombre obligatorio (máximo 120 caracteres)';end if;
 if p_action='create_corporation' then
  if not access_private.can_create_corporation() then raise exception 'No puedes crear corporaciones' using errcode='42501';end if;
  insert into public.corporations(name) values(trim(p_name)) returning id into result;
  insert into public.corporation_members(corporation_id,user_id) values(result,auth.uid());
 elsif p_action='rename_corporation' then
  if not access_private.corporation_permission(p_id) then raise exception 'Sin permiso sobre esta corporación' using errcode='42501';end if;
  update public.corporations set name=trim(p_name) where id=p_id;result:=p_id;
 elsif p_action='create_company' then
  if not access_private.corporation_permission(p_parent) then raise exception 'No puedes crear empresas en esta corporación' using errcode='42501';end if;
  if not exists(select 1 from public.corporations where id=p_parent and active) then raise exception 'Corporación inactiva';end if;
  insert into public.companies(name,corporation_id) values(trim(p_name),p_parent) returning id into result;
  insert into public.company_settings(company_id) values(result);
  insert into public.units(company_id,name,symbol,dimension,base_factor) values(result,'Gramo','g','mass',1),(result,'Kilogramo','kg','mass',1000),(result,'Onza','oz','mass',28.34952313),(result,'Mililitro','ml','volume',1),(result,'Litro','l','volume',1000),(result,'Unidad','ud','count',1);
 elsif p_action='edit_company' then
  if not access_private.company_permission(p_id,'manage') then raise exception 'Sin permiso sobre esta empresa' using errcode='42501';end if;
  update public.companies set name=trim(p_name),active=p_active where id=p_id;result:=p_id;
 else raise exception 'Operación no permitida';end if;
 return result;
end $$;
create function public.manage_structure(p_action text,p_id uuid,p_name text,p_parent uuid default null,p_active boolean default true) returns uuid language sql security invoker set search_path='' as $$select access_private.manage_structure(p_action,p_id,p_name,p_parent,p_active)$$;

create function access_private.company_context() returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 if auth.uid() is null then raise exception 'Inicia sesión' using errcode='42501';end if;
 return jsonb_build_object('can_create',access_private.can_create_corporation(),'companies',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'currency',c.currency,'corporation_id',c.corporation_id,'logo_path',c.logo_path,'active',c.active,'corporation_name',co.name,'manage',access_private.company_permission(c.id,'manage'),'write',access_private.company_permission(c.id,'write'),'manage_corporation',access_private.corporation_permission(co.id)) order by c.name,c.id) from public.companies c join public.corporations co on co.id=c.corporation_id where access_private.company_permission(c.id,'read') or access_private.company_permission(c.id,'manage')),'[]'::jsonb),'corporations',coalesce((select jsonb_agg(jsonb_build_object('id',co.id,'name',co.name,'manage',access_private.corporation_permission(co.id)) order by co.name,co.id) from public.corporations co where access_private.corporation_permission(co.id) or exists(select 1 from public.companies c where c.corporation_id=co.id and access_private.company_permission(c.id,'read'))),'[]'::jsonb));end $$;
create function public.company_context() returns jsonb language sql stable security invoker set search_path='' as $$select access_private.company_context()$$;

create function access_private.save_company_settings(p_company uuid,p_name text,p_currency text,p_details jsonb,p_appearance jsonb,p_logo text default null) returns void language plpgsql security definer set search_path='' as $$
declare link jsonb; key text;begin
 if auth.uid() is null or not access_private.company_permission(p_company,'manage') then raise exception 'Solo administradores autorizados pueden guardar esta configuración' using errcode='42501';end if;
 if length(trim(p_name)) not between 1 and 120 then raise exception 'Nombre comercial obligatorio';end if;
 if not exists(select 1 from public.currencies where code=p_currency and active) or (p_details is distinct from coalesce((select details from public.company_settings where company_id=p_company),'{}'::jsonb) and not exists(select 1 from public.countries where code=p_details->>'country' and active)) then raise exception 'Selecciona país y moneda válidos';end if;
 if length(p_details::text)>20000 or jsonb_typeof(p_details)<>'object' or jsonb_typeof(p_appearance)<>'object' then raise exception 'Configuración inválida';end if;
 if nullif(p_details->>'email','') is not null and (p_details->>'email')!~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Correo comercial inválido';end if;
 for link in select value from jsonb_each(coalesce(p_details->'social','{}')) loop
  if nullif(link->>'url','') is not null and (length(link->>'url')>2048 or (link->>'url')!~ '^https?://[^[:space:]@/]+\.[^[:space:]/]+(/[^[:space:]]*)?$') then raise exception 'Revisa los enlaces: utiliza una dirección http o https válida';end if;
 end loop;
 for key in select jsonb_object_keys(p_appearance) loop
  if key in('background','surface','primary','text','accent') then if (p_appearance->>key)!~ '^#[0-9a-fA-F]{6}$' then raise exception 'Color inválido';end if;
  elsif key='font' then if (p_appearance->>key) not in('DM Sans','Arial','Georgia','Verdana') then raise exception 'Tipografía no permitida';end if;
  else raise exception 'Propiedad de apariencia no permitida';end if;
 end loop;
 if p_logo is not null and p_logo<>'brand:ohana' and (p_logo not like p_company::text||'/%' or not exists(select 1 from storage.objects where bucket_id='company-logos' and name=p_logo)) then raise exception 'Logo no autorizado';end if;
 update public.companies set name=trim(p_name),currency=p_currency,logo_path=p_logo where id=p_company;
 insert into public.company_settings(company_id,details,appearance,updated_at) values(p_company,p_details,p_appearance,clock_timestamp()) on conflict(company_id) do update set details=excluded.details,appearance=excluded.appearance,updated_at=excluded.updated_at;
end $$;
create function public.save_company_settings(p_company uuid,p_name text,p_currency text,p_details jsonb,p_appearance jsonb,p_logo text default null) returns void language sql security invoker set search_path='' as $$select access_private.save_company_settings(p_company,p_name,p_currency,p_details,p_appearance,p_logo)$$;

create function access_private.assign_member(p_company uuid,p_email text,p_role text,p_corporation uuid default null) returns void language plpgsql security definer set search_path='' as $$
declare target uuid;begin
 if auth.uid() is null then raise exception 'Inicia sesión' using errcode='42501';end if;
 if p_corporation is not null then
  if not access_private.corporation_permission(p_corporation) or p_role<>'corporation_admin' then raise exception 'Asignación no permitida' using errcode='42501';end if;
 else
  if not access_private.company_permission(p_company,'manage') or p_role not in('admin','editor','viewer','remove') then raise exception 'Asignación no permitida' using errcode='42501';end if;
 end if;
 select id into target from auth.users where lower(email)=lower(trim(p_email)) and email_confirmed_at is not null;
 if target is null then raise exception 'La cuenta debe registrarse y verificar su correo antes de asignarla';end if;
 if target=auth.uid() then raise exception 'No puedes modificar tus propios permisos' using errcode='42501';end if;
 if p_corporation is not null then insert into public.corporation_members(corporation_id,user_id) values(p_corporation,target) on conflict do nothing;
 elsif p_role='remove' then delete from public.company_members where company_id=p_company and user_id=target;
 else insert into public.company_members(company_id,user_id,role) values(p_company,target,p_role) on conflict(company_id,user_id) do update set role=excluded.role;end if;
end $$;
create function public.assign_member(p_company uuid,p_email text,p_role text,p_corporation uuid default null) returns void language sql security invoker set search_path='' as $$select access_private.assign_member(p_company,p_email,p_role,p_corporation)$$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('company-logos','company-logos',false,3145728,array['image/png','image/jpeg','image/webp']) on conflict(id) do nothing;
create policy company_logo_read on storage.objects for select to authenticated using(bucket_id='company-logos' and public.company_permission((storage.foldername(name))[1]::uuid,'read'));
create policy company_logo_insert on storage.objects for insert to authenticated with check(bucket_id='company-logos' and public.company_permission((storage.foldername(name))[1]::uuid,'manage'));
create policy company_logo_delete on storage.objects for delete to authenticated using(bucket_id='company-logos' and public.company_permission((storage.foldername(name))[1]::uuid,'manage'));
do $$ declare f record;begin
 for f in select p.oid::regprocedure as signature,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='access_private' or n.nspname='public' and p.proname in('company_permission','corporation_permission','can_create_corporation','company_context','manage_structure','save_company_settings','assign_member') loop
  execute format('revoke all on function %s from public,anon',f.signature);execute format('grant execute on function %s to authenticated',f.signature);
 end loop;
end $$;
notify pgrst,'reload schema';
