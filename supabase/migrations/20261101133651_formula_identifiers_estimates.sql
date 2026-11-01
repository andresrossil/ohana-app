-- A formula family is the stable formula identity; formulas are its exact revisions.
alter table public.formula_families add column formula_origen_id uuid, add column own_reference text check(length(own_reference)<=80);
-- Follow only recorded variation ancestry. Duplicates and originals start independent roots.
create temporary table family_parents on commit drop as
select ff.company_id,ff.id,case when first_revision.origin_action='variation' then source.family_id else ff.id end parent
from public.formula_families ff
left join lateral(select * from public.formulas f where f.company_id=ff.company_id and f.family_id=ff.id order by version,created_at,id limit 1)first_revision on true
left join public.formulas source on source.company_id=ff.company_id and source.id=first_revision.source_formula_id;
do $$begin if exists(select 1 from family_parents where parent is null) then raise exception 'Una variación histórica no tiene origen verificable';end if;end $$;
with recursive walk as(
 select company_id,id,parent,array[id] path,false cycle from family_parents
 union all select w.company_id,w.id,p.parent,w.path||p.id,p.id=any(w.path)
 from walk w join family_parents p on p.company_id=w.company_id and p.id=w.parent
 where w.parent<>w.path[array_length(w.path,1)] and not w.cycle
),roots as(select company_id,id,parent from walk where parent=path[array_length(path,1)] and not cycle)
update public.formula_families ff set formula_origen_id=r.parent from roots r where ff.company_id=r.company_id and ff.id=r.id;
alter table public.formula_families alter column formula_origen_id set not null;
alter table public.formula_families add foreign key(company_id,formula_origen_id) references public.formula_families(company_id,id);
create index formula_family_origin on public.formula_families(company_id,formula_origen_id);
create unique index formula_own_reference on public.formula_families(company_id,lower(btrim(own_reference))) where nullif(btrim(own_reference),'') is not null;

-- High-water marks survive removal of formulas; previews never reserve a number.
create table access_private.formula_code_counters(company_id uuid primary key references public.companies(id),last_value bigint not null check(last_value>=0));
alter table access_private.formula_code_counters enable row level security;
revoke all on access_private.formula_code_counters from public,anon,authenticated;
insert into access_private.formula_code_counters select company_id,coalesce(max(case when code~'^F[0-9]{1,12}$' then substring(code from 2)::bigint end),0) from public.formula_families group by company_id;
-- Retain custom legacy identifiers as references, never infer ancestry from names.
update public.formula_families set own_reference=code where code!~'^F[0-9]{1,12}$';
do $$declare r record;n bigint;begin
 for r in select * from public.formula_families order by company_id,created_at,id loop
  if r.code~'^F[0-9]{1,12}$' then n:=substring(r.code from 2)::bigint;
  else update access_private.formula_code_counters set last_value=last_value+1 where company_id=r.company_id returning last_value into n;end if;
  update public.formula_families set code='F'||lpad(n::text,greatest(6,length(n::text)),'0') where id=r.id;
 end loop;
end $$;
alter table public.formula_families add check(code~'^F[0-9]{6,}$');
create or replace function access_private.next_formula_code(c uuid) returns text language sql stable security definer set search_path='' as $$
 select 'F'||lpad((coalesce((select last_value from access_private.formula_code_counters where company_id=c),0)+1)::text,greatest(6,length((coalesce((select last_value from access_private.formula_code_counters where company_id=c),0)+1)::text)),'0')
$$;
create function access_private.formula_family_guard() returns trigger language plpgsql security definer set search_path='' as $$declare n bigint;begin
 perform pg_advisory_xact_lock(hashtextextended(new.company_id::text,0));
 if tg_op='INSERT' then
  insert into access_private.formula_code_counters values(new.company_id,1) on conflict(company_id) do update set last_value=access_private.formula_code_counters.last_value+1 returning last_value into n;
  new.code:='F'||lpad(n::text,greatest(6,length(n::text)),'0');
  new.formula_origen_id:=coalesce(new.formula_origen_id,new.id);
 elsif row(new.id,new.company_id,new.product_id,new.code,new.formula_origen_id,new.created_at) is distinct from row(old.id,old.company_id,old.product_id,old.code,old.formula_origen_id,old.created_at) then raise exception 'La identidad y el origen de la fórmula no cambian';end if;
 if new.formula_origen_id<>new.id and not exists(select 1 from public.formula_families f where f.company_id=new.company_id and f.id=new.formula_origen_id and f.formula_origen_id=f.id and f.product_id=new.product_id) then raise exception 'El origen debe ser la fórmula original del mismo producto y empresa';end if;
 new.own_reference:=nullif(btrim(new.own_reference),'');return new;
end $$;
revoke all on function access_private.formula_family_guard() from public,anon,authenticated;
create trigger formula_family_guard before insert or update on public.formula_families for each row execute function access_private.formula_family_guard();

