alter table public.products add column is_intermediate boolean not null default false,
  add column available_for_sale boolean not null default true;
alter table public.inventory_lots alter column created_at set default clock_timestamp();

create table access_private.formula_intermediates (
  company_id uuid not null,
  formula_id uuid not null,
  variant_id uuid not null,
  unit_id uuid not null,
  quantity numeric(20,8) not null check(quantity>0 and quantity<1e12),
  primary key(company_id,formula_id,variant_id),
  foreign key(company_id,formula_id) references public.formulas(company_id,id),
  foreign key(company_id,variant_id) references public.product_variants(company_id,id),
  foreign key(company_id,unit_id) references public.units(company_id,id)
);
create index formula_intermediates_variant on access_private.formula_intermediates(company_id,variant_id);

create function access_private.guard_intermediate_unit()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.unit_id is distinct from old.unit_id and exists(
   select 1 from public.product_variants v
   where v.company_id=old.company_id and v.product_id=old.id and (
    exists(select 1 from access_private.formula_intermediates i where i.company_id=v.company_id and i.variant_id=v.id)
    or ((old.is_intermediate or new.is_intermediate) and exists(select 1 from public.inventory_balances b
      where b.company_id=v.company_id and b.item_kind='variant' and b.item_id=v.id and b.on_hand<>0))
   )
 ) then raise exception 'La unidad de inventario está en uso por una fórmula o por existencias del producto intermedio';end if;
 return new;
end $$;
revoke all on function access_private.guard_intermediate_unit() from public,anon,authenticated;
create trigger guard_intermediate_unit before update of unit_id on public.products
 for each row execute function access_private.guard_intermediate_unit();

create table access_private.production_intermediate_consumptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  batch_id uuid not null,
  variant_id uuid not null,
  quantity numeric(20,8) not null check(quantity>=0 and quantity<1e12),
  cost numeric,
  breakdown jsonb not null default '[]',
  breakdown_pending boolean not null default false,
  unique(company_id,batch_id,variant_id),
  foreign key(company_id,batch_id) references public.production_batches(company_id,id),
  foreign key(company_id,variant_id) references public.product_variants(company_id,id)
);

create function access_private.save_formula_intermediates(c uuid,fid uuid,items jsonb)
returns void language plpgsql set search_path='' as $$
declare product uuid; item jsonb;
begin
 select product_id into strict product from public.formulas where company_id=c and id=fid;
 if jsonb_typeof(items)<>'array' or jsonb_array_length(items)>100 then raise exception 'Revisa los productos intermedios';end if;
 delete from access_private.formula_intermediates where company_id=c and formula_id=fid;
 for item in select value from jsonb_array_elements(items) loop
  insert into access_private.formula_intermediates
  select c,fid,v.id,u.id,(item->>'quantity')::numeric
  from public.product_variants v join public.products p on p.company_id=c and p.id=v.product_id
  join public.units base on base.company_id=c and base.id=p.unit_id
  join public.units u on u.company_id=c and u.id=(item->>'unit_id')::uuid and u.dimension=base.dimension
  where v.company_id=c and v.id=(item->>'variant_id')::uuid and v.active and p.active and p.is_intermediate
    and (v.weight_min is null or base.dimension='count')
    and exists(select 1 from public.formulas f where f.company_id=c and f.product_id=p.id);
  if not found then raise exception 'Selecciona una variante intermedia con fórmula y unidad compatible';end if;
 end loop;
 if exists (
  with recursive dependencies(id) as (
    select v.product_id from access_private.formula_intermediates i join public.product_variants v on v.company_id=c and v.id=i.variant_id
    where i.company_id=c and i.formula_id=fid
    union
    select v.product_id from dependencies d join public.formulas f on f.company_id=c and f.product_id=d.id
    join access_private.formula_intermediates i on i.company_id=c and i.formula_id=f.id
    join public.product_variants v on v.company_id=c and v.id=i.variant_id
  ) select 1 from dependencies where id=product
 ) then raise exception 'La fórmula contiene una referencia circular';end if;
end $$;

