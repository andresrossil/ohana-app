-- Additive migration: existing UUIDs, names, units, presentations and prices stay intact.
create schema if not exists catalog_private;
revoke all on schema catalog_private from public, anon;
grant usage on schema catalog_private to authenticated;

create table public.catalog_origins(
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 name text not null check(length(trim(name)) between 1 and 80), active boolean not null default true,
 created_at timestamptz not null default now(), unique(company_id,id)
);
create unique index catalog_origins_name on public.catalog_origins(company_id,public.catalog_key(name));
insert into public.catalog_origins(company_id,name)
 select c.id,n from public.companies c cross join (values('Comprado'),('Fabricado')) names(n);
create function catalog_private.seed_origins() returns trigger language plpgsql security invoker set search_path='' as $$
begin insert into public.catalog_origins(company_id,name) values(new.id,'Comprado'),(new.id,'Fabricado');return new;end $$;
revoke all on function catalog_private.seed_origins() from public,anon,authenticated;
create trigger seed_catalog_origins after insert on public.companies for each row execute function catalog_private.seed_origins();
create function catalog_private.guard_origin_company() returns trigger language plpgsql security invoker set search_path='' as $$
begin if new.company_id is distinct from old.company_id then raise exception 'No se puede cambiar la empresa';end if;return new;end $$;
revoke all on function catalog_private.guard_origin_company() from public,anon,authenticated;
create trigger guard_origin_company before update on public.catalog_origins for each row execute function catalog_private.guard_origin_company();

alter table public.raw_materials
 add column classification text check(classification in ('Materia prima','Material de empaque')),
 add column sku text check(length(sku) between 1 and 80),
 add column barcode text check(length(barcode) between 1 and 80 and barcode ~ '^[ -~]+$'),
 add column barcode_custom boolean not null default false,
 add column origin_id uuid,
 add constraint raw_materials_origin_fk foreign key(company_id,origin_id) references public.catalog_origins(company_id,id);
create index raw_materials_origin_idx on public.raw_materials(company_id,origin_id);
create index raw_materials_classification_idx on public.raw_materials(company_id,classification);

create table public.products(
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id),
 name text not null check(length(trim(name)) between 1 and 160), notes text not null default '',
 unit_id uuid, active boolean not null default true, created_at timestamptz not null default now(),
 sku text check(length(sku) between 1 and 80),
 barcode text check(length(barcode) between 1 and 80 and barcode ~ '^[ -~]+$'),
 barcode_custom boolean not null default false, origin_id uuid, unique(company_id,id),
 foreign key(company_id,origin_id) references public.catalog_origins(company_id,id),
 foreign key(company_id,unit_id) references public.units(company_id,id)
);
create unique index products_name on public.products(company_id,public.catalog_key(name));
create index products_origin_idx on public.products(company_id,origin_id);
create index products_unit_idx on public.products(company_id,unit_id);

-- A single registry enforces uniqueness across BOTH catalogs, including concurrent writes.
-- Clients may read their company's registry; only the protected trigger may modify it.
create table public.catalog_identifiers(
 company_id uuid not null references public.companies(id), kind text not null check(kind in('material','product')),
 record_id uuid not null, sku text, barcode text, primary key(company_id,kind,record_id)
);
create unique index catalog_unique_sku on public.catalog_identifiers(company_id,public.catalog_key(sku)) where sku is not null;
create unique index catalog_unique_barcode on public.catalog_identifiers(company_id,public.catalog_key(barcode)) where barcode is not null;
create table public.catalog_sku_counters(
 company_id uuid not null references public.companies(id), prefix text not null check(prefix in('M','E','P')),
 last_value bigint not null default 0 check(last_value>=0), primary key(company_id,prefix)
);

alter table public.catalog_origins enable row level security;
alter table public.products enable row level security;
alter table public.catalog_identifiers enable row level security;
alter table public.catalog_sku_counters enable row level security;
revoke all on public.catalog_origins,public.products,public.catalog_identifiers,public.catalog_sku_counters from public,anon,authenticated;
grant select,insert,update on public.catalog_origins,public.products to authenticated;
grant delete on public.catalog_origins to authenticated;
grant select on public.catalog_identifiers,public.catalog_sku_counters to authenticated;
create policy origins_read on public.catalog_origins for select to authenticated using(company_id in(select company_id from public.company_members where user_id=(select auth.uid())));
create policy origins_insert on public.catalog_origins for insert to authenticated with check(company_id in(select company_id from public.company_members where user_id=(select auth.uid()) and role in('admin','editor')));
create policy origins_update on public.catalog_origins for update to authenticated using(company_id in(select company_id from public.company_members where user_id=(select auth.uid()) and role in('admin','editor'))) with check(company_id in(select company_id from public.company_members where user_id=(select auth.uid()) and role in('admin','editor')));
create policy origins_delete on public.catalog_origins for delete to authenticated using(company_id in(select company_id from public.company_members where user_id=(select auth.uid()) and role in('admin','editor')));
create policy products_read on public.products for select to authenticated using(company_id in(select company_id from public.company_members where user_id=(select auth.uid())));
create policy products_insert on public.products for insert to authenticated with check(company_id in(select company_id from public.company_members where user_id=(select auth.uid()) and role in('admin','editor')));
create policy products_update on public.products for update to authenticated using(company_id in(select company_id from public.company_members where user_id=(select auth.uid()) and role in('admin','editor'))) with check(company_id in(select company_id from public.company_members where user_id=(select auth.uid()) and role in('admin','editor')));
create policy identifiers_read on public.catalog_identifiers for select to authenticated using(company_id in(select company_id from public.company_members where user_id=(select auth.uid())));
create policy counters_read on public.catalog_sku_counters for select to authenticated using(company_id in(select company_id from public.company_members where user_id=(select auth.uid()) and role in('admin','editor')));

