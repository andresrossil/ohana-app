-- Restore the six function definitions captured before the intervention.
-- Deploy the previous frontend before executing this script as a new migration.
-- No business rows are rewritten. Retain the batch RPC until old browser tabs have closed.
BEGIN;
CREATE OR REPLACE FUNCTION access_private.sales_fulfillment(c uuid, action text, k uuid DEFAULT NULL::uuid, data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare so public.sales_orders%rowtype;d public.sales_deliveries%rowtype;cached access_private.operation_requests%rowtype;target text;answer jsonb;line public.order_lines%rowtype;rev uuid; supply record; packaging_id uuid;
begin
 if auth.uid() is null or not public.company_permission(c,case when action in ('detail','invoice_customers','invoice_headers','preparation_list') then 'read' else 'write' end,'sales') then raise exception 'Pedido no autorizado' using errcode='42501';end if;

 if action in ('invoice_customers','invoice_headers','preparation_list') then
  return access_private.sales_worklist(c,action,data);
 end if;
 if action<>'detail' then
  if k is null then raise exception 'Identificador requerido';end if;
  perform pg_advisory_xact_lock(hashtextextended(c::text,0));
  select * into cached from access_private.operation_requests where company_id=c and key=k;
  if found then if cached.action<>'fulfillment_'||action or cached.payload<>data then raise exception 'Identificador utilizado con otros datos';end if;return cached.result;end if;
 end if;
 select * into strict so from public.sales_orders where company_id=c and id=(data->>'order')::uuid for update;
 select * into d from public.sales_deliveries where company_id=c and order_id=so.id;
 if action='detail' then return jsonb_build_object('order',to_jsonb(so),
    'gift_options',case when so.fulfillment_stage='preparing' then (
      select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'name',p.name||' · '||access_private.variant_label(to_jsonb(v)),
        'sku',v.sku,'barcode',v.barcode,'available',floor(b.on_hand-b.blocked-b.reserved)) order by p.name,v.name,v.id),'[]'::jsonb)
      from public.product_variants v
      join public.products p on p.company_id=v.company_id and p.id=v.product_id
      join public.inventory_balances b on b.company_id=v.company_id and b.item_kind='variant' and b.item_id=v.id
      where v.company_id=c and v.active and p.active and b.on_hand-b.blocked-b.reserved>=1
    ) else '[]'::jsonb end,'packaging_options',case when so.fulfillment_stage='preparing' then
      (select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'sku',m.sku,'unit',u.symbol,
        'available',coalesce(b.on_hand-b.blocked-b.reserved,0),'unit_cost',quote.unit_cost,'cost_currency',quote.currency) order by m.name),'[]')
       from public.raw_materials m join public.units u on u.company_id=c and u.id=m.unit_id
       left join public.inventory_balances b on b.company_id=c and b.item_kind='material' and b.item_id=m.id
       left join lateral access_private.material_purchase_quote(c,m.id) quote on true where m.company_id=c and m.active and m.classification in ('Material de empaque','Insumos')) else '[]'::jsonb end,
    'delivery',to_jsonb(d),'document_brand',(select jsonb_build_object('name',co.name,'logo_path',cs.details->>'document_logo_path')
      from public.companies co left join public.company_settings cs on cs.company_id=co.id where co.id=c),
    'commercial_info',(select jsonb_build_object('commercial_notes',bp.commercial_notes,'delivery_instructions',bp.delivery_instructions) from public.business_partners bp where bp.company_id=c and bp.id=so.customer_id),'settled',exists(select 1 from public.courier_settlement_items where company_id=c and order_id=so.id and active),'summary',access_private.delivery_payment_summary(c,so.id),'lines',coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from public.order_lines l where l.company_id=c and l.order_id=so.id and l.quantity>0),'[]'));end if;
 if so.status not in('pending','dispatched') or exists(select 1 from public.courier_settlement_items where company_id=c and order_id=so.id and active) then raise exception 'El pedido ya no permite cambiar su preparación';end if;
 if data->>'expected_stage' is distinct from so.fulfillment_stage then raise exception 'El pedido cambió. Actualiza su estado antes de continuar';end if;
 if so.fulfillment_stage='draft' then
  if action<>'confirm_customer' or so.status<>'pending' then
   raise exception 'Confirma primero el pedido con el cliente';
  end if;
  if (data->>'expected_revision')::integer is distinct from so.revision then
   raise exception 'La factura cambió. Actualiza el listado antes de confirmar';
  end if;

  declare
    shortages text;
  begin
    select string_agg(
      format('• %s: pedidas %s, disponibles %s (%s)', l.description, l.quantity,
        greatest(0,coalesce(b.on_hand-b.blocked-b.reserved,0)),
        case when b.item_id is null then 'sin inventario registrado' else 'existencias insuficientes' end),
      E'\n' order by l.description,l.id
    ) into shortages
    from public.order_lines l
    left join public.inventory_balances b on b.company_id=l.company_id and b.item_kind='variant' and b.item_id=l.variant_id
    where l.company_id=c and l.order_id=so.id and l.quantity>0
      and l.quantity>coalesce(b.on_hand-b.blocked-b.reserved,0);
    if shortages is not null then
      raise exception 'El pedido sigue en borrador. Revisa estas existencias:%', E'\n'||shortages;
    end if;
  end;
  for line in select * from public.order_lines where company_id=c and order_id=so.id and quantity>0 order by variant_id,id loop
   if not exists(select 1 from public.product_variants v join public.products p on p.company_id=v.company_id and p.id=v.product_id
      where v.company_id=c and v.id=line.variant_id and v.active and p.active) then
    raise exception 'La variante % ya no está activa',line.description;
   end if;
   if line.quantity > coalesce((select on_hand-blocked-reserved from public.inventory_balances
     where company_id=c and item_kind='variant' and item_id=line.variant_id),0) then
    raise exception 'No hay suficientes unidades disponibles de %',line.description;
   end if;
   perform access_private.post_stock(c,'variant',line.variant_id,0,0,line.quantity,'order_reservation',line.id);
   update public.order_lines set reserved_quantity=line.quantity where company_id=c and id=line.id;
  end loop;
  update public.sales_orders set fulfillment_stage='invoiced',revision=revision+1,expires_at=now()+interval '24 hours',
   fulfillment_history=fulfillment_history||jsonb_build_array(jsonb_build_object('stage','invoiced','action','confirm_customer','at',now(),'by',auth.uid()))
  where company_id=c and id=so.id;
  answer:=jsonb_build_object('id',so.id,'stage','invoiced');
  insert into access_private.operation_requests(company_id,key,action,payload,result) values(c,k,'fulfillment_'||action,data,answer);
  return answer;
 end if;
 if action='revert' then
  if so.status='pending' and so.fulfillment_stage='invoiced' then raise exception 'La factura ya está abierta';end if;
  if length(trim(coalesce(data->>'reason',''))) not between 5 and 500 then raise exception 'Indica el motivo de reversión (5 a 500 caracteres)';end if;
  if exists(select 1 from public.courier_settlement_items i join public.courier_settlements st on st.company_id=i.company_id and st.id=i.settlement_id where i.company_id=c and i.order_id=so.id and st.state='draft') then raise exception 'Anula primero el borrador de liquidación que incluye esta factura';end if;
  insert into public.sales_order_revisions(company_id,order_id,number,before_snapshot,created_by)
  values(c,so.id,so.revision+1,jsonb_build_object('action','revert','reason',data->>'reason','order',to_jsonb(so),'lines',(select jsonb_agg(to_jsonb(l)) from public.order_lines l where l.company_id=c and l.order_id=so.id and l.quantity>0),'delivery',to_jsonb(d)),auth.uid()) returning id into rev;
  for line in select * from public.order_lines where company_id=c and order_id=so.id and quantity>0 order by id loop
   if so.status='dispatched' then perform access_private.return_edited_sale_line(c,line.id);
   elsif line.reserved_quantity>0 then perform access_private.post_stock(c,'variant',line.variant_id,0,0,-line.reserved_quantity,'order_reopen_release',line.id,null,'Liberación de reserva al reabrir factura');end if;
   update public.order_lines set quantity=0,reserved_quantity=0 where company_id=c and id=line.id;
   -- Fresh line identities allow a later dispatch/reversal without reusing stock movement keys.

   if (line.price_reference->>'preparation_gift') is distinct from 'true' then
   insert into public.order_lines select (jsonb_populate_record(null::public.order_lines,to_jsonb(line)||jsonb_build_object('id',gen_random_uuid(),'reserved_quantity',0))).*;
   end if;
  end loop;
  update public.sales_orders set status='pending',fulfillment_stage='invoiced',revision=revision+1,expires_at=now()+interval '24 hours',
   fulfillment_history=fulfillment_history||jsonb_build_array(jsonb_build_object('stage','invoiced','action','revert','from',so.fulfillment_stage,'reason',data->>'reason','at',now(),'by',auth.uid()))
  where company_id=c and id=so.id;
  update public.sales_deliveries set status='pending',updated_at=now() where company_id=c and order_id=so.id;
  update public.sales_order_revisions set after_snapshot=jsonb_build_object('order',(select to_jsonb(o) from public.sales_orders o where o.company_id=c and o.id=so.id),'lines',(select jsonb_agg(to_jsonb(l)) from public.order_lines l where l.company_id=c and l.order_id=so.id and l.quantity>0),'delivery',(select to_jsonb(x) from public.sales_deliveries x where x.company_id=c and x.order_id=so.id)) where id=rev;
  answer:=jsonb_build_object('id',so.id,'stage','invoiced','reopened',true);
  insert into access_private.operation_requests(company_id,key,action,payload,result) values(c,k,'fulfillment_'||action,data,answer);return answer;
 end if;
 if action='prepare' and so.status='pending' and so.fulfillment_stage='invoiced' then target:='preparing';
 elsif action='finish' and so.status='pending' and so.fulfillment_stage='preparing' then
  declare
    gifts jsonb := coalesce(data->'gifts','[]'::jsonb);
    gift record;
  begin
    if jsonb_typeof(gifts)<>'array' then raise exception 'Regalos inválidos'; end if;
    if jsonb_array_length(gifts)>30 then raise exception 'Máximo 30 variantes de regalo por pedido'; end if;
    if exists(select 1 from jsonb_array_elements(gifts) e group by (e->>'variant')::uuid having count(*)>1) then
      raise exception 'Cada variante de regalo debe aparecer una sola vez';
    end if;
    for gift in
      select v.*,p.name as product_name,(e->>'quantity')::numeric as gift_quantity
      from jsonb_array_elements(gifts) e
      left join public.product_variants v on v.company_id=c and v.id=(e->>'variant')::uuid and v.active
      left join public.products p on p.company_id=c and p.id=v.product_id and p.active
      order by v.id
    loop
      if gift.product_name is null or not coalesce(gift.gift_quantity between 1 and 1000
        and gift.gift_quantity=trunc(gift.gift_quantity),false) then
        raise exception 'Selecciona una variante activa y una cantidad entera positiva';
      end if;
      insert into public.order_lines(company_id,order_id,variant_id,description,attributes,weight_min,
        weight_max,quantity,unit_price,reserved_quantity,price_reference,is_gift,line_discount)
      values(c,so.id,gift.id,gift.product_name||' · '||gift.name,gift.attributes,gift.weight_min,
        gift.weight_max,gift.gift_quantity,0,0,'{"preparation_gift":true}'::jsonb,true,0);
    end loop;
  end;

  perform access_private.sales(c,'dispatch',gen_random_uuid(),jsonb_build_object('order',so.id));
  
    if jsonb_typeof(coalesce(data->'packaging','[]'))<>'array' then raise exception 'Empaque inválido'; end if;
    if jsonb_array_length(coalesce(data->'packaging','[]'))>100 then raise exception 'Máximo 100 insumos por pedido'; end if;
    if exists(select 1 from jsonb_array_elements(coalesce(data->'packaging','[]')) e group by (e->>'material')::uuid having count(*)>1)
      then raise exception 'Cada insumo debe aparecer una sola vez'; end if;
    for supply in select m.id,m.name,m.active,m.classification,(e->>'quantity')::numeric quantity
      from jsonb_array_elements(coalesce(data->'packaging','[]')) e
      left join public.raw_materials m on m.company_id=c and m.id=(e->>'material')::uuid order by m.id
    loop
      if supply.id is null or not supply.active or supply.classification not in ('Material de empaque','Insumos')
        or not coalesce(supply.quantity>0 and supply.quantity<1e12 and supply.quantity=round(supply.quantity,8),false)
      then raise exception 'Selecciona un empaque o insumo activo y una cantidad positiva'; end if;
      if supply.quantity>coalesce((select b.on_hand-b.blocked-b.reserved from public.inventory_balances b
          where b.company_id=c and b.item_kind='material' and b.item_id=supply.id),0)
      then raise exception 'Existencias insuficientes de %',supply.name; end if;
      insert into access_private.order_packaging(company_id,order_id,material_id,quantity)
        values(c,so.id,supply.id,supply.quantity) returning id into packaging_id;
      perform access_private.post_stock(c,'material',supply.id,-supply.quantity,0,0,'order_packaging',packaging_id,null,'Empaque adicional del pedido');
    end loop;
    target:='finished';
 elsif action='handoff' and so.fulfillment_stage='finished' then
  if d.status='cancelled' then raise exception 'La entrega está cancelada';end if;
  if so.status='pending' then perform access_private.sales(c,'dispatch',gen_random_uuid(),jsonb_build_object('order',so.id));end if;
  target:=case when d.kind='courier' then 'courier' else 'delivered' end;
  update public.sales_deliveries set status=case when kind='courier' then 'in_transit' else 'delivered' end,updated_at=now() where company_id=c and order_id=so.id;
 else raise exception 'Completa primero la etapa anterior del pedido';end if;
 update public.sales_orders set fulfillment_stage=target,fulfillment_history=fulfillment_history||jsonb_build_array(jsonb_build_object('stage',target,'at',now(),'by',auth.uid())) where company_id=c and id=so.id;
 answer:=jsonb_build_object('id',so.id,'stage',target);
 insert into access_private.operation_requests(company_id,key,action,payload,result) values(c,k,'fulfillment_'||action,data,answer);return answer;
