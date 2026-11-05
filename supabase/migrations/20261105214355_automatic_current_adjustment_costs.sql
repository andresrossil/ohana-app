-- Current quotes are frozen at confirmation; reversals retain original costs.
CREATE OR REPLACE FUNCTION access_private.inventory_document_review(c uuid, data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare r jsonb;rows jsonb:='[]';warnings jsonb:='[]';errors jsonb:='[]';signum integer;typ text;docdate date;item uuid;lotid uuid;unitid uuid;unitrow public.inventory_units%rowtype;lot public.inventory_lots%rowtype;
 mat public.raw_materials%rowtype;var public.product_variants%rowtype;un public.units%rowtype;bu public.units%rowtype;prod uuid;qty numeric;bqty numeric;unitcost numeric;bcost numeric;factor numeric;snap jsonb;ordinal integer:=0;sig text;seen text[]:='{}';available numeric;matches uuid[];lineid uuid;reason text;ccy text;rev uuid;original public.inventory_documents%rowtype;inputrows jsonb;parentline public.inventory_document_lines%rowtype;
begin
 typ:=data->>'kind';rev:=nullif(data->>'reverses_id','')::uuid;reason:=btrim(data->>'reason');
 if typ not in('opening','adjust_in','adjust_out','reversal') or typ is null then raise exception 'Selecciona el tipo de movimiento';end if;
 if length(coalesce(reason,'')) not between 3 and 500 then raise exception 'Indica un motivo de 3 a 500 caracteres';end if;
 docdate:=(data->>'date')::date;if docdate is null or docdate>(clock_timestamp() at time zone 'America/Guatemala')::date then raise exception 'Indica una fecha válida, no futura';end if;
 if length(coalesce(data->>'notes',''))>2000 then raise exception 'Observaciones: máximo 2000 caracteres';end if;
 select currency into strict ccy from public.companies where id=c;
 if nullif(data->>'corrects_id','') is not null and (typ not in('adjust_in','adjust_out') or not exists(select 1 from public.inventory_documents d where d.company_id=c and d.id=(data->>'corrects_id')::uuid and d.state='confirmed')) then raise exception 'Documento original de corrección no válido';end if;
 if typ='reversal' then
  select * into strict original from public.inventory_documents where company_id=c and id=rev and state='confirmed' and kind<>'reversal';
  if exists(select 1 from public.inventory_documents d where d.company_id=c and d.reverses_id=rev) then raise exception 'Este documento ya tiene una reversión';end if;
  signum:=case when original.kind in('opening','adjust_in') then -1 else 1 end;
  select jsonb_agg(jsonb_build_object('line_key',l.id,'item_kind',l.item_kind,'item_id',l.item_id,'unit_id',l.input_unit_id,'quantity',l.quantity,'unit_cost',l.unit_cost,'lot_id',l.lot_id,'individual_unit_id',l.individual_unit_id,'weight',l.weight,'notes',l.notes,'external_code',l.external_code,'original_line',l.id) order by l.line_number) into inputrows from public.inventory_document_lines l where l.company_id=c and l.document_id=rev;

  if signum=1 then
   -- Expand an outgoing quantity adjustment into its original allocations.
   -- Individual units keep their original identities and frozen costs.
   select jsonb_agg(jsonb_build_object(
    'line_key',md5(l.id::text||a.lot_id::text||coalesce(u.id::text,''))::uuid,
    'item_kind',l.item_kind,'item_id',l.item_id,'unit_id',l.input_unit_id,
    'quantity',case when u.id is not null then 1 else a.quantity end/(l.base_quantity/l.quantity),
    'unit_cost',case when u.id is not null and u.cost_snapshot is not null then (u.cost_snapshot->>'manufacturing_cost')::numeric else a.unit_cost end*(l.base_quantity/l.quantity),
    'lot_id',a.lot_id,'individual_unit_id',u.id,'weight',u.weight,
    'notes',l.notes,'external_code',u.external_code,'original_line',l.id)
    order by l.line_number,a.lot_id,u.id) into inputrows
   from public.inventory_document_lines l
   join public.inventory_allocations a on a.company_id=c and a.movement_id=l.movement_id
   left join lateral(
    select pu.* from public.inventory_units pu
    join public.inventory_unit_movements h on h.company_id=c and h.unit_id=pu.id
    where pu.company_id=c and pu.lot_id=a.lot_id and h.movement_id=l.movement_id and h.status_after='retired'
   )u on true
   where l.company_id=c and l.document_id=rev;
  end if;
 else
  if rev is not null then raise exception 'La referencia de reversión no corresponde al tipo';end if;
  signum:=case when typ='adjust_out' then -1 else 1 end;inputrows:=data->'lines';
 end if;
 if jsonb_typeof(inputrows) is distinct from 'array' or jsonb_array_length(inputrows) not between 1 and 500 then raise exception 'Agrega entre 1 y 500 líneas';end if;
 for r in select value from jsonb_array_elements(inputrows) loop
  ordinal:=ordinal+1;lotid:=null;unitid:=null;unitrow:=null;lot:=null;mat:=null;var:=null;prod:=null;
  lineid:=coalesce(nullif(r->>'line_key','')::uuid,gen_random_uuid());item:=nullif(r->>'item_id','')::uuid;
  qty:=nullif(r->>'quantity','')::numeric;
  if nullif(r->>'weight','') is not null and ((r->>'weight')::numeric<=0 or (r->>'weight')::numeric>=1e12 or (r->>'weight')::numeric<>round((r->>'weight')::numeric,4)) then raise exception 'Fila %: peso positivo, máximo 4 decimales',ordinal;end if;
  if qty is null or qty<=0 or qty>=1e12 or qty<>round(qty,8) then raise exception 'Fila %: cantidad positiva, máximo 8 decimales',ordinal;end if;
  if r->>'item_kind'='material' then
   select * into strict mat from public.raw_materials where company_id=c and id=item;
   select * into strict bu from public.units where company_id=c and id=mat.unit_id;
   select * into strict un from public.units where company_id=c and id=coalesce(nullif(r->>'unit_id','')::uuid,bu.id);
   if un.dimension<>bu.dimension or (not un.active and typ<>'reversal') then raise exception 'Fila %: unidad incompatible',ordinal;end if;
   factor:=un.base_factor/bu.base_factor;bqty:=round(qty*factor,8);
   snap:=jsonb_build_object('sku',mat.sku,'name',mat.name,'unit',bu.symbol,'input_unit',un.symbol,'unit_id',bu.id,'classification',mat.classification);
  elsif r->>'item_kind'='variant' then
   if item is not null then select * into strict var from public.product_variants where company_id=c and id=item;prod:=var.product_id;else prod:=nullif(r->>'product_id','')::uuid;end if;
   if signum=1 and typ<>'reversal' and nullif(r->>'weight','') is not null then
    select array_agg(v.id) into matches from public.product_variants v where v.company_id=c and v.product_id=prod and v.active and v.weight_min<=(r->>'weight')::numeric and (r->>'weight')::numeric<v.weight_max and (var.id is null or v.attributes=var.attributes);
    if coalesce(cardinality(matches),0)<>1 then raise exception 'Fila %: el peso no identifica una sola variante. Selecciona sus atributos o corrige el peso',ordinal;end if;
    select * into strict var from public.product_variants where company_id=c and id=matches[1];item:=var.id;
   end if;
   if var.id is null then raise exception 'Fila %: selecciona una variante',ordinal;end if;
   if qty<>trunc(qty) then raise exception 'Fila %: los productos requieren cantidades enteras',ordinal;end if;
   -- Quantity-only entries retain the selected variant without inventing a real weight.
   if signum=1 and typ<>'reversal' and (not var.active or not exists(select 1 from public.products p where p.company_id=c and p.id=var.product_id and p.active)) then raise exception 'Fila %: producto o variante archivados',ordinal;end if;
   select * into un from public.units where company_id=c and dimension='count' and base_factor=1 and active order by (symbol='ud') desc,id limit 1;bu:=un;factor:=1;bqty:=qty;
   if nullif(r->>'unit_id','') is not null and (r->>'unit_id')::uuid is distinct from un.id then raise exception 'Fila %: producto terminado se registra en unidades',ordinal;end if;
   snap:=access_private.inventory_context(c,'variant',item,'adjustment',lineid,clock_timestamp());snap:=snap||jsonb_build_object('input_unit','ud','unit_id',un.id);
  else raise exception 'Fila %: tipo de artículo inválido',ordinal;end if;
  if bqty<=0 then raise exception 'Fila %: cantidad insuficiente en unidad base',ordinal;end if;
  if typ<>'reversal' and nullif(r->>'external_code','') is not null and signum=1 and (var.id is null or nullif(r->>'weight','') is null) then raise exception 'Fila %: el identificador individual requiere un producto con peso real',ordinal;end if;
  if typ='reversal' then select l.snapshot into snap from public.inventory_document_lines l where l.company_id=c and l.id=(r->>'original_line')::uuid;end if;
  if signum=1 and typ<>'reversal' and mat.id is not null and not mat.active then raise exception 'Fila %: el material está archivado',ordinal;end if;
  lotid:=nullif(r->>'lot_id','')::uuid;unitid:=nullif(r->>'individual_unit_id','')::uuid;
  if signum=-1 then
   if unitid is null and nullif(r->>'external_code','') is not null then select id into unitid from public.inventory_units where company_id=c and lower(coalesce(external_code,'U-'||id::text))=lower(r->>'external_code');end if;
   if unitid is not null then
    select * into strict unitrow from public.inventory_units where company_id=c and id=unitid and variant_id=item and status='available';
    if qty<>1 then raise exception 'Fila %: una unidad individual requiere cantidad 1',ordinal;end if;
    lotid:=unitrow.lot_id;snap:=snap||jsonb_build_object('variant',unitrow.variant_snapshot->>'name','sku',unitrow.variant_snapshot->>'sku','weight',unitrow.weight);
   end if;
   if lotid is null then
    select * into lot from public.inventory_lots il where il.company_id=c and il.item_kind=r->>'item_kind' and il.item_id=item and not il.blocked and il.remaining>=bqty order by il.created_at,il.id limit 1;
    lotid:=lot.id;
    if lotid is null then lot.currency:=ccy;lot.unit_cost:=access_private.available_stock_cost(c,r->>'item_kind',item,bqty);end if;
   end if;
   if lotid is not null then select * into strict lot from public.inventory_lots where company_id=c and id=lotid and item_kind=r->>'item_kind' and item_id=item and not blocked and remaining>=bqty;end if;
   if lot.currency<>ccy then raise exception 'Fila %: la moneda histórica del lote es distinta. No se aplica una conversión ficticia',ordinal;end if;
   select on_hand-blocked-reserved into available from public.inventory_balances where company_id=c and item_kind=r->>'item_kind' and item_id=item;
   if coalesce(available,0)<bqty then raise exception 'Fila %: salida superior a las existencias disponibles',ordinal;end if;
   if typ='reversal' then bcost:=nullif(r->>'unit_cost','')::numeric/factor;
   else
    bcost:=case when unitrow.id is not null and unitrow.cost_snapshot is not null then (unitrow.cost_snapshot->>'manufacturing_cost')::numeric else lot.unit_cost end;
    snap:=snap||jsonb_build_object('cost_basis',case when unitrow.id is not null then 'individual' else 'lot' end);
    if bcost is null and mat.id is not null then select il.unit_cost into bcost from public.inventory_lots il where il.company_id=c and il.item_kind='material' and il.item_id=item and il.unit_cost is not null order by il.created_at desc,il.id desc limit 1;snap:=snap||jsonb_build_object('cost_basis','historical_reference');end if;
   end if;
   unitcost:=bcost*factor;
  else
   unitcost:=nullif(r->>'unit_cost','')::numeric;bcost:=unitcost/factor;
   if typ<>'reversal' then snap:=snap||jsonb_build_object('cost_basis','entry_confirmed');end if;
   if typ<>'reversal' and lotid is not null then raise exception 'Fila %: en entradas utiliza un nombre de lote, no un lote de existencias',ordinal;end if;
   if typ='reversal' and unitid is not null then
    select * into strict unitrow from public.inventory_units where company_id=c and id=unitid and status='retired' and last_movement_id=(select l.movement_id from public.inventory_document_lines l where l.company_id=c and l.id=(r->>'original_line')::uuid);
   end if;
   if typ<>'reversal' and nullif(btrim(r->>'external_code'),'') is not null and exists(select 1 from public.inventory_units u where u.company_id=c and lower(u.external_code)=lower(btrim(r->>'external_code'))) then raise exception 'Fila %: identificador individual repetido',ordinal;end if;
  end if;
  if typ<>'reversal' and r->>'cost_mode'='current' then
   if mat.id is not null then
    select q.unit_cost into bcost from access_private.material_purchase_quote(c,mat.id)q;
    snap:=snap||jsonb_build_object('cost_basis','current_catalog');
   else
    bcost:=nullif(r->>'unit_cost','')::numeric/factor;
    snap:=snap||jsonb_build_object('cost_basis','current_formula');
   end if;
   unitcost:=bcost*factor;
  end if;
  if unitcost is not null and (unitcost<0 or unitcost>=1e12) then raise exception 'Fila %: costo unitario inválido',ordinal;end if;
  if bcost is not null and (bcost<0 or bcost>=1e12) then raise exception 'Fila %: costo en unidad base fuera de rango',ordinal;end if;
  if unitcost is null then warnings:=warnings||jsonb_build_array('Fila '||ordinal||': costo pendiente para '||coalesce(snap->>'sku',snap->>'name'));end if;
  if typ='opening' and exists(select 1 from public.inventory_balances b where b.company_id=c and b.item_kind=r->>'item_kind' and b.item_id=item and b.on_hand<>0) then warnings:=warnings||jsonb_build_array('Fila '||ordinal||': '||coalesce(snap->>'sku',snap->>'name')||' ya tiene existencias; esta apertura será complementaria');end if;
  if signum=1 and typ<>'reversal' and nullif(btrim(r->>'external_code'),'') is not null and exists(select 1 from jsonb_array_elements(rows) x where lower(x->>'external_code')=lower(btrim(r->>'external_code'))) then raise exception 'Fila %: identificador individual repetido en el documento',ordinal;end if;
  sig:=(r->>'item_kind')||':'||item::text||':'||coalesce(lotid::text,r->>'lot_label','')||':'||case when unitid is not null then unitid::text when var.weight_min is not null then coalesce(nullif(lower(btrim(r->>'external_code')),''),lineid::text) else '' end;
  if sig=any(seen) then raise exception 'Fila %: artículo, variante, lote o unidad repetidos',ordinal;end if;seen:=array_append(seen,sig);
  if length(coalesce(r->>'notes',''))>1000 or length(coalesce(r->>'lot_label',''))>120 or length(coalesce(r->>'external_code',''))>80 then raise exception 'Fila %: texto demasiado largo',ordinal;end if;
  rows:=rows||jsonb_build_array(jsonb_build_object('line_key',lineid,'line_number',ordinal,'item_kind',r->>'item_kind','item_id',item,'material_id',mat.id,'variant_id',var.id,'input_unit_id',un.id,'quantity',qty,'base_quantity',bqty,'unit_cost',unitcost,'base_unit_cost',bcost,'total_value',qty*unitcost,'currency',ccy,'lot_id',lotid,'lot_label',coalesce(r->>'lot_label',''),'individual_unit_id',unitid,'external_code',nullif(btrim(r->>'external_code'),''),'weight',case when unitrow.id is not null then unitrow.weight else nullif(r->>'weight','')::numeric end,'notes',coalesce(r->>'notes',''),'snapshot',snap,'direction',signum,'original_line',r->>'original_line'));
 end loop;
 return jsonb_build_object('kind',typ,'date',docdate,'reverses_id',rev,'corrects_id',nullif(data->>'corrects_id','')::uuid,'reason',reason,'notes',coalesce(data->>'notes',''),'lines',rows,'warnings',warnings,'currency',ccy,'line_count',ordinal,
 'quantity_totals',(select jsonb_agg(jsonb_build_object('unit',g.symbol,'quantity',g.qty)) from(select l#>>'{snapshot,input_unit}' symbol,sum((l->>'quantity')::numeric) qty from jsonb_array_elements(rows)l group by 1)g),
 'known_total',(select coalesce(sum((l->>'total_value')::numeric),0) from jsonb_array_elements(rows)l),'pending_costs',(select count(*) from jsonb_array_elements(rows)l where l->>'unit_cost' is null));
end $function$
;
CREATE OR REPLACE FUNCTION access_private.post_stock_selected(c uuid, k text, item uuid, q numeric, block_delta numeric, reserve_delta numeric, source text, source_uuid uuid, cost numeric, note text, selected_lot uuid, selected_unit uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare movement uuid;lot public.inventory_lots%rowtype;take numeric;needed numeric;total numeric:=0;known boolean:=true;created_lot uuid;valuation text;available_lot numeric;tracked boolean;changed integer;assigned_cost numeric;assigned_known boolean;negative_allowed boolean:=false;short_lot uuid;settling numeric;settlement jsonb:='[]';debt record;purchase_quote jsonb;production_price numeric;begin
 select currency into strict valuation from public.companies where id=c;
 if source='production_consumption' and k='material' then select to_jsonb(p) into purchase_quote from access_private.material_purchase_quote(c,item)p;production_price:=(purchase_quote->>'unit_cost')::numeric;end if;
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
  if k='material' and source<>'document_reversal' then
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
 if source='production_consumption' and k='material' then
  -- Formula and production consume the exact same current purchase quote.
  -- Stock allocation tracks quantity only; it does not choose the production price.
  total:=abs(q)*production_price;known:=production_price is not null;
  update public.inventory_allocations set unit_cost=production_price where company_id=c and movement_id=movement;
 end if;
 if source='inventory_document' and exists(
  select 1 from public.inventory_document_lines dl where dl.company_id=c and dl.id=source_uuid
   and dl.snapshot->>'cost_basis' in('current_catalog','current_formula')
 ) then
  total:=abs(q)*cost;known:=cost is not null;
  update public.inventory_allocations set unit_cost=cost where company_id=c and movement_id=movement;
 end if;
 if source='document_reversal' then
  total:=abs(q)*cost;known:=cost is not null;
  update public.inventory_allocations set unit_cost=cost where company_id=c and movement_id=movement;
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
 update public.inventory_movements im set effective_on=(ctx.data->>'effective_on')::date,unit_cost=case when known and q<>0 then total/abs(q) end,total_value=case when q=0 then 0 when known then sign(q)*total end,currency=valuation,snapshot=ctx.data||case when source='production_consumption' and k='material' then jsonb_build_object('cost_basis','catalog_purchase','purchase_price_reference',purchase_quote) else '{}'::jsonb end||jsonb_build_object('negative_stock_acknowledged',negative_allowed,'shortfall_settlements',settlement),captured=true,
 document_id=case when source='inventory_document' then (select l.document_id from public.inventory_document_lines l where l.company_id=c and l.id=source_uuid) end,
 document_line_id=case when source='inventory_document' then source_uuid end
 from (select access_private.inventory_context(c,k,item,source,source_uuid,clock_timestamp()) data)ctx where im.company_id=c and im.id=movement;
 return jsonb_build_object('movement',movement,'lot',created_lot,'cost',case when known then total else null end);
end $function$
;
