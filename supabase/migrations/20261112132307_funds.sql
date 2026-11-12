create table public.fund_movements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  fund_key text not null,
  fund_name text not null,
  kind text not null check (kind in ('sale','expense','transfer','reversal','pending')),
  currency text not null,
  amount numeric(24,2) not null check (amount between -1e20 and 1e20),
  occurred_on date not null,
  created_at timestamptz not null default now(),
  created_by uuid,
  order_id uuid,
  product_id uuid,
  product_name text,
  document_number bigint,
  customer_name text,
  description text not null,
  reference text not null default '',
  operation_id uuid not null,
  reversal_of uuid,
  detail jsonb not null default '{}',
  unique(company_id,id),
  foreign key(company_id,order_id) references public.sales_orders(company_id,id),
  foreign key(company_id,reversal_of) references public.fund_movements(company_id,id)
);
create unique index fund_reversed_once on public.fund_movements(company_id,reversal_of) where reversal_of is not null;
create unique index fund_manual_once on public.fund_movements(company_id,operation_id,fund_key) where kind in ('expense','transfer');
create index fund_order on public.fund_movements(company_id,order_id) where order_id is not null;
create index fund_history on public.fund_movements(company_id,occurred_on desc,created_at desc,id);
alter table public.fund_movements enable row level security;
revoke all on public.fund_movements from public,anon,authenticated;
grant select on public.fund_movements to authenticated;
create policy fund_admin_read on public.fund_movements for select to authenticated
using (public.company_permission(company_id,'manage'));

create function access_private.fund_line_cost(c uuid, line_id uuid, ccy text)
returns jsonb language plpgsql stable set search_path='' as $$
declare
  ol public.order_lines%rowtype;
  f public.formulas%rowtype;
  b public.production_batches%rowtype;
  pid uuid;
  batch_ids uuid[];
  linked integer;
  candidates integer;
  estimated_units numeric;
  weight_factor numeric;
  material_rows jsonb;
  extra jsonb;
  selected jsonb;
  source jsonb;
  measured jsonb;
  historical_total numeric;
  component_total numeric;
