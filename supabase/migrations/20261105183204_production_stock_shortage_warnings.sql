-- Only explicitly acknowledged production consumption can create material deficits.
-- Later material entries offset deficit lots; confirmed consumption costs stay frozen.
alter table public.production_batches add column stock_warnings jsonb not null default '{}';
alter table public.inventory_balances drop constraint inventory_balances_check;
alter table public.inventory_balances add constraint inventory_balances_check check(on_hand<>'NaN'::numeric and blocked>=0 and reserved>=0 and ((on_hand>=0 and blocked+reserved<=on_hand) or(item_kind='material' and blocked=0 and reserved=0)));
alter table public.inventory_lots drop constraint inventory_lots_remaining_check;
alter table public.inventory_lots add constraint inventory_lots_remaining_check check(remaining<>'NaN'::numeric and (remaining>=0 or(item_kind='material' and source_kind='production_shortfall' and not blocked and unit_cost is null)));

create function access_private.production_stock_review(c uuid,stage text,data jsonb) returns jsonb language plpgsql stable set search_path='' as $$
declare rows jsonb;shortages jsonb;fid uuid;f public.formulas%rowtype;b public.production_batches%rowtype;n numeric;factor numeric;
begin
 if auth.uid() is null or not public.company_permission(c,'write','production') then raise exception 'Producción no autorizada' using errcode='42501';end if;
 if stage='draft' then
  fid:=(data->>'formula')::uuid;
  select * into strict f from public.formulas where company_id=c and id=fid and product_id=(data->>'product')::uuid and state<>'inactive';
  factor:=coalesce(nullif(data->>'formula_scale','')::numeric,1);
  n:=access_private.planned_production_units(f.estimated_units,factor);
  rows:=access_private.production_requirements(c,fid,factor,n);
 elsif stage='confirm' then
  select * into strict b from public.production_batches where company_id=c and id=(data->>'batch')::uuid and state='in_progress' and not confirmed;
  fid:=b.formula_id;
  if jsonb_typeof(data->'consumptions') is distinct from 'array' then raise exception 'Completa el consumo real';end if;
  if (select count(*) from jsonb_array_elements(data->'consumptions'))<>(select count(*) from public.formula_ingredients where company_id=c and formula_id=fid)
   or exists(select 1 from jsonb_array_elements(data->'consumptions')x group by x->>'material' having count(*)>1)
   or exists(select 1 from jsonb_array_elements(data->'consumptions')x
    left join public.formula_ingredients i on i.company_id=c and i.formula_id=fid and i.material_id=(x->>'material')::uuid
    left join public.units u on u.company_id=c and u.id=(x->>'unit')::uuid
    left join public.raw_materials m on m.company_id=c and m.id=i.material_id
    left join public.units bu on bu.company_id=c and bu.id=m.unit_id
    where i.material_id is null or u.id is null or u.dimension<>bu.dimension or not coalesce((x->>'quantity')::numeric>=0 and (x->>'quantity')::numeric<1e12,false))
   then raise exception 'Completa una cantidad válida por cada material de la fórmula';end if;
  select jsonb_agg(jsonb_build_object('material_id',m.id,'sku',m.sku,'name',m.name,'unit',bu.symbol,'required',(x->>'quantity')::numeric*u.base_factor/bu.base_factor))
   into rows from jsonb_array_elements(data->'consumptions')x join public.raw_materials m on m.company_id=c and m.id=(x->>'material')::uuid
   join public.units u on u.company_id=c and u.id=(x->>'unit')::uuid join public.units bu on bu.company_id=c and bu.id=m.unit_id;
 else raise exception 'Etapa no válida';end if;
 select coalesce(jsonb_agg(s.row order by s.row->>'name',s.row->>'material_id'),'[]') into shortages from(
  select r||jsonb_build_object('available',coalesce(bal.on_hand-bal.blocked-bal.reserved,0),
   'shortage',(r->>'required')::numeric-coalesce(bal.on_hand-bal.blocked-bal.reserved,0),
   'resulting_balance',coalesce(bal.on_hand-bal.blocked-bal.reserved,0)-(r->>'required')::numeric) row
  from jsonb_array_elements(coalesce(rows,'[]'))r left join public.inventory_balances bal on bal.company_id=c and bal.item_kind='material' and bal.item_id=(r->>'material_id')::uuid
  where (r->>'required')::numeric>0 and (r->>'required')::numeric>coalesce(bal.on_hand-bal.blocked-bal.reserved,0)
 )s;
 return jsonb_build_object('stage',stage,'shortages',shortages,'proof',md5(shortages::text));