create function catalog_private.prepare_codes() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' and new.company_id is distinct from old.company_id then raise exception 'No se puede cambiar la empresa';end if;
 new.sku:=nullif(trim(new.sku),''); new.barcode:=nullif(trim(new.barcode),'');
 if tg_op='INSERT' then
  if new.barcode is not null and new.barcode is distinct from new.sku then new.barcode_custom:=true;end if;
 elsif new.barcode is distinct from old.barcode and new.barcode is distinct from new.sku then
  new.barcode_custom:=true;
 end if;
 if not new.barcode_custom then new.barcode:=case when new.sku ~ '^[ -~]+$' then new.sku else null end;end if;
 return new;
end $$;
revoke all on function catalog_private.prepare_codes() from public,anon,authenticated;

-- Definer is needed only for this registry write: never exposed as an RPC, fixed path,
-- explicit membership check, and no client privileges on registry writes.
create function catalog_private.sync_codes() returns trigger language plpgsql security definer set search_path='' as $$
declare c uuid; rid uuid; sk text; bc text; u uuid:=auth.uid();
begin
 if tg_op='DELETE' then c:=old.company_id;rid:=old.id;else c:=new.company_id;rid:=new.id;sk:=new.sku;bc:=new.barcode;end if;
 if u is null then
  if session_user not in('postgres','supabase_admin') then raise exception 'Se requiere una cuenta autorizada' using errcode='42501';end if;
 elsif not exists(select 1 from public.company_members where company_id=c and user_id=u and role in('admin','editor')) then
  raise exception 'No tienes permisos de edición' using errcode='42501';
 end if;
 if tg_op='DELETE' then delete from public.catalog_identifiers where company_id=c and kind=tg_argv[0] and record_id=rid;return old;end if;
 begin
  insert into public.catalog_identifiers(company_id,kind,record_id,sku,barcode) values(c,tg_argv[0],rid,sk,bc)
   on conflict(company_id,kind,record_id) do update set sku=excluded.sku,barcode=excluded.barcode;
 exception when unique_violation then raise exception 'El SKU o código de barras ya está en uso en este negocio' using errcode='23505';end;
 -- A manually assigned sequence-shaped code also advances the high-water mark,
 -- so deleting that record cannot cause the code to be suggested later.
 if upper(sk) ~ '^[MEP][0-9]{4,18}$' then
  insert into public.catalog_sku_counters(company_id,prefix,last_value) values(c,left(upper(sk),1),substring(sk from 2)::bigint)
   on conflict(company_id,prefix) do update set last_value=greatest(public.catalog_sku_counters.last_value,excluded.last_value)
   where public.catalog_sku_counters.last_value<excluded.last_value;
 end if;
 return new;
end $$;
revoke all on function catalog_private.sync_codes() from public,anon,authenticated;
create trigger prepare_material_codes before insert or update on public.raw_materials for each row execute function catalog_private.prepare_codes();
create trigger sync_material_codes after insert or update or delete on public.raw_materials for each row execute function catalog_private.sync_codes('material');
create trigger prepare_product_codes before insert or update on public.products for each row execute function catalog_private.prepare_codes();
create trigger sync_product_codes after insert or update or delete on public.products for each row execute function catalog_private.sync_codes('product');

-- Committed suggestions consume a number even if the user cancels the form. Counters
-- cannot be reset/deleted by clients; manual codes already in use are skipped.
create function catalog_private.reserve_sku(p_company uuid,p_prefix text) returns text language plpgsql security definer set search_path='' as $$
declare n bigint; candidate text;
begin
 if auth.uid() is null or not exists(select 1 from public.company_members where company_id=p_company and user_id=auth.uid() and role in('admin','editor')) then raise exception 'No tienes permisos de edición' using errcode='42501';end if;
 if p_prefix not in('M','E','P') or p_prefix is null then raise exception 'Prefijo inválido';end if;
 loop
  insert into public.catalog_sku_counters(company_id,prefix,last_value) values(p_company,p_prefix,1)
   on conflict(company_id,prefix) do update set last_value=public.catalog_sku_counters.last_value+1 returning last_value into n;
  candidate:=p_prefix||case when n<10000 then lpad(n::text,4,'0') else n::text end;
  exit when not exists(select 1 from public.catalog_identifiers where company_id=p_company and (public.catalog_key(sku)=public.catalog_key(candidate) or public.catalog_key(barcode)=public.catalog_key(candidate)));
 end loop;
 return candidate;
