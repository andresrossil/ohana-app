-- Incremental, no existing rows or price history are removed.
alter table public.raw_materials add column alternative_name text not null default '';
alter table public.presentations add column capacity text not null default '';
alter table public.presentations add column comment text not null default '';
alter table public.price_history add column legacy_previous_amount numeric(18,4) check(legacy_previous_amount >= 0 and legacy_previous_amount <> 'NaN'::numeric);
alter table public.price_history add column legacy_previous_supplier text;
alter table public.price_history add column legacy_previous_basis text not null default 'unknown' check(legacy_previous_basis in ('unknown','unit','presentation'));
alter table public.price_history add column legacy_previous_date date;
-- Ounce of mass only; fluid ounces must be configured as a separate volume unit.
insert into public.units(company_id,name,symbol,dimension,base_factor)
select c.id,'Onza','oz','mass',28.34952313 from public.companies c
where not exists(select 1 from public.units u where u.company_id=c.id and lower(trim(u.symbol))='oz');

create function public.catalog_key(value text) returns text language sql immutable strict
set search_path='' as $$ select lower(regexp_replace(trim(value),'\s+',' ','g')) $$;
revoke all on function public.catalog_key(text) from public,anon;
grant execute on function public.catalog_key(text) to authenticated;
create index suppliers_catalog_key_idx on public.suppliers(company_id,public.catalog_key(name));
create index materials_catalog_key_idx on public.raw_materials(company_id,public.catalog_key(name));
create index units_catalog_key_idx on public.units(company_id,public.catalog_key(symbol));

create view public.material_sheet with(security_invoker=true) as
select p.id,p.company_id,p.raw_material_id,p.supplier_id,p.unit_id,p.quantity,p.capacity,p.comment,p.active,
 p.name as presentation_name,p.product_url,m.name as material_name,m.alternative_name,m.notes as material_notes,
 s.name as supplier_name,u.symbol as unit_symbol,u.name as unit_name,u.dimension,u.base_factor,
 h.id as price_id,h.amount,h.currency,h.effective_on,h.created_at as price_created_at,
 h.amount/p.quantity as unit_price,
 case when prev.id is not null then prev.normalized_unit_price
      when h.legacy_previous_basis='unit' then h.legacy_previous_amount
      when h.legacy_previous_basis='presentation' then h.legacy_previous_amount/p.quantity end as previous_unit_price,
 case when prev.id is not null then prev.normalized_unit_price
      else h.legacy_previous_amount end as previous_display,
 coalesce(prev.supplier_name,h.legacy_previous_supplier) as previous_supplier,
 prev.effective_on as previous_date,
 case when prev.id is not null then 'history' else h.legacy_previous_basis end as previous_basis,
 h.legacy_previous_amount,h.legacy_previous_supplier,h.legacy_previous_basis,h.legacy_previous_date
from public.presentations p
join public.raw_materials m on m.id=p.raw_material_id and m.company_id=p.company_id
join public.suppliers s on s.id=p.supplier_id and s.company_id=p.company_id
join public.units u on u.id=p.unit_id and u.company_id=p.company_id
left join lateral (
 select * from public.price_history h where h.company_id=p.company_id and h.presentation_id=p.id and h.effective_on <= current_date
 order by h.effective_on desc,h.created_at desc,h.id desc limit 1
) h on true
left join lateral (
 select ph.id,ph.effective_on,ps.name as supplier_name,
 ph.amount/(pp.quantity*pu.base_factor)*u.base_factor as normalized_unit_price
 from public.price_history ph
 join public.presentations pp on pp.company_id=ph.company_id and pp.id=ph.presentation_id
 join public.units pu on pu.company_id=pp.company_id and pu.id=pp.unit_id
 join public.suppliers ps on ps.company_id=pp.company_id and ps.id=pp.supplier_id
 where ph.company_id=p.company_id and pp.raw_material_id=p.raw_material_id
 and pu.dimension=u.dimension and ph.currency=h.currency
 and (ph.effective_on,ph.created_at,ph.id)<(h.effective_on,h.created_at,h.id)
 order by ph.effective_on desc,ph.created_at desc,ph.id desc limit 1
) prev on true;
revoke all on public.material_sheet from public,anon,authenticated;
grant select on public.material_sheet to authenticated;

