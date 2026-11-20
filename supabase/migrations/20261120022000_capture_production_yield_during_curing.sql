-- Capture a preliminary yield without changing the stock or dates of existing batches.
alter table public.production_batches
  add column yield_timing text check (yield_timing in ('before','after')),
  add column preliminary_quantity integer check (preliminary_quantity between 1 and 10000),
  add column preliminary_outputs jsonb check (jsonb_typeof(preliminary_outputs)='array');

-- Keep a zeroed historical output row as the reference for its original movement.
alter table public.batch_outputs
  drop constraint batch_outputs_quantity_check,
  add constraint batch_outputs_quantity_check check (quantity>=0);

create function access_private.validate_production_yield(c uuid, product uuid, outputs jsonb, allow_empty boolean)
returns integer language plpgsql set search_path='' as $$
declare total numeric;
begin
  if jsonb_typeof(outputs) is distinct from 'array' then
    raise exception 'Registra las variantes obtenidas';
  end if;
  if jsonb_array_length(outputs)>100 or exists (
    select 1 from jsonb_array_elements(outputs) as line
    where not coalesce((line->>'quantity')::numeric between 1 and 10000
      and (line->>'quantity')::numeric=trunc((line->>'quantity')::numeric),false)
      or not exists (select 1 from public.product_variants v
        where v.company_id=c and v.product_id=product and v.id=(line->>'variant')::uuid)
  ) or (select count(distinct (line->>'variant')::uuid) from jsonb_array_elements(outputs) as line)
       <> jsonb_array_length(outputs) then
    raise exception 'Registra unidades enteras positivas en variantes distintas del producto';
  end if;
  select coalesce(sum((line->>'quantity')::numeric),0) into total from jsonb_array_elements(outputs) as line;
  if total>10000 or (total=0 and not allow_empty) then
    raise exception 'Registra hasta 10000 unidades por lote';
  end if;
  return total::integer;
end $$;
revoke all on function access_private.validate_production_yield(uuid,uuid,jsonb,boolean) from public,anon,authenticated;

create function access_private.adjust_curing_yield(c uuid, bid uuid, outputs jsonb)
returns void language plpgsql set search_path='' as $$
declare
  b public.production_batches%rowtype;
  variant record;
  lot public.inventory_lots%rowtype;
  output_id uuid;
  delta integer;
  delta_cost numeric;
  movement_id uuid;
  posted jsonb;
  tracked_count integer;