end $$;
revoke all on function access_private.production_stock_review(uuid,text,jsonb) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION access_private.post_stock_selected(c uuid, k text, item uuid, q numeric, block_delta numeric, reserve_delta numeric, source text, source_uuid uuid, cost numeric, note text, selected_lot uuid, selected_unit uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare movement uuid;lot public.inventory_lots%rowtype;take numeric;needed numeric;total numeric:=0;known boolean:=true;created_lot uuid;valuation text;available_lot numeric;tracked boolean;changed integer;assigned_cost numeric;assigned_known boolean;negative_allowed boolean:=false;short_lot uuid;settling numeric;settlement jsonb:='[]';debt record;begin
 select currency into strict valuation from public.companies where id=c;
 if k='material' and source='production_consumption' and q<0 then
  select exists(select 1 from public.batch_consumptions bc join public.production_batches pb on pb.company_id=bc.company_id and pb.id=bc.batch_id
   cross join lateral jsonb_array_elements(coalesce(pb.stock_warnings#>'{confirmation,shortages}','[]'))s
   where bc.company_id=c and bc.id=source_uuid and bc.material_id=item and bc.base_quantity=-q
   and not pb.confirmed and pb.state='in_progress' and pb.stock_warnings#>>'{confirmation,user_id}'=auth.uid()::text
   and pb.stock_warnings#>>'{confirmation,acknowledged}'='true' and s->>'material_id'=item::text and (s->>'required')::numeric=-q) into negative_allowed;
 end if;
 if not negative_allowed and (q<0 or block_delta>0 or reserve_delta>0) and exists(select 1 from public.inventory_balances b where b.company_id=c and b.item_kind=k and b.item_id=item and b.on_hand+q<b.blocked+block_delta+b.reserved+reserve_delta) then raise exception 'Existencias disponibles insuficientes';end if;
 insert into public.inventory_balances(company_id,item_kind,item_id) values(c,k,item) on conflict do nothing;
 update public.inventory_balances set on_hand=on_hand+q,blocked=blocked+block_delta,reserved=reserved+reserve_delta where company_id=c and item_kind=k and item_id=item;
 insert into public.inventory_movements(company_id,item_kind,item_id,quantity,blocked_delta,reserved_delta,source_kind,source_id,notes) values(c,k,item,q,block_delta,reserve_delta,source,source_uuid,note) returning id into movement;
 if q>0 then
  if selected_lot is not null then
   update public.inventory_lots set remaining=remaining+q where company_id=c and id=selected_lot and item_kind=k and item_id=item returning id into created_lot;
   if not found then raise exception 'Lote de reversión no disponible';end if;
  else
  insert into public.inventory_lots(company_id,item_kind,item_id,remaining,currency,unit_cost,blocked,source_kind,source_id) values(c,k,item,q,valuation,cost,block_delta>0,source,source_uuid) returning id into created_lot;
  end if;
  total:=q*cost;known:=cost is not null;
  if k='material' then
   settling:=q;
   for debt in select id,remaining,source_id from public.inventory_lots where company_id=c and item_kind='material' and item_id=item and remaining<0 and id<>created_lot order by created_at,id for update loop
    take:=least(settling,-debt.remaining);exit when take<=0;
    update public.inventory_lots set remaining=remaining+take where company_id=c and id=debt.id;
    update public.inventory_lots set remaining=remaining-take where company_id=c and id=created_lot;
    settlement:=settlement||jsonb_build_array(jsonb_build_object('shortfall_lot_id',debt.id,'consumption_id',debt.source_id,'quantity',take));settling:=settling-take;
   end loop;
  end if;
 elsif q<0 then
  needed:=-q;
  for lot in select il.* from public.inventory_lots il where il.company_id=c and il.item_kind=k and il.item_id=item and not il.blocked and il.remaining>0 and (selected_lot is null or il.id=selected_lot)
   order by case when source='order_dispatch' and exists(select 1 from public.inventory_units u where u.company_id=c and u.lot_id=il.id and u.status='reserved' and u.order_line_id=source_uuid) then 0 else 1 end,il.created_at,il.id for update loop
   select exists(select 1 from public.inventory_units u where u.company_id=c and u.lot_id=lot.id) into tracked;
   available_lot:=lot.remaining;
   if tracked then
    select count(*) into available_lot from public.inventory_units u where u.company_id=c and u.lot_id=lot.id and (selected_unit is null or u.id=selected_unit) and (u.status='available' or(source='order_dispatch' and u.status='reserved' and u.order_line_id=source_uuid));
   end if;
   take:=least(needed,available_lot);if take<=0 then continue;end if;
   update public.inventory_lots set remaining=remaining-take where company_id=c and id=lot.id;
   assigned_cost:=take*lot.unit_cost;assigned_known:=lot.unit_cost is not null;
   if source='inventory_document' and k='material' and cost is not null then assigned_cost:=take*cost;assigned_known:=true;end if;
   if tracked then
    with picked as(select u.id from public.inventory_units u where u.company_id=c and u.lot_id=lot.id and (selected_unit is null or u.id=selected_unit) and (u.status='available' or(source='order_dispatch' and u.status='reserved' and u.order_line_id=source_uuid))
     order by (u.status='reserved') desc,u.created_at,u.id limit take::integer for update),
    changed_units as(
     update public.inventory_units u set status=case when source='order_dispatch' then 'sold' else 'retired' end,order_line_id=case when source='order_dispatch' then source_uuid end,last_movement_id=movement
     from picked where u.company_id=c and u.id=picked.id
     returning case when u.cost_snapshot is not null then (u.cost_snapshot->>'manufacturing_cost')::numeric else lot.unit_cost end applied_cost)
    select count(*),sum(applied_cost),bool_and(applied_cost is not null) into changed,assigned_cost,assigned_known from changed_units;
    if changed<>take then raise exception 'No se pudo conservar la asignación individual del inventario';end if;
    if lot.remaining>take and exists(select 1 from public.inventory_units un where un.company_id=c and un.lot_id=lot.id and un.cost_snapshot is not null) then
     update public.inventory_lots il set unit_cost=(
      select case when bool_and(case when un.cost_snapshot is null then lot.unit_cost else (un.cost_snapshot->>'manufacturing_cost')::numeric end is not null)
       then sum(case when un.cost_snapshot is null then lot.unit_cost else (un.cost_snapshot->>'manufacturing_cost')::numeric end)/count(*) end
      from public.inventory_units un where un.company_id=c and un.lot_id=lot.id and un.status not in('sold','retired'))
     where il.company_id=c and il.id=lot.id;
    end if;
   end if;
   insert into public.inventory_allocations(company_id,movement_id,lot_id,quantity,unit_cost,currency) values(c,movement,lot.id,take,case when assigned_known then assigned_cost/take end,lot.currency);
   if not assigned_known or lot.currency<>valuation then known:=false;else total:=total+assigned_cost;end if;
   needed:=needed-take;exit when needed=0;
  end loop;
  if needed<>0 then
   if not negative_allowed then raise exception 'No hay lotes disponibles suficientes';end if;
   insert into public.inventory_lots(company_id,item_kind,item_id,remaining,currency,unit_cost,blocked,source_kind,source_id,label)
   values(c,'material',item,-needed,valuation,null,false,'production_shortfall',source_uuid,'Faltante de producción confirmado') returning id into short_lot;
   insert into public.inventory_allocations(company_id,movement_id,lot_id,quantity,unit_cost,currency) values(c,movement,short_lot,needed,null,valuation);
   known:=false;needed:=0;
  end if;
 end if;
 if k='variant' and reserve_delta>0 then
  with picked as(select u.id from public.inventory_units u join public.inventory_lots l on l.company_id=u.company_id and l.id=u.lot_id where u.company_id=c and u.variant_id=item and u.status='available' and not l.blocked order by l.created_at,l.id,u.created_at,u.id limit reserve_delta::integer for update of u)
  update public.inventory_units u set status='reserved',order_line_id=source_uuid,last_movement_id=movement from picked where u.company_id=c and u.id=picked.id;
 elsif k='variant' and reserve_delta<0 then
  update public.inventory_units set status='available',order_line_id=null,last_movement_id=movement where company_id=c and variant_id=item and status='reserved' and order_line_id=source_uuid;
 end if;
 if k='variant' and source='release' and block_delta<0 then
  update public.inventory_units set status='available',last_movement_id=movement where company_id=c and variant_id=item and output_id=source_uuid and status='curing';
 end if;
 update public.inventory_movements im set effective_on=(ctx.data->>'effective_on')::date,unit_cost=case when known and q<>0 then total/abs(q) end,total_value=case when q=0 then 0 when known then sign(q)*total end,currency=valuation,snapshot=ctx.data||jsonb_build_object('negative_stock_acknowledged',negative_allowed,'shortfall_settlements',settlement),captured=true,
 document_id=case when source='inventory_document' then (select l.document_id from public.inventory_document_lines l where l.company_id=c and l.id=source_uuid) end,
 document_line_id=case when source='inventory_document' then source_uuid end
 from (select access_private.inventory_context(c,k,item,source,source_uuid,clock_timestamp()) data)ctx where im.company_id=c and im.id=movement;
 return jsonb_build_object('movement',movement,'lot',created_lot,'cost',case when known then total else null end);
end $function$
;
CREATE OR REPLACE FUNCTION access_private.batch_trace_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$begin
 perform pg_advisory_xact_lock(hashtextextended(new.company_id::text,0));
 if tg_op='INSERT' then
  if new.batch_number is null then select coalesce(max(batch_number),0)+1 into new.batch_number from public.production_batches where company_id=new.company_id;end if;
  if new.confirmed or new.recipe_snapshot is not null or new.state not in('draft','in_progress') then raise exception 'El lote se confirma desde Producción';end if;
 else
  if row(new.id,new.company_id,new.batch_number) is distinct from row(old.id,old.company_id,old.batch_number) then raise exception 'La identidad del lote no cambia';end if;
  if old.confirmed then
   if (to_jsonb(new)-array['state','release_note']) is distinct from(to_jsonb(old)-array['state','release_note']) then raise exception 'El lote confirmado y su receta histórica son inmutables';end if;
   if new.state<>old.state and not(old.state='curing' and new.state='released') then raise exception 'Transición no válida para un lote confirmado';end if;
  elsif new.state='curing' then
   if old.state<>'in_progress' or new.formula_id is null or new.finish_payload is null then raise exception 'Completa la versión y los consumos antes de confirmar';end if;
   new.recipe_snapshot:=access_private.batch_recipe_snapshot(new.company_id,new.id,new.formula_id,new.product_id,new.formula_scale,new.finish_payload,new.currency,new.total_cost);
   if new.recipe_snapshot is null or jsonb_array_length(new.recipe_snapshot->'lines')<>(select count(*) from public.formula_ingredients where company_id=new.company_id and formula_id=new.formula_id) then raise exception 'No se pudo conservar la receta completa; no se confirmó la producción';end if;
   
   if (select production_mode from public.formulas where company_id=new.company_id and id=new.formula_id)='variable_weight' then
    if new.finish_payload#>>'{_server_cost_plan,batch_id}' is distinct from new.id::text or (new.finish_payload#>>'{_server_cost_plan,unit_count}')::numeric is distinct from new.actual_quantity then raise exception 'No se pudo conservar el reparto de costos por peso';end if;
    new.recipe_snapshot:=new.recipe_snapshot||jsonb_build_object('production_mode','variable_weight','weight_costs',new.finish_payload->'_server_cost_plan',
     'estimated_total_cost',new.finish_payload#>'{_server_cost_plan,total_cost}',
     'estimated_unit_cost',(new.finish_payload#>>'{_server_cost_plan,total_cost}')::numeric/nullif(new.actual_quantity,0));
   else
   new.recipe_snapshot:=new.recipe_snapshot||jsonb_build_object('additional_costs',access_private.additional_cost_quote(new.company_id,new.actual_quantity,(select f.estimate_variant_id from public.formulas f where f.company_id=new.company_id and f.id=new.formula_id),(select f.labor_level_id from public.formulas f where f.company_id=new.company_id and f.id=new.formula_id),(select f.advertising_level_id from public.formulas f where f.company_id=new.company_id and f.id=new.formula_id),coalesce((select jsonb_agg(jsonb_build_object('cost_id',ol.cost_id,'quantity',ol.quantity,'percent',ol.percent)) from public.formula_overhead_lines ol where ol.company_id=new.company_id and ol.formula_id=new.formula_id),'[]')));
   
   new.recipe_snapshot:=jsonb_set(new.recipe_snapshot,'{additional_costs}',(new.recipe_snapshot->'additional_costs')||jsonb_build_object('unit_basis_count',coalesce(nullif(new.actual_quantity,0),(new.recipe_snapshot#>>'{additional_costs,estimated_units}')::numeric),'overhead_unit',(new.recipe_snapshot#>>'{additional_costs,overhead_total}')::numeric/coalesce(nullif(new.actual_quantity,0),(new.recipe_snapshot#>>'{additional_costs,estimated_units}')::numeric),'additional_unit',(new.recipe_snapshot#>>'{additional_costs,additional_total}')::numeric/coalesce(nullif(new.actual_quantity,0),(new.recipe_snapshot#>>'{additional_costs,estimated_units}')::numeric)));
   new.recipe_snapshot:=new.recipe_snapshot||jsonb_build_object('estimated_total_cost',new.total_cost+(new.recipe_snapshot#>>'{additional_costs,additional_total}')::numeric,'estimated_unit_cost',(new.total_cost+(new.recipe_snapshot#>>'{additional_costs,additional_total}')::numeric)/nullif((new.recipe_snapshot#>>'{additional_costs,unit_basis_count}')::numeric,0));
   end if;
   update public.additional_cost_catalog x set used_in_history=true where x.company_id=new.company_id and not x.used_in_history and ((exists(select 1 from public.formula_overhead_lines ol where ol.company_id=new.company_id and ol.formula_id=new.formula_id and ol.cost_id=x.id)) or x.id in(select f.labor_level_id from public.formulas f where f.company_id=new.company_id and f.id=new.formula_id union all select f.advertising_level_id from public.formulas f where f.company_id=new.company_id and f.id=new.formula_id));
   new.recipe_snapshot:=new.recipe_snapshot||jsonb_build_object('curing',jsonb_build_object('required',coalesce(new.requires_curing,true),'days',new.curing_days,'available_on',new.available_on));
   new.recipe_snapshot:=new.recipe_snapshot||jsonb_build_object('stock_warnings',new.stock_warnings);
   new.confirmed:=true;new.confirmed_at:=now();
  elsif new.confirmed or new.recipe_snapshot is not null then raise exception 'La confirmación requiere el registro transaccional de consumos';end if;
 end if;return new;
end $function$
;
CREATE OR REPLACE FUNCTION access_private.production_requirements(c uuid, fid uuid, factor numeric, n numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$begin
 if auth.uid() is null or not(case when fid is not null then public.company_permission(c,'read','production') else public.company_permission(c,'read','reports') and public.company_permission(c,'read','inventory') end) then raise exception 'Requerimientos no autorizados' using errcode='42501';end if;
 if factor is null or not(factor>0 and factor<=1e6) or (n is not null and not(n>0 and n<1e12)) then raise exception 'Escala o unidades no válidas';end if;
 if fid is not null and not exists(select 1 from public.formulas f where f.company_id=c and f.id=fid) then raise exception 'Fórmula no disponible';end if;
 return coalesce((with selected as (
  select f.id,factor scale,coalesce(n,f.estimated_units*factor) units from public.formulas f where f.company_id=c and f.id=fid
  union all
  select pb.formula_id,pb.formula_scale,pb.planned_quantity::numeric from public.production_batches pb where fid is null and pb.company_id=c and pb.state in('draft','in_progress') and not pb.confirmed and pb.formula_id is not null
 ), needed as (
  select i.material_id,array_agg(distinct i.line_kind) kinds,bool_or(qty.q is null) pending,sum(qty.q*u.base_factor/bu.base_factor) required
  from selected s join public.formula_ingredients i on i.company_id=c and i.formula_id=s.id
  join public.units u on u.company_id=c and u.id=i.unit_id
  join public.raw_materials m on m.company_id=c and m.id=i.material_id
  join public.units bu on bu.company_id=c and bu.id=m.unit_id
  cross join lateral(select access_private.planned_material_quantity(i.quantity,i.quantity_basis,s.scale,s.units) q)qty
  group by i.material_id
 ), rows as (
  select m.id material_id,m.name,m.sku,bu.symbol unit,k.kinds,case when k.pending then null else k.required end required,
   coalesce(b.on_hand-b.blocked-b.reserved,0) available,
   case when k.pending then null else greatest(0,k.required-coalesce(b.on_hand-b.blocked-b.reserved,0)) end shortage
  from needed k join public.raw_materials m on m.company_id=c and m.id=k.material_id
  join public.units bu on bu.company_id=c and bu.id=m.unit_id
  left join public.inventory_balances b on b.company_id=c and b.item_kind='material' and b.item_id=m.id
 ) select jsonb_agg(to_jsonb(rows) order by name) from rows),'[]'::jsonb);
end $function$
;
CREATE OR REPLACE FUNCTION access_private.inventory_command(c uuid, action text, data jsonb, k uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare review jsonb;r jsonb;answer jsonb;cached access_private.operation_requests%rowtype;docid uuid;lineid uuid;move jsonb;lotid uuid;unitid uuid;n bigint;sgn numeric;items jsonb;total bigint;page integer;
begin
 if auth.uid() is null or not public.company_permission(c,case when action in('review','confirm') then 'write' else 'read' end,'inventory') then raise exception 'No tienes permiso para esta empresa';end if;
 if action='catalog' then
  return jsonb_build_object(
   'materials',(select coalesce(jsonb_agg(to_jsonb(m)||jsonb_build_object('suggested_cost',(select s.unit_price*bu.base_factor/s.base_factor from public.material_sheet s join public.units bu on bu.company_id=c and bu.id=m.unit_id where s.company_id=c and s.raw_material_id=m.id and s.active and s.effective_on<=current_date and s.currency=cp.currency and s.unit_price is not null order by s.effective_on desc,s.price_created_at desc limit 1)) order by m.name),'[]') from public.raw_materials m join public.companies cp on cp.id=c where m.company_id=c),
   'variants',(select coalesce(jsonb_agg(to_jsonb(v)||jsonb_build_object('product_name',p.name,'label',access_private.variant_label(to_jsonb(v)),'suggested_cost',(select l.unit_cost from public.inventory_lots l where l.company_id=c and l.item_kind='variant' and l.item_id=v.id and l.unit_cost is not null order by l.created_at desc limit 1)) order by p.name),'[]') from public.product_variants v join public.products p on p.company_id=v.company_id and p.id=v.product_id where v.company_id=c),
   'units',(select coalesce(jsonb_agg(to_jsonb(u) order by u.name),'[]') from public.units u where u.company_id=c and u.active),
   'lots',(select coalesce(jsonb_agg(to_jsonb(l) order by l.created_at),'[]') from public.inventory_lots l where l.company_id=c),
   'physical',(select coalesce(jsonb_agg(to_jsonb(u) order by u.created_at),'[]') from public.inventory_units u where u.company_id=c and u.status='available'));
 elsif action='review' then
  review:=access_private.inventory_document_review(c,data);return review||jsonb_build_object('proof',md5(review::text));
 elsif action='confirm' then
  if k is null then raise exception 'Falta identificador de operación';end if;
  perform pg_advisory_xact_lock(hashtextextended(c::text,0));
  if not public.company_permission(c,'write','inventory') then raise exception 'Permiso revocado';end if;
  select * into cached from access_private.operation_requests where company_id=c and key=k;
  if found then if cached.action<>'inventory_confirm' or cached.payload<>data then raise exception 'Identificador de operación utilizado con otros datos';end if;return cached.result;end if;
  review:=access_private.inventory_document_review(c,data);
  if data->>'proof' is distinct from md5(review::text) then raise exception 'Los datos o las existencias cambiaron. Revisa nuevamente antes de confirmar';end if;
  if jsonb_array_length(review->'warnings')>0 and coalesce((data->>'acknowledged')::boolean,false)=false then raise exception 'Confirma las advertencias antes de continuar';end if;
  insert into access_private.inventory_document_counters(company_id,last_value) values(c,1) on conflict(company_id) do update set last_value=inventory_document_counters.last_value+1 returning last_value into n;
  insert into public.inventory_documents(company_id,number,kind,effective_on,reason,notes,reverses_id,corrects_id,created_by) values(c,n,review->>'kind',(review->>'date')::date,review->>'reason',review->>'notes',(review->>'reverses_id')::uuid,(review->>'corrects_id')::uuid,auth.uid()) returning id into docid;
  for r in select value from jsonb_array_elements(review->'lines') loop
   lineid:=case when review->>'kind'='reversal' then gen_random_uuid() else (r->>'line_key')::uuid end;sgn:=(r->>'direction')::numeric;
   insert into public.inventory_document_lines(id,company_id,document_id,line_number,item_kind,item_id,material_id,variant_id,input_unit_id,quantity,base_quantity,unit_cost,base_unit_cost,total_value,currency,lot_id,individual_unit_id,weight,external_code,notes,snapshot)
   values(lineid,c,docid,(r->>'line_number')::integer,r->>'item_kind',(r->>'item_id')::uuid,(r->>'material_id')::uuid,(r->>'variant_id')::uuid,(r->>'input_unit_id')::uuid,(r->>'quantity')::numeric,(r->>'base_quantity')::numeric,(r->>'unit_cost')::numeric,(r->>'base_unit_cost')::numeric,(r->>'total_value')::numeric,r->>'currency',(r->>'lot_id')::uuid,(r->>'individual_unit_id')::uuid,(r->>'weight')::numeric,r->>'external_code',r->>'notes',r->'snapshot');
   move:=access_private.post_stock_selected(c,r->>'item_kind',(r->>'item_id')::uuid,sgn*(r->>'base_quantity')::numeric,0,0,'inventory_document',lineid,(r->>'base_unit_cost')::numeric,r->>'notes',(r->>'lot_id')::uuid,(r->>'individual_unit_id')::uuid);
   lotid:=coalesce((move->>'lot')::uuid,(r->>'lot_id')::uuid);unitid:=(r->>'individual_unit_id')::uuid;
   update public.inventory_document_lines set movement_id=(move->>'movement')::uuid,lot_id=lotid where company_id=c and id=lineid;
   if sgn=1 then
    if review->>'kind'<>'reversal' then update public.inventory_lots set label=r->>'lot_label' where company_id=c and id=lotid;end if;
    if unitid is not null then
     update public.inventory_units set status='available',last_movement_id=(move->>'movement')::uuid where company_id=c and id=unitid;
    elsif r->>'item_kind'='variant' and r->>'weight' is not null then
     insert into public.inventory_units(company_id,lot_id,variant_id,weight,variant_snapshot,cost_snapshot,status,last_movement_id,external_code)
     select c,lotid,v.id,(r->>'weight')::numeric,to_jsonb(v)||jsonb_build_object('name',access_private.variant_label(to_jsonb(v)),'product_name',p.name,'origin_document',docid),jsonb_build_object('manufacturing_cost',(r->>'base_unit_cost')::numeric,'currency',r->>'currency','cost_basis','inventory_document'),'available',(move->>'movement')::uuid,r->>'external_code' from public.product_variants v join public.products p on p.company_id=v.company_id and p.id=v.product_id where v.company_id=c and v.id=(r->>'item_id')::uuid returning id into unitid;
     update public.inventory_document_lines set individual_unit_id=unitid where company_id=c and id=lineid;
    end if;
   end if;
  end loop;
  update public.inventory_documents set state='confirmed' where company_id=c and id=docid;
  answer:=jsonb_build_object('id',docid,'number',n,'state','confirmed');
  insert into access_private.operation_requests(company_id,key,action,payload,result) values(c,k,'inventory_confirm',data,answer);return answer;
 elsif action='source' then
  select x into r from access_private.inventory_ledger_rows(c)x where x->>'id'=data->>'id';
  if r is null then raise exception 'Movimiento no disponible';end if;
  return jsonb_build_object('movement',r,'lines',(select jsonb_agg(x order by x->>'created_at') from access_private.inventory_ledger_rows(c)x where x->>'source_document_id'=r->>'source_document_id'),
  'reference',case when r->>'source_kind'='receipt' then(select pr.reference from public.purchase_receipts pr where pr.company_id=c and pr.id=(r->>'source_id')::uuid) else r->>'document_number' end);
 elsif action='detail' then
  return jsonb_build_object('header',(select to_jsonb(d) from public.inventory_documents d where d.company_id=c and d.id=(data->>'id')::uuid),'lines',(select coalesce(jsonb_agg(to_jsonb(l) order by l.line_number),'[]') from public.inventory_document_lines l where l.company_id=c and l.document_id=(data->>'id')::uuid),'reversal',(select id from public.inventory_documents where company_id=c and reverses_id=(data->>'id')::uuid));
 elsif action='ledger' then
  page:=greatest(coalesce((data->>'page')::integer,0),0);
  with ledger as materialized(select x from access_private.inventory_ledger_rows(c)x),filtered as(
   select x from ledger where (nullif(data->>'from','') is null or (x->>'date')::date>=(data->>'from')::date) and (nullif(data->>'to','') is null or (x->>'date')::date<=(data->>'to')::date)
   and(nullif(data->>'kind','') is null or x->>'item_kind'=data->>'kind') and(nullif(data->>'item','') is null or x->>'item_id'=data->>'item')
   and(nullif(data->>'lot','') is null or x->'lots' ? (data->>'lot')) and(nullif(data->>'source','') is null or x->>'source_kind'=data->>'source')
   and(nullif(data->>'type','') is null or x->>'movement_type'=data->>'type')
   and(nullif(data->>'query','') is null or concat_ws(' ',x->>'sku',x->>'name',x->>'variant',x->>'document_number',x->'units') ilike '%'||(data->>'query')||'%'))
  select jsonb_build_object('total',(select count(*) from filtered),'rows',(select coalesce(jsonb_agg(x order by x->>'date' desc,x->>'created_at' desc,x->>'id' desc),'[]') from(select x from filtered order by x->>'date' desc,x->>'created_at' desc,x->>'id' desc limit 100 offset page*100)s),
  'stock',(select coalesce(jsonb_agg(jsonb_build_object('item_kind',b.item_kind,'item_id',b.item_id,'on_hand',b.on_hand,'blocked',b.blocked,'reserved',b.reserved,'available',b.on_hand-b.blocked-b.reserved,'known_value',(select sum(l.remaining*l.unit_cost) from public.inventory_lots l where l.company_id=c and l.item_kind=b.item_kind and l.item_id=b.item_id),'pending_cost',(select coalesce(sum(abs(l.remaining)),0) from public.inventory_lots l where l.company_id=c and l.item_kind=b.item_kind and l.item_id=b.item_id and l.unit_cost is null))),'[]') from public.inventory_balances b where b.company_id=c)) into answer;return answer;
 end if;
 raise exception 'Acción no válida';
end $function$
;

CREATE OR REPLACE FUNCTION access_private.production_command(c uuid, action text, k uuid DEFAULT NULL::uuid, data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b public.production_batches%rowtype;f public.formulas%rowtype;cached access_private.operation_requests%rowtype;bid uuid;pid uuid;fid uuid;answer jsonb;stock_review jsonb;begin
 if auth.uid() is null or not public.company_permission(c,case when action in('list','detail') then 'read' else 'write' end,'production') then raise exception 'Producción no autorizada' using errcode='42501';end if;
 if action='stock_review' then return access_private.production_stock_review(c,data->>'stage',data);end if;
 if action='list' then return coalesce((select jsonb_agg(to_jsonb(pb)||jsonb_build_object('product_name',coalesce(pb.recipe_snapshot#>>'{product,name}',p.name),'formula_code',coalesce(pb.recipe_snapshot#>>'{formula,code}',ff.code),'formula_name',coalesce(pb.recipe_snapshot#>>'{formula,name}',revision.name),'formula_version',coalesce((pb.recipe_snapshot#>>'{formula,version}')::integer,revision.version),'outputs',coalesce((select jsonb_agg(to_jsonb(o)||jsonb_build_object('variant_name',pv.name)) from public.batch_outputs o join public.product_variants pv on pv.company_id=o.company_id and pv.id=o.variant_id where o.company_id=c and o.batch_id=pb.id),'[]')) order by pb.batch_number desc) from public.production_batches pb join public.products p on p.company_id=pb.company_id and p.id=pb.product_id left join public.formulas revision on revision.company_id=pb.company_id and revision.id=pb.formula_id left join public.formula_families ff on ff.company_id=revision.company_id and ff.id=revision.family_id where pb.company_id=c),'[]');end if;
 if action='detail' then
  select * into strict b from public.production_batches where company_id=c and id=(data->>'id')::uuid;
  return jsonb_build_object('batch',to_jsonb(b),'snapshot',b.recipe_snapshot,'legacy_consumptions',case when b.confirmed and b.recipe_snapshot is null then coalesce((select jsonb_agg(jsonb_build_object('material_id',material_id,'base_quantity',base_quantity,'cost',cost)) from public.batch_consumptions where company_id=c and batch_id=b.id),'[]') else '[]'::jsonb end);
 end if;
 if action not in('draft_save','start') or k is null then raise exception 'Acción de lote inválida';end if;
 perform pg_advisory_xact_lock(hashtextextended(c::text,0));
 select * into cached from access_private.operation_requests where company_id=c and key=k;
 if found then if cached.action<>'production_'||action or cached.payload<>data then raise exception 'Identificador utilizado con otros datos';end if;return cached.result;end if;
 if action='draft_save' then
  stock_review:=access_private.production_stock_review(c,'draft',data);
  if jsonb_array_length(stock_review->'shortages')>0 and (coalesce((data->>'acknowledge_shortages')::boolean,false)=false or data->>'stock_proof' is distinct from stock_review->>'proof') then raise exception 'Hay materiales insuficientes o cambiaron las existencias. Revisa la advertencia y confirma si deseas guardar el borrador';end if;
 end if;
 bid:=nullif(data->>'id','')::uuid;
 if bid is not null then select * into strict b from public.production_batches where company_id=c and id=bid;end if;
 if action='start' then
  if b.id is null or b.state<>'draft' then raise exception 'Selecciona un lote borrador';end if;
  if b.formula_id is null then raise exception 'Selecciona una versión válida antes de preparar el lote';end if;
  select * into strict f from public.formulas where company_id=c and id=b.formula_id and product_id=b.product_id and state<>'inactive';
  update public.production_batches set state='in_progress',requires_curing=f.requires_curing,curing_days=f.curing_days,available_on=b.production_date+f.curing_days,planned_quantity=access_private.planned_production_units(f.estimated_units,b.formula_scale) where company_id=c and id=bid;
 else
  if b.id is not null and b.state<>'draft' then raise exception 'Solo puedes editar un lote borrador';end if;
  pid:=(data->>'product')::uuid;fid:=nullif(data->>'formula','')::uuid;
  perform 1 from public.products where company_id=c and id=pid and active;if not found then raise exception 'Producto no disponible';end if;
  if fid is null then raise exception 'Selecciona una fórmula con unidades estimadas';end if;
  select * into f from public.formulas where company_id=c and id=fid and product_id=pid and state<>'inactive';if not found then raise exception 'La versión no corresponde al producto o está inactiva';end if;
  if b.id is null then
   insert into public.production_batches(company_id,product_id,formula_id,planned_quantity,formula_scale,production_date,available_on,currency,notes,state,requires_curing,curing_days)
   values(c,pid,fid,access_private.planned_production_units(f.estimated_units,coalesce(nullif(data->>'formula_scale','')::numeric,1)),coalesce((data->>'formula_scale')::numeric,1),(data->>'date')::date,(data->>'date')::date+f.curing_days,(select currency from public.companies where id=c),left(coalesce(data->>'notes',''),1000),'draft',f.requires_curing,f.curing_days) returning id into bid;
  else
   update public.production_batches set product_id=pid,formula_id=fid,requires_curing=f.requires_curing,curing_days=f.curing_days,planned_quantity=access_private.planned_production_units(f.estimated_units,coalesce(nullif(data->>'formula_scale','')::numeric,1)),formula_scale=coalesce((data->>'formula_scale')::numeric,1),production_date=(data->>'date')::date,available_on=(data->>'date')::date+f.curing_days,notes=left(coalesce(data->>'notes',''),1000) where company_id=c and id=bid;
  end if;
 end if;
 if action='draft_save' then update public.production_batches set stock_warnings=jsonb_set(stock_warnings,'{draft}',stock_review||jsonb_build_object('acknowledged',coalesce((data->>'acknowledge_shortages')::boolean,false),'user_id',auth.uid(),'recorded_at',clock_timestamp())) where company_id=c and id=bid;end if;
 answer:=jsonb_build_object('id',bid);
 insert into access_private.operation_requests(company_id,key,action,payload,result) values(c,k,'production_'||action,data,answer);return answer;
end $function$
;
CREATE OR REPLACE FUNCTION access_private.operations(p_company uuid, p_action text, p_key uuid DEFAULT NULL::uuid, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare module text; cached access_private.operation_requests%rowtype; v_result jsonb:='{}'; r jsonb; x record; m public.raw_materials%rowtype; u public.units%rowtype; base public.units%rowtype; v public.product_variants%rowtype; b public.production_batches%rowtype; f public.formulas%rowtype; q numeric; converted numeric; amount numeric; rate numeric; v_id uuid; parent uuid; code text; n bigint; total numeric:=0; known boolean:=true; weight_sum numeric:=0; qty_sum integer:=0; v_kind text; price_currency text; weighed_item jsonb; weighed_sum numeric; weighed_value numeric;variable_plan jsonb;stock_review jsonb;
begin
 module:=case when p_action in('variants','variant_save','presentation_codes') then 'catalog' when p_action in('inventory','receive','adjust','receipts') then 'inventory' when p_action in('formulas','formula_create','batches','batch_start','batch_finish','batch_release','production_catalog') then 'production' else null end;
 if auth.uid() is null or module is null or not access_private.company_permission(p_company,case when p_action in('variants','inventory','receipts','formulas','batches','production_catalog') then 'read' else 'write' end,module) then raise exception 'Operación no autorizada para esta empresa' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company::text,0));
 if not access_private.company_permission(p_company,case when p_action in('variants','inventory','receipts','formulas','batches','production_catalog') then 'read' else 'write' end,module) then raise exception 'Permiso revocado' using errcode='42501';end if;
 if p_action='inventory' then
  return jsonb_build_object('balances',coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('name',case when s.item_kind='material' then rm.name else pr.name||' · '||access_private.variant_label(to_jsonb(pv)) end,'sku',case when s.item_kind='material' then rm.sku else pv.sku end,'barcode',case when s.item_kind='material' then rm.barcode else pv.barcode end,'unit',case when s.item_kind='material' then un.symbol else 'ud' end,'classification',rm.classification,'origin_id',case when s.item_kind='material' then rm.origin_id else pr.origin_id end,'available',s.on_hand-s.blocked-s.reserved)) from public.inventory_balances s left join public.raw_materials rm on rm.company_id=s.company_id and rm.id=s.item_id and s.item_kind='material' left join public.units un on un.company_id=rm.company_id and un.id=rm.unit_id left join public.product_variants pv on pv.company_id=s.company_id and pv.id=s.item_id and s.item_kind='variant' left join public.products pr on pr.company_id=pv.company_id and pr.id=pv.product_id where s.company_id=p_company),'[]'),'materials',coalesce((select jsonb_agg(jsonb_build_object('id',rm.id,'name',rm.name,'unit_id',rm.unit_id,'sku',rm.sku)) from public.raw_materials rm where rm.company_id=p_company and rm.active),'[]'),'variants',coalesce((select jsonb_agg(jsonb_build_object('id',pv.id,'name',p.name||' · '||access_private.variant_label(to_jsonb(pv)),'sku',pv.sku,'product_id',pv.product_id,'attributes',pv.attributes,'weight_min',pv.weight_min,'weight_max',pv.weight_max)) from public.product_variants pv join public.products p on p.company_id=pv.company_id and p.id=pv.product_id where pv.company_id=p_company and pv.active),'[]'),'units',coalesce((select jsonb_agg(to_jsonb(un)) from public.units un where un.company_id=p_company and active),'[]'),'suppliers',coalesce((select jsonb_agg(jsonb_build_object('id',suppliers.id,'name',suppliers.name)) from public.suppliers where company_id=p_company and active),'[]'),'movements',coalesce((select jsonb_agg(to_jsonb(z)) from(select * from public.inventory_movements where company_id=p_company order by created_at desc limit 100)z),'[]'));
 elsif p_action='variants' then return coalesce((select jsonb_agg(to_jsonb(pv)||jsonb_build_object('currency',(select currency from public.companies where id=p_company),'price',access_private.base_sale_price(pv.company_id,pv.id),'available',coalesce(s.on_hand-s.blocked-s.reserved,0),'on_hand',coalesce(s.on_hand,0),'blocked',coalesce(s.blocked,0))) from public.product_variants pv left join public.inventory_balances s on s.company_id=pv.company_id and s.item_id=pv.id and s.item_kind='variant' where pv.company_id=p_company and pv.product_id=(p_data->>'product')::uuid),'[]');
 elsif p_action='receipts' then return coalesce((select jsonb_agg(to_jsonb(z)) from(select rc.*,rm.name as material_name from public.purchase_receipts rc join public.raw_materials rm on rm.company_id=rc.company_id and rm.id=rc.material_id where rc.company_id=p_company order by rc.created_at desc limit 100)z),'[]');
 elsif p_action='formulas' then return coalesce((select jsonb_agg(to_jsonb(fm)||jsonb_build_object('product_name',p.name,'ingredients',(select jsonb_agg(to_jsonb(i)||jsonb_build_object('name',rm.name,'unit',un.symbol)) from public.formula_ingredients i join public.raw_materials rm on rm.company_id=i.company_id and rm.id=i.material_id join public.units un on un.company_id=i.company_id and un.id=i.unit_id where i.company_id=fm.company_id and i.formula_id=fm.id))) from public.formulas fm join public.products p on p.company_id=fm.company_id and p.id=fm.product_id where fm.company_id=p_company),'[]');
 elsif p_action='batches' then return coalesce((select jsonb_agg(to_jsonb(pb)||jsonb_build_object('product_name',p.name,'outputs',coalesce((select jsonb_agg(to_jsonb(o)||jsonb_build_object('variant_name',access_private.variant_label(to_jsonb(pv)))) from public.batch_outputs o join public.product_variants pv on pv.company_id=o.company_id and pv.id=o.variant_id where o.company_id=pb.company_id and o.batch_id=pb.id),'[]'))) from public.production_batches pb join public.products p on p.company_id=pb.company_id and p.id=pb.product_id where pb.company_id=p_company),'[]');
 elsif p_action='production_catalog' then return jsonb_build_object('products',coalesce((select jsonb_agg(jsonb_build_object('id',products.id,'name',products.name)) from public.products where company_id=p_company and active),'[]'),'materials',coalesce((select jsonb_agg(jsonb_build_object('id',raw_materials.id,'name',raw_materials.name,'unit_id',raw_materials.unit_id)) from public.raw_materials where company_id=p_company and active),'[]'),'units',coalesce((select jsonb_agg(to_jsonb(un)) from public.units un where un.company_id=p_company and active),'[]'),'variants',coalesce((select jsonb_agg(to_jsonb(pv)) from public.product_variants pv where company_id=p_company and active),'[]'));
 end if;
 if p_key is null then raise exception 'Falta identificador de operación';end if;
 select * into cached from access_private.operation_requests where company_id=p_company and key=p_key;
 if found then if cached.action<>p_action or cached.payload<>p_data then raise exception 'La clave de operación ya se utilizó con otros datos';end if;return cached.result;end if;
 insert into access_private.operation_requests(company_id,key,action,payload) values(p_company,p_key,p_action,p_data);
 if p_action='variant_save' then
  parent:=(p_data->>'product')::uuid;select * into strict x from public.products where company_id=p_company and products.id=parent and active;
  v_id:=nullif(p_data->>'id','')::uuid;code:=case when v_id is null then null else (select sku from public.product_variants where company_id=p_company and product_id=parent and id=v_id) end;
 if v_id is not null and p_data ? 'sku' and nullif(trim(p_data->>'sku'),'') is distinct from code then raise exception 'El SKU es automático. Utiliza Código comercial';end if;
  if v_id is null and code is null then
   if x.sku is null then update public.products set sku=catalog_private.reserve_sku(p_company,'P') where company_id=p_company and products.id=parent returning * into x;end if;
   loop
    insert into access_private.child_code_counters(company_id,kind,parent_id,last_value) values(p_company,'variant',parent,1) on conflict(company_id,kind,parent_id) do update set last_value=access_private.child_code_counters.last_value+1 returning last_value into n;
    code:=x.sku||'-'||case when n<100 then lpad(n::text,2,'0') else n::text end;
    exit when not exists(select 1 from public.catalog_identifiers where company_id=p_company and (public.catalog_key(sku)=public.catalog_key(code) or public.catalog_key(barcode)=public.catalog_key(code)));
   end loop;
  end if;
  if v_id is null then
   insert into public.product_variants(company_id,product_id,name,commercial_code,sku,barcode,barcode_custom,attributes,weight_min,weight_max,price,currency,published,allow_preorder,active) values(p_company,parent,coalesce(trim(p_data->>'name'),''),nullif(trim(p_data->>'commercial_code'),''),code,nullif(trim(p_data->>'barcode'),''),coalesce((p_data->>'barcode_custom')::boolean,false),access_private.normalize_attributes(coalesce(p_data->'attributes','{}')),nullif(p_data->>'weight_min','')::numeric,nullif(p_data->>'weight_max','')::numeric,null::numeric,(select currency from public.companies where companies.id=p_company),coalesce((p_data->>'published')::boolean,false),coalesce((p_data->>'allow_preorder')::boolean,false),coalesce((p_data->>'active')::boolean,true)) returning product_variants.id into v_id;
  else
   update public.product_variants set name=coalesce(trim(p_data->>'name'),''),commercial_code=case when p_data ? 'commercial_code' then nullif(trim(p_data->>'commercial_code'),'') else commercial_code end,sku=code,barcode=nullif(trim(p_data->>'barcode'),''),barcode_custom=coalesce((p_data->>'barcode_custom')::boolean,false),attributes=access_private.normalize_attributes(coalesce(p_data->'attributes','{}')),weight_min=nullif(p_data->>'weight_min','')::numeric,weight_max=nullif(p_data->>'weight_max','')::numeric,currency=(select currency from public.companies where companies.id=p_company),published=coalesce((p_data->>'published')::boolean,false),active=coalesce((p_data->>'active')::boolean,true),allow_preorder=coalesce((p_data->>'allow_preorder')::boolean,false) where company_id=p_company and product_id=parent and product_variants.id=v_id;
   if not found then raise exception 'Variante no disponible';end if;
  end if;v_result:=jsonb_build_object('id',v_id);
 elsif p_action='presentation_codes' then
  v_id:=(p_data->>'id')::uuid;
  update public.presentations set sku=nullif(trim(p_data->>'sku'),''),barcode=nullif(trim(p_data->>'barcode'),''),barcode_custom=coalesce((p_data->>'barcode_custom')::boolean,false),alternative_name=coalesce(p_data->>'alternative_name','') where company_id=p_company and presentations.id=v_id;
  if not found then raise exception 'Presentación no disponible';end if;v_result:=jsonb_build_object('id',v_id);
 elsif p_action='receive' then
  select * into strict m from public.raw_materials where company_id=p_company and raw_materials.id=(p_data->>'material')::uuid and active;
  select * into strict u from public.units where company_id=p_company and units.id=(p_data->>'unit')::uuid and active;
  select * into strict base from public.units where company_id=p_company and units.id=m.unit_id;
  if u.dimension<>base.dimension then raise exception 'No se puede convertir entre masa, volumen y conteo sin una conversión definida';end if;
  q:=(p_data->>'quantity')::numeric;amount:=(p_data->>'amount')::numeric;rate:=coalesce(nullif(p_data->>'exchange_rate','')::numeric,1);converted:=q*u.base_factor/base.base_factor;
  select currency into price_currency from public.companies where companies.id=p_company;
  if coalesce(p_data->>'currency',price_currency)<>price_currency and nullif(p_data->>'exchange_rate','') is null then raise exception 'Indica el tipo de cambio de la compra';end if;
  if coalesce(p_data->>'currency',price_currency)=price_currency then rate:=1;end if;
  if not exists(select 1 from public.currencies where currencies.code=coalesce(p_data->>'currency',price_currency) and active) then raise exception 'Moneda no válida';end if;
  if (p_data->>'date')::date>current_date then raise exception 'Una compra futura no puede recibirse todavía';end if;
  insert into public.purchase_receipts(company_id,material_id,supplier_id,presentation_id,quantity,unit_id,base_quantity,amount,currency,valuation_currency,exchange_rate,received_on,reference) values(p_company,m.id,nullif(p_data->>'supplier','')::uuid,nullif(p_data->>'presentation','')::uuid,q,u.id,converted,amount,coalesce(p_data->>'currency',price_currency),price_currency,rate,(p_data->>'date')::date,coalesce(p_data->>'reference','')) returning purchase_receipts.id into v_id;
  if nullif(p_data->>'presentation','') is not null and not exists(select 1 from public.presentations where company_id=p_company and presentations.id=(p_data->>'presentation')::uuid and raw_material_id=m.id) then raise exception 'La presentación no corresponde al material';end if;
  v_result:=access_private.post_stock(p_company,'material',m.id,converted,0,0,'receipt',v_id,amount*rate/converted,coalesce(p_data->>'reference',''))||jsonb_build_object('id',v_id);
 elsif p_action='adjust' then
  v_kind:=p_data->>'kind';v_id:=(p_data->>'item')::uuid;q:=(p_data->>'quantity')::numeric;
  if q=0 or q='NaN'::numeric or length(trim(coalesce(p_data->>'reason','')))<3 then raise exception 'Indica cantidad y motivo del ajuste';end if;
  if v_kind='material' then perform 1 from public.raw_materials where company_id=p_company and raw_materials.id=v_id;
  elsif v_kind='variant' then perform 1 from public.product_variants where company_id=p_company and product_variants.id=v_id;
  else raise exception 'Tipo no válido';end if;
  if not found then raise exception 'Registro no disponible';end if;
  if q<0 and coalesce((select on_hand-blocked-reserved from public.inventory_balances where company_id=p_company and inventory_balances.item_kind=v_kind and item_id=v_id),0)<-q then raise exception 'El ajuste excede las existencias disponibles';end if;
  
  if v_kind='variant' and q>0 and exists(select 1 from public.product_variants pv where pv.company_id=p_company and pv.id=v_id and pv.weight_min is not null) then
   select * into strict v from public.product_variants where company_id=p_company and id=v_id;
   if coalesce(jsonb_typeof(p_data->'unit_weights'),'')<>'array' or jsonb_array_length(p_data->'unit_weights')<>q or q>10000 then raise exception 'Registra un peso real por cada unidad que se agrega';end if;
   for x in select resolved.variant_id,jsonb_agg(resolved.w) weights,count(*) qty from(
    select e.value w,access_private.match_weight_variant(p_company,v.product_id,v.attributes,(e.value#>>'{}')::numeric) variant_id from jsonb_array_elements(p_data->'unit_weights')e
   )resolved group by resolved.variant_id loop
    v_result:=access_private.post_stock(p_company,'variant',x.variant_id,x.qty,0,0,'adjustment',case when x.variant_id=v_id then p_key else gen_random_uuid() end,nullif(p_data->>'unit_cost','')::numeric,p_data->>'reason');
    insert into public.inventory_units(company_id,lot_id,variant_id,weight,variant_snapshot,status,last_movement_id)
    select p_company,(v_result->>'lot')::uuid,pv.id,(w.value#>>'{}')::numeric,
     jsonb_build_object('name',access_private.variant_label(to_jsonb(pv)),'sku',pv.sku,'attributes',pv.attributes,'weight_min',pv.weight_min,'weight_max',pv.weight_max,'product_name',pr.name,'product_sku',pr.sku,'origin','adjustment'),
     'available',(v_result->>'movement')::uuid
    from jsonb_array_elements(x.weights)w join public.product_variants pv on pv.company_id=p_company and pv.id=x.variant_id join public.products pr on pr.company_id=pv.company_id and pr.id=pv.product_id;
   end loop;v_result:=jsonb_build_object('units',q);
  else
   v_result:=access_private.post_stock(p_company,v_kind,v_id,q,0,0,'adjustment',p_key,nullif(p_data->>'unit_cost','')::numeric,p_data->>'reason');
  end if;
 
 elsif p_action='formula_create' then
  parent:=(p_data->>'product')::uuid;perform 1 from public.products where company_id=p_company and products.id=parent and active;if not found then raise exception 'Producto no disponible';end if;
  insert into public.formulas(company_id,product_id,name,version,standard_yield) values(p_company,parent,trim(p_data->>'name'),coalesce((select max(version) from public.formulas where company_id=p_company and product_id=parent),0)+1,(p_data->>'yield')::integer) returning formulas.id into v_id;
  if coalesce(jsonb_typeof(p_data->'ingredients'),'')<>'array' or jsonb_array_length(p_data->'ingredients') not between 1 and 100 then raise exception 'Añade entre 1 y 100 ingredientes';end if;
  for r in select value from jsonb_array_elements(p_data->'ingredients') loop
   select * into strict m from public.raw_materials where company_id=p_company and raw_materials.id=(r->>'material')::uuid and active;
   select * into strict u from public.units where company_id=p_company and units.id=(r->>'unit')::uuid and active;
   if u.dimension<>(select dimension from public.units where company_id=p_company and units.id=m.unit_id) then raise exception 'Unidad incompatible con el material';end if;
   insert into public.formula_ingredients(company_id,formula_id,material_id,quantity,unit_id) values(p_company,v_id,m.id,(r->>'quantity')::numeric,u.id);
  end loop;v_result:=jsonb_build_object('id',v_id);
 elsif p_action='batch_start' then
  select * into strict f from public.formulas where company_id=p_company and formulas.id=(p_data->>'formula')::uuid;
  if f.state='inactive' then raise exception 'Selecciona una versión vigente o en pruebas';end if; insert into public.production_batches(company_id,product_id,formula_id,planned_quantity,formula_scale,production_date,available_on,currency,notes,requires_curing,curing_days) values(p_company,f.product_id,f.id,access_private.planned_production_units(f.estimated_units,coalesce(nullif(p_data->>'formula_scale','')::numeric,1)),coalesce(nullif(p_data->>'formula_scale','')::numeric,1),(p_data->>'date')::date,(p_data->>'date')::date+f.curing_days,(select currency from public.companies where companies.id=p_company),coalesce(p_data->>'notes',''),f.requires_curing,f.curing_days) returning production_batches.id into v_id;v_result:=jsonb_build_object('id',v_id);
 elsif p_action='batch_finish' then
  select * into strict b from public.production_batches where company_id=p_company and production_batches.id=(p_data->>'batch')::uuid for update;
  if b.state<>'in_progress' then if b.finish_payload=p_data then v_result:=jsonb_build_object('id',b.id,'state',b.state);update access_private.operation_requests set result=v_result where company_id=p_company and key=p_key;return v_result;end if;raise exception 'Este lote ya fue finalizado';end if;
  
 if nullif(p_data->>'expected_revision','') is not null and (p_data->>'expected_revision')::integer<>(select edit_revision from public.formulas where company_id=p_company and id=b.formula_id) then raise exception 'La fórmula fue corregida mientras preparabas el lote. Actualiza los consumos antes de confirmar' using errcode='40001';end if;
 if b.production_date>current_date then raise exception 'No se puede finalizar una producción futura';end if;
  -- Freeze curing from the same formula revision used for actual consumption.
  select * into strict f from public.formulas where company_id=p_company and id=b.formula_id;
  if (b.requires_curing,b.curing_days,b.available_on) is distinct from (f.requires_curing,f.curing_days,b.production_date+f.curing_days) then
   update public.production_batches set requires_curing=f.requires_curing,curing_days=f.curing_days,available_on=production_date+f.curing_days where company_id=p_company and id=b.id returning * into b;
  end if;
  if p_data->>'capture_mode'='variant_units' and (
 (select coalesce(sum((e->>'quantity')::numeric),0) from jsonb_array_elements(p_data->'outputs')e) not between 1 and 10000
 or exists(select 1 from jsonb_array_elements(p_data->'outputs')e where not coalesce((e->>'quantity')::numeric>0 and (e->>'quantity')::numeric=trunc((e->>'quantity')::numeric),false))
 ) then raise exception 'Registra cantidades enteras positivas; máximo 10000 unidades por lote';end if;
 if coalesce(jsonb_typeof(p_data->'consumptions'),'')<>'array' or coalesce(jsonb_typeof(p_data->'outputs'),'')<>'array' or jsonb_array_length(p_data->'outputs') not between 1 and 100 then raise exception 'Registra consumos reales y variantes obtenidas';end if;
  stock_review:=access_private.production_stock_review(p_company,'confirm',p_data);
  if jsonb_array_length(stock_review->'shortages')>0 and (coalesce((p_data->>'acknowledge_shortages')::boolean,false)=false or p_data->>'stock_proof' is distinct from stock_review->>'proof') then raise exception 'Hay materiales insuficientes o cambiaron las existencias. Revisa la advertencia y confirma si deseas producir con negativos';end if;
  update public.production_batches set stock_warnings=jsonb_set(stock_warnings,'{confirmation}',stock_review||jsonb_build_object('acknowledged',coalesce((p_data->>'acknowledge_shortages')::boolean,false),'user_id',auth.uid(),'recorded_at',clock_timestamp())) where company_id=p_company and id=b.id;
  for r in select value from jsonb_array_elements(p_data->'consumptions') loop
   select * into strict m from public.raw_materials where company_id=p_company and raw_materials.id=(r->>'material')::uuid;
   if not exists(select 1 from public.formula_ingredients where company_id=p_company and formula_id=b.formula_id and material_id=m.id) then raise exception 'Material no incluido en la fórmula';end if;
   select * into strict u from public.units where company_id=p_company and units.id=(r->>'unit')::uuid;
   select * into strict base from public.units where company_id=p_company and units.id=m.unit_id;
   if u.dimension<>base.dimension then raise exception 'Unidad incompatible';end if;
   q:=(r->>'quantity')::numeric;converted:=q*u.base_factor/base.base_factor;
   if converted<0 or converted='NaN'::numeric then raise exception 'Consumo inválido';end if;
   -- Shortages were collectively reviewed and explicitly acknowledged before any consumption.
   insert into public.batch_consumptions(company_id,batch_id,material_id,base_quantity) values(p_company,b.id,m.id,converted) returning batch_consumptions.id into v_id;
   if converted>0 then v_result:=access_private.post_stock(p_company,'material',m.id,-converted,0,0,'production_consumption',v_id,null,'Lote '||b.id);amount:=nullif(v_result->>'cost','')::numeric;else amount:=0;end if;
   if amount is null then known:=false;else total:=total+amount;end if;
   update public.batch_consumptions set cost=amount where company_id=p_company and batch_consumptions.id=v_id;
  end loop;
  if (select count(*) from public.batch_consumptions where company_id=p_company and batch_id=b.id)<>(select count(*) from public.formula_ingredients where company_id=p_company and formula_id=b.formula_id) or not exists(select 1 from public.batch_consumptions where company_id=p_company and batch_id=b.id and base_quantity>0) then raise exception 'Completa el consumo real de todos los materiales';end if;
  for r in select value from jsonb_array_elements(p_data->'outputs') loop
   select * into strict v from public.product_variants where company_id=p_company and product_variants.id=(r->>'variant')::uuid and product_id=b.product_id and active;
   q:=(r->>'quantity')::integer;
   if v.weight_min is not null and coalesce(p_data->>'capture_mode','')<>'variant_units' and not(r ? 'unit_weights') then raise exception 'Esta variante requiere registrar cada unidad por su peso real';end if;
   if coalesce(p_data->>'capture_mode','')='variant_units' then
    if r ? 'unit_weights' or nullif(r->>'weight','') is not null then raise exception 'La captura por variantes utiliza cantidades, sin pesos reales';end if;
   elsif r ? 'unit_weights' then
    if jsonb_typeof(r->'unit_weights')<>'array' or jsonb_array_length(r->'unit_weights')<>q or q not between 1 and 10000 then raise exception 'Revisa la cantidad y los pesos individuales de la variante';end if;
    weighed_sum:=0;
    for weighed_item in select value from jsonb_array_elements(r->'unit_weights') loop
     weighed_value:=(weighed_item#>>'{}')::numeric;
     if access_private.match_weight_variant(p_company,b.product_id,v.attributes,weighed_value)<>v.id then raise exception 'El peso % g corresponde a otra variante. Revisa los rangos y vuelve a registrar la unidad',weighed_value;end if;
     weighed_sum:=weighed_sum+weighed_value;
    end loop;
    if nullif(r->>'weight','')::numeric is distinct from weighed_sum then raise exception 'El peso total no coincide con los pesos individuales';end if;
   elsif q=1 and nullif(r->>'weight','') is not null then
    if access_private.match_weight_variant(p_company,b.product_id,v.attributes,(r->>'weight')::numeric)<>v.id then raise exception 'Ese peso corresponde a otra variante. Usa Registrar por peso unitario';end if;
   end if;
   converted:=coalesce(nullif(r->>'weight','')::numeric,(v.weight_min+v.weight_max)/2*q);
   insert into public.batch_outputs(company_id,batch_id,variant_id,quantity,actual_weight,allocation_weight,estimated_cost) values(p_company,b.id,v.id,q,nullif(r->>'weight','')::numeric,converted,nullif(r->>'weight','') is null);
   qty_sum:=qty_sum+q;if converted is null then weight_sum:=null;elsif weight_sum is not null then weight_sum:=weight_sum+converted;end if;
  end loop;
  if (select production_mode from public.formulas where company_id=p_company and id=b.formula_id)='variable_weight' then
   variable_plan:=access_private.variable_cost_plan(p_company,b.id,p_data);
  end if;
  for x in select * from public.batch_outputs where company_id=p_company and batch_id=b.id loop
   if variable_plan is not null then
 select case when bool_and(cost_row.value->>'manufacturing_cost' is not null)then sum((cost_row.value->>'manufacturing_cost')::numeric)/x.quantity end into amount from jsonb_array_elements(variable_plan->'units')cost_row(value) where cost_row.value->>'variant_id'=x.variant_id::text;
 else amount:=case when known and qty_sum>0 then total/qty_sum else null end;end if;
   update public.batch_outputs set unit_cost=amount where company_id=p_company and batch_outputs.id=x.id;
   
   v_result:=access_private.post_stock(p_company,'variant',x.variant_id,x.quantity,x.quantity,0,'production_output',x.id,amount,'Lote '||b.id);
   insert into public.inventory_units(company_id,lot_id,batch_id,output_id,variant_id,weight,variant_snapshot,status,last_movement_id,cost_snapshot)
   select p_company,(v_result->>'lot')::uuid,b.id,x.id,x.variant_id,(w.value#>>'{}')::numeric,
    jsonb_build_object('name',access_private.variant_label(to_jsonb(pv)),'sku',pv.sku,'attributes',pv.attributes,'weight_min',pv.weight_min,'weight_max',pv.weight_max,'product_name',pr.name,'product_sku',pr.sku,'batch_number',b.batch_number),
    'curing',(v_result->>'movement')::uuid,
    (select cost_row.value from jsonb_array_elements(coalesce(variable_plan->'units','[]'))cost_row(value) where cost_row.value->>'variant_id'=x.variant_id::text and (cost_row.value->>'position')::bigint=w.position)
   from jsonb_array_elements(p_data->'outputs') output_line
   cross join lateral jsonb_array_elements(coalesce(output_line->'unit_weights','[]'::jsonb)) with ordinality w(value,position)
   join public.product_variants pv on pv.company_id=p_company and pv.id=x.variant_id
   join public.products pr on pr.company_id=pv.company_id and pr.id=pv.product_id
   where output_line->>'variant'=x.variant_id::text;
   if p_data->>'capture_mode'='variant_units' and exists(select 1 from public.product_variants pv where pv.company_id=p_company and pv.id=x.variant_id and pv.weight_min is not null) then
    insert into public.inventory_units(company_id,lot_id,batch_id,output_id,variant_id,weight,variant_snapshot,status,last_movement_id,cost_snapshot)
    select p_company,(v_result->>'lot')::uuid,b.id,x.id,x.variant_id,null,
     jsonb_build_object('name',access_private.variant_label(to_jsonb(pv)),'sku',pv.sku,'attributes',pv.attributes,'weight_min',pv.weight_min,'weight_max',pv.weight_max,'product_name',pr.name,'product_sku',pr.sku,'batch_number',b.batch_number,'capture_mode','variant_units','reference_weight',(pv.weight_min+pv.weight_max)/2),
     'curing',(v_result->>'movement')::uuid,
     (select cost_row.value from jsonb_array_elements(coalesce(variable_plan->'units','[]'))cost_row(value) where cost_row.value->>'variant_id'=x.variant_id::text and (cost_row.value->>'position')::bigint=unit_index)
    from generate_series(1,x.quantity)unit_index
    join public.product_variants pv on pv.company_id=p_company and pv.id=x.variant_id
    join public.products pr on pr.company_id=pv.company_id and pr.id=pv.product_id;
   end if;

  end loop;
  update public.production_batches set currency=(select currency from public.companies where companies.id=p_company),state='curing',actual_quantity=qty_sum,scrap_quantity=coalesce((p_data->>'scrap')::integer,0),actual_weight=case when variable_plan is not null then (variable_plan->>'total_weight')::numeric else nullif(p_data->>'weight','')::numeric end,total_cost=case when known then total else null end,finish_payload=p_data||jsonb_build_object('_server_cost_plan',variable_plan) where company_id=p_company and production_batches.id=b.id;
  if b.requires_curing is false then
   perform access_private.operations(p_company,'batch_release',gen_random_uuid(),jsonb_build_object('batch',b.id,'reason','Disponible inmediatamente: la fórmula no requiere curado'));
  end if;
  v_result:=jsonb_build_object('id',b.id,'state',case when b.requires_curing is false then 'released' else 'curing' end);
 elsif p_action='batch_release' then
  select * into strict b from public.production_batches where company_id=p_company and production_batches.id=(p_data->>'batch')::uuid for update;
  if b.state='released' then v_result:=jsonb_build_object('id',b.id,'state','released');update access_private.operation_requests set result=v_result where company_id=p_company and key=p_key;return v_result;end if;
  if b.state<>'curing' then raise exception 'El lote no está en curado';end if;
  if b.available_on>current_date and (not coalesce((p_data->>'override')::boolean,false) or not access_private.company_permission(p_company,'manage') or length(trim(coalesce(p_data->>'reason','')))<5) then raise exception 'Aún no llega la fecha estimada. La liberación anticipada requiere autorización administrativa y motivo';end if;
  for x in select * from public.batch_outputs where company_id=p_company and batch_id=b.id loop
   perform access_private.post_stock(p_company,'variant',x.variant_id,0,-x.quantity,0,'release',x.id,null,coalesce(p_data->>'reason','Liberación manual'));
   update public.inventory_lots set blocked=false where company_id=p_company and source_kind='production_output' and source_id=x.id;
  end loop;
  update public.production_batches set state='released',release_note=coalesce(p_data->>'reason','Liberación manual') where company_id=p_company and production_batches.id=b.id;v_result:=jsonb_build_object('id',b.id,'state','released');
 end if;
 update access_private.operation_requests set result=v_result where company_id=p_company and key=p_key;
 return v_result;
exception when unique_violation then
 get stacked diagnostics code=constraint_name;
 if code='variant_commercial_code_unique' then raise exception 'Ya existe ese código comercial para el producto y atributos seleccionados';
 elsif code='variant_combination_unique' then raise exception 'Ya existe una variante con el mismo tamaño comercial, atributos y rango de peso';
 else raise; end if;
 when exclusion_violation then raise exception 'Los rangos de peso se solapan con otra variante de los mismos atributos';
end $function$
;
