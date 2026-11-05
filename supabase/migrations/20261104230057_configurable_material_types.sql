create table public.material_types(
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id) on delete cascade,
 key text not null,
 name text not null check(length(btrim(name)) between 1 and 80),
 prefix text not null check(prefix ~ '^[A-Z]{1,8}$'),
 revision integer not null default 0,
 unique(company_id,key),unique(company_id,id)
);
create unique index material_type_name_unique on public.material_types(company_id,lower(btrim(name)));
alter table public.material_types enable row level security;
create policy material_types_read on public.material_types for select to authenticated using(public.company_permission(company_id,'read','identity'));
revoke all on public.material_types from public,anon,authenticated;
grant select on public.material_types to authenticated;

insert into public.material_types(company_id,key,name,prefix)
 select c.id,v.name,v.name,v.prefix from public.companies c cross join(values('Materia prima','M'),('Material de empaque','E'),('Insumos','M'))v(name,prefix);
alter table public.raw_materials drop constraint raw_materials_classification_check;
alter table public.raw_materials add constraint raw_material_type_fk foreign key(company_id,classification) references public.material_types(company_id,key);
alter table public.catalog_sku_counters drop constraint catalog_sku_counters_prefix_check;
alter table public.catalog_sku_counters add constraint catalog_sku_counters_prefix_check check(prefix ~ '^[A-Z]{1,8}$');

create function access_private.seed_material_types() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.material_types(company_id,key,name,prefix)
 select new.id,v.name,v.name,v.prefix from(values('Materia prima','M'),('Material de empaque','E'),('Insumos','M'))v(name,prefix);
 return new;
end $$;
revoke all on function access_private.seed_material_types() from public,anon,authenticated;
create trigger seed_material_types after insert on public.companies for each row execute function access_private.seed_material_types();