begin
  select * into strict b from public.production_batches
    where company_id=c and id=bid and state='curing' and confirmed for update;
  for variant in
    with requested as (
      select (line->>'variant')::uuid as variant_id, (line->>'quantity')::integer as quantity
      from jsonb_array_elements(outputs) as line
    ), original as (
      select * from public.batch_outputs where company_id=c and batch_id=bid
    )
    select coalesce(o.variant_id,r.variant_id) as id, o.id as output_id, o.unit_cost, o.actual_weight,
      coalesce(o.quantity,0) as original_quantity, coalesce(r.quantity,0) as final_quantity,
      pv.weight_min,pv.weight_max,pv.name,pv.sku,pv.attributes
    from original o full join requested r on o.variant_id=r.variant_id
    join public.product_variants pv on pv.company_id=c and pv.id=coalesce(o.variant_id,r.variant_id)
    where coalesce(o.quantity,0)<>coalesce(r.quantity,0)
    order by 1
  loop
    delta:=variant.final_quantity-variant.original_quantity;
    output_id:=variant.output_id;
    delta_cost:=variant.unit_cost;
    if output_id is null then
      delta_cost:=b.total_cost/(select sum((line->>'quantity')::integer) from jsonb_array_elements(outputs) as line);
      insert into public.batch_outputs(company_id,batch_id,variant_id,quantity,allocation_weight,unit_cost)
      values(c,bid,variant.id,variant.final_quantity,
        (variant.weight_min+variant.weight_max)/2*variant.final_quantity,delta_cost)
      returning id into output_id;
      posted:=access_private.post_stock(c,'variant',variant.id,delta,delta,0,'production_output',
        output_id,delta_cost,'Variante registrada al confirmar el rendimiento final');
      lot.id:=(posted->>'lot')::uuid;
      movement_id:=(posted->>'movement')::uuid;
    else
      select * into strict lot from public.inventory_lots il
        where il.company_id=c and il.source_kind='production_output' and il.source_id=output_id and il.blocked
        for update;
      if lot.remaining<>variant.original_quantity then
        raise exception 'El inventario bloqueado de este lote cambió. Revisa sus movimientos antes de liberarlo';
      end if;
      select count(*) into tracked_count from public.inventory_units iu
        where iu.company_id=c and iu.lot_id=lot.id and iu.status='curing';
      if tracked_count not in (0,variant.original_quantity) then
        raise exception 'Las unidades rastreadas del lote cambiaron. Revisa sus movimientos antes de liberarlo';
      end if;
      update public.inventory_balances set on_hand=on_hand+delta,blocked=blocked+delta
        where company_id=c and item_kind='variant' and item_id=variant.id;
      insert into public.inventory_movements(company_id,item_kind,item_id,quantity,blocked_delta,source_kind,source_id,notes)
        values(c,'variant',variant.id,delta,delta,'curing_yield_adjustment',gen_random_uuid(),'Rendimiento final del lote '||b.batch_number)
        returning id into movement_id;
      update public.inventory_lots set remaining=remaining+delta where company_id=c and id=lot.id;
      if delta<0 then
        update public.inventory_units iu set status='retired',last_movement_id=movement_id
        where iu.company_id=c and iu.id in (
          select unit.id from public.inventory_units unit
          where unit.company_id=c and unit.lot_id=lot.id and unit.status='curing'
          order by unit.external_code is not null,unit.created_at desc,unit.id limit -delta
        );
        insert into public.inventory_allocations(company_id,movement_id,lot_id,quantity,unit_cost,currency)
          values(c,movement_id,lot.id,-delta,lot.unit_cost,lot.currency);
      end if;
    end if;
    if delta>0 and variant.weight_min is not null then
      insert into public.inventory_units(company_id,lot_id,batch_id,output_id,variant_id,weight,variant_snapshot,status,last_movement_id)
      select c,lot.id,bid,output_id,variant.id,null,
        jsonb_build_object('name',access_private.variant_label(to_jsonb(pv)),'sku',pv.sku,'attributes',pv.attributes,
          'weight_min',pv.weight_min,'weight_max',pv.weight_max,'product_name',p.name,
          'product_sku',p.sku,'batch_number',b.batch_number,'capture_mode','variant_units',
          'reference_weight',(pv.weight_min+pv.weight_max)/2),
        'curing',movement_id
      from generate_series(1,case when variant.output_id is not null and tracked_count=0 then variant.final_quantity else delta end)
      join public.product_variants pv on pv.company_id=c and pv.id=variant.id
      join public.products p on p.company_id=c and p.id=b.product_id;
    end if;
    if variant.output_id is not null then
      update public.batch_outputs bo set quantity=variant.final_quantity,
        actual_weight=case when variant.actual_weight is not null then (
          select case when count(*)=variant.final_quantity and count(iu.weight)=variant.final_quantity then sum(iu.weight) end
          from public.inventory_units iu where iu.company_id=c and iu.output_id=bo.id and iu.status='curing'
        ) end,
        allocation_weight=(variant.weight_min+variant.weight_max)/2*variant.final_quantity,
        estimated_cost=true
      where bo.company_id=c and bo.id=output_id;
    end if;
  end loop;
end $$;
revoke all on function access_private.adjust_curing_yield(uuid,uuid,jsonb) from public,anon,authenticated;