-- A whole batch is one transaction under the caller's RLS. No SECURITY DEFINER.
-- A client-generated batch UUID makes retries safe after a lost response.
create table public.catalog_batches(
 company_id uuid not null references public.companies(id),
 id uuid not null,created_by uuid not null default auth.uid() references auth.users(id),
 payload jsonb not null, result jsonb, created_at timestamptz not null default now(),
 primary key(company_id,id)
);
create index catalog_batches_user_idx on public.catalog_batches(created_by);
alter table public.catalog_batches enable row level security;
revoke all on public.catalog_batches from public,anon,authenticated;
grant select,insert,update on public.catalog_batches to authenticated;
create policy own_batches_read on public.catalog_batches for select to authenticated using(
 created_by=(select auth.uid()) and company_id in(select company_id from public.company_members where user_id=(select auth.uid()) and role in('admin','editor')));
create policy own_batches_insert on public.catalog_batches for insert to authenticated with check(
 created_by=(select auth.uid()) and company_id in(select company_id from public.company_members where user_id=(select auth.uid()) and role in('admin','editor')));
create policy own_batches_update on public.catalog_batches for update to authenticated using(
 created_by=(select auth.uid()) and company_id in(select company_id from public.company_members where user_id=(select auth.uid()) and role in('admin','editor')))
 with check(created_by=(select auth.uid()) and company_id in(select company_id from public.company_members where user_id=(select auth.uid()) and role in('admin','editor')));

