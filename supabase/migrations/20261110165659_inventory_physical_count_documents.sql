alter table public.inventory_documents drop constraint inventory_documents_kind_check;
alter table public.inventory_documents add constraint inventory_documents_kind_check check(kind in('opening','adjust_in','adjust_out','reversal','count'));
alter table public.inventory_documents add column count_snapshot jsonb;
comment on column public.inventory_documents.count_snapshot is 'Captura física, teórico y diferencias por artículo al confirmar un conteo. No incluye artículos no contados.';

create function access_private.inventory_count_review(c uuid,data jsonb) returns jsonb
language plpgsql stable set search_path='' as $$
declare r jsonb;entry jsonb;checked jsonb;lines jsonb:='[]';counts jsonb:='[]';warnings jsonb:='[]';seen text[]:='{}';sig text;idx integer:=0;
 item uuid;kind text;bu public.units%rowtype;un public.units%rowtype;factor numeric;physical numeric;actual_base numeric;theoretical numeric;delta numeric;
 blocked numeric;reserved numeric;label jsonb;ccy text;key uuid;
begin
 if jsonb_typeof(data->'lines') is distinct from 'array' or jsonb_array_length(data->'lines') not between 1 and 500 then raise exception 'Agrega entre 1 y 500 artículos contados';end if;
 if length(btrim(coalesce(data->>'reason',''))) not between 3 and 500 then raise exception 'Indica un motivo de 3 a 500 caracteres';end if;
 if nullif(data->>'date','') is null or (data->>'date')::date>(clock_timestamp() at time zone 'America/Guatemala')::date then raise exception 'Indica una fecha válida, no futura';end if;
 if length(coalesce(data->>'notes',''))>2000 or nullif(data->>'reverses_id','') is not null or nullif(data->>'corrects_id','') is not null then raise exception 'Datos de conteo no válidos';end if;
 select currency into strict ccy from public.companies where id=c;
 for r in select value from jsonb_array_elements(data->'lines') loop
  idx:=idx+1;item:=nullif(r->>'item_id','')::uuid;kind:=r->>'item_kind';key:=nullif(r->>'line_key','')::uuid;
  if key is null then raise exception 'Fila %: falta identificador de captura',idx;end if;
  sig:=kind||':'||item::text;
  if sig is null or sig=any(seen) then raise exception 'Fila %: artículo inválido o repetido. Captura un único total por artículo',idx;end if;seen:=array_append(seen,sig);
  physical:=nullif(r->>'quantity','')::numeric;
  if physical is null or not(physical>=0 and physical<1e12) or physical<>round(physical,8) then raise exception 'Fila %: captura una cantidad real no negativa, máximo 8 decimales; cero es válido',idx;end if;
  if kind='material' then
   select u.* into strict bu from public.raw_materials m join public.units u on u.company_id=c and u.id=m.unit_id where m.company_id=c and m.id=item;
   select u.* into strict un from public.units u where u.company_id=c and u.id=coalesce(nullif(r->>'unit_id','')::uuid,bu.id);
   if not un.active or un.dimension<>bu.dimension then raise exception 'Fila %: unidad incompatible',idx;end if;
  elsif kind='variant' then
   perform 1 from public.product_variants where company_id=c and id=item;if not found then raise exception 'Fila %: variante no disponible',idx;end if;
   select u.* into strict bu from public.units u where u.company_id=c and u.dimension='count' and u.base_factor=1 and u.active order by (u.symbol='ud') desc,u.id limit 1;
   un:=bu;
   if physical<>trunc(physical) or (nullif(r->>'unit_id','') is not null and (r->>'unit_id')::uuid<>bu.id) then raise exception 'Fila %: los productos se cuentan en unidades enteras',idx;end if;
  else raise exception 'Fila %: tipo de artículo inválido',idx;end if;
  factor:=un.base_factor/bu.base_factor;actual_base:=round(physical*factor,8);
  if actual_base>=1e12 then raise exception 'Fila %: cantidad fuera de rango en unidad base',idx;end if;
  select b.on_hand,b.blocked,b.reserved into theoretical,blocked,reserved from public.inventory_balances b where b.company_id=c and b.item_kind=kind and b.item_id=item;
  theoretical:=coalesce(theoretical,0);blocked:=coalesce(blocked,0);reserved:=coalesce(reserved,0);
  delta:=actual_base-theoretical;
  if actual_base<blocked+reserved then raise exception 'Fila %: el conteo es menor que las unidades reservadas o en curación. Revisa esas reservas antes de ajustar este artículo',idx;end if;
  label:=access_private.inventory_context(c,kind,item,'adjustment',key,clock_timestamp());
  label:=label||jsonb_build_object('line_key',key,'item_kind',kind,'item_id',item,'unit',un.symbol,'theoretical',theoretical/factor,'actual',physical,'difference',delta/factor,'theoretical_base',theoretical,'actual_base',actual_base,'difference_base',delta,'base_unit',bu.symbol,'reserved',reserved,'blocked',blocked,'notes',coalesce(r->>'notes',''));
  counts:=counts||jsonb_build_array(label);
  if delta<>0 then
   checked:=access_private.inventory_document_review(c,data||jsonb_build_object('kind',case when delta>0 then 'adjust_in' else 'adjust_out' end,'lines',jsonb_build_array(r||jsonb_build_object('unit_id',bu.id,'quantity',abs(delta),'cost_mode','current','lot_id',null,'individual_unit_id',null,'weight',null,'external_code',null,'lot_label',''))));
   entry:=checked->'lines'->0;
   entry:=entry||jsonb_build_object('line_number',idx,'snapshot',(entry->'snapshot')||jsonb_build_object('count',label,'count_direction',sign(delta)));
   lines:=lines||jsonb_build_array(entry);
   warnings:=warnings||(checked->'warnings');
  end if;
 end loop;
 return jsonb_build_object('kind','count','date',(data->>'date')::date,'reason',btrim(data->>'reason'),'notes',coalesce(data->>'notes',''),'lines',lines,'counts',counts,'warnings',warnings,'currency',ccy,'line_count',idx,'changed_count',jsonb_array_length(lines),'unchanged_count',idx-jsonb_array_length(lines),'quantity_totals','[]'::jsonb);