create function access_private.save_material_types(c uuid,entries jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare e jsonb;r public.material_types%rowtype;label text;pre text;
begin
 if auth.uid() is null or not public.company_permission(c,'manage') then raise exception 'Solo administradores autorizados pueden configurar tipos de materiales' using errcode='42501';end if;
 if jsonb_typeof(entries) is distinct from 'array' or jsonb_array_length(entries) not between 1 and 100 or length(entries::text)>30000 then raise exception 'Configura entre 1 y 100 tipos';end if;
 if exists(select 1 from jsonb_array_elements(entries) duplicate_entry(value) where nullif(duplicate_entry.value->>'id','') is not null group by duplicate_entry.value->>'id' having count(*)>1) then raise exception 'Tipos repetidos';end if;
 perform pg_advisory_xact_lock(hashtextextended(c::text,0));
 for e in select value from jsonb_array_elements(entries) loop
  label:=btrim(e->>'name');pre:=upper(btrim(e->>'prefix'));
  if label is null or length(label) not between 1 and 80 or pre is null or pre!~'^[A-Z]{1,8}$' then raise exception 'Indica un nombre y un prefijo de 1 a 8 letras sin espacios ni acentos';end if;
  if nullif(e->>'id','') is not null then
   select * into r from public.material_types where company_id=c and id=(e->>'id')::uuid for update;
   if not found then raise exception 'Tipo no disponible en esta empresa' using errcode='42501';end if;
   if r.revision is distinct from (e->>'revision')::integer then raise exception 'Los tipos cambiaron. Actualiza antes de guardar' using errcode='40001';end if;
   update public.material_types set name=label,prefix=pre,revision=revision+1 where company_id=c and id=r.id and (name,prefix) is distinct from (label,pre);
  else
   insert into public.material_types(company_id,key,name,prefix) values(c,'tipo:'||gen_random_uuid()::text,label,pre);
  end if;
 end loop;
 return (select jsonb_agg(to_jsonb(t) order by t.name) from public.material_types t where t.company_id=c);
exception when unique_violation then raise exception 'Ya existe un tipo de material con ese nombre en esta empresa';
end $$;
revoke all on function access_private.save_material_types(uuid,jsonb) from public,anon;
grant execute on function access_private.save_material_types(uuid,jsonb) to authenticated;
create function public.save_material_types(p_company uuid,p_entries jsonb) returns jsonb language sql security invoker set search_path='' as $$ select access_private.save_material_types(p_company,p_entries) $$;
revoke all on function public.save_material_types(uuid,jsonb) from public,anon;
grant execute on function public.save_material_types(uuid,jsonb) to authenticated;

CREATE OR REPLACE FUNCTION catalog_private.reserve_sku(p_company uuid, p_prefix text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare n bigint; candidate text;
begin
 if auth.uid() is null or not public.company_permission(p_company,'write') then raise exception 'No tienes permisos de edición' using errcode='42501';end if;
 if p_prefix is null or p_prefix !~ '^[A-Z]{1,8}$' or (p_prefix not in('M','E','P') and not exists(select 1 from public.material_types t where t.company_id=p_company and t.prefix=p_prefix)) then raise exception 'Prefijo no configurado para esta empresa';end if;
 loop
  insert into public.catalog_sku_counters(company_id,prefix,last_value) values(p_company,p_prefix,1)
   on conflict(company_id,prefix) do update set last_value=public.catalog_sku_counters.last_value+1 returning last_value into n;
  candidate:=p_prefix||case when n<10000 then lpad(n::text,4,'0') else n::text end;
  exit when not exists(select 1 from public.catalog_identifiers where company_id=p_company and (public.catalog_key(sku)=public.catalog_key(candidate) or public.catalog_key(barcode)=public.catalog_key(candidate)));
 end loop;
 return candidate;
end $function$
;
CREATE OR REPLACE FUNCTION access_private.presentation_sku()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare parent_code text;class text;next_value bigint;candidate text;begin
 if not public.company_permission(new.company_id,'write') then raise exception 'Presentación no autorizada' using errcode='42501';end if;
 if nullif(trim(new.sku),'') is not null then return new;end if;
 perform pg_advisory_xact_lock(hashtextextended(new.company_id::text,0));
 select sku,classification into strict parent_code,class from public.raw_materials where company_id=new.company_id and id=new.raw_material_id;
 if parent_code is null then
  parent_code:=catalog_private.reserve_sku(new.company_id,coalesce((select t.prefix from public.material_types t where t.company_id=new.company_id and t.key=class),'M'));
  update public.raw_materials set sku=parent_code where company_id=new.company_id and id=new.raw_material_id;
 end if;
 loop
  insert into access_private.child_code_counters(company_id,kind,parent_id,last_value) values(new.company_id,'presentation',new.raw_material_id,1) on conflict(company_id,kind,parent_id) do update set last_value=access_private.child_code_counters.last_value+1 returning last_value into next_value;
  candidate:=parent_code||'-'||case when next_value<100 then lpad(next_value::text,2,'0') else next_value::text end;
  exit when not exists(select 1 from public.catalog_identifiers where company_id=new.company_id and (public.catalog_key(sku)=public.catalog_key(candidate) or public.catalog_key(barcode)=public.catalog_key(candidate)));
 end loop;
 new.sku:=candidate;return new;
end $function$
;
CREATE OR REPLACE FUNCTION access_private.generate_missing_material_skus(c uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$declare r record;n integer:=0;sk text;begin
 if auth.uid() is null or not public.company_permission(c,'write','catalog') then raise exception 'No tienes permisos para generar SKU' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(c::text,0));
 for r in select m.id,t.prefix from public.raw_materials m join public.material_types t on t.company_id=m.company_id and t.key=m.classification where m.company_id=c and nullif(btrim(m.sku),'') is null order by m.id for update of m loop
  sk:=catalog_private.reserve_sku(c,r.prefix);
  update public.raw_materials set sku=sk where company_id=c and id=r.id and nullif(btrim(sku),'') is null;n:=n+1;
 end loop;
 return jsonb_build_object('generated',n,'unclassified',(select count(*) from public.raw_materials where company_id=c and nullif(btrim(sku),'') is null and classification is null));
end $function$
;
do $migration$
declare d text;old_part text:=$old$insert into public.raw_materials(company_id,name,unit_id,alternative_name) values(p_company,trim(r->>'material'),uid,coalesce(r->>'alternative',''))$old$;
begin
 select pg_get_functiondef('catalog_private.save_material_sheet(uuid,uuid,jsonb)'::regprocedure) into d;
 if position(old_part in d)=0 then raise exception 'No se encontró la inserción de materiales esperada';end if;
 execute replace(d,old_part,$new$insert into public.raw_materials(company_id,name,unit_id,alternative_name,classification) values(p_company,trim(r->>'material'),uid,coalesce(r->>'alternative',''),nullif(r->>'classification',''))$new$);
end $migration$;