end $$;
revoke all on function catalog_private.reserve_sku(uuid,text) from public,anon;
grant execute on function catalog_private.reserve_sku(uuid,text) to authenticated;
create function public.suggest_catalog_skus(p_company uuid,p_requests jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r jsonb; output jsonb:='[]';
begin
 if auth.uid() is null then raise exception 'Se requiere una cuenta autorizada' using errcode='42501';end if;
 if jsonb_typeof(p_requests)<>'array' or jsonb_array_length(p_requests) not between 1 and 500 then raise exception 'Solicita entre 1 y 500 códigos';end if;
 for r in select value from jsonb_array_elements(p_requests) loop
  output:=output||jsonb_build_array(jsonb_build_object('key',r->>'key','sku',catalog_private.reserve_sku(p_company,r->>'prefix')));
 end loop;return output;
end $$;
revoke all on function public.suggest_catalog_skus(uuid,jsonb) from public,anon;
grant execute on function public.suggest_catalog_skus(uuid,jsonb) to authenticated;

-- Preserve the proven transactional quote saver as a private, invoker-only core.
-- Its old JSON contract remains valid: absent metadata keys NEVER clear existing data.
alter function public.save_material_sheet(uuid,uuid,jsonb) set schema catalog_private;
revoke all on function catalog_private.save_material_sheet(uuid,uuid,jsonb) from public,anon;
grant execute on function catalog_private.save_material_sheet(uuid,uuid,jsonb) to authenticated;
create function public.save_material_sheet(p_company uuid,p_batch uuid,p_rows jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare output jsonb; cached public.catalog_batches%rowtype; r jsonb; entry jsonb; n integer; mid uuid; o uuid;
 m public.raw_materials%rowtype; desired jsonb; seen jsonb:='{}';
begin
 if auth.uid() is null or not exists(select 1 from public.company_members where company_id=p_company and user_id=auth.uid() and role in('admin','editor')) then raise exception 'No tienes permisos de edición' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company::text,0));
 select * into cached from public.catalog_batches where company_id=p_company and id=p_batch;
 if found then
  if cached.payload<>p_rows then raise exception 'El identificador de lote ya se utilizó para otros cambios';end if;
  return cached.result;
 end if;
 output:=catalog_private.save_material_sheet(p_company,p_batch,p_rows);
 for entry in select value from jsonb_array_elements(output) loop
  n:=(entry->>'row')::integer;r:=p_rows->(n-1);
  if not (r ?| array['sku','classification','origin','barcode','barcodeCustom']) then continue;end if;
  begin
   select raw_material_id into strict mid from public.presentations where company_id=p_company and id=(entry->>'id')::uuid;
   select * into strict m from public.raw_materials where company_id=p_company and id=mid for update;
   o:=m.origin_id;
   if r?'origin' then
    o:=null;
    if nullif(trim(r->>'origin'),'') is not null then
     select id into o from public.catalog_origins where company_id=p_company and public.catalog_key(name)=public.catalog_key(r->>'origin') and (active or id=m.origin_id);
     if o is null then raise exception 'Origen desconocido o inactivo; revísalo en Configuración';end if;
    end if;
   end if;
   desired:=jsonb_build_object('sku',case when r?'sku' then nullif(trim(r->>'sku'),'') else m.sku end,
    'classification',case when r?'classification' then nullif(trim(r->>'classification'),'') else m.classification end,
    'origin_id',o,'barcode',case when r?'barcode' then nullif(trim(r->>'barcode'),'') else m.barcode end,
    'barcode_custom',case when r?'barcodeCustom' then coalesce((r->>'barcodeCustom')::boolean,false) else m.barcode_custom end);
   if desired->>'barcode' is distinct from m.barcode and desired->>'barcode' is distinct from desired->>'sku' then desired:=jsonb_set(desired,'{barcode_custom}','true');end if;
   if not (desired->>'barcode_custom')::boolean then
    desired:=jsonb_set(desired,'{barcode}',coalesce(to_jsonb(case when desired->>'sku' ~ '^[ -~]+$' then desired->>'sku' else null end),'null'::jsonb));
   end if;
   if seen?mid::text and seen->mid::text<>desired then raise exception 'Las presentaciones del mismo material deben compartir SKU, clasificación, origen y código de barras';end if;
   seen:=jsonb_set(seen,array[mid::text],desired);
   update public.raw_materials set sku=desired->>'sku',classification=desired->>'classification',origin_id=o,barcode=desired->>'barcode',barcode_custom=(desired->>'barcode_custom')::boolean where company_id=p_company and id=mid;
  exception when others then raise exception 'Fila %: %',n,sqlerrm using errcode=sqlstate;end;
 end loop;return output;
end $$;
revoke all on function public.save_material_sheet(uuid,uuid,jsonb) from public,anon;
grant execute on function public.save_material_sheet(uuid,uuid,jsonb) to authenticated;
notify pgrst, 'reload schema';