end $function$;

CREATE OR REPLACE FUNCTION access_private.sales_worklist(c uuid, action text, filters jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  start_date date := (now() at time zone 'America/Guatemala')::date;
  end_date date := start_date;
  lower_bound timestamptz;
  upper_bound timestamptz;
  selected_customer uuid;
  selected_status text;
  page_offset integer;
  result jsonb;
begin
  if action='invoice_customers' then
    return coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'name',b.name,'code',b.code) order by b.name,b.id)
      from public.business_partners b where b.company_id=c and b.is_customer),'[]');
  end if;
  start_date:=coalesce(nullif(filters->>'from','')::date,start_date);
  end_date:=coalesce(nullif(filters->>'to','')::date,start_date);
  if start_date>end_date then raise exception 'La fecha inicial debe ser anterior o igual a la final';end if;
  lower_bound:=start_date::timestamp at time zone 'America/Guatemala';
  upper_bound:=(end_date+1)::timestamp at time zone 'America/Guatemala';

  if action='invoice_headers' then
    selected_customer:=nullif(filters->>'customer','')::uuid;
    selected_status:=nullif(filters->>'status','');
    page_offset:=greatest(0,coalesce((filters->>'offset')::integer,0));
    with candidates as (
      select o.id,o.number,o.invoice_number,o.created_at,o.customer_id,
        jsonb_build_object('name',o.customer_snapshot->>'name') as customer_snapshot,
        o.currency,o.total,o.payment,o.paid_at,o.status,o.fulfillment_stage,o.revision,o.delivery,
        d.courier_snapshot->>'name' as courier_name,s.settled,
        case when o.status in ('cancelled','expired') then o.status
          when s.settled then 'settled'
          when o.status='dispatched' and o.fulfillment_stage='invoiced' then 'delivered'
          else o.fulfillment_stage end as display_status
      from public.sales_orders o
      left join public.sales_deliveries d on d.company_id=o.company_id and d.order_id=o.id
      cross join lateral (select exists(select 1 from public.courier_settlement_items i
        where i.company_id=o.company_id and i.order_id=o.id and i.active) as settled) s
      where o.company_id=c and o.created_at>=lower_bound and o.created_at<upper_bound
        and (selected_customer is null or o.customer_id=selected_customer)
    ), page_rows as (
      select * from candidates where selected_status is null or display_status=selected_status
      order by created_at desc,id desc limit 51 offset page_offset
    ), visible as (
      select *,access_private.delivery_payment_summary(c,id)->'balance' as balance
      from page_rows order by created_at desc,id desc limit 50
    )
    select jsonb_build_object('orders',coalesce((select jsonb_agg(to_jsonb(v) order by v.created_at desc,v.id desc) from visible v),'[]'),
      'has_more',(select count(*)=51 from page_rows)) into result;
    return result;
  end if;

  if action='preparation_list' then
    return coalesce((select jsonb_agg(jsonb_build_object(
      'id',o.id,'number',o.number,'invoice_number',o.invoice_number,'customer_id',o.customer_id,'customer_name',o.customer_snapshot->>'name',
      
    'total',o.total,'currency',o.currency,'phone',o.customer_snapshot->>'phone',
    'address',coalesce(nullif(d.address,''),o.customer_snapshot->>'address'),
    'department',d.department,'zone',d.zone,'delivery_kind',d.kind,
    'confirmed_at',confirmation.confirmed_at,'stage',o.fulfillment_stage,'lines',
      coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'variant_id',l.variant_id,'description',l.description,
        'quantity',l.quantity,'weight_min',l.weight_min,'weight_max',l.weight_max,'is_gift',l.is_gift,
        'attributes',l.attributes,'commercial_code',v.commercial_code,'sku',v.sku) order by l.id)
        from public.order_lines l
        left join public.product_variants v on v.company_id=l.company_id and v.id=l.variant_id
        where l.company_id=c and l.order_id=o.id and l.quantity>0),'[]')
    ) order by confirmation.confirmed_at,o.number)
    from public.sales_orders o
    
    left join public.sales_deliveries d on d.company_id=o.company_id and d.order_id=o.id
    cross join lateral (select max((event->>'at')::timestamptz) as confirmed_at
      from jsonb_array_elements(o.fulfillment_history) event where event->>'action'='confirm_customer') confirmation
    where o.company_id=c and (
    (o.status='pending' and o.fulfillment_stage in ('invoiced','preparing'))
    or (o.status='dispatched' and o.fulfillment_stage in ('finished','courier','delivered'))
  )
      and confirmation.confirmed_at>=lower_bound and confirmation.confirmed_at<upper_bound),'[]');
  end if;
  raise exception 'Consulta de ventas no válida';