create function public.save_material_sheet(p_company uuid,p_batch uuid,p_rows jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r jsonb; n integer:=0; sid uuid; mid uuid; uid uuid; pid uuid;
 qty numeric; price numeric; prior numeric; d date; oldp public.presentations%rowtype;
 oldh public.price_history%rowtype; material public.raw_materials%rowtype;
 unit public.units%rowtype; ids uuid[]; output jsonb:='[]'; cached public.catalog_batches%rowtype;
 mode text; basis text;
begin
 if auth.uid() is null or not exists(select 1 from public.company_members where company_id=p_company and user_id=auth.uid() and role in('admin','editor')) then
  raise exception 'No tienes permisos de edición' using errcode='42501';
 end if;
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 500 then raise exception 'El lote debe tener entre 1 y 500 filas'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company::text,0));
 select * into cached from public.catalog_batches where company_id=p_company and id=p_batch;
 if found then
  if cached.payload<>p_rows then raise exception 'El identificador de lote ya se utilizó para otros cambios'; end if;
  return cached.result;
 end if;
 insert into public.catalog_batches(company_id,id,payload) values(p_company,p_batch,p_rows);
 for r in select value from jsonb_array_elements(p_rows) loop
  n:=n+1;
  begin
   mode:=coalesce(r->>'mode','add'); if mode not in('add','update') then raise exception 'Elige agregar o actualizar'; end if;
   if nullif(trim(r->>'material'),'') is null or nullif(trim(r->>'supplier'),'') is null or nullif(trim(r->>'unit'),'') is null then raise exception 'MP, PROVEEDOR y UNIDAD MEDIDA son obligatorios'; end if;
   qty:=(r->>'quantity')::numeric; price:=(r->>'price')::numeric; d:=(r->>'date')::date;
   prior:=nullif(r->>'previous','')::numeric; basis:=coalesce(r->>'previousBasis','unknown');
   if qty is null or qty<=0 or qty='NaN'::numeric or qty>999999999999 or price<0 or price='NaN'::numeric or price is null or d is null then raise exception 'Presentación, precio o fecha inválidos'; end if;
   if prior<0 or prior='NaN'::numeric or basis not in('unknown','unit','presentation') then raise exception 'Referencia histórica inválida'; end if;
   select array_agg(id) into ids from public.units where company_id=p_company and active and (public.catalog_key(symbol)=public.catalog_key(r->>'unit') or public.catalog_key(name)=public.catalog_key(r->>'unit'));
   if coalesce(cardinality(ids),0)<>1 then raise exception 'Unidad desconocida o ambigua: %; configúrala en Unidades',r->>'unit'; end if;
   uid:=ids[1]; select * into unit from public.units where company_id=p_company and id=uid;
   select array_agg(id) into ids from public.suppliers where company_id=p_company and public.catalog_key(name)=public.catalog_key(r->>'supplier');
   if cardinality(ids)>1 then raise exception 'Hay varios proveedores con ese nombre; corrige el catálogo'; end if;
   sid:=ids[1];
   if sid is null then insert into public.suppliers(company_id,name) values(p_company,trim(r->>'supplier')) returning id into sid; end if;
   if not exists(select 1 from public.suppliers where id=sid and company_id=p_company and active) then raise exception 'El proveedor está archivado'; end if;
   pid:=nullif(r->>'id','')::uuid;
   if pid is not null then
    select * into oldp from public.presentations where company_id=p_company and id=pid for update;
    if not found then raise exception 'La presentación ya no está disponible'; end if;
    if (r->>'expectedPriceId') is distinct from (select id::text from public.price_history where company_id=p_company and presentation_id=pid and effective_on<=current_date order by effective_on desc,created_at desc,id desc limit 1) then
     raise exception 'El precio cambió en otra sesión; recarga antes de guardar';
    end if;
    mid:=oldp.raw_material_id;
   else
    select array_agg(id) into ids from public.raw_materials where company_id=p_company and public.catalog_key(name)=public.catalog_key(r->>'material');
    if cardinality(ids)>1 then raise exception 'Hay varias materias primas con ese nombre; selecciona una fila existente'; end if;
    mid:=ids[1];
    if mid is null then
     insert into public.raw_materials(company_id,name,unit_id,alternative_name) values(p_company,trim(r->>'material'),uid,coalesce(r->>'alternative','')) returning id into mid;
    end if;
   end if;
   select * into material from public.raw_materials where company_id=p_company and id=mid;
   if not material.active then raise exception 'La materia prima está archivada'; end if;
   if not exists(select 1 from public.units where company_id=p_company and id=material.unit_id and dimension=unit.dimension) then raise exception 'La unidad no es compatible con la materia prima'; end if;
   if exists(select 1 from public.raw_materials where company_id=p_company and id<>mid and public.catalog_key(name)=public.catalog_key(r->>'material')) then raise exception 'Ya existe otra materia prima con ese nombre'; end if;
   update public.raw_materials set name=trim(r->>'material'),alternative_name=coalesce(r->>'alternative','') where company_id=p_company and id=mid;
   if pid is null then
    select array_agg(id) into ids from public.presentations where company_id=p_company and active and raw_material_id=mid and supplier_id=sid and unit_id=uid and quantity=qty and public.catalog_key(capacity)=public.catalog_key(coalesce(r->>'capacity',''));
    if coalesce(cardinality(ids),0)>0 and not coalesce((r->>'confirmedDuplicate')::boolean,false) then raise exception 'Posible duplicado: confirma agregar o actualizar en la vista previa'; end if;
    if mode='update' and cardinality(ids)>1 then raise exception 'Varias presentaciones coinciden; selecciona una fila existente'; end if;
    if mode='update' then pid:=ids[1]; end if;
   end if;
   if pid is not null then
    select * into oldp from public.presentations where company_id=p_company and id=pid for update;
    if oldp.supplier_id<>sid or oldp.unit_id<>uid or oldp.quantity<>qty then
     update public.presentations set active=false where company_id=p_company and id=pid; pid:=null;
    end if;
   end if;
   if pid is null then
    insert into public.presentations(company_id,raw_material_id,supplier_id,unit_id,quantity,name,capacity,comment,product_url)
    values(p_company,mid,sid,uid,qty,left(trim(r->>'material')||' · '||qty||' '||unit.symbol,160),coalesce(r->>'capacity',''),coalesce(r->>'comment',''),oldp.product_url) returning id into pid;
   else
    update public.presentations set capacity=coalesce(r->>'capacity',''),comment=coalesce(r->>'comment','') where company_id=p_company and id=pid;
   end if;
   select * into oldh from public.price_history where company_id=p_company and presentation_id=pid and effective_on=d order by created_at desc,id desc limit 1;
   if oldh.id is null or oldh.amount<>price or oldh.currency<>coalesce(r->>'currency','GTQ') or oldh.legacy_previous_amount is distinct from prior or oldh.legacy_previous_supplier is distinct from nullif(r->>'previousSupplier','') or oldh.legacy_previous_basis<>basis then
    insert into public.price_history(company_id,presentation_id,amount,currency,effective_on,legacy_previous_amount,legacy_previous_supplier,legacy_previous_basis,legacy_previous_date)
    values(p_company,pid,price,coalesce(r->>'currency','GTQ'),d,prior,nullif(r->>'previousSupplier',''),basis,null);
   end if;
   output:=output||jsonb_build_array(jsonb_build_object('row',n,'id',pid));
   oldp:=null; oldh:=null;
  exception when others then raise exception 'Fila %: %',n,sqlerrm using errcode=sqlstate; end;
 end loop;
 update public.catalog_batches set result=output where company_id=p_company and id=p_batch;
 return output;
end $$;
revoke all on function public.save_material_sheet(uuid,uuid,jsonb) from public,anon;
grant execute on function public.save_material_sheet(uuid,uuid,jsonb) to authenticated;