begin
  select * into strict ol from public.order_lines where company_id=c and id=line_id;
  select product_id into strict pid from public.product_variants where company_id=c and id=ol.variant_id;
  select count(*),array_agg(distinct batch_id) into linked,batch_ids from public.inventory_units
  where company_id=c and order_line_id=line_id and status='sold' and variant_id=ol.variant_id;
  if linked=ol.quantity then
    with units as (
      select u.id,u.cost_snapshot s,pb.recipe_snapshot recipe
      from public.inventory_units u join public.production_batches pb on pb.company_id=c and pb.id=u.batch_id
      where u.company_id=c and u.order_line_id=line_id and u.status='sold' and u.variant_id=ol.variant_id
        and pb.confirmed and pb.currency=ccy and pb.recipe_snapshot->>'cost_basis'='catalog_purchase'
        and pb.recipe_snapshot#>>'{weight_costs,cost_schema}'='3' and u.cost_snapshot->>'total_cost' is not null
        and coalesce(u.cost_snapshot->>'weight',u.cost_snapshot->>'reference_weight') is not null
    ), breakdown as (
      select e->>'line_kind' kind,null::text cost_id,null::text name,
        (e->>'total_cost')::numeric*coalesce(s->>'weight',s->>'reference_weight')::numeric/
          nullif(coalesce(recipe#>>'{weight_costs,total_weight}',recipe#>>'{weight_costs,reference_weight}')::numeric,0) amount
      from units cross join lateral jsonb_array_elements(recipe->'lines') e
      where e->>'line_kind'='ingredient' or (e->>'line_kind'='auxiliary' and e->>'quantity_basis'<>'unit')
      union all
      select m->>'line_kind',null,null,(e->>'cost')::numeric
      from units cross join lateral jsonb_array_elements(s->'material_allocations') e
      left join lateral (select m from jsonb_array_elements(recipe->'lines') m where m->>'material_id'=e->>'material_id' limit 1) material on true
      union all
      select e->>'kind',e->>'cost_id',e->>'name',(e->>'total')::numeric
      from units cross join lateral jsonb_array_elements(s->'commercial_lines') e
      union all
      select e->>'kind',e->>'cost_id',e->>'name',(e->>'total')::numeric/nullif((recipe#>>'{weight_costs,unit_count}')::numeric,0)
      from units cross join lateral jsonb_array_elements(recipe#>'{weight_costs,fixed_costs,cost_lines}') e
    )
    select case when bool_and(amount is not null and kind is not null) then
        jsonb_agg(jsonb_build_object('kind',kind,'cost_id',cost_id,'name',name,'amount',amount/ol.quantity)) end,
      sum(amount),
      (select case when count(*)=ol.quantity then sum((s->>'total_cost')::numeric) end from units)
    into measured,component_total,historical_total from breakdown;
    if measured is not null and abs(component_total-historical_total)<0.000001 then
      return jsonb_build_object('product_id',pid,'components',measured,
        'source',jsonb_build_object('batch_ids',batch_ids,'basis','historical_units'));
    end if;
  end if;
  if linked=ol.quantity and cardinality(batch_ids)=1 then
    select * into b from public.production_batches where company_id=c and id=batch_ids[1]
      and confirmed and currency=ccy and actual_quantity>0;
    if found and b.recipe_snapshot->>'cost_basis'='catalog_purchase'
      and b.recipe_snapshot#>>'{formula,production_mode}'='fixed'
      and b.recipe_snapshot#>>'{additional_costs,variant_id}'=ol.variant_id::text
      and jsonb_typeof(b.recipe_snapshot->'lines')='array'
      and jsonb_array_length(b.recipe_snapshot->'lines')>0
      and jsonb_typeof(b.recipe_snapshot#>'{additional_costs,cost_lines}')='array'
      and not exists(select 1 from jsonb_array_elements(b.recipe_snapshot->'lines') e where e->>'total_cost' is null)
      and not exists(select 1 from jsonb_array_elements(b.recipe_snapshot#>'{additional_costs,cost_lines}') e where e->>'total' is null)
    then
      select jsonb_agg(jsonb_build_object('kind',e->>'line_kind','amount',(e->>'total_cost')::numeric/b.actual_quantity))
        into material_rows from jsonb_array_elements(b.recipe_snapshot->'lines') e;
      select coalesce(jsonb_agg(jsonb_build_object('kind',e->>'kind','cost_id',e->>'cost_id','name',e->>'name','amount',(e->>'total')::numeric/b.actual_quantity)),'[]')
        into extra from jsonb_array_elements(b.recipe_snapshot#>'{additional_costs,cost_lines}') e;
      return jsonb_build_object('product_id',pid,'components',material_rows||extra,'source',jsonb_build_object('batch_id',b.id,'formula_id',b.formula_id));
    end if;
  end if;

  select count(distinct family_id) into candidates from public.formulas
  where company_id=c and product_id=pid and state='current'
    and (estimate_variant_id is null or estimate_variant_id=ol.variant_id or production_mode='variable_weight' or ol.weight_min is not null);
  if candidates<>1 then return jsonb_build_object('reason','Falta una fórmula vigente inequívoca'); end if;
  select * into f from public.formulas where company_id=c and product_id=pid and state='current'
    and (estimate_variant_id is null or estimate_variant_id=ol.variant_id or production_mode='variable_weight' or ol.weight_min is not null)
    order by version desc limit 1;
  estimated_units:=f.estimated_units;
  if f.production_mode='variable_weight' or ol.weight_min is not null then
    if f.estimated_final_weight_g is null or ol.weight_min is null or ol.weight_max is null or ol.weight_max<=ol.weight_min then
      return jsonb_build_object('reason','Falta el rendimiento final o el rango de peso');
    end if;
    weight_factor:=(ol.weight_min+ol.weight_max)/2/f.estimated_final_weight_g;
  end if;
  if not exists(select 1 from public.formula_ingredients where company_id=c and formula_id=f.id and line_kind='ingredient') then
    return jsonb_build_object('reason','Falta la composición de la fórmula');
  end if;
  -- The saved quantities in percentage mode are already converted by formula_command.
  select jsonb_agg(jsonb_build_object('kind',i.line_kind,'amount',
    case when quote.currency=ccy and u.dimension=bu.dimension then
      access_private.planned_material_quantity(i.quantity,i.quantity_basis,1,estimated_units)
      *u.base_factor/bu.base_factor*quote.unit_cost
      *case when weight_factor is not null and i.line_kind<>'packaging'
        and not(i.line_kind='auxiliary' and i.quantity_basis='unit') then weight_factor
        else 1/nullif(estimated_units,0) end end))
    into material_rows
    from public.formula_ingredients i
    join public.raw_materials m on m.company_id=c and m.id=i.material_id
    join public.units u on u.company_id=c and u.id=i.unit_id
    join public.units bu on bu.company_id=c and bu.id=m.unit_id
    left join lateral access_private.material_purchase_quote(c,i.material_id) quote on true
    where i.company_id=c and i.formula_id=f.id;
  if material_rows is null or exists(select 1 from jsonb_array_elements(material_rows) e where e->>'amount' is null) then
    return jsonb_build_object('reason','Faltan precios vigentes, unidades compatibles o rendimiento');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('cost_id',cost_id,'quantity',quantity,'percent',percent)),'[]')
    into selected from public.formula_overhead_lines where company_id=c and formula_id=f.id;
  extra:=access_private.additional_cost_quote(c,1,ol.variant_id,null,null,selected);
  if extra->>'currency'<>ccy or extra->>'additional_total' is null then
    return jsonb_build_object('reason','Falta el precio BASE o la moneda del costo adicional');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('kind',e->>'kind','cost_id',e->>'cost_id','name',e->>'name','amount',(e->>'total')::numeric)),'[]')
    into extra from jsonb_array_elements(extra->'cost_lines') e;
  source:=jsonb_build_object('formula_id',f.id,'version',f.version,'basis','current_formula');
  return jsonb_build_object('product_id',pid,'components',material_rows||extra,'source',source);
end $$;

create function access_private.sync_sale_funds(c uuid, oid uuid)
returns void language plpgsql set search_path='' as $$
declare
  so public.sales_orders%rowtype;
  l record;
  q jsonb;
  receipts jsonb;
  paid numeric;
  payment_date date;
  collected numeric;
  components jsonb:='[]';
  missing jsonb:='[]';
  allocation uuid:=gen_random_uuid();
  assigned numeric:=0;
  x record;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ohana:funds:'||oid::text,0));
  select * into so from public.sales_orders where company_id=c and id=oid;
  if not found then return; end if;
  select coalesce(sum(p.amount),0),max(greatest(p.received_on,s.exchanged_on,
      (select max(a.occurred_on) from public.courier_account_movements a
       where a.company_id=c and a.settlement_id=s.id and a.kind='exchange' and a.reversal_of is null))),
    coalesce(jsonb_agg(jsonb_build_object('payment_id',p.id,'settlement_id',s.id) order by p.id),'[]')
  into paid,payment_date,receipts
  from public.order_payments p
  left join public.courier_settlement_items si on si.company_id=c and si.payment_id=p.id and si.active
  left join public.courier_settlements s on s.company_id=c and s.id=si.settlement_id and s.state='settled'
  where p.company_id=c and p.order_id=oid and p.confirmed and p.voided_at is null
    and (p.receiver='ohana' or (p.receiver='courier' and s.id is not null));

  if so.status in ('cancelled','expired') or so.fulfillment_stage='draft' or paid<so.total or paid<=0 then
    insert into public.fund_movements(company_id,fund_key,fund_name,kind,currency,amount,occurred_on,created_by,
      order_id,product_id,product_name,document_number,customer_name,description,operation_id,reversal_of)
    select c,m.fund_key,m.fund_name,'reversal',m.currency,-m.amount,current_date,auth.uid(),
      oid,m.product_id,m.product_name,m.document_number,m.customer_name,'Anulación del cobro',allocation,m.id
    from public.fund_movements m where m.company_id=c and m.order_id=oid and m.kind in ('sale','pending')
      and not exists(select 1 from public.fund_movements r where r.company_id=c and r.reversal_of=m.id);
    return;
  end if;
  if exists(select 1 from public.fund_movements m where m.company_id=c and m.order_id=oid and m.kind in ('sale','pending')
    and not exists(select 1 from public.fund_movements r where r.company_id=c and r.reversal_of=m.id)) then return; end if;
  collected:=greatest(0,so.total-so.shipping);
  for l in select ol.id,ol.quantity,ol.description,p.name from public.order_lines ol
    join public.product_variants v on v.company_id=c and v.id=ol.variant_id
    join public.products p on p.company_id=c and p.id=v.product_id
    where ol.company_id=c and ol.order_id=oid and ol.quantity>0 order by ol.id
  loop
    q:=access_private.fund_line_cost(c,l.id,so.currency);
    if q ? 'reason' then
      missing:=missing||jsonb_build_array(l.description||' · '||(q->>'reason'));
    else
      components:=components||(
        select coalesce(jsonb_agg(e||jsonb_build_object('amount',(e->>'amount')::numeric*l.quantity,
          'product_id',q->>'product_id','product_name',l.name,'line_id',l.id,'source',q->'source')),'[]')
        from jsonb_array_elements(q->'components') e);
    end if;
  end loop;
  if jsonb_array_length(missing)>0 then
    insert into public.fund_movements(company_id,fund_key,fund_name,kind,currency,amount,occurred_on,created_by,
      order_id,document_number,customer_name,description,operation_id,detail)
    values(c,'pending','Pendiente','pending',so.currency,0,payment_date,auth.uid(),oid,so.number,
      so.customer_snapshot->>'name','Distribución pendiente de costos',allocation,
      jsonb_build_object('reasons',missing,'receipts',receipts,'merchandise',collected));
    return;
  end if;
  for x in with costs as (
    select e,
      case e->>'kind' when 'ingredient' then 'materials' when 'packaging' then 'packaging'
        when 'auxiliary' then 'supplies' when 'labor' then 'labor' when 'advertising' then 'advertising'
        else 'cost:'||(e->>'cost_id') end fund,
      case e->>'kind' when 'ingredient' then 'Materia prima' when 'packaging' then 'Empaque'
        when 'auxiliary' then 'Insumos' when 'labor' then 'Mano de obra' when 'advertising' then 'Publicidad'
        else e->>'name' end label
    from jsonb_array_elements(components) e
  ) select fund,max(label) label,(e->>'product_id')::uuid product_id,max(e->>'product_name') product_name,
      round(sum((e->>'amount')::numeric),2) amount,jsonb_agg(e) cost_detail
    from costs group by fund,e->>'product_id'
  loop
    if x.amount=0 then continue; end if;
    assigned:=assigned+x.amount;
    insert into public.fund_movements(company_id,fund_key,fund_name,kind,currency,amount,occurred_on,created_by,
      order_id,product_id,product_name,document_number,customer_name,description,operation_id,detail)
    values(c,x.fund,x.label,'sale',so.currency,x.amount,payment_date,auth.uid(),oid,x.product_id,x.product_name,
      so.number,so.customer_snapshot->>'name','Distribución de venta',allocation,jsonb_build_object('costs',x.cost_detail,'receipts',receipts));
  end loop;
  insert into public.fund_movements(company_id,fund_key,fund_name,kind,currency,amount,occurred_on,created_by,
    order_id,document_number,customer_name,description,operation_id,detail)
  values(c,'profit','Utilidad','sale',so.currency,collected-assigned,payment_date,auth.uid(),oid,so.number,
    so.customer_snapshot->>'name','Remanente de productos cobrados',allocation,jsonb_build_object('receipts',receipts,'merchandise',collected));
end $$;

create function access_private.fund_collection_event()
returns trigger language plpgsql security definer set search_path='' as $$
declare oid uuid;
begin
  if tg_table_name='courier_settlements' then
    if (old.state='settled') is distinct from (new.state='settled') then
      for oid in select distinct i.order_id from public.courier_settlement_items i
        where i.company_id=new.company_id and i.settlement_id=new.id and i.payment_id is not null order by i.order_id
      loop perform access_private.sync_sale_funds(new.company_id,oid); end loop;
    end if;
  elsif tg_table_name='sales_orders' then
    if new.status in ('cancelled','expired') then perform access_private.sync_sale_funds(new.company_id,new.id); end if;
  else
    if new.receiver='ohana' or new.voided_at is not null then
      perform access_private.sync_sale_funds(new.company_id,new.order_id);
    end if;
  end if;
  return null;
end $$;
revoke all on function access_private.fund_collection_event(),access_private.sync_sale_funds(uuid,uuid),
  access_private.fund_line_cost(uuid,uuid,text) from public,anon,authenticated;
create constraint trigger fund_payment_event after insert or update of confirmed,voided_at on public.order_payments
  deferrable initially deferred for each row execute function access_private.fund_collection_event();
create constraint trigger fund_settlement_event after update of state on public.courier_settlements
  deferrable initially deferred for each row execute function access_private.fund_collection_event();
create constraint trigger fund_order_event after update of status on public.sales_orders
  deferrable initially deferred for each row execute function access_private.fund_collection_event();

create function access_private.record_fund_movement(c uuid, k uuid, data jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare
  origin public.fund_movements%rowtype;
  destination public.fund_movements%rowtype;
  amount_value numeric:=round((data->>'amount')::numeric,2);
  d date:=(data->>'date')::date;
  note text:=trim(coalesce(data->>'description',''));
  ref text:=trim(coalesce(data->>'reference',''));
  target text:=nullif(data->>'destination','');
  ccy text:=data->>'currency';
  movement_kind text:=case when target is null then 'expense' else 'transfer' end;
begin
  if auth.uid() is null or not public.company_permission(c,'manage') then
    raise exception 'Fondos no autorizados' using errcode='42501';
  end if;
  if k is null or d is null or amount_value is null or not(amount_value>0 and amount_value<1e20)
    or length(note) not between 1 and 500 or length(ref)>200 then
    raise exception 'Revisa monto, fecha, concepto y referencia';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('ohana:fund-entry:'||c::text||k::text,0));
  if exists(select 1 from public.fund_movements where company_id=c and operation_id=k and kind in ('expense','transfer')) then return; end if;
  select * into origin from public.fund_movements where company_id=c and fund_key=data->>'origin'
    and currency=ccy and kind='sale' order by created_at desc,id limit 1;
  if not found then raise exception 'Selecciona un fondo de origen'; end if;
  if target is not null then
    select * into destination from public.fund_movements where company_id=c and fund_key=target and fund_key<>origin.fund_key
      and currency=ccy and kind='sale' order by created_at desc,id limit 1;
    if not found then raise exception 'Selecciona otro fondo en la misma moneda'; end if;
  end if;
  insert into public.fund_movements(company_id,fund_key,fund_name,kind,currency,amount,occurred_on,created_by,description,reference,operation_id,detail)
    values(c,origin.fund_key,origin.fund_name,movement_kind,ccy,-amount_value,d,auth.uid(),note,ref,k,
      case when target is null then '{}'::jsonb else jsonb_build_object('counterpart',destination.fund_name) end);
  if target is not null then
    insert into public.fund_movements(company_id,fund_key,fund_name,kind,currency,amount,occurred_on,created_by,description,reference,operation_id,detail)
      values(c,destination.fund_key,destination.fund_name,'transfer',ccy,amount_value,d,auth.uid(),note,ref,k,
        jsonb_build_object('counterpart',origin.fund_name));
  end if;
end $$;
revoke all on function access_private.record_fund_movement(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function access_private.record_fund_movement(uuid,uuid,jsonb) to authenticated;
create function public.record_fund_movement(p_company uuid,p_key uuid,p_data jsonb)
returns void language sql security invoker set search_path='' as $$
  select access_private.record_fund_movement(p_company,p_key,p_data)
$$;
revoke all on function public.record_fund_movement(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.record_fund_movement(uuid,uuid,jsonb) to authenticated;

create view public.fund_balances with (security_invoker=true) as
select company_id,fund_key,currency,(array_agg(fund_name order by created_at desc,id))[1] fund_name,
  coalesce(sum(amount) filter(where kind='sale'),0) sales,
  coalesce(sum(amount) filter(where kind='expense'),0) expenses,
  coalesce(sum(amount) filter(where kind='reversal'),0) reversals,
  coalesce(sum(amount) filter(where kind='transfer'),0) transfers,
  sum(amount) balance
from public.fund_movements where fund_key<>'pending' group by company_id,fund_key,currency;
revoke all on public.fund_balances from public,anon,authenticated;
grant select on public.fund_balances to authenticated;