alter table public.formulas add column estimated_units numeric(20,8) check(estimated_units>0 and estimated_units<1000000000000 and estimated_units=trunc(estimated_units)),
 add column estimate_unit_id uuid,add column quantity_per_unit numeric(20,8) check(quantity_per_unit>0 and quantity_per_unit<1000000000000),
 add foreign key(company_id,estimate_unit_id) references public.units(company_id,id);
create index formula_estimate_unit on public.formulas(company_id,estimate_unit_id);
alter table public.formula_ingredients add column density_g_ml numeric(20,8) check(density_g_ml>0 and density_g_ml<1000000);

-- Reuse the existing command and its scoped authorization, validation and retry handling.
do $patch$declare def text;begin
 def:=pg_get_functiondef('access_private.formula_command(uuid,text,uuid,jsonb)'::regprocedure);
 def:=replace(def,'''code'',ff.code,','''own_reference'',ff.own_reference,''formula_origen_id'',ff.formula_origen_id,''code'',ff.code,');
 def:=replace(def,'if action=''notes'' then', $new$if action='notes' then
  if data ? 'own_reference' then
   update public.formula_families ff set own_reference=data->>'own_reference' from public.formulas rf where rf.company_id=c and rf.id=(data->>'id')::uuid and ff.company_id=c and ff.id=rf.family_id;
  end if;
 $new$);
 def:=replace(def,'product:=(data->>''product'')::uuid;', $new$product:=(data->>'product')::uuid;
  if nullif(data->>'estimate_unit_id','') is not null and not exists(
   select 1 from public.units eu join public.products ep on ep.company_id=eu.company_id and ep.id=product
   join public.units pu on pu.company_id=ep.company_id and pu.id=ep.unit_id
   where eu.company_id=c and eu.id=(data->>'estimate_unit_id')::uuid and eu.active and eu.dimension=pu.dimension and lower(eu.symbol) in('g','kg','ml','l')
  ) then raise exception 'Selecciona una presentación compatible con el producto';end if;
 $new$);
 def:=replace(def,'code:=coalesce(nullif(trim(data->>''code''),''''),access_private.next_formula_code(c));','code:=access_private.next_formula_code(c);');
 def:=replace(def,'insert into public.formula_families(company_id,product_id,code) values(c,product,code) returning id into family;',
 'insert into public.formula_families(company_id,product_id,code,formula_origen_id,own_reference) values(c,product,code,case when data->>''kind''=''variation'' then (select formula_origen_id from public.formula_families where company_id=c and id=src.family_id) else null end,nullif(btrim(data->>''own_reference''),'''')) returning id into family;');
 def:=replace(def,'for r in select value from jsonb_array_elements(lines) loop', $new$
  update public.formulas set estimated_units=nullif(data->>'estimated_units','')::numeric,estimate_unit_id=nullif(data->>'estimate_unit_id','')::uuid,quantity_per_unit=nullif(data->>'quantity_per_unit','')::numeric where company_id=c and id=fid;
  if data ? 'own_reference' then update public.formula_families set own_reference=data->>'own_reference' where company_id=c and id=family;end if;
  for r in select value from jsonb_array_elements(lines) loop$new$);
 def:=replace(def,'''dimension'',u.dimension)', '''dimension'',u.dimension,''density_g_ml'',nullif(r->>''density_g_ml'','''')::numeric)');
 def:=replace(def,'unit_id,line_kind,percentage)', 'unit_id,line_kind,percentage,density_g_ml)');
 def:=replace(def,'round((r->>''base'')::numeric/sum_base*100,8) end);','round((r->>''base'')::numeric/sum_base*100,8) end,(r->>''density_g_ml'')::numeric);');
 if strpos(def,'estimate_unit_id=nullif')=0 or strpos(def,'''density_g_ml'',nullif')=0 then raise exception 'No se encontró el comando de fórmulas esperado';end if;
 execute def;
 def:=pg_get_functiondef('access_private.formula_catalog(uuid)'::regprocedure);
 def:=replace(def,'select id,name,active from public.products','select id,name,unit_id,active from public.products');execute def;
 -- Snapshots for future confirmations include recipe estimates and density; old snapshots stay untouched.
 def:=pg_get_functiondef('access_private.batch_recipe_snapshot(uuid,uuid,uuid,uuid,numeric,jsonb,text,numeric)'::regprocedure);
 def:=replace(def,'''edit_revision'',f.edit_revision)', '''edit_revision'',f.edit_revision,''formula_origen_id'',ff.formula_origen_id,''own_reference'',ff.own_reference,''estimated_units'',f.estimated_units,''estimate_unit_id'',f.estimate_unit_id,''quantity_per_unit'',f.quantity_per_unit)');
 def:=replace(def,'''percentage'',i.percentage,','''percentage'',i.percentage,''density_g_ml'',i.density_g_ml,');execute def;
end $patch$;
notify pgrst,'reload schema';