end
$function$;

CREATE OR REPLACE FUNCTION access_private.courier_pending(c uuid, partner uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select coalesce(jsonb_agg(to_jsonb(z) order by delivered_at,number),'[]') from(
 select o.id order_id,o.payment payment_method,o.number,o.created_at,o.customer_snapshot->>'name' customer,d.status,
 (select st.id from public.courier_settlement_items i join public.courier_settlements st on st.company_id=i.company_id and st.id=i.settlement_id where i.company_id=c and i.order_id=o.id and st.state='draft' order by st.number limit 1) reserved_id,
 (select st.number from public.courier_settlement_items i join public.courier_settlements st on st.company_id=i.company_id and st.id=i.settlement_id where i.company_id=c and i.order_id=o.id and st.state='draft' order by st.number limit 1) reserved_number,
 (o.fulfillment_stage='finished' and d.status='pending') pending_handoff,
 case when o.fulfillment_stage='finished' and d.status='pending' then null else
 coalesce((select max((h->>'at')::timestamptz) from jsonb_array_elements(o.fulfillment_history) h where h->>'stage' in('courier','delivered')),d.updated_at) end delivered_at,
 case when o.payment='transfer' then 0 else coalesce((select sum(p.amount) from public.order_payments p where p.company_id=c and p.order_id=o.id and p.courier_id=partner and p.receiver='courier' and p.method='cash' and p.confirmed and p.voided_at is null and not exists(select 1 from public.courier_settlement_items i where i.company_id=c and i.payment_id=p.id and i.active)),0) end collected,
 case when o.payment='transfer' then 0 else greatest(0,o.total-access_private.order_covered(c,o.id)) end expected_cash,
 case when d.payer='ohana' and not exists(select 1 from public.courier_settlement_items i where i.company_id=c and i.delivery_id=d.id and i.active) then d.shipping_cost else 0 end shipping_cost,
 d.id delivery_id,o.total invoice_total,o.shipping shipping_charged
 from public.sales_orders o join public.sales_deliveries d on d.company_id=o.company_id and d.order_id=o.id
 where o.company_id=c and d.courier_id=partner and o.status='dispatched'
 and (d.status in('in_transit','delivered') or (o.fulfillment_stage='invoiced' and d.status<>'cancelled') or (o.fulfillment_stage='finished' and d.status='pending'))
 and not exists(select 1 from public.courier_settlement_items i where i.company_id=c and i.order_id=o.id and i.active)
 )z where collected>0 or shipping_cost>0 or expected_cash>0 or pending_handoff or reserved_id is not null
$function$;

CREATE OR REPLACE FUNCTION access_private.settlement_engine(c uuid, action text, k uuid DEFAULT NULL::uuid, data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare cached access_private.operation_requests%rowtype;s public.courier_settlements%rowtype;so public.sales_orders%rowtype;
 receipt public.order_payments%rowtype;m public.courier_account_movements%rowtype;
 partner uuid:=nullif(data->>'courier','')::uuid;sid uuid:=nullif(data->>'id','')::uuid;oid uuid;new_payment_id uuid;
 r record;x jsonb;pending jsonb;available jsonb;extra numeric;due numeric;v_collected numeric;v_cost numeric;actual numeric;before_value numeric;after_value numeric;signed_value numeric;
 n bigint;last_sequence bigint;reason text;answer jsonb;seen uuid[]:='{}';exchange_date date;v_direction text;v_method text;
begin
 if auth.uid() is null or not public.company_permission(c,case when action in('settlements','pending','settlement','account') then 'read' else 'write' end,'sales') then raise exception 'Liquidación no autorizada' using errcode='42501';end if;
 if length(data::text)>200000 then raise exception 'Solicitud demasiado extensa';end if;
 if action='settlements' then
  return coalesce((select jsonb_agg(to_jsonb(z) order by number desc) from(
   select st.*,access_private.settlement_remaining(c,st.id) remaining,case when st.state='cancelled' then 0 else abs(st.net)-abs(access_private.settlement_remaining(c,st.id)) end paid_total,b.name courier_name,(select count(distinct i.order_id) from public.courier_settlement_items i where i.company_id=c and i.settlement_id=st.id) order_count
   from public.courier_settlements st join public.business_partners b on b.company_id=st.company_id and b.id=st.courier_id
   where st.company_id=c and (partner is null or st.courier_id=partner)
   and (coalesce(data->>'state','')='' or st.state=data->>'state')
   and (nullif(data->>'from','') is null or st.settled_on>=(data->>'from')::date)
   and (nullif(data->>'to','') is null or st.settled_on<=(data->>'to')::date)
   order by st.number desc limit 500)z),'[]');
 elsif action='account' then
  perform 1 from public.business_partners where company_id=c and id=partner and is_courier;
  if not found then raise exception 'Mensajería no disponible';end if;
  return jsonb_build_object('balance',access_private.courier_balance(c,partner),'movements',coalesce((select jsonb_agg(to_jsonb(z) order by sequence desc) from(
   select a.*,sum(signed_amount) over(order by sequence) running_balance,
    exists(select 1 from public.courier_account_movements rev where rev.company_id=c and rev.reversal_of=a.id) reversed
   from public.courier_account_movements a where a.company_id=c and a.courier_id=partner)z),'[]'));
 elsif action='pending' then return access_private.courier_pending(c,partner);
 elsif action='settlement' then
  select * into strict s from public.courier_settlements where company_id=c and id=sid;
  return jsonb_build_object('document',to_jsonb(s)||jsonb_build_object('remaining',access_private.settlement_remaining(c,s.id),'paid_total',case when s.state='cancelled' then 0 else abs(s.net)-abs(access_private.settlement_remaining(c,s.id)) end),'payments',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('reversed',exists(select 1 from public.courier_account_movements rev where rev.company_id=c and rev.reversal_of=a.id)) order by a.sequence) from public.courier_account_movements a where a.company_id=c and a.settlement_id=s.id and a.kind='exchange'),'[]'),'balance',access_private.courier_balance(c,s.courier_id),'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.order_id,i.id) from public.courier_settlement_items i where i.company_id=c and i.settlement_id=sid),'[]'));
 end if;
 if k is null then raise exception 'Identificador de operación requerido';end if;
 perform pg_advisory_xact_lock(hashtextextended(c::text,0));
 select * into cached from access_private.operation_requests where company_id=c and key=k;
 if found then if cached.action<>'courier_'||action or cached.payload<>data then raise exception 'Identificador utilizado con otros datos';end if;return cached.result;end if;
 if action='settlement_save' then
  perform 1 from public.business_partners where company_id=c and id=partner and is_courier and active;
  if not found then raise exception 'Selecciona una mensajería activa de esta empresa';end if;
  if jsonb_typeof(data->'orders') is distinct from 'array' or jsonb_array_length(data->'orders') not between 1 and 300 then raise exception 'Selecciona entre 1 y 300 pedidos';end if;
  if nullif(data->>'date','') is null then raise exception 'Indica la fecha de liquidación';end if;
  pending:=access_private.courier_pending(c,partner);
  if sid is null then
   select coalesce(max(number),0)+1 into n from public.courier_settlements where company_id=c;
   insert into public.courier_settlements(company_id,courier_id,number,settled_on,notes,created_by) values(c,partner,n,(data->>'date')::date,coalesce(data->>'notes',''),auth.uid()) returning id into sid;
  else
   select * into strict s from public.courier_settlements where company_id=c and id=sid for update;
   if s.state<>'draft' then raise exception 'Solo se editan borradores';end if;
   if data ? 'expected_revision' and (data->>'expected_revision')::int is distinct from s.revision then raise exception 'El borrador cambió; vuelve a abrirlo';end if;
   update public.courier_settlements set courier_id=partner,settled_on=(data->>'date')::date,notes=coalesce(data->>'notes',''),revision=revision+1 where company_id=c and id=sid;
   delete from public.courier_settlement_items where company_id=c and settlement_id=sid;
  end if;
  for x in select value from jsonb_array_elements(data->'orders') loop
   oid:=case when jsonb_typeof(x)='string' then (x#>>'{}')::uuid else (x->>'order')::uuid end;
   if oid=any(seen) then raise exception 'Pedido repetido';end if;seen:=array_append(seen,oid);
   select value into available from jsonb_array_elements(pending) where value->>'order_id'=oid::text;
   if available is not null and nullif(available->>'reserved_id','')::uuid is distinct from sid and nullif(available->>'reserved_id','') is not null then raise exception 'La factura está reservada para otro borrador';end if;
   if available is null then raise exception 'El pedido ya fue liquidado, no está listo para esta mensajería o pertenece a otra empresa';end if;
   extra:=case when jsonb_typeof(x)='object' and coalesce((x->>'mark_collected')::boolean,false) then coalesce(nullif(x->>'extra_cash','')::numeric,0) else 0 end;
   if available->>'payment_method'='transfer' and (coalesce((x->>'mark_collected')::boolean,false) or extra>0) then raise exception 'La factura está marcada como transferencia; solo se puede liquidar el costo del envío';end if;
   if (available->>'pending_handoff')::boolean and coalesce((x->>'mark_collected')::boolean,false) then
    raise exception 'Registra la entrega a mensajería antes de marcar efectivo cobrado';
   end if;
   extra:=round(extra,2);
   if extra<0 or extra>=1e12 or (extra>0 and (available->>'expected_cash')::numeric<=0) then raise exception 'El efectivo adicional no es válido para esta factura';end if;

   if extra>0 and extra<>(available->>'expected_cash')::numeric and not coalesce((data->>'cash_discrepancies_confirmed')::boolean,false) then raise exception 'Confirma el cobro diferente al saldo pendiente antes de guardar';end if;
   select * into strict so from public.sales_orders where company_id=c and id=oid;
   for receipt in select op.* from public.order_payments op where op.company_id=c and op.order_id=oid and so.payment<>'transfer' and op.receiver='courier' and op.courier_id=partner and op.confirmed and op.method='cash' and op.voided_at is null and not exists(select 1 from public.courier_settlement_items i where i.company_id=c and i.payment_id=op.id and i.active) loop
    insert into public.courier_settlement_items(company_id,settlement_id,order_id,payment_id,amount,snapshot)
    values(c,sid,oid,receipt.id,receipt.amount,available||jsonb_build_object('type','collection','number',so.number,'customer',so.customer_snapshot->>'name','recorded_receipt',true));
   end loop;
   if extra>0 then
    insert into public.courier_settlement_items(company_id,settlement_id,order_id,collection_pending,amount,snapshot)
    values(c,sid,oid,true,extra,available||jsonb_build_object('type','collection','number',so.number,'customer',so.customer_snapshot->>'name','expected_due',available->'expected_cash','recorded_receipt',false));
   end if;
   if (available->>'shipping_cost')::numeric>0 or
      ((available->>'pending_handoff')::boolean or available->>'reserved_id'=sid::text)
      and not exists(select 1 from public.courier_settlement_items where company_id=c and settlement_id=sid and order_id=oid) then
    insert into public.courier_settlement_items(company_id,settlement_id,order_id,delivery_id,amount,snapshot)
    values(c,sid,oid,(available->>'delivery_id')::uuid,(available->>'shipping_cost')::numeric,available||jsonb_build_object('type','shipping','number',so.number,'customer',so.customer_snapshot->>'name'));
   end if;
   if not exists(select 1 from public.courier_settlement_items where company_id=c and settlement_id=sid and order_id=oid) then raise exception 'El pedido no tiene efectivo confirmado ni gastos de envío de Ohana para liquidar';end if;
  end loop;
  select coalesce(sum(amount) filter(where payment_id is not null or collection_pending),0),coalesce(sum(amount) filter(where delivery_id is not null),0) into v_collected,v_cost from public.courier_settlement_items where company_id=c and settlement_id=sid;
  update public.courier_settlements set collected=v_collected,shipping_cost=v_cost,net=v_collected-v_cost where company_id=c and id=sid;
  answer:=jsonb_build_object('id',sid);
 elsif action='settlement_confirm' then
  select * into strict s from public.courier_settlements where company_id=c and id=sid for update;
  if s.state<>'draft' or s.settled_on>current_date then raise exception 'Solo se confirman borradores con fecha actual o anterior';end if;
  if data ? 'expected_revision' and (data->>'expected_revision')::int is distinct from s.revision then raise exception 'El borrador cambió; vuelve a abrirlo';end if;
  partner:=s.courier_id;before_value:=access_private.courier_balance(c,partner);
  if data ? 'expected_balance' and (data->>'expected_balance')::numeric is distinct from before_value then raise exception 'El saldo del mensajero cambió; actualiza el resumen antes de confirmar';end if;
  actual:=round(nullif(data->>'actual_amount','')::numeric,2);v_direction:=case when s.net>=0 then 'received' else 'paid' end;v_method:=data->>'method';exchange_date:=nullif(data->>'exchange_date','')::date;
  if actual is null or actual<0 or actual>abs(s.net) or actual>=1e12 or v_direction not in('received','paid') or v_direction is null or v_method not in('cash','transfer') or v_method is null or exchange_date is null or exchange_date>current_date or length(coalesce(data->>'exchange_notes',''))>2000 then raise exception 'Revisa importe, dirección, método y fecha del intercambio';end if;
  if not exists(select 1 from public.courier_settlement_items where company_id=c and settlement_id=sid) then raise exception 'Liquidación vacía';end if;
  for r in select i.*,o.status order_status,o.fulfillment_stage order_stage,o.payment order_payment,d.courier_id,d.payer,d.shipping_cost,d.status delivery_status from public.courier_settlement_items i join public.sales_orders o on o.company_id=i.company_id and o.id=i.order_id join public.sales_deliveries d on d.company_id=i.company_id and d.order_id=i.order_id where i.company_id=c and i.settlement_id=sid order by i.order_id,i.collection_pending,i.id loop
   if r.order_status<>'dispatched' or r.delivery_status='cancelled' or r.courier_id<>partner or exists(select 1 from public.courier_settlement_items where company_id=c and order_id=r.order_id and active and settlement_id<>sid) then raise exception 'El pedido cambió o ya está liquidado; actualiza el borrador';end if;
   if r.order_stage='finished' and r.delivery_status='pending' then
    raise exception 'Registra la entrega a mensajería antes de liquidar el pedido';
   end if;
   if r.order_payment='transfer' and (r.collection_pending or r.payment_id is not null) then raise exception 'Una factura por transferencia no admite efectivo cobrado por mensajero. Vuelve a guardar el borrador para liquidar solo su envío';end if;
   if r.collection_pending then
    due:=greatest(0,(select total from public.sales_orders where company_id=c and id=r.order_id)-access_private.order_covered(c,r.order_id));
    if due<=0 or due<>(r.snapshot->>'expected_due')::numeric then raise exception 'El saldo de una factura cambió; actualiza el borrador';end if;
    new_payment_id:=access_private.add_order_payment(c,r.order_id,jsonb_build_object('amount',r.amount,'method','cash','receiver','courier','received_on',exchange_date,'confirmed',true,'expected_due',due,'discrepancy_confirmed',true,'notes','Efectivo confirmado en liquidación LIQ-'||lpad(s.number::text,4,'0')));
    update public.order_payments set settlement_generated=true where company_id=c and id=new_payment_id;
    update public.courier_settlement_items set payment_id=new_payment_id,collection_pending=false where company_id=c and id=r.id;
   elsif r.payment_id is not null then
    perform 1 from public.order_payments where company_id=c and id=r.payment_id and order_id=r.order_id and courier_id=partner and receiver='courier' and confirmed and amount=r.amount and voided_at is null;
    if not found then raise exception 'El cobro cambió; actualiza el borrador';end if;
   elsif (case when r.payer='ohana' then r.shipping_cost else 0 end) is distinct from r.amount then raise exception 'El envío cambió; actualiza el borrador';end if;
  end loop;
  update public.courier_settlement_items i
  set active=true, snapshot=case when i.snapshot->>'pending_handoff'='true' then
    i.snapshot || jsonb_build_object('pending_handoff',false,'delivered_at',
      coalesce((select max((h->>'at')::timestamptz) from jsonb_array_elements(o.fulfillment_history) h
                where h->>'stage' in ('courier','delivered')),d.updated_at))
    else i.snapshot end
  from public.sales_orders o join public.sales_deliveries d on d.company_id=o.company_id and d.order_id=o.id
  where i.company_id=c and i.settlement_id=sid and o.company_id=c and o.id=i.order_id;
  signed_value:=case when v_direction='received' then -actual else actual end;after_value:=before_value+s.net+signed_value;
  insert into public.courier_account_movements(company_id,courier_id,kind,signed_amount,settlement_id,occurred_on,notes,created_by)
  values(c,partner,'settlement',s.net,sid,s.settled_on,'Resultado de LIQ-'||lpad(s.number::text,4,'0'),auth.uid());
  if actual>0 then insert into public.courier_account_movements(company_id,courier_id,kind,signed_amount,settlement_id,method,occurred_on,notes,created_by)
   values(c,partner,'exchange',signed_value,sid,v_method,exchange_date,coalesce(data->>'exchange_notes',''),auth.uid());end if;
  update public.courier_settlements set state=case when access_private.settlement_remaining(c,sid)=0 then 'settled' when abs(access_private.settlement_remaining(c,sid))<abs(net) then 'partial' else 'pending' end,revision=revision+1,actual_amount=actual,confirmed_at=now(),balance_before=before_value,balance_after=after_value,exchange_direction=v_direction,exchange_method=v_method,exchanged_on=exchange_date,exchange_notes=coalesce(data->>'exchange_notes','') where company_id=c and id=sid;
  for r in select distinct o.customer_id from public.sales_orders o join public.courier_settlement_items i on i.company_id=o.company_id and i.order_id=o.id where i.company_id=c and i.settlement_id=sid loop perform access_private.reconcile_customer_account(c,r.customer_id);end loop;
  answer:=jsonb_build_object('id',sid,'balance',after_value);
 elsif action='settlement_payment' then
  select * into strict s from public.courier_settlements where company_id=c and id=sid for update;
  if s.state not in('pending','partial') then raise exception 'Esta liquidación no tiene pagos pendientes disponibles';end if;
  due:=access_private.settlement_remaining(c,sid);
  if due=0 then raise exception 'La liquidación ya está saldada';end if;
  if data ? 'expected_revision' and (data->>'expected_revision')::int is distinct from s.revision then raise exception 'La liquidación cambió; vuelve a abrirla';end if;
  if data ? 'expected_remaining' and (data->>'expected_remaining')::numeric is distinct from due then raise exception 'El saldo cambió; actualiza antes de pagar';end if;
  actual:=round(nullif(data->>'amount','')::numeric,2);v_method:=data->>'method';exchange_date:=nullif(data->>'date','')::date;
  if actual is null or actual<=0 or actual>abs(due) or v_method not in('cash','transfer') or v_method is null or exchange_date is null or exchange_date>current_date or length(coalesce(data->>'notes',''))>2000 then raise exception 'El pago debe ser positivo y no superar el saldo pendiente; revisa método y fecha';end if;
  partner:=s.courier_id;before_value:=access_private.courier_balance(c,partner);signed_value:=case when due>0 then -actual else actual end;
  insert into public.courier_account_movements(company_id,courier_id,kind,signed_amount,settlement_id,method,occurred_on,notes,created_by)
  values(c,partner,'exchange',signed_value,sid,v_method,exchange_date,coalesce(data->>'notes',''),auth.uid());
  update public.courier_settlements set state=case when access_private.settlement_remaining(c,sid)=0 then 'settled' else 'partial' end,revision=revision+1 where company_id=c and id=sid;
  answer:=jsonb_build_object('id',sid,'balance',before_value+signed_value);
 elsif action='settlement_cancel' then
  select * into strict s from public.courier_settlements where company_id=c and id=sid for update;
  if s.state='cancelled' then raise exception 'La liquidación ya está anulada';end if;
  reason:=trim(coalesce(data->>'reason',''));if length(reason) not between 5 and 500 then raise exception 'Indica un motivo de 5 a 500 caracteres';end if;
  partner:=s.courier_id;
  select min(sequence) into last_sequence from public.courier_account_movements where company_id=c and settlement_id=sid and reversal_of is null;
  if s.state in('pending','partial','settled') and exists(select 1 from public.courier_account_movements a where a.company_id=c and a.courier_id=partner and a.sequence>last_sequence and a.settlement_id is distinct from sid and a.reversal_of is null and not exists(select 1 from public.courier_account_movements rev where rev.company_id=c and rev.reversal_of=a.id)) then raise exception 'Existen compensaciones o intercambios posteriores. Revierte primero esos movimientos o liquidaciones';end if;
  if s.state in('pending','partial','settled') then
   for m in select * from public.courier_account_movements where company_id=c and settlement_id=sid and reversal_of is null order by sequence loop
    insert into public.courier_account_movements(company_id,courier_id,kind,signed_amount,settlement_id,reversal_of,method,occurred_on,notes,created_by)
    values(c,partner,'reversal',-m.signed_amount,sid,m.id,m.method,current_date,reason,auth.uid());
   end loop;
   update public.order_payments p set voided_at=now(),voided_by=auth.uid(),void_reason='Liquidación anulada: '||reason
    from public.courier_settlement_items i where i.company_id=c and i.settlement_id=sid and i.active and p.company_id=c and p.id=i.payment_id and p.settlement_generated;
  end if;
  update public.courier_settlement_items set active=false where company_id=c and settlement_id=sid;
  update public.courier_settlements set state='cancelled',cancelled_at=now(),cancel_reason=reason where company_id=c and id=sid;
  for r in select distinct o.customer_id from public.sales_orders o join public.courier_settlement_items i on i.company_id=o.company_id and i.order_id=o.id where i.company_id=c and i.settlement_id=sid loop perform access_private.reconcile_customer_account(c,r.customer_id);end loop;
  answer:=jsonb_build_object('id',sid);
 elsif action='money_add' then
  raise exception 'Registra el pago desde el detalle de la liquidación correspondiente';
 elsif action='money_void' then
  select * into strict m from public.courier_account_movements where company_id=c and id=sid for update;
  reason:=trim(coalesce(data->>'reason',''));if length(reason) not between 5 and 500 then raise exception 'Indica el motivo de reversión';end if;
  if m.kind<>'exchange' or m.settlement_id is not null or exists(select 1 from public.courier_account_movements where company_id=c and reversal_of=m.id) then raise exception 'Este movimiento no se anula de forma independiente';end if;
  if exists(select 1 from public.courier_account_movements a where a.company_id=c and a.courier_id=m.courier_id and a.sequence>m.sequence and a.reversal_of is null and not exists(select 1 from public.courier_account_movements rev where rev.company_id=c and rev.reversal_of=a.id)) then raise exception 'Revierte primero los movimientos posteriores';end if;
  insert into public.courier_account_movements(company_id,courier_id,kind,signed_amount,reversal_of,method,occurred_on,notes,created_by)
  values(c,m.courier_id,'reversal',-m.signed_amount,m.id,m.method,current_date,reason,auth.uid());
  answer:=jsonb_build_object('id',sid);
 else raise exception 'Acción de liquidación inválida';end if;
 insert into access_private.operation_requests(company_id,key,action,payload,result) values(c,k,'courier_'||action,data,answer);return answer;
exception when unique_violation then raise exception 'El cobro o envío ya fue liquidado; actualiza el documento';
end $function$;

CREATE OR REPLACE FUNCTION public.company_dashboard(p_company uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  catalog_ok boolean := public.company_permission(p_company,'read','catalog');
  inventory_ok boolean := public.company_permission(p_company,'read','inventory');
  sales_ok boolean := public.company_permission(p_company,'read','sales');
  month_start timestamp := date_trunc('month',now() at time zone 'America/Guatemala');
  company_currency text;
  result jsonb := '{}';
begin
  if auth.uid() is null or not (catalog_ok or inventory_ok or sales_ok) then
    return result;
  end if;
  select currency into company_currency from public.companies where id=p_company;

  if catalog_ok then
    result := result || jsonb_build_object('suppliers', (
      select count(*) from public.business_partners where company_id=p_company and active and is_supplier
    ));
  end if;

  if catalog_ok and inventory_ok then
    result := result || (
      select jsonb_build_object(
        'material_value',coalesce(sum(b.on_hand*q.unit_cost),0),
        'material_missing',count(*) filter (where b.on_hand<>0 and q.unit_cost is null),
        'reorder',count(distinct m.sku) filter (
          where m.active and m.minimum_stock>0 and coalesce(b.on_hand-b.blocked-b.reserved,0)<m.minimum_stock
        ))
      from public.raw_materials m
      left join public.inventory_balances b on b.company_id=m.company_id and b.item_kind='material' and b.item_id=m.id
      left join public.catalog_material_costs(p_company) q on q.id=m.id
      where m.company_id=p_company
    ) || (
      with general_list as (
        select id,name from public.price_lists where company_id=p_company and active and lower(btrim(name))='general'
      )
      select jsonb_build_object(
        'product_value',coalesce(sum(b.on_hand*e.price),0),
        'product_missing',count(*) filter (where e.price is null),
        'price_list', (select name from general_list))
      from (
        select * from public.inventory_balances
        where company_id=p_company and item_kind='variant' and on_hand<>0
      ) b
      left join public.price_list_entries e on e.company_id=b.company_id and e.variant_id=b.item_id
        and e.active and e.currency=company_currency and e.list_id=(select id from general_list)
    );
  end if;



  if inventory_ok then
    result := result || jsonb_build_object('available_products',coalesce((
      with curing_batches as (
        select pb.id,pb.product_id,pb.preliminary_outputs,
          coalesce(pb.actual_quantity,pb.preliminary_quantity,pb.planned_quantity,
            case when f.estimated_units>0 and pb.formula_scale>0 then round(f.estimated_units*pb.formula_scale,8) end) quantity,
          pb.actual_quantity is null and (pb.yield_timing is distinct from 'before' or pb.preliminary_quantity is null) estimated
        from public.production_batches pb
        left join public.formulas f on f.company_id=pb.company_id and f.id=pb.formula_id
        where pb.company_id=p_company and pb.state='curing'
          and public.company_permission(p_company,'read','production')
      ), assigned as (
        select cb.id,cb.product_id,o.variant_id,o.quantity
        from curing_batches cb
        join public.batch_outputs o on o.company_id=p_company and o.batch_id=cb.id and o.quantity>0
        union all
        select cb.id,cb.product_id,(line->>'variant')::uuid,(line->>'quantity')::int
        from curing_batches cb
        cross join lateral jsonb_array_elements(cb.preliminary_outputs) line
        where not exists (
          select 1 from public.batch_outputs o where o.company_id=p_company and o.batch_id=cb.id and o.quantity>0
        )
      ), by_variant as (
        select variant_id,sum(quantity) curing
        from assigned group by variant_id
      ), unassigned as (
        select cb.product_id,
          sum(greatest(cb.quantity-coalesce(a.quantity,0),0)) filter (where cb.quantity is not null) curing,
          coalesce(sum(greatest(cb.quantity-coalesce(a.quantity,0),0)) filter (where cb.estimated),0) estimated,
          count(*) filter (where cb.quantity is null and a.quantity is null) unknown_lots
        from curing_batches cb
        left join (select id,sum(quantity) quantity from assigned group by id) a on a.id=cb.id
        group by cb.product_id
      ), items as (
        select v.id::text,p.name product,access_private.variant_label(to_jsonb(v)) variant,
          coalesce(b.on_hand-b.blocked-b.reserved,0) available,
          coalesce(c.curing,0) curing,0 estimated,0 unknown_lots,
          (select e.price from public.price_lists pl
           join public.price_list_entries e on e.company_id=pl.company_id and e.list_id=pl.id
           where catalog_ok and pl.company_id=p_company and pl.active and lower(btrim(pl.name))='general'
             and e.active and e.variant_id=v.id and e.currency=company_currency) general_price
        from public.product_variants v
        join public.products p on p.company_id=v.company_id and p.id=v.product_id
        left join public.inventory_balances b on b.company_id=v.company_id and b.item_id=v.id and b.item_kind='variant'
        left join by_variant c on c.variant_id=v.id
        where v.company_id=p_company
          and ((v.active and p.active and b.on_hand>b.blocked+b.reserved) or c.curing>0)
        union all
        select 'unassigned-'||p.id,p.name,'Variante por definir',0,
          nullif(u.curing,0),u.estimated,u.unknown_lots,null
        from unassigned u
        join public.products p on p.company_id=p_company and p.id=u.product_id
        where u.curing>0 or u.unknown_lots>0
      )
      select jsonb_agg(to_jsonb(item) order by item.product,item.variant,item.id) from items item
    ),'[]'::jsonb));
  end if;

  if catalog_ok and inventory_ok then
    result := result || jsonb_build_object('reorder_materials',coalesce((
      select jsonb_agg(to_jsonb(item) order by item.name,item.sku,item.id)
      from (
        select m.id,m.sku,m.name,u.symbol unit,m.minimum_stock minimum,
          coalesce(b.on_hand-b.blocked-b.reserved,0) available
        from public.raw_materials m
        left join public.inventory_balances b on b.company_id=m.company_id and b.item_kind='material' and b.item_id=m.id
        left join public.units u on u.company_id=m.company_id and u.id=m.unit_id
        where m.company_id=p_company and m.active and m.minimum_stock>0
          and coalesce(b.on_hand-b.blocked-b.reserved,0)<m.minimum_stock
      ) item
    ),'[]'::jsonb));
  end if;


 if catalog_ok and inventory_ok then
  result:=result||jsonb_build_object('suggested_production',coalesce((
   select jsonb_agg(to_jsonb(item) order by item.name,item.id) from (
    select p.id,p.name,p.minimum_stock minimum,coalesce(sum(b.on_hand-b.blocked-b.reserved),0) available,
      p.minimum_stock-coalesce(sum(b.on_hand-b.blocked-b.reserved),0) suggested
    from public.products p
    left join public.product_variants v on v.company_id=p.company_id and v.product_id=p.id and v.active
    left join public.inventory_balances b on b.company_id=v.company_id and b.item_kind='variant' and b.item_id=v.id
    where p.company_id=p_company and p.active and p.minimum_stock>0
    group by p.id
    having coalesce(sum(b.on_hand-b.blocked-b.reserved),0)<p.minimum_stock
   ) item
  ),'[]'::jsonb));
 end if;
 if sales_ok then
  result:=result||jsonb_build_object('pending_settlements',coalesce((
   select jsonb_agg(to_jsonb(item) order by item.date,item.number) from (
    select s.id,s.number,s.settled_on date,b.name courier,s.state,
      case when s.state='draft' then s.net else access_private.settlement_remaining(p_company,s.id) end remaining
    from public.courier_settlements s
    join public.business_partners b on b.company_id=s.company_id and b.id=s.courier_id
    where s.company_id=p_company and s.state in ('draft','pending','partial')
   ) item
  ),'[]'::jsonb));
 end if;
  if sales_ok then
    result := result || (
      select jsonb_build_object(
        'drafts', count(*) filter (where fulfillment_stage='draft'),
        'invoices', count(*) filter (where current_month and fulfillment_stage<>'draft'),
        'active_customers', count(distinct customer_id) filter (where current_month and fulfillment_stage<>'draft'),
        'sales_current', coalesce(sum(total) filter (where current_month and fulfillment_stage<>'draft'),0),
        'sales_previous', coalesce(sum(total) filter (where not current_month and fulfillment_stage<>'draft'),0),
        'drop_size', avg(total) filter (where current_month and fulfillment_stage<>'draft'))
      from (
        select o.*, o.created_at >= month_start at time zone 'America/Guatemala' as current_month
        from public.sales_orders o where o.company_id=p_company and o.currency=company_currency
          and o.status not in ('cancelled','expired')
          and (o.fulfillment_stage='draft' or (
            o.created_at >= (month_start-interval '1 month') at time zone 'America/Guatemala'
            and o.created_at < (month_start+interval '1 month') at time zone 'America/Guatemala'
          ))
      ) sales
    ) || jsonb_build_object('customers',(
      select count(*) from public.business_partners where company_id=p_company and active and is_customer
    ));
  end if;
  return result;
end $function$;

CREATE OR REPLACE FUNCTION access_private.partners(c uuid, action text, data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare p public.business_partners%rowtype;pid uuid; a jsonb;aid uuid;used uuid[]:='{}';n integer;pg integer;cnt bigint;q text;typ text;st text;sort text;dir text;res jsonb;begin
 if auth.uid() is null or not(access_private.partner_read(c,'supplier') or access_private.partner_read(c,'customer')) then raise exception 'Socios no autorizados' using errcode='42501';end if;
 if action='list' then
  q:=left(coalesce(data->>'query',''),120);typ:=coalesce(data->>'type','');st:=coalesce(data->>'status','');pg:=greatest(1,least(coalesce((data->>'page')::int,1),100000));
  sort:=case when data->>'sort' in('code','alternate_code','name','partner_type','courier_tariff_mode','phone','active') then data->>'sort' else 'name' end;dir:=case when data->>'direction'='desc' then 'desc' else 'asc' end;
  select count(*) into cnt from public.business_partners b where b.company_id=c and ((b.is_customer and access_private.partner_read(c,'customer')) or (b.is_supplier and access_private.partner_read(c,'supplier')) or (b.is_courier and access_private.partner_read(c,'courier'))) and(typ='' or (typ='customer' and b.is_customer and access_private.partner_read(c,'customer')) or (typ='supplier' and b.is_supplier and access_private.partner_read(c,'supplier')) or (typ='courier' and b.is_courier and access_private.partner_read(c,'courier'))) and(st='' or b.active=(st='active')) and (q='' or concat_ws(' ',b.code,b.alternate_code,b.name,b.phone,b.phone_secondary,b.whatsapp,b.instagram,b.facebook,b.tax_id) ilike '%'||q||'%');
  execute format('select coalesce(jsonb_agg(to_jsonb(z)),''[]'') from(select * from public.business_partners b where b.company_id=$1 and ((b.is_customer and access_private.partner_read($1,''customer'')) or (b.is_supplier and access_private.partner_read($1,''supplier'')) or (b.is_courier and access_private.partner_read($1,''courier''))) and($2='''' or ($2=''customer'' and b.is_customer and access_private.partner_read($1,''customer'')) or ($2=''supplier'' and b.is_supplier and access_private.partner_read($1,''supplier'')) or ($2=''courier'' and b.is_courier and access_private.partner_read($1,''courier''))) and($3='''' or b.active=($3=''active'')) and($4='''' or concat_ws('' '',b.code,b.alternate_code,b.name,b.phone,b.phone_secondary,b.whatsapp,b.instagram,b.facebook,b.tax_id) ilike ''%%''||$4||''%%'') order by %I %s,id limit 25 offset $5)z',sort,dir) into res using c,typ,st,q,(pg-1)*25;
  return jsonb_build_object('rows',res,'total',cnt,'currency',(select currency from public.companies where id=c),'price_lists',coalesce((select jsonb_agg(to_jsonb(pl) order by pl.name) from public.price_lists pl where pl.company_id=c and pl.active),'[]'),'default_price_list',access_private.default_customer_price_list(c),'canManage',public.company_permission(c,'manage'),'supplierRead',access_private.partner_read(c,'supplier'),'customerRead',access_private.partner_read(c,'customer'));
 end if;
 if action='matches' then
  if not public.company_permission(c,'manage') then raise exception 'Socios no autorizados' using errcode='42501';end if;
  return coalesce((select jsonb_agg(to_jsonb(z)) from(
   select b.id,b.code,b.name,b.is_customer,b.is_supplier,b.is_courier from public.business_partners b
   where b.company_id=c and b.id is distinct from nullif(data->>'id','')::uuid and (
    (length(trim(coalesce(data->>'name','')))>=2 and public.catalog_key(b.name) like '%'||public.catalog_key(data->>'name')||'%') or
    (length(trim(coalesce(data->>'instagram','')))>=2 and lower(ltrim(b.instagram,'@'))=lower(ltrim(data->>'instagram','@'))) or
    (length(trim(coalesce(data->>'facebook','')))>=2 and lower(b.facebook)=lower(data->>'facebook')) or
    exists(select 1 from unnest(array[b.phone,b.phone_secondary,b.whatsapp]) v
     cross join unnest(array[data->>'phone',data->>'phone_secondary',data->>'whatsapp']) w
     where length(regexp_replace(w,'[^0-9]','','g'))>=5 and regexp_replace(v,'[^0-9]','','g')=regexp_replace(w,'[^0-9]','','g'))
   ) order by b.name,b.id limit 10)z),'[]'::jsonb);
 end if;
 pid:=nullif(data->>'id','')::uuid;
 if action in('get','save','active') and pid is not null then
  select * into strict p from public.business_partners where company_id=c and id=pid;
  if not ((p.is_customer and access_private.partner_read(c,'customer')) or (p.is_supplier and access_private.partner_read(c,'supplier')) or (p.is_courier and access_private.partner_read(c,'courier'))) then raise exception 'Socio no autorizado' using errcode='42501';end if;
 end if;
 if action='get' then
  return jsonb_build_object('courier_account',case when p.is_courier and access_private.partner_read(c,'courier') then access_private.courier_balance(c,pid) else null end,'account',case when p.is_customer and access_private.partner_read(c,'customer') then access_private.customer_account(c,pid) else '[]'::jsonb end,'partner',to_jsonb(p),'canChangeType',not(exists(select 1 from public.presentations where company_id=c and supplier_id=pid) or exists(select 1 from public.purchase_receipts where company_id=c and supplier_id=pid) or exists(select 1 from public.sales_orders where company_id=c and customer_id=pid)), 'addresses',coalesce((select jsonb_agg(to_jsonb(d) order by is_primary desc,label,id) from public.partner_addresses d where d.company_id=c and d.partner_id=pid),'[]'),
   'related',case when p.is_supplier and(public.company_permission(c,'read','catalog') or public.company_permission(c,'manage')) then
     jsonb_build_object('presentations',coalesce((select jsonb_agg(to_jsonb(z)) from(select pp.id,rm.name material,pp.quantity,u.symbol unit,pp.active from public.presentations pp join public.raw_materials rm on rm.company_id=pp.company_id and rm.id=pp.raw_material_id join public.units u on u.company_id=pp.company_id and u.id=pp.unit_id where pp.company_id=c and pp.supplier_id=pid order by rm.name limit 100)z),'[]'),
     'prices',coalesce((select jsonb_agg(to_jsonb(z)) from(select h.effective_on,h.amount,h.currency,rm.name material from public.price_history h join public.presentations pp on pp.company_id=h.company_id and pp.id=h.presentation_id join public.raw_materials rm on rm.company_id=pp.company_id and rm.id=pp.raw_material_id where pp.company_id=c and pp.supplier_id=pid order by h.effective_on desc nulls last,h.created_at desc limit 100)z),'[]')) else '{}'::jsonb end ||
    case when p.is_supplier and(public.company_permission(c,'read','inventory') or public.company_permission(c,'manage')) then jsonb_build_object('purchases',coalesce((select jsonb_agg(to_jsonb(z)) from(select received_on,reference,quantity,amount,currency from public.purchase_receipts where company_id=c and supplier_id=pid order by created_at desc limit 100)z),'[]')) else '{}'::jsonb end ||
    case when p.is_customer and access_private.partner_read(c,'customer') then jsonb_build_object('orders',coalesce((select jsonb_agg(to_jsonb(z)) from(select number,status,total,currency,created_at,coalesce((select sum(l.quantity) from public.order_lines l where l.company_id=c and l.order_id=sales_orders.id and l.is_gift and l.quantity>0),0) gift_units from public.sales_orders where company_id=c and customer_id=pid order by created_at desc limit 100)z),'[]')) else '{}'::jsonb end);
 end if;
 if not public.company_permission(c,'manage') then raise exception 'Solo administradores autorizados pueden modificar socios' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(c::text,0));
 if action='suggest' then
  if data->>'type' not in('supplier','customer','courier') then raise exception 'Tipo inválido';end if;
  return jsonb_build_object('code',access_private.next_partner_code(c,data->>'type'));
 elsif action='active' then
  update public.business_partners set active=(data->>'active')::boolean where company_id=c and id=pid;
  return jsonb_build_object('id',pid);
 elsif action<>'save' then raise exception 'Acción inválida';end if;
 if length(data::text)>40000 or jsonb_typeof(data->'addresses') is distinct from 'array' or jsonb_array_length(data->'addresses')>20 then raise exception 'Máximo 20 direcciones por socio';end if;
 if coalesce(data->>'type','') not in('supplier','customer','courier') or length(trim(coalesce(data->>'name',''))) not between 1 and 160 then raise exception 'Revisa tipo y nombre';end if;
 if length(coalesce(data->>'phone',''))>40 or length(coalesce(data->>'whatsapp',''))>40 or length(coalesce(data->>'tax_id',''))>80 or length(coalesce(data->>'legal_name',''))>200 or length(coalesce(data->>'notes',''))>4000 or length(coalesce(data->>'commercial_notes',''))>4000 or length(coalesce(data->>'purchase_terms',''))>2000 or length(coalesce(data->>'delivery_instructions',''))>2000 then raise exception 'Uno de los campos es demasiado extenso';end if;
 if (select count(*) from jsonb_array_elements(data->'addresses') x where coalesce((x->>'is_primary')::boolean,false))>1 then raise exception 'Selecciona una sola dirección principal';end if;
 if pid is null then
  insert into public.business_partners(company_id,name,partner_type,code) values(c,trim(data->>'name'),data->>'type',null) returning id into pid;
 end if;
 update public.business_partners set price_list_id=case when data ? 'price_list_id' then coalesce(nullif(data->>'price_list_id','')::uuid,access_private.default_customer_price_list(c)) else price_list_id end,name=trim(data->>'name'),is_customer=coalesce((data->>'is_customer')::boolean,is_customer),is_supplier=coalesce((data->>'is_supplier')::boolean,is_supplier),alternate_code=nullif(trim(data->>'alternate_code'),''),instagram=coalesce(data->>'instagram',''),facebook=coalesce(data->>'facebook',''),phone_secondary=coalesce(data->>'phone_secondary',''),whatsapp_same=coalesce((data->>'whatsapp_same')::boolean,false),payment_preference=nullif(data->>'payment_preference',''),legal_name=coalesce(data->>'legal_name',''),tax_id=coalesce(data->>'tax_id',''),phone=coalesce(data->>'phone',''),whatsapp=coalesce(data->>'whatsapp',''),email=trim(coalesce(data->>'email','')),active=coalesce((data->>'active')::boolean,true),notes=coalesce(data->>'notes',''),commercial_notes=coalesce(data->>'commercial_notes',''),purchase_terms=coalesce(data->>'purchase_terms',''),delivery_instructions=coalesce(data->>'delivery_instructions','') where company_id=c and id=pid;
 update public.partner_addresses set is_primary=false where company_id=c and partner_id=pid;
 for a in select value from jsonb_array_elements(data->'addresses') loop
  aid:=nullif(a->>'id','')::uuid;
  if aid is null then aid:=gen_random_uuid();
   insert into public.partner_addresses(id,company_id,partner_id,label,address,instructions,phone,is_primary,department,zone) values(aid,c,pid,trim(a->>'label'),trim(a->>'address'),coalesce(a->>'instructions',''),coalesce(a->>'phone',''),coalesce((a->>'is_primary')::boolean,false),nullif(trim(a->>'department'),''),nullif(btrim(a->>'zone'),''));
  else
   update public.partner_addresses set label=trim(a->>'label'),address=trim(a->>'address'),instructions=coalesce(a->>'instructions',''),phone=coalesce(a->>'phone',''),zone=case when a ? 'zone' then nullif(btrim(a->>'zone'),'') else public.partner_addresses.zone end,department=case when a ? 'department' then nullif(trim(a->>'department'),'') else public.partner_addresses.department end,is_primary=coalesce((a->>'is_primary')::boolean,false) where company_id=c and partner_id=pid and id=aid;
   if not found then raise exception 'Dirección ajena o inexistente' using errcode='42501';end if;
  end if;
  if aid=any(used) then raise exception 'Dirección repetida';end if;used:=array_append(used,aid);
 end loop;
 delete from public.partner_addresses where company_id=c and partner_id=pid and not(id=any(used));
 update public.business_partners set address=coalesce((select address from public.partner_addresses where company_id=c and partner_id=pid order by is_primary desc,label,id limit 1),'') where company_id=c and id=pid;
 return jsonb_build_object('id',pid);
end $function$;
REVOKE EXECUTE ON FUNCTION public.register_admin_payments(uuid,uuid,jsonb) FROM authenticated;
COMMIT;