do $migration$
declare
  operations text := pg_get_functiondef('access_private.operations(uuid,text,uuid,jsonb)'::regprocedure);
  guard text := pg_get_functiondef('access_private.batch_trace_guard()'::regprocedure);
  variable_cost text := pg_get_functiondef('access_private.variable_cost_plan(uuid,uuid,jsonb)'::regprocedure);
  patch record;
begin
  for patch in select * from (values
    ('operations', $old$stock_review jsonb;$old$, $new$stock_review jsonb; staging_yield boolean:=false; completing_yield boolean:=p_action='batch_curing_complete'; preliminary integer; frozen_cost_payload jsonb;$new$),
    ('operations', $old$'batch_finish','batch_release','production_catalog'$old$, $new$'batch_finish','batch_curing_complete','batch_release','production_catalog'$new$),
    ('operations', $old$ elsif p_action='batch_finish' then$old$, $new$ elsif p_action in ('batch_finish','batch_curing_complete') then$new$),
    ('operations', $old$  if not (b.state='in_progress' or (b.opening_stock and b.state='curing' and not b.confirmed)) then if b.finish_payload=p_data then v_result:=jsonb_build_object('id',b.id,'state',b.state);update access_private.operation_requests set result=v_result where company_id=p_company and key=p_key;return v_result;end if;raise exception 'Este lote ya fue finalizado';end if;
$old$||repeat(' ',2)||$old$
 if nullif(p_data->>'expected_revision','') is not null and (p_data->>'expected_revision')::integer<>(select edit_revision from public.formulas where company_id=p_company and id=b.formula_id) then raise exception 'La fórmula fue corregida mientras preparabas el lote. Actualiza los consumos antes de confirmar' using errcode='40001';end if;
 if b.production_date>current_date then raise exception 'No se puede finalizar una producción futura';end if;
  -- Freeze curing from the same formula revision used for actual consumption.
  select * into strict f from public.formulas where company_id=p_company and id=b.formula_id;
  if b.opening_stock and b.available_on>current_date then raise exception 'Aún no llega la fecha de disponibilidad para pesar y registrar el lote';end if;
  if not b.opening_stock and (b.requires_curing,b.curing_days,b.available_on) is distinct from (f.requires_curing,f.curing_days,coalesce(b.available_on_override,b.production_date+f.curing_days)) then
   update public.production_batches set requires_curing=f.requires_curing,curing_days=f.curing_days,available_on=coalesce(b.available_on_override,production_date+f.curing_days) where company_id=p_company and id=b.id returning * into b;
  end if;
$old$, $new$  if completing_yield then
   if b.state='released' and b.finish_payload->'_final_yield_request'=p_data then
    v_result:=jsonb_build_object('id',b.id,'state','released');
    update access_private.operation_requests set result=v_result where company_id=p_company and key=p_key;
    return v_result;
   end if;
   if b.state<>'curing' or not b.confirmed then raise exception 'Este lote no está pendiente de confirmar rendimiento';end if;
  else
  if not (b.state='in_progress' or (b.opening_stock and b.state='curing' and not b.confirmed)) then if b.finish_payload=p_data then v_result:=jsonb_build_object('id',b.id,'state',b.state);update access_private.operation_requests set result=v_result where company_id=p_company and key=p_key;return v_result;end if;raise exception 'Este lote ya fue finalizado';end if;

 if nullif(p_data->>'expected_revision','') is not null and (p_data->>'expected_revision')::integer<>(select edit_revision from public.formulas where company_id=p_company and id=b.formula_id) then raise exception 'La fórmula fue corregida mientras preparabas el lote. Actualiza los consumos antes de confirmar' using errcode='40001';end if;
 if b.production_date>current_date then raise exception 'No se puede finalizar una producción futura';end if;
  -- Freeze curing from the same formula revision used for actual consumption.
  select * into strict f from public.formulas where company_id=p_company and id=b.formula_id;
  if b.opening_stock and b.available_on>current_date then raise exception 'Aún no llega la fecha de disponibilidad para pesar y registrar el lote';end if;
  if not b.opening_stock and (b.requires_curing,b.curing_days,b.available_on) is distinct from (f.requires_curing,f.curing_days,coalesce(b.available_on_override,b.production_date+f.curing_days)) then
   update public.production_batches set requires_curing=f.requires_curing,curing_days=f.curing_days,available_on=coalesce(b.available_on_override,production_date+f.curing_days) where company_id=p_company and id=b.id returning * into b;
  end if;
   staging_yield:=p_data ? 'yield_timing' and not b.opening_stock
     and case when b.available_on_override is not null then b.available_on>current_date else b.requires_curing end;
   if p_data ? 'yield_timing' and not staging_yield then raise exception 'Cambió la fecha o la condición de curado. Actualiza el lote';end if;
  end if;
$new$),
    ('operations', $old$  if (
 (select coalesce(sum((e->>'quantity')::numeric),0) from jsonb_array_elements(p_data->'outputs')e) not between 1 and 10000
 or exists(select 1 from jsonb_array_elements(p_data->'outputs')e where not coalesce((e->>'quantity')::numeric>0 and (e->>'quantity')::numeric=trunc((e->>'quantity')::numeric),false))
 ) then raise exception 'Registra cantidades enteras positivas; máximo 10000 unidades por lote';end if;
 if coalesce(jsonb_typeof(p_data->'consumptions'),'')<>'array' or coalesce(jsonb_typeof(p_data->'outputs'),'')<>'array' or jsonb_array_length(p_data->'outputs') not between 1 and 100 then raise exception 'Registra consumos reales y variantes obtenidas';end if;
$old$, $new$  qty_sum:=access_private.validate_production_yield(p_company,b.product_id,p_data->'outputs',staging_yield);
  if staging_yield then
   if coalesce(p_data->>'yield_timing','') not in ('before','after') then raise exception 'Elige cuándo registrar las unidades';end if;
   preliminary:=nullif(p_data->>'preliminary_quantity','')::integer;
   if (preliminary is not null and preliminary not between 1 and 10000)
     or (p_data->>'yield_timing'='before' and preliminary is null)
     or (p_data->>'yield_timing'='after' and qty_sum<>0)
     or (qty_sum>0 and qty_sum is distinct from preliminary) then
    raise exception 'Revisa el conteo y las cantidades por variante';
   end if;
  elsif completing_yield and qty_sum is distinct from nullif(p_data->>'final_quantity','')::integer then
   raise exception 'La suma por variante debe coincidir con el rendimiento final';
  end if;
  if completing_yield then
   total:=b.total_cost;
   known:=total is not null;
   frozen_cost_payload:=coalesce(b.finish_payload,'{}') || jsonb_build_object('outputs',p_data->'outputs','capture_mode','variant_units');
  elsif coalesce(jsonb_typeof(p_data->'consumptions'),'')<>'array' then
   raise exception 'Registra los consumos reales';
  end if;
  if not completing_yield then
$new$),
    ('operations', $old$ end if;
  for r in select value from jsonb_array_elements(p_data->'outputs') loop$old$, $new$ end if;
  end if;
  if staging_yield then
   update public.production_batches set state='curing',actual_quantity=null,
     scrap_quantity=coalesce(nullif(btrim(p_data->>'scrap'),'')::integer,0),
     total_cost=case when known then total end,finish_payload=p_data,
     yield_timing=p_data->>'yield_timing',preliminary_quantity=preliminary,
     preliminary_outputs=p_data->'outputs'
   where company_id=p_company and production_batches.id=b.id;
   v_result:=jsonb_build_object('id',b.id,'state','curing');
  else
   if completing_yield and b.yield_timing is null then
    perform access_private.adjust_curing_yield(p_company,b.id,p_data->'outputs');
   else
    qty_sum:=0;
  for r in select value from jsonb_array_elements(p_data->'outputs') loop$new$),
    ('operations', $old$variable_plan:=access_private.variable_cost_plan(p_company,b.id,p_data);$old$, $new$variable_plan:=access_private.variable_cost_plan(p_company,b.id,coalesce(frozen_cost_payload,p_data));$new$),
    ('operations', $old$  update public.production_batches set currency=(select currency from public.companies where companies.id=p_company),state='curing',actual_quantity=qty_sum,scrap_quantity=coalesce(nullif(btrim(p_data->>'scrap'),'')::integer,0),actual_weight=case when variable_plan is not null then (variable_plan->>'total_weight')::numeric else nullif(p_data->>'weight','')::numeric end,total_cost=case when known then total else null end,finish_payload=p_data||jsonb_build_object('_server_cost_plan',variable_plan) where company_id=p_company and production_batches.id=b.id;
  if b.available_on<=current_date and (b.opening_stock or b.available_on_override is not null or b.requires_curing is false) then
   perform access_private.operations(p_company,'batch_release',gen_random_uuid(),jsonb_build_object('batch',b.id,'reason','Disponible inmediatamente: la fórmula no requiere curado'));
  end if;
  v_result:=jsonb_build_object('id',b.id,'state',case when b.available_on<=current_date and (b.opening_stock or b.available_on_override is not null or b.requires_curing is false) then 'released' else 'curing' end);
$old$, $new$   end if;
   if completing_yield then
    update public.production_batches
    set actual_quantity=qty_sum,
        scrap_quantity=b.scrap_quantity,
        actual_weight=case when variable_plan is not null then (variable_plan->>'total_weight')::numeric
          when b.yield_timing is null then (select sum(actual_weight) from public.batch_outputs where company_id=p_company and batch_id=b.id and quantity>0) end,
        finish_payload=coalesce(b.finish_payload,'{}')||jsonb_build_object(
          '_final_yield_request',p_data,'_server_final_cost_plan',variable_plan)
    where company_id=p_company and production_batches.id=b.id;
    v_result:=access_private.operations(p_company,'batch_release',gen_random_uuid(),
      jsonb_build_object('batch',b.id,'reason',nullif(btrim(p_data->>'reason'),''),'override',p_data->'override'));
   else
  update public.production_batches set currency=(select currency from public.companies where companies.id=p_company),state='curing',actual_quantity=qty_sum,scrap_quantity=coalesce(nullif(btrim(p_data->>'scrap'),'')::integer,0),actual_weight=case when variable_plan is not null then (variable_plan->>'total_weight')::numeric else nullif(p_data->>'weight','')::numeric end,total_cost=case when known then total else null end,finish_payload=p_data||jsonb_build_object('_server_cost_plan',variable_plan) where company_id=p_company and production_batches.id=b.id;
  if b.available_on<=current_date and (b.opening_stock or b.available_on_override is not null or b.requires_curing is false) then
   perform access_private.operations(p_company,'batch_release',gen_random_uuid(),jsonb_build_object('batch',b.id,'reason','Disponible inmediatamente: la fórmula no requiere curado'));
  end if;
  v_result:=jsonb_build_object('id',b.id,'state',case when b.available_on<=current_date and (b.opening_stock or b.available_on_override is not null or b.requires_curing is false) then 'released' else 'curing' end);
   end if;
  end if;
$new$),
    ('operations', $old$  if b.state<>'curing' or not b.confirmed then raise exception 'Registra las unidades obtenidas antes de liberar el lote';end if;$old$, $new$  if b.state<>'curing' or not b.confirmed or b.actual_quantity is null then raise exception 'Registra las unidades obtenidas antes de liberar el lote';end if;$new$),
    ('operations', $old$  for x in select * from public.batch_outputs where company_id=p_company and batch_id=b.id loop
   perform access_private.post_stock$old$, $new$  for x in select * from public.batch_outputs where company_id=p_company and batch_id=b.id and quantity>0 loop
   perform access_private.post_stock$new$),
    ('variable_cost', $old$and id=bid and not confirmed;$old$, $new$and id=bid and (not confirmed or (state='curing' and yield_timing is not null and actual_quantity is null));$new$),
    ('guard', $old$  if old.state='curing' and new.state='curing' then$old$, $new$  if old.state='curing' and new.state='curing' then
   if old.confirmed and new.actual_quantity between 1 and 10000 and new.finish_payload ? '_final_yield_request'
      and (to_jsonb(new)-array['actual_quantity','actual_weight','finish_payload']) =
          (to_jsonb(old)-array['actual_quantity','actual_weight','finish_payload']) then
    if old.yield_timing is not null then
     new.recipe_snapshot:=new.recipe_snapshot || jsonb_build_object(
       'final_quantity',new.actual_quantity,
       'component_costs',access_private.composite_output_costs(new.company_id,new.id,new.recipe_snapshot,new.actual_quantity,new.currency));
     if jsonb_typeof(new.finish_payload->'_server_final_cost_plan')='object' then
      new.recipe_snapshot:=new.recipe_snapshot || jsonb_build_object(
        'production_mode','variable_weight','weight_costs',new.finish_payload->'_server_final_cost_plan',
        'estimated_total_cost',new.finish_payload#>'{_server_final_cost_plan,total_cost}',
        'estimated_unit_cost',(new.finish_payload#>>'{_server_final_cost_plan,total_cost}')::numeric/new.actual_quantity);
     else
      new.recipe_snapshot:=jsonb_set(new.recipe_snapshot,'{additional_costs}',
        (new.recipe_snapshot->'additional_costs')||jsonb_build_object(
         'unit_basis_count',new.actual_quantity,
         'overhead_unit',(new.recipe_snapshot#>>'{additional_costs,overhead_total}')::numeric/new.actual_quantity,
         'additional_unit',(new.recipe_snapshot#>>'{additional_costs,additional_total}')::numeric/new.actual_quantity));
      new.recipe_snapshot:=new.recipe_snapshot || jsonb_build_object(
       'estimated_unit_cost',(new.recipe_snapshot->>'estimated_total_cost')::numeric/new.actual_quantity);
     end if;
    end if;
    return new;
   end if;$new$),
    ('guard', $old$   elsif (select production_mode$old$, $new$   elsif new.yield_timing is not null and (select production_mode from public.formulas where company_id=new.company_id and id=new.formula_id)='variable_weight' then
    new.recipe_snapshot:=new.recipe_snapshot||jsonb_build_object('production_mode','variable_weight');
   elsif (select production_mode$new$),
    ('guard', $old$new.actual_quantity,(select f.estimate_variant_id$old$, $new$coalesce(new.actual_quantity,new.preliminary_quantity,new.planned_quantity),(select f.estimate_variant_id$new$),
    ('guard', $old$new.recipe_snapshot,new.actual_quantity,new.currency));$old$, $new$new.recipe_snapshot,coalesce(new.actual_quantity,new.preliminary_quantity,new.planned_quantity),new.currency));$new$)
  ) as edits(target, old_text, new_text) loop
    case patch.target
      when 'operations' then
        if strpos(operations,patch.old_text)=0 then raise exception 'Cambió la definición de operaciones de producción'; end if;
        operations:=replace(operations,patch.old_text,patch.new_text);
      when 'guard' then
        if strpos(guard,patch.old_text)=0 then raise exception 'Cambió la validación del lote'; end if;
        guard:=replace(guard,patch.old_text,patch.new_text);
      when 'variable_cost' then
        if strpos(variable_cost,patch.old_text)=0 then raise exception 'Cambió el reparto de costos'; end if;
        variable_cost:=replace(variable_cost,patch.old_text,patch.new_text);
    end case;
  end loop;
  execute operations;
  execute guard;
  execute variable_cost;
end
$migration$;
