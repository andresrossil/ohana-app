CREATE OR REPLACE FUNCTION access_private.inventory_count_review(c uuid, data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare r jsonb;entry jsonb;checked jsonb;lines jsonb:='[]';counts jsonb:='[]';warnings jsonb:='[]';seen text[]:='{}';sig text;idx integer:=0;
 item uuid;kind text;bu public.units%rowtype;un public.units%rowtype;factor numeric;physical numeric;actual_base numeric;theoretical numeric;delta numeric;
 blocked numeric;reserved numeric;label jsonb;ccy text;key uuid;count_action text;
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
  count_action:=coalesce(nullif(r->>'count_action',''),'count');
  if count_action not in('count','adjust_in','adjust_out') then raise exception 'Fila %: acción de conteo inválida',idx;end if;
  if length(coalesce(r->>'notes',''))>1000 then raise exception 'Fila %: observaciones demasiado largas',idx;end if;
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
  if count_action<>'count' and physical<=0 then raise exception 'Fila %: para un ajuste captura una cantidad positiva',idx;end if;
  actual_base:=case count_action when 'adjust_in' then theoretical+actual_base when 'adjust_out' then theoretical-actual_base else actual_base end;
  delta:=actual_base-theoretical;
  if actual_base<blocked+reserved then raise exception 'Fila %: el conteo es menor que las unidades reservadas o en curación. Revisa esas reservas antes de ajustar este artículo',idx;end if;
  label:=access_private.inventory_context(c,kind,item,'adjustment',key,clock_timestamp());
  label:=label||jsonb_build_object('line_key',key,'item_kind',kind,'item_id',item,'unit',un.symbol,'theoretical',theoretical/factor,'action',count_action,'captured_quantity',physical,'actual',actual_base/factor,'difference',delta/factor,'theoretical_base',theoretical,'actual_base',actual_base,'difference_base',delta,'base_unit',bu.symbol,'reserved',reserved,'blocked',blocked,'notes',coalesce(r->>'notes',''));
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
end $function$
;
