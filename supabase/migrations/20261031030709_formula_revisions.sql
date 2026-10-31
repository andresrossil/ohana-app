-- Group revisions without changing existing formula UUIDs or batch references.
create table public.formula_families(
 id uuid primary key default gen_random_uuid(),company_id uuid not null,product_id uuid not null,
 code text not null check(code ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$'),
 created_at timestamptz not null default now(),unique(company_id,id),unique(company_id,id,product_id),
 foreign key(company_id,product_id) references public.products(company_id,id)
);
create unique index formula_family_code on public.formula_families(company_id,lower(code));
alter table public.formula_families enable row level security;
create policy scoped_read on public.formula_families for select to authenticated using(public.company_permission(company_id,'read','production'));
revoke all on public.formula_families from public,anon,authenticated;grant select on public.formula_families to authenticated;
alter table public.formulas
 add column family_id uuid,
 add column state text not null default 'testing' check(state in('testing','current','inactive')),
 add column capture_mode text not null default 'quantity' check(capture_mode in('quantity','percentage')),
 add column total_quantity numeric(20,8) check(total_quantity>0 and total_quantity<1000000000000),
 add column total_unit_id uuid,
 add column loss_enabled boolean not null default false,
 add column loss_percent numeric(9,6) not null default 5 check(loss_percent between 0 and 100),
 add column source_formula_id uuid,
 add column origin_action text not null default 'new' check(origin_action in('new','version','variation','duplicate'));
alter table public.formulas alter column standard_yield drop not null;
create temporary table legacy_formula_groups on commit drop as
select company_id,product_id,public.catalog_key(name) label,gen_random_uuid() id,
 'F'||lpad(row_number() over(partition by company_id order by product_id,public.catalog_key(name))::text,4,'0') code
from public.formulas group by company_id,product_id,public.catalog_key(name);
insert into public.formula_families(id,company_id,product_id,code) select id,company_id,product_id,code from legacy_formula_groups;
update public.formulas f set family_id=g.id from legacy_formula_groups g where f.company_id=g.company_id and f.product_id=g.product_id and public.catalog_key(f.name)=g.label;
update public.formulas f set state=case when f.version=(select max(other.version) from public.formulas other where other.company_id=f.company_id and other.family_id=f.family_id) then 'current' else 'inactive' end;
alter table public.formulas alter column family_id set not null;
alter table public.formulas drop constraint formulas_company_id_product_id_version_key;
alter table public.formulas add unique(company_id,family_id,version),
 add foreign key(company_id,family_id,product_id) references public.formula_families(company_id,id,product_id),
 add foreign key(company_id,total_unit_id) references public.units(company_id,id),
 add foreign key(company_id,source_formula_id) references public.formulas(company_id,id);
create unique index one_current_formula_version on public.formulas(company_id,family_id) where state='current';
create index formula_source on public.formulas(company_id,source_formula_id);
create index formula_total_unit on public.formulas(company_id,total_unit_id);
create index formulas_product on public.formulas(company_id,product_id);
create index formula_families_product on public.formula_families(company_id,product_id);
alter table public.formula_ingredients add column line_kind text not null default 'ingredient' check(line_kind in('ingredient','packaging')),
 add column percentage numeric(12,8) check(percentage>0 and percentage<=100);
update public.formula_ingredients i set line_kind='packaging' from public.raw_materials m where m.company_id=i.company_id and m.id=i.material_id and m.classification='Material de empaque';
-- A scale factor is independent of produced units; legacy batches retain their ratio.
alter table public.production_batches add column formula_scale numeric(20,8) not null default 1 check(formula_scale>0 and formula_scale<1000000000000);
update public.production_batches b set formula_scale=b.planned_quantity::numeric/f.standard_yield from public.formulas f where f.company_id=b.company_id and f.id=b.formula_id and f.standard_yield is not null;

create function access_private.next_formula_code(c uuid) returns text language sql stable security definer set search_path='' as $$
 select 'F'||lpad((coalesce(max(substring(code from '[0-9]+$')::bigint),0)+1)::text,greatest(4,length((coalesce(max(substring(code from '[0-9]+$')::bigint),0)+1)::text)),'0') from public.formula_families where company_id=c and code ~ '^F[0-9]{1,12}$'
$$;
revoke all on function access_private.next_formula_code(uuid) from public,anon,authenticated;
create function access_private.formula_identity_guard() returns trigger language plpgsql security definer set search_path='' as $$begin
 if tg_op='INSERT' then
  if new.family_id is null then
   perform pg_advisory_xact_lock(hashtextextended(new.company_id::text,0));
   insert into public.formula_families(company_id,product_id,code) values(new.company_id,new.product_id,access_private.next_formula_code(new.company_id)) returning id into new.family_id;
   new.version:=1;
  end if;
 elsif (to_jsonb(new)-'state') is distinct from (to_jsonb(old)-'state') then raise exception 'Las revisiones se conservan. Crea una nueva versión para cambiar la composición';
 end if;return new;
end $$;
revoke all on function access_private.formula_identity_guard() from public,anon,authenticated;
create trigger formula_identity_guard before insert or update on public.formulas for each row execute function access_private.formula_identity_guard();
create function access_private.formula_line_guard() returns trigger language plpgsql set search_path='' as $$begin
 raise exception 'Los ingredientes de una revisión son inmutables; crea una nueva versión';
end $$;
revoke all on function access_private.formula_line_guard() from public,anon,authenticated;
create trigger formula_line_guard before update or delete on public.formula_ingredients for each row execute function access_private.formula_line_guard();

create function access_private.formula_catalog(c uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$declare ccy text;begin
 if auth.uid() is null or not public.company_permission(c,'read','production') then raise exception 'Fórmulas no autorizadas' using errcode='42501';end if;
 select currency into strict ccy from public.companies where id=c;
 return jsonb_build_object('currency',ccy,'next_code',case when public.company_permission(c,'write','production') then access_private.next_formula_code(c) else null end,
 'products',coalesce((select jsonb_agg(to_jsonb(p) order by name) from(select id,name,active from public.products where company_id=c)p),'[]'),
 'units',coalesce((select jsonb_agg(to_jsonb(u) order by name) from public.units u where company_id=c),'[]'),
 'materials',coalesce((select jsonb_agg(to_jsonb(z) order by name) from(
   select m.id,m.name,m.sku,m.classification,m.unit_id,m.active,quote.unit_cost,quote.effective_on,ccy currency
   from public.raw_materials m join public.units base on base.company_id=m.company_id and base.id=m.unit_id
   left join lateral(select h.amount/pp.quantity*base.base_factor/qu.base_factor unit_cost,h.effective_on from public.price_history h
    join public.presentations pp on pp.company_id=h.company_id and pp.id=h.presentation_id
    join public.units qu on qu.company_id=pp.company_id and qu.id=pp.unit_id
    left join public.business_partners partner on partner.company_id=pp.company_id and partner.id=pp.supplier_id
    where pp.company_id=c and pp.raw_material_id=m.id and pp.active and (pp.supplier_id is null or (partner.active and partner.partner_type='supplier'))
      and qu.dimension=base.dimension and h.amount is not null and h.currency=ccy and h.effective_on<=current_date
    order by h.effective_on desc,h.created_at desc,h.id desc limit 1)quote on true where m.company_id=c
 )z),'[]'));
end $$;
create function public.formula_catalog(p_company uuid) returns jsonb language sql stable security invoker set search_path='' as $$select access_private.formula_catalog(p_company)$$;
revoke all on function access_private.formula_catalog(uuid),public.formula_catalog(uuid) from public,anon;
grant execute on function access_private.formula_catalog(uuid),public.formula_catalog(uuid) to authenticated;

create function access_private.formula_command(c uuid,action text,k uuid default null,data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare src public.formulas%rowtype;f public.formulas%rowtype;mat public.raw_materials%rowtype;u public.units%rowtype;tu public.units%rowtype;
 cached access_private.operation_requests%rowtype;fid uuid;family uuid;product uuid;ver integer;code text;capture text;kind text;status text;qty numeric;pct numeric;total numeric;sum_pct numeric:=0;dimensions integer;sum_base numeric;
 lines jsonb:='[]';r jsonb;duplicates jsonb;signature jsonb;answer jsonb;begin
 if auth.uid() is null or not public.company_permission(c,case when action='list' then 'read' else 'write' end,'production') then raise exception 'Fórmulas no autorizadas' using errcode='42501';end if;
 if action='list' then return coalesce((select jsonb_agg(to_jsonb(fm)||jsonb_build_object('code',ff.code,'product_name',p.name,'ingredients',coalesce((select jsonb_agg(to_jsonb(i)||jsonb_build_object('name',rm.name,'unit',un.symbol) order by line_kind,rm.name) from public.formula_ingredients i join public.raw_materials rm on rm.company_id=i.company_id and rm.id=i.material_id join public.units un on un.company_id=i.company_id and un.id=i.unit_id where i.company_id=c and i.formula_id=fm.id),'[]')) order by ff.code,fm.version desc) from public.formulas fm join public.formula_families ff on ff.company_id=fm.company_id and ff.id=fm.family_id join public.products p on p.company_id=fm.company_id and p.id=fm.product_id where fm.company_id=c),'[]');end if;
 if action not in('save','state') or k is null then raise exception 'Acción inválida';end if;
 perform pg_advisory_xact_lock(hashtextextended(c::text,0));
 select * into cached from access_private.operation_requests where company_id=c and key=k;
 if found then if cached.action<>'formula_'||action or cached.payload<>data then raise exception 'Identificador utilizado con otros datos';end if;return cached.result;end if;
 if action='state' then
  status:=data->>'state';if coalesce(status,'') not in('testing','current','inactive') then raise exception 'Estado inválido';end if;
  select * into strict f from public.formulas where company_id=c and id=(data->>'id')::uuid;
  if status='current' then update public.formulas set state='inactive' where company_id=c and family_id=f.family_id and state='current' and id<>f.id;end if;
  update public.formulas set state=status where company_id=c and id=f.id;answer:=jsonb_build_object('id',f.id);
 else
  if length(data::text)>80000 then raise exception 'Fórmula demasiado extensa';end if;
  if coalesce(data->>'kind','') not in('new','version','variation','duplicate') then raise exception 'Selecciona la acción de fórmula';end if;
  if data->>'kind'<>'new' then select * into strict src from public.formulas where company_id=c and id=(data->>'source')::uuid;end if;
  product:=(data->>'product')::uuid;
  if data->>'kind' in('version','variation') and product is distinct from src.product_id then raise exception 'Una versión o variación pertenece al mismo producto';end if;
  perform 1 from public.products where company_id=c and id=product and active;if not found then raise exception 'Producto no disponible';end if;
  capture:=coalesce(data->>'capture_mode','quantity');status:=coalesce(data->>'state','testing');
  if capture not in('quantity','percentage') or status not in('testing','current','inactive') then raise exception 'Revisa modalidad y estado';end if;
  if coalesce(jsonb_typeof(data->'ingredients'),'')<>'array' or jsonb_array_length(data->'ingredients') not between 1 and 100 then raise exception 'Añade entre 1 y 100 materiales';end if;
  if capture='percentage' then
   total:=nullif(data->>'total_quantity','')::numeric;
   if total is null or not(total>0 and total<1000000000000) then raise exception 'Define la cantidad total a preparar';end if;
   select * into strict tu from public.units where company_id=c and id=(data->>'total_unit')::uuid and active;
  end if;
  for r in select value from jsonb_array_elements(data->'ingredients') loop
   select * into strict mat from public.raw_materials where company_id=c and id=(r->>'material')::uuid and active;
   select * into strict u from public.units where company_id=c and id=(r->>'unit')::uuid and active;
   if u.dimension<>(select dimension from public.units where company_id=c and id=mat.unit_id) then raise exception 'Unidad incompatible con %',mat.name;end if;
   kind:=coalesce(r->>'line_kind','ingredient');if kind not in('ingredient','packaging') then raise exception 'Tipo de material inválido';end if;
   if mat.classification='Material de empaque' and kind<>'packaging' then raise exception 'El empaque se registra en su sección independiente';end if;
   if exists(select 1 from jsonb_array_elements(lines) x where x->>'material'=mat.id::text) then raise exception 'La materia prima % ya está incluida; modifica su fila',mat.name;end if;
   pct:=null;
   if capture='percentage' and kind='ingredient' then
    pct:=nullif(r->>'percentage','')::numeric;
    if pct is null or not(pct>0 and pct<=100) then raise exception 'Revisa el porcentaje de %',mat.name;end if;
    if u.dimension<>tu.dimension then raise exception 'No se pueden sumar gramos, mililitros ni conteos sin una conversión válida';end if;
    qty:=round(total*tu.base_factor*pct/100/u.base_factor,8);sum_pct:=sum_pct+pct;
   else qty:=nullif(r->>'quantity','')::numeric;end if;
   if qty is null or not(qty>0 and qty<1000000000000) then raise exception 'Cantidad inválida para %',mat.name;end if;
   lines:=lines||jsonb_build_array(jsonb_build_object('material',mat.id,'unit',u.id,'quantity',round(qty,8),'percentage',pct,'line_kind',kind,'base',round(qty*u.base_factor,8),'dimension',u.dimension));
  end loop;
  if not exists(select 1 from jsonb_array_elements(lines)x where x->>'line_kind'='ingredient') then raise exception 'Añade al menos una materia prima';end if;
  if capture='percentage' and abs(sum_pct-100)>0.000001 then raise exception 'Los porcentajes deben sumar 100 %% (actual: %)',sum_pct;end if;
  select count(distinct x->>'dimension'),sum((x->>'base')::numeric) into dimensions,sum_base from jsonb_array_elements(lines)x where x->>'line_kind'='ingredient';
  if data->>'kind'='version' then family:=src.family_id;ver:=(select coalesce(max(version),0)+1 from public.formulas where company_id=c and family_id=family);
  else family:=null;ver:=1;end if;
  select jsonb_agg(jsonb_build_array(x->>'material',x->>'line_kind',(x->>'base')::numeric) order by x->>'material') into signature from jsonb_array_elements(lines)x;
  select coalesce(jsonb_agg(to_jsonb(z)),'[]') into duplicates from(select fm.id,ff.code,fm.name,fm.version from public.formulas fm join public.formula_families ff on ff.company_id=fm.company_id and ff.id=fm.family_id
    where fm.company_id=c and fm.product_id=product and (family is null or fm.family_id<>family) and signature=(select jsonb_agg(jsonb_build_array(i.material_id::text,i.line_kind,round(i.quantity*un.base_factor,8)) order by i.material_id::text) from public.formula_ingredients i join public.units un on un.company_id=i.company_id and un.id=i.unit_id where i.company_id=c and i.formula_id=fm.id) order by ff.code,fm.version desc limit 10)z;
  if jsonb_array_length(duplicates)>0 and not coalesce((data->>'confirm_duplicate')::boolean,false) then return jsonb_build_object('duplicates',duplicates);end if;
  if family is null then
   code:=coalesce(nullif(trim(data->>'code'),''),access_private.next_formula_code(c));
   insert into public.formula_families(company_id,product_id,code) values(c,product,code) returning id into family;
  end if;
  if status='current' then update public.formulas set state='inactive' where company_id=c and family_id=family and state='current';end if;
  insert into public.formulas(company_id,product_id,family_id,name,version,standard_yield,state,capture_mode,total_quantity,total_unit_id,loss_enabled,loss_percent,source_formula_id,origin_action)
    values(c,product,family,trim(data->>'name'),ver,null,status,capture,case when capture='percentage' then total else null end,case when capture='percentage' then tu.id else null end,coalesce((data->>'loss_enabled')::boolean,false),coalesce(nullif(data->>'loss_percent','')::numeric,5),src.id,data->>'kind') returning id into fid;
  for r in select value from jsonb_array_elements(lines) loop
   insert into public.formula_ingredients(company_id,formula_id,material_id,quantity,unit_id,line_kind,percentage)
   values(c,fid,(r->>'material')::uuid,(r->>'quantity')::numeric,(r->>'unit')::uuid,r->>'line_kind',case when r->>'line_kind'='packaging' or dimensions<>1 then null when capture='percentage' then(r->>'percentage')::numeric else round((r->>'base')::numeric/sum_base*100,8) end);
  end loop;answer:=jsonb_build_object('id',fid,'version',ver);
 end if;
 insert into access_private.operation_requests(company_id,key,action,payload,result) values(c,k,'formula_'||action,data,answer);return answer;
end $$;
create function public.formula_command(p_company uuid,p_action text,p_key uuid default null,p_data jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select access_private.formula_command(p_company,p_action,p_key,p_data)$$;
revoke all on function access_private.formula_command(uuid,text,uuid,jsonb),public.formula_command(uuid,text,uuid,jsonb) from public,anon;
grant execute on function access_private.formula_command(uuid,text,uuid,jsonb),public.formula_command(uuid,text,uuid,jsonb) to authenticated;

-- Keep the existing production command and preserve its consumption/stock semantics.
do $patch$declare def text;begin
 def:=pg_get_functiondef('access_private.operations(uuid,text,uuid,jsonb)'::regprocedure);
 def:=replace(def,'planned_quantity,production_date,available_on,currency,notes) values(p_company,f.product_id,f.id,(p_data->>''quantity'')::integer,',
 'planned_quantity,formula_scale,production_date,available_on,currency,notes) values(p_company,f.product_id,f.id,(p_data->>''quantity'')::integer,coalesce(nullif(p_data->>''formula_scale'','''')::numeric,case when f.standard_yield is not null then (p_data->>''quantity'')::numeric/f.standard_yield else 1 end),');
 def:=replace(def,'insert into public.production_batches(company_id,product_id,formula_id,planned_quantity,formula_scale,',
 'if f.state=''inactive'' then raise exception ''Selecciona una versión vigente o en pruebas'';end if; insert into public.production_batches(company_id,product_id,formula_id,planned_quantity,formula_scale,');
 if strpos(def,'formula_scale,production_date')=0 then raise exception 'No se encontró la integración de escala de lotes';end if;
 execute def;
end $patch$;
notify pgrst,'reload schema';