end $$;
revoke all on function access_private.inventory_count_review(uuid,jsonb) from public,anon,authenticated;

-- Expand mixed count reversals using each movement's original direction and allocations.
create function access_private.inventory_count_reversal_lines(c uuid,doc uuid) returns jsonb
language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(x),'[]'::jsonb) from(
  select jsonb_build_object('line_key',l.id,'item_kind',l.item_kind,'item_id',l.item_id,'unit_id',l.input_unit_id,'quantity',l.quantity,'unit_cost',l.unit_cost,'lot_id',l.lot_id,'individual_unit_id',l.individual_unit_id,'weight',l.weight,'notes',l.notes,'external_code',l.external_code,'original_line',l.id,'reverse_direction',-1) x
  from public.inventory_document_lines l join public.inventory_movements m on m.company_id=c and m.id=l.movement_id where l.company_id=c and l.document_id=doc and m.quantity>0
  union all
  select jsonb_build_object('line_key',md5(l.id::text||a.lot_id::text||coalesce(u.id::text,''))::uuid,'item_kind',l.item_kind,'item_id',l.item_id,'unit_id',l.input_unit_id,'quantity',case when u.id is not null then 1 else a.quantity end/(l.base_quantity/l.quantity),'unit_cost',case when u.id is not null and u.cost_snapshot is not null then (u.cost_snapshot->>'manufacturing_cost')::numeric else a.unit_cost end*(l.base_quantity/l.quantity),'lot_id',a.lot_id,'individual_unit_id',u.id,'weight',u.weight,'notes',l.notes,'external_code',u.external_code,'original_line',l.id,'reverse_direction',1) x
  from public.inventory_document_lines l join public.inventory_movements m on m.company_id=c and m.id=l.movement_id
  join public.inventory_allocations a on a.company_id=c and a.movement_id=m.id
  left join lateral(select pu.* from public.inventory_units pu join public.inventory_unit_movements h on h.company_id=c and h.unit_id=pu.id where pu.company_id=c and pu.lot_id=a.lot_id and h.movement_id=m.id and h.status_after='retired')u on true
  where l.company_id=c and l.document_id=doc and m.quantity<0
 )v