create function access_private.intermediate_entry_cost(c uuid, lot uuid)
returns jsonb language sql stable set search_path='' as $$
 select b.recipe_snapshot->'component_costs'->bo.variant_id::text
 from public.inventory_lots il join public.batch_outputs bo on bo.company_id=c and bo.id=il.source_id
 join public.production_batches b on b.company_id=c and b.id=bo.batch_id
 where il.company_id=c and il.id=lot and il.source_kind='production_output'
$$;


create function access_private.consume_intermediates(c uuid,bid uuid,fid uuid,items jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare r record; a record; qty numeric; cid uuid; move jsonb; entry jsonb; components jsonb;
 pending boolean; known boolean:=true; amount numeric; total numeric:=0;
begin
 if jsonb_typeof(items)<>'array' or jsonb_array_length(items)<>(select count(*) from access_private.formula_intermediates where company_id=c and formula_id=fid)
   or jsonb_array_length(items)<>(select count(distinct e->>'variant_id') from jsonb_array_elements(items)e)
 then raise exception 'Completa el consumo real de productos intermedios';end if;
 for r in select i.variant_id,p.name,u.base_factor as input_factor,base.base_factor as stock_factor,(e->>'quantity')::numeric actual
  from jsonb_array_elements(items)e
  join access_private.formula_intermediates i on i.company_id=c and i.formula_id=fid and i.variant_id=(e->>'variant_id')::uuid
  join public.product_variants v on v.company_id=c and v.id=i.variant_id
  join public.products p on p.company_id=c and p.id=v.product_id
  join public.units u on u.company_id=c and u.id=i.unit_id
  join public.units base on base.company_id=c and base.id=p.unit_id
  where u.dimension=base.dimension order by i.variant_id
 loop
  qty:=round(r.actual*r.input_factor/r.stock_factor,8);
  if qty is null or not(qty>=0 and qty<1e12) or (qty<>trunc(qty) and exists(
    select 1 from public.inventory_units where company_id=c and variant_id=r.variant_id and status='available'
  )) then raise exception 'Cantidad inválida de %. Las unidades identificadas se consumen enteras',r.name;end if;
  insert into access_private.production_intermediate_consumptions(company_id,batch_id,variant_id,quantity)
  values(c,bid,r.variant_id,qty) returning id into cid;
  amount:=0; pending:=false; components:='[]';
  if qty>0 then
   if qty>coalesce((select on_hand-blocked-reserved from public.inventory_balances where company_id=c and item_kind='variant' and item_id=r.variant_id),0)
    then raise exception 'Existencia insuficiente de %',r.name;end if;
   move:=access_private.post_stock(c,'variant',r.variant_id,-qty,0,0,'production_intermediate',cid,null,'Consumo de producto intermedio');
   for a in select al.* from public.inventory_allocations al where al.company_id=c and al.movement_id=(move->>'movement')::uuid
   loop
    entry:=access_private.intermediate_entry_cost(c,a.lot_id);
    if entry is null or coalesce((entry->>'pending')::boolean,true) or entry->>'total' is null then pending:=true;end if;
    if a.currency=(select currency from public.companies where id=c) then
     amount:=amount+coalesce((entry->>'total')::numeric,a.unit_cost)*a.quantity;
     components:=components||coalesce((select jsonb_agg(e||jsonb_build_object('amount',(e->>'amount')::numeric*a.quantity))
      from jsonb_array_elements(coalesce(entry->'lines','[]'))e),'[]');
    else amount:=null;pending:=true;end if;
   end loop;
  end if;
  update access_private.production_intermediate_consumptions set cost=amount,breakdown=components,breakdown_pending=pending where id=cid;
  if amount is null then known:=false;else total:=total+amount;end if;
 end loop;
 if (select count(*) from access_private.production_intermediate_consumptions where company_id=c and batch_id=bid)<>jsonb_array_length(items)
 then raise exception 'Producto intermedio fuera de la fórmula o unidad incompatible';end if;
 return jsonb_build_object('known',known,'total',total);
end $$;

revoke all on function access_private.save_formula_intermediates(uuid,uuid,jsonb),
 access_private.intermediate_entry_cost(uuid,uuid),
 access_private.consume_intermediates(uuid,uuid,uuid,jsonb) from public,anon,authenticated;

create function access_private.composite_output_costs(c uuid,bid uuid,snapshot jsonb,n numeric,ccy text)
returns jsonb language sql stable set search_path='' as $$
 with outputs as (
  select o.*,snapshot#>'{weight_costs,units}' as weights
  from public.batch_outputs o where o.company_id=c and o.batch_id=bid
 ), lines as (
  select o.variant_id,e->>'line_kind' kind,null::text cost_id,null::text name,
   case when o.weights is not null and (e->>'line_kind'='packaging' or (e->>'line_kind'='auxiliary' and e->>'quantity_basis'='unit'))
     then (select sum((a->>'cost')::numeric) from jsonb_array_elements(o.weights) w
       cross join lateral jsonb_array_elements(w->'material_allocations') a
       where w->>'variant_id'=o.variant_id::text and a->>'material_id'=e->>'material_id')/o.quantity
     else (e->>'total_cost')::numeric*case when o.weights is not null
       then o.allocation_weight/nullif(coalesce(snapshot#>>'{weight_costs,total_weight}',snapshot#>>'{weight_costs,reference_weight}')::numeric,0)/o.quantity
       else 1/nullif(n,0) end end amount
  from outputs o cross join lateral jsonb_array_elements(snapshot->'lines') e
  union all
  select o.variant_id,e->>'kind',e->>'cost_id',e->>'name',(e->>'total')::numeric/nullif(n,0)
  from outputs o cross join lateral jsonb_array_elements(coalesce(snapshot#>'{weight_costs,fixed_costs,cost_lines}',snapshot#>'{additional_costs,cost_lines}','[]')) e
  union all
  select o.variant_id,e->>'kind',e->>'cost_id',e->>'name',(e->>'total')::numeric/o.quantity
  from outputs o cross join lateral jsonb_array_elements(o.weights) w
  cross join lateral jsonb_array_elements(w->'commercial_lines') e
  where w->>'variant_id'=o.variant_id::text
  union all
  select o.variant_id,e->>'kind',e->>'cost_id',e->>'name',(e->>'amount')::numeric*
    case when o.weights is not null then o.allocation_weight/nullif(coalesce(snapshot#>>'{weight_costs,total_weight}',snapshot#>>'{weight_costs,reference_weight}')::numeric,0)/o.quantity else 1/nullif(n,0) end
  from outputs o join access_private.production_intermediate_consumptions i on i.company_id=c and i.batch_id=bid
  cross join lateral jsonb_array_elements(i.breakdown)e
 ), grouped as (
  select variant_id,kind,cost_id,max(name) name,sum(amount) amount,not bool_and(amount is not null) incomplete
  from lines group by variant_id,kind,cost_id
 )
 select coalesce(jsonb_object_agg(o.variant_id::text,jsonb_build_object(
   'currency',ccy,'total',case when o.unit_cost is not null and costs.extra_known then o.unit_cost+costs.extra end,
   'pending',o.unit_cost is null or not costs.extra_known or costs.missing or
      coalesce((snapshot->>'opening_stock')::boolean,false) or
      exists(select 1 from access_private.production_intermediate_consumptions i where i.company_id=c and i.batch_id=bid and i.breakdown_pending),
   'lines',costs.components
 )),'{}') from outputs o
 cross join lateral (
  select coalesce(sum(amount) filter(where kind not in ('ingredient','packaging','auxiliary')),0)
    -coalesce((select sum((e->>'amount')::numeric) from access_private.production_intermediate_consumptions i
      cross join lateral jsonb_array_elements(i.breakdown)e where i.company_id=c and i.batch_id=bid
      and e->>'kind' not in ('ingredient','packaging','auxiliary')),0)*
       case when o.weights is not null then o.allocation_weight/nullif(coalesce(snapshot#>>'{weight_costs,total_weight}',snapshot#>>'{weight_costs,reference_weight}')::numeric,0)/o.quantity else 1/nullif(n,0) end as extra,
   coalesce(bool_and(not incomplete) filter(where kind not in('ingredient','packaging','auxiliary')),true) as extra_known,
   coalesce(bool_or(incomplete),false) as missing,
   coalesce(jsonb_agg(jsonb_build_object('kind',kind,'cost_id',cost_id,'name',name,'amount',amount)) filter(where amount is not null),'[]') components
  from grouped where variant_id=o.variant_id
 ) costs
$$;
revoke all on function access_private.composite_output_costs(uuid,uuid,jsonb,numeric,text) from public,anon,authenticated;

do $migration$
declare d text; target regprocedure; marker text;
begin
 d:=pg_get_functiondef('access_private.formula_command(uuid,text,uuid,jsonb)'::regprocedure);
 marker:='answer:=jsonb_build_object(''id'',fid,''version'',ver);';
 if strpos(d,marker)=0 then raise exception 'Cambió el guardado de fórmulas';end if;
 d:=replace(d,marker,$sql$
 if data ? 'intermediates' then perform access_private.save_formula_intermediates(c,fid,data->'intermediates');end if;
 answer:=jsonb_build_object('id',fid,'version',ver);$sql$);
 d:=replace(d,$old$jsonb_array_length(data->'ingredients') not between 1 and 100$old$,
   $new$(jsonb_array_length(data->'ingredients')>100 or (jsonb_array_length(data->'ingredients')=0 and coalesce(jsonb_array_length(data->'intermediates'),0)=0))$new$);
 d:=replace(d,$old$if not exists(select 1 from jsonb_array_elements(lines)x where x->>'line_kind'='ingredient') then$old$,
   $new$if not exists(select 1 from jsonb_array_elements(lines)x where x->>'line_kind'='ingredient') and coalesce(jsonb_array_length(data->'intermediates'),0)=0 then$new$);
 d:=replace(d,$old$'ingredients',coalesce($old$,$new$'intermediates',coalesce((select jsonb_agg(to_jsonb(i)||jsonb_build_object('name',p.name||' · '||v.name,'unit',u.symbol)) from access_private.formula_intermediates i join public.product_variants v on v.company_id=c and v.id=i.variant_id join public.products p on p.company_id=c and p.id=v.product_id join public.units u on u.company_id=c and u.id=i.unit_id where i.company_id=c and i.formula_id=fm.id),'[]'),'ingredients',coalesce($new$);
 execute d;

 d:=pg_get_functiondef('access_private.production_requirements(uuid,uuid,numeric,numeric)'::regprocedure);
 marker:=' ) select jsonb_agg(to_jsonb(rows) order by name) from rows';
 if strpos(d,marker)=0 then raise exception 'Cambió la consulta de requerimientos';end if;
 execute replace(d,marker,$sql$
  union all
  select v.id,p.name||' · '||v.name,v.sku,bu.symbol,array['intermediate']::text[],
    sum(i.quantity*s.scale*u.base_factor/bu.base_factor),
    greatest(0,coalesce(b.on_hand-b.blocked-b.reserved,0)),
    greatest(0,sum(i.quantity*s.scale*u.base_factor/bu.base_factor)-greatest(0,coalesce(b.on_hand-b.blocked-b.reserved,0)))
  from selected s join access_private.formula_intermediates i on i.company_id=c and i.formula_id=s.id
  join public.product_variants v on v.company_id=c and v.id=i.variant_id
  join public.products p on p.company_id=c and p.id=v.product_id
  join public.units u on u.company_id=c and u.id=i.unit_id
  join public.units bu on bu.company_id=c and bu.id=p.unit_id
  left join public.inventory_balances b on b.company_id=c and b.item_kind='variant' and b.item_id=v.id
  group by v.id,p.name,v.name,v.sku,bu.symbol,b.on_hand,b.blocked,b.reserved
$sql$||marker);

 d:=pg_get_functiondef('access_private.formula_catalog(uuid)'::regprocedure);
 marker:='''additional_costs'',';
 if strpos(d,marker)=0 then raise exception 'Cambió el catálogo de fórmulas';end if;
 execute replace(d,marker,$sql$'intermediate_options',coalesce((
 select jsonb_agg(jsonb_build_object('id',v.id,'product_id',p.id,'name',p.name||' · '||v.name,'unit_id',p.unit_id,'dimension',u.dimension,
 'available',coalesce((select b.on_hand-b.blocked-b.reserved from public.inventory_balances b
   where b.company_id=c and b.item_kind='variant' and b.item_id=v.id),0),
 'stock_entries',coalesce((select jsonb_agg(jsonb_build_object('remaining',il.remaining,'cost',
   case when il.currency=ccy then coalesce((access_private.intermediate_entry_cost(c,il.id)->>'total')::numeric,il.unit_cost) end)
   order by il.created_at,il.id) from public.inventory_lots il where il.company_id=c and il.item_kind='variant' and il.item_id=v.id and not il.blocked and il.remaining>0),'[]')) order by p.name,v.name)
 from public.product_variants v join public.products p on p.company_id=c and p.id=v.product_id
 join public.units u on u.company_id=c and u.id=p.unit_id
 where v.company_id=c and v.active and p.active and p.is_intermediate
 and exists(select 1 from public.formulas f where f.company_id=c and f.product_id=p.id)
 ),'[]'),'additional_costs',$sql$);

 d:=pg_get_functiondef('access_private.operations(uuid,text,uuid,jsonb)'::regprocedure);
 d:=replace(d,$old$else 'ud' end))$old$,$new$else coalesce(case when pr.is_intermediate then
    (select un.symbol from public.units un where un.company_id=pr.company_id and un.id=pr.unit_id) end,'ud') end))$new$);
 d:=replace(d,$old$or not exists(select 1 from public.batch_consumptions where company_id=p_company and batch_id=b.id and base_quantity>0)$old$,
  $new$or not (exists(select 1 from public.batch_consumptions where company_id=p_company and batch_id=b.id and base_quantity>0)
   or exists(select 1 from jsonb_array_elements(coalesce(p_data->'intermediates','[]')) e where (e->>'quantity')::numeric>0))$new$);
 marker:='  for r in select value from jsonb_array_elements(p_data->''outputs'') loop';
 if strpos(d,marker)=0 then raise exception 'Cambió la confirmación de producción'; end if;
 d:=replace(d,marker,$sql$
 if not b.opening_stock then
  v_result:=access_private.consume_intermediates(p_company,b.id,b.formula_id,coalesce(p_data->'intermediates','[]'));
  known:=known and (v_result->>'known')::boolean;
  total:=total+(v_result->>'total')::numeric;
 end if;
$sql$||marker);
 execute d;

 d:=pg_get_functiondef('access_private.variable_cost_plan(uuid,uuid,jsonb)'::regprocedure);
 marker:=' common_total:=case when common_known then common_material end;';
 if strpos(d,marker)=0 then raise exception 'Cambió el costo por peso';end if;
 execute replace(d,marker,$sql$
 select common_material+coalesce(sum(i.cost),0),common_known and coalesce(bool_and(i.cost is not null),true)
 into common_material,common_known from access_private.production_intermediate_consumptions i where i.company_id=c and i.batch_id=bid;
$sql$||marker);

 d:=pg_get_functiondef('access_private.batch_trace_guard()'::regprocedure);
 marker:='new.confirmed:=true;';
 if strpos(d,marker)=0 then raise exception 'Cambió el registro histórico de producción';end if;
 execute replace(d,marker,$sql$
 new.recipe_snapshot:=new.recipe_snapshot||jsonb_build_object(
 'intermediate_consumptions',coalesce((select jsonb_agg(to_jsonb(i)) from access_private.production_intermediate_consumptions i where i.company_id=new.company_id and i.batch_id=new.id),'[]'),
 'component_costs',access_private.composite_output_costs(new.company_id,new.id,new.recipe_snapshot,new.actual_quantity,new.currency));
$sql$||marker);

 d:=pg_get_functiondef('access_private.document_cancellation(uuid,text,uuid,jsonb)'::regprocedure);
 marker:='  for r in select mv.id from public.batch_consumptions';
 if strpos(d,marker)=0 then raise exception 'Cambió la reversión de producción';end if;
 d:=replace(d,marker,$sql$
  for r in select mv.id from access_private.production_intermediate_consumptions i
   join public.inventory_movements mv on mv.company_id=c and mv.source_kind='production_intermediate' and mv.source_id=i.id
   where i.company_id=c and i.batch_id=sid order by i.id loop
   perform access_private.cancellation_restore(c,aid,r.id);
  end loop;
$sql$||marker);
 d:=replace(d,$old$m.source_kind in('production_consumption','production_output','release')$old$,$new$m.source_kind in('production_consumption','production_intermediate','production_output','release')$new$);
 execute d;

 d:=pg_get_functiondef('access_private.inventory_context(uuid,text,uuid,text,uuid,timestamptz)'::regprocedure);
 marker:='elsif source in(''production_consumption'',''production_output'',''release'')';
 if strpos(d,marker)=0 then raise exception 'Cambió la referencia de movimientos';end if;
 execute replace(d,marker,$sql$elsif source='production_intermediate' then
   select b.id,to_jsonb(b) into did,doc from access_private.production_intermediate_consumptions i
   join public.production_batches b on b.company_id=c and b.id=i.batch_id where i.company_id=c and i.id=sid;
   num:='PROD-'||coalesce(doc->>'batch_number',left(did::text,8));
   dt:=coalesce((doc->>'production_date')::date,dt);movement_type:='production';
  $sql$||marker);

 d:=pg_get_functiondef('access_private.fund_line_cost(uuid,uuid,text)'::regprocedure);
 marker:='  if linked=ol.quantity then';
 if strpos(d,marker)=0 then raise exception 'Cambió el origen del costo para Fondos';end if;
 execute replace(d,marker,$sql$
 if linked=0 and exists(
  select 1 from public.inventory_movements im join public.inventory_allocations a on a.company_id=c and a.movement_id=im.id
  where im.company_id=c and im.source_kind='order_dispatch' and im.source_id=line_id
  group by im.id having sum(a.quantity)=ol.quantity and bool_and(
    coalesce(access_private.intermediate_entry_cost(c,a.lot_id)->>'pending','true')='false'
    and access_private.intermediate_entry_cost(c,a.lot_id)->>'currency'=ccy)
 ) then
  return (select jsonb_build_object('product_id',pid,'source',jsonb_build_object('basis','historical_components'),
    'components',jsonb_agg(e||jsonb_build_object('amount',(e->>'amount')::numeric*a.quantity/ol.quantity)))
   from public.inventory_movements im join public.inventory_allocations a on a.company_id=c and a.movement_id=im.id
   cross join lateral jsonb_array_elements(access_private.intermediate_entry_cost(c,a.lot_id)->'lines') e
   where im.company_id=c and im.source_kind='order_dispatch' and im.source_id=line_id);
 end if;
 if linked=ol.quantity and linked>0 and not exists(
  select 1 from public.inventory_units u left join public.production_batches b on b.company_id=c and b.id=u.batch_id
  where u.company_id=c and u.order_line_id=line_id and u.status='sold'
   and (coalesce(b.recipe_snapshot->'component_costs'->ol.variant_id::text->>'pending','true')<>'false'
    or b.currency is distinct from ccy)
 ) then
  return (select jsonb_build_object('product_id',pid,'source',jsonb_build_object('basis','historical_components'),
    'components',jsonb_agg(e||jsonb_build_object('amount',(e->>'amount')::numeric/linked)))
   from public.inventory_units u join public.production_batches pb on pb.company_id=c and pb.id=u.batch_id
   cross join lateral jsonb_array_elements(pb.recipe_snapshot->'component_costs'->ol.variant_id::text->'lines') e
   where u.company_id=c and u.order_line_id=line_id and u.status='sold');
 end if;
 if exists(select 1 from public.formulas f join access_private.formula_intermediates i on i.company_id=c and i.formula_id=f.id
    where f.company_id=c and f.product_id=pid and f.state='current') then
  return jsonb_build_object('reason','El producto compuesto requiere un desglose histórico verificable');
 end if;
$sql$||marker);

 foreach target in array array['access_private.sales(uuid,text,uuid,jsonb)'::regprocedure,
  'access_private.place_order(uuid,uuid,jsonb,boolean)'::regprocedure,'access_private.edit_sale(uuid,uuid,jsonb)'::regprocedure,
  'access_private.storefront(uuid)'::regprocedure] loop
  d:=pg_get_functiondef(target);
  if strpos(d,'pr.active')>0 then
   execute replace(d,'pr.active','pr.active and pr.available_for_sale');
  elsif strpos(d,'pv.active and p.active')>0 and target='access_private.edit_sale(uuid,uuid,jsonb)'::regprocedure then
   execute replace(d,'pv.active and p.active','pv.active and p.active and p.available_for_sale');
  else raise exception 'Cambió la consulta de ventas %',target;end if;
 end loop;
end $migration$;