$$;
revoke all on function access_private.inventory_count_reversal_lines(uuid,uuid) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION access_private.inventory_document_review(c uuid, data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare r jsonb;rows jsonb:='[]';warnings jsonb:='[]';errors jsonb:='[]';signum integer;typ text;docdate date;item uuid;lotid uuid;unitid uuid;unitrow public.inventory_units%rowtype;lot public.inventory_lots%rowtype;
 mat public.raw_materials%rowtype;var public.product_variants%rowtype;un public.units%rowtype;bu public.units%rowtype;prod uuid;qty numeric;bqty numeric;unitcost numeric;bcost numeric;factor numeric;snap jsonb;ordinal integer:=0;sig text;seen text[]:='{}';available numeric;matches uuid[];lineid uuid;reason text;ccy text;rev uuid;original public.inventory_documents%rowtype;inputrows jsonb;parentline public.inventory_document_lines%rowtype;
begin
 if data->>'kind'='count' then return access_private.inventory_count_review(c,data);end if;
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

  if original.kind='count' then inputrows:=access_private.inventory_count_reversal_lines(c,rev);end if;
  if signum=1 and original.kind<>'count' then
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
  if typ='reversal' and original.kind='count' then signum:=(r->>'reverse_direction')::integer;end if;
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

CREATE OR REPLACE FUNCTION access_private.inventory_command(c uuid, action text, data jsonb, k uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare review jsonb;r jsonb;answer jsonb;cached access_private.operation_requests%rowtype;docid uuid;lineid uuid;move jsonb;lotid uuid;unitid uuid;n bigint;sgn numeric;items jsonb;total bigint;page integer;
begin
 if auth.uid() is null or not public.company_permission(c,case when action in('review','confirm') then 'write' else 'read' end,'inventory') then raise exception 'No tienes permiso para esta empresa';end if;
 if action in('cancellation_info','cancel_document') then return access_private.document_cancellation(c,case when action='cancellation_info' then 'info' else 'confirm' end,k,data);end if;
 if action='kardex_options' then
 return jsonb_build_object(
 'materials',(select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'sku',m.sku,'name',m.name) order by m.name),'[]') from public.raw_materials m where m.company_id=c),
 'variants',(select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'sku',v.sku,'product_id',v.product_id,'product_name',p.name,'label',access_private.variant_label(to_jsonb(v))) order by p.name),'[]') from public.product_variants v join public.products p on p.company_id=c and p.id=v.product_id where v.company_id=c));
 elsif action='stock_valuation' then return jsonb_build_object('stock',(select coalesce(jsonb_agg(jsonb_build_object('item_kind',b.item_kind,'item_id',b.item_id,'on_hand',b.on_hand,'blocked',b.blocked,'reserved',b.reserved,'available',b.on_hand-b.blocked-b.reserved,'known_value',(select sum(l.remaining*l.unit_cost) from public.inventory_lots l where l.company_id=c and l.item_kind=b.item_kind and l.item_id=b.item_id),'pending_cost',(select coalesce(sum(abs(l.remaining)),0) from public.inventory_lots l where l.company_id=c and l.item_kind=b.item_kind and l.item_id=b.item_id and l.unit_cost is null))),'[]') from public.inventory_balances b where b.company_id=c));
 elsif action='catalog' then
  return jsonb_build_object(
   'materials',(select coalesce(jsonb_agg(to_jsonb(m)||jsonb_build_object('suggested_cost',(select s.unit_price*bu.base_factor/s.base_factor from public.material_sheet s join public.units bu on bu.company_id=c and bu.id=m.unit_id where s.company_id=c and s.raw_material_id=m.id and s.active and s.effective_on<=current_date and s.currency=cp.currency and s.unit_price is not null order by s.effective_on desc,s.price_created_at desc limit 1)) order by m.name),'[]') from public.raw_materials m join public.companies cp on cp.id=c where m.company_id=c),
   'variants',(select coalesce(jsonb_agg(to_jsonb(v)||jsonb_build_object('product_name',p.name,'label',access_private.variant_label(to_jsonb(v)),'suggested_cost',(select l.unit_cost from public.inventory_lots l where l.company_id=c and l.item_kind='variant' and l.item_id=v.id and l.unit_cost is not null order by l.created_at desc limit 1)) order by p.name),'[]') from public.product_variants v join public.products p on p.company_id=v.company_id and p.id=v.product_id where v.company_id=c),
   'balances',(select coalesce(jsonb_agg(to_jsonb(b)),'[]') from public.inventory_balances b where b.company_id=c),
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
  insert into public.inventory_documents(company_id,number,kind,effective_on,reason,notes,reverses_id,corrects_id,created_by,count_snapshot) values(c,n,review->>'kind',(review->>'date')::date,review->>'reason',review->>'notes',(review->>'reverses_id')::uuid,(review->>'corrects_id')::uuid,auth.uid(),review->'counts') returning id into docid;
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
  return jsonb_build_object('movement',r,'reversal',(select (to_jsonb(dc)-'snapshot')||jsonb_build_object('original_movement_id',dc.snapshot#>>'{effects,0,original_movement_id}') from public.document_cancellations dc where dc.company_id=c and dc.id=nullif(r->>'source_document_id','')::uuid and r->>'source_kind'='document_reversal'),'cancellation',access_private.document_cancellation(c,'info',null,jsonb_build_object('movement_id',r->>'id')),'lines',(select jsonb_agg(x order by x->>'created_at') from access_private.inventory_ledger_rows(c)x where x->>'source_document_id'=r->>'source_document_id' and not(x->>'source_kind'='release' and coalesce((x->>'entry')::numeric,0)=0 and coalesce((x->>'exit')::numeric,0)=0)),
  'reference',case when r->>'source_kind'='receipt' then(select pr.reference from public.purchase_receipts pr where pr.company_id=c and pr.id=(r->>'source_id')::uuid) else r->>'document_number' end);
 elsif action='detail' then
  return jsonb_build_object('header',(select to_jsonb(d)||jsonb_build_object('user_name',coalesce((select nullif(btrim(up.display_name),'') from public.user_profiles up where up.user_id=d.created_by),case when d.created_by is null then 'Histórico' else 'Usuario sin nombre registrado' end)) from public.inventory_documents d where d.company_id=c and d.id=(data->>'id')::uuid),'lines',(select coalesce(jsonb_agg(to_jsonb(l) order by l.line_number),'[]') from public.inventory_document_lines l where l.company_id=c and l.document_id=(data->>'id')::uuid),'reversal',(select id from public.inventory_documents where company_id=c and reverses_id=(data->>'id')::uuid));
 elsif action='ledger' then
  page:=greatest(coalesce((data->>'page')::integer,0),0);
  with ledger as materialized(select x from access_private.inventory_ledger_rows(c)x),filtered as(
   select x from ledger where not(x->>'source_kind'='release' and coalesce((x->>'entry')::numeric,0)=0 and coalesce((x->>'exit')::numeric,0)=0) and (nullif(data->>'from','') is null or (x->>'date')::date>=(data->>'from')::date) and (nullif(data->>'to','') is null or (x->>'date')::date<=(data->>'to')::date)
   and(nullif(data->>'kind','') is null or x->>'item_kind'=data->>'kind') and(nullif(data->>'item','') is null or x->>'item_id'=data->>'item')
   and(nullif(data->>'lot','') is null or x->'lots' ? (data->>'lot')) and(nullif(data->>'source','') is null or x->>'source_kind'=data->>'source')
   and(nullif(data->>'type','') is null or x->>'movement_type'=data->>'type' or(data->>'type' in('production_consumption','production_output') and x->>'source_kind'=data->>'type'))
   and(nullif(data->>'query','') is null or concat_ws(' ',x->>'sku',x->>'name',x->>'variant',x->>'document_number',x->'units') ilike '%'||(data->>'query')||'%'))
  select jsonb_build_object('total',(select count(*) from filtered),'rows',(select coalesce(jsonb_agg(x order by x->>'date' desc,x->>'created_at' desc,x->>'id' desc),'[]') from(select x from filtered order by x->>'date' desc,x->>'created_at' desc,x->>'id' desc limit 100 offset page*100)s),
  'stock','[]'::jsonb) into answer;return answer;
 end if;
 raise exception 'Acción no válida';
end $function$
;
notify pgrst,'reload schema';
