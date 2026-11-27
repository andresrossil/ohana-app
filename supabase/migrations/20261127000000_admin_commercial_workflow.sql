-- Administrative workflow only. Checkout, stock posting and fund formulas retain their definitions.
do $migration$
declare
  definition text := pg_get_functiondef('access_private.sales_fulfillment(uuid,text,uuid,jsonb)'::regprocedure);
  marker text := $match$action='finish' and so.status='pending' and so.fulfillment_stage='preparing'$match$;
begin
  if strpos(definition,marker)=0 then raise exception 'No se encontró la confirmación de preparación'; end if;
  definition:=replace(definition,marker,$sql$action='finish' and so.status='pending' and so.fulfillment_stage in ('invoiced','preparing')$sql$);
  definition:=replace(definition,$sql$case when so.fulfillment_stage='preparing' then$sql$,
    $sql$case when so.fulfillment_stage in ('invoiced','preparing') and so.status='pending' then$sql$);
  execute definition;

  definition:=pg_get_functiondef('access_private.sales_worklist(uuid,text,jsonb)'::regprocedure);
  marker:='where selected_status is null or display_status=selected_status';
  if strpos(definition,marker)=0 then raise exception 'No se encontró el filtro comercial'; end if;
  definition:=replace(definition,marker,$sql$where selected_status is null or display_status=selected_status
    or (selected_status='invoices' and fulfillment_stage<>'draft' and status not in ('cancelled','expired'))
    or (selected_status='closed' and status in ('cancelled','expired'))
    or (selected_status='to_prepare' and status='pending' and fulfillment_stage in ('invoiced','preparing'))
    or (selected_status='to_pay' and status in ('pending','dispatched') and fulfillment_stage<>'draft'
      and (access_private.delivery_payment_summary(c,id)->>'balance')::numeric>0)$sql$);
  marker:=$match$d.courier_snapshot->>'name' as courier_name,s.settled,$match$;
  if strpos(definition,marker)=0 then raise exception 'No se encontró el resumen de liquidación'; end if;
  execute replace(definition,marker,marker||$sql$
        (select st.state from public.courier_settlement_items i
          join public.courier_settlements st on st.company_id=i.company_id and st.id=i.settlement_id
          where i.company_id=o.company_id and i.order_id=o.id and st.state<>'cancelled'
            and (i.active or st.state='draft')
          order by i.active desc,st.number desc limit 1) settlement_state,$sql$);
end $migration$;

create function public.register_admin_payments(p_company uuid,p_key uuid,p_data jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare item jsonb; result jsonb:='[]'; payment_id uuid;
begin
  if auth.uid() is null or not public.company_permission(p_company,'write','sales') then
    raise exception 'Pago no autorizado' using errcode='42501';
  end if;
  if p_key is null or jsonb_typeof(p_data->'payments') is distinct from 'array'
    or jsonb_array_length(p_data->'payments') not between 1 and 50
    or p_data->>'method' is null or p_data->>'method' not in ('cash','transfer') then
    raise exception 'La operación requiere método y de 1 a 50 pagos';
  end if;
  if exists(select 1 from jsonb_array_elements(p_data->'payments') e group by (e->>'order')::uuid having count(*)>1) then
    raise exception 'La factura aparece más de una vez';
  end if;
  -- Reuse each payment RPC's locking, stale-balance check and retry ledger.
  for item in select value from jsonb_array_elements(p_data->'payments') order by value->>'order' loop
    if nullif(item->>'expected_due','') is null or nullif(item->>'amount','') is null
      or (item->>'amount')::numeric not between 0.01 and (item->>'expected_due')::numeric then
      raise exception 'El pago debe ser positivo y no superar el saldo';
    end if;
    payment_id:=md5(p_key::text||':'||(item->>'order'))::uuid;
    result:=result||jsonb_build_array(public.courier_operations(p_company,'payment_add',payment_id,
      jsonb_build_object('order',item->>'order','expected_due',item->>'expected_due','amount',item->>'amount',
        'method',p_data->>'method','received_on',p_data->>'date','receiver','ohana','confirmed',true,
        'discrepancy_confirmed',true,'notes',coalesce(p_data->>'notes',''))));
  end loop;
  return result;
end $$;
revoke all on function public.register_admin_payments(uuid,uuid,jsonb) from public,anon;
grant execute on function public.register_admin_payments(uuid,uuid,jsonb) to authenticated;

do $migration$
declare
  definition text := pg_get_functiondef('access_private.courier_pending(uuid,uuid)'::regprocedure);
  marker text := $match$where o.company_id=c and d.courier_id=partner and o.status='dispatched'$match$;
begin
  if strpos(definition,marker)=0 then raise exception 'No se encontró la selección de facturas'; end if;
  definition:=replace(definition,marker,$sql$where o.company_id=c and d.courier_id=partner
    and d.status<>'cancelled'
    and (o.status='dispatched' or (o.status='pending' and o.fulfillment_stage in ('invoiced','preparing')))$sql$);
  definition:=replace(definition,$sql$(o.fulfillment_stage='finished' and d.status='pending') pending_handoff,$sql$,
    $sql$(o.fulfillment_stage='finished' and d.status='pending') pending_handoff,
    (o.status='pending') needs_preparation,
    coalesce(d.address,o.customer_snapshot->>'address') address,
    o.invoice_number,access_private.delivery_payment_summary(c,o.id)->'ohana_received' direct_paid,$sql$);
  definition:=replace(definition,$sql$or (o.fulfillment_stage='finished' and d.status='pending'))$sql$,
    $sql$or (o.fulfillment_stage='finished' and d.status='pending') or (o.status='pending' and o.fulfillment_stage in ('invoiced','preparing')))$sql$);
  definition:=replace(definition,'or pending_handoff or reserved_id','or pending_handoff or needs_preparation or reserved_id');
  if strpos(definition,'or needs_preparation')=0 then raise exception 'No se encontró el filtro de facturas pendientes'; end if;
  execute definition;

  definition:=pg_get_functiondef('access_private.settlement_engine(uuid,text,uuid,jsonb)'::regprocedure);
  marker:=$match$if r.order_stage='finished' and r.delivery_status='pending' then$match$;
  if strpos(definition,marker)=0 then raise exception 'No se encontró la validación de salida a ruta'; end if;
  definition:=replace(definition,marker,$sql$if r.order_stage='finished' and r.delivery_status='pending'
    and not coalesce((data->>'admin_complete')::boolean,false) then$sql$);
  definition:=replace(definition,$sql$if (available->>'pending_handoff')::boolean and coalesce((x->>'mark_collected')::boolean,false) then$sql$,
    $sql$if (available->>'pending_handoff')::boolean and coalesce((x->>'mark_collected')::boolean,false)
      and not coalesce((data->>'admin_draft')::boolean,false) then$sql$);
  definition:=replace(definition,$sql$((available->>'pending_handoff')::boolean or available->>'reserved_id'=sid::text)$sql$,
    $sql$((available->>'pending_handoff')::boolean or (available->>'needs_preparation')::boolean or available->>'reserved_id'=sid::text)$sql$);
  marker:=$match$  if not exists(select 1 from public.courier_settlement_items where company_id=c and settlement_id=sid) then raise exception 'Liquidación vacía';end if;$match$;
  if strpos(definition,marker)=0 then raise exception 'No se encontró la validación de liquidación'; end if;
  definition:=replace(definition,marker,marker||$sql$
  if coalesce((data->>'admin_complete')::boolean,false) then
    if actual<>abs(s.net) then raise exception 'El intercambio debe coincidir con el importe neto'; end if;
    if exists(select 1 from public.courier_settlement_items i where i.company_id=c and i.settlement_id=sid
      and i.collection_pending and i.amount is distinct from (i.snapshot->>'expected_due')::numeric) then
      raise exception 'Resuelve la diferencia del efectivo cobrado antes de liquidar';
    end if;
    if exists(select 1 from public.courier_settlement_items i
      join public.sales_orders o on o.company_id=i.company_id and o.id=i.order_id
      where i.company_id=c and i.settlement_id=sid
        and (o.status<>'dispatched' or o.fulfillment_stage not in ('finished','courier','delivered','invoiced'))) then
      raise exception 'Confirma la preparación de todas las facturas antes de liquidar';
    end if;
    if exists(
      select 1 from public.courier_settlement_items i
      join public.sales_orders o on o.company_id=i.company_id and o.id=i.order_id
      where i.company_id=c and i.settlement_id=sid and o.payment<>'transfer'
        and greatest(0,o.total-access_private.order_covered(c,o.id))>
          coalesce((select sum(x.amount) from public.courier_settlement_items x where x.company_id=c
            and x.settlement_id=sid and x.order_id=o.id and x.collection_pending),0)
    ) then
      raise exception 'Confirma todo el efectivo pendiente del mensajero antes de liquidar';
    end if;

  end if;
$sql$);
  execute definition;
end $migration$;

do $migration$
declare
  definition text:=pg_get_functiondef('public.company_dashboard(uuid)'::regprocedure);
  marker text:=$match$  if sales_ok then$match$;
begin
  if strpos(definition,marker)=0 then raise exception 'No se encontró la sección de ventas de Inicio'; end if;
  execute replace(definition,marker,marker||$sql$
    result:=result||jsonb_build_object(
      'preparation_pending',(select count(*) from public.sales_orders o
        where o.company_id=p_company and o.status='pending' and o.fulfillment_stage in ('invoiced','preparing')),
      'payments_pending',(select count(*) from public.sales_orders o
        where o.company_id=p_company and o.status in ('pending','dispatched') and o.fulfillment_stage<>'draft'
          and (access_private.delivery_payment_summary(p_company,o.id)->>'balance')::numeric>0),
      'settlement_drafts',(select count(*) from public.courier_settlements where company_id=p_company and state='draft'),
      'settlement_open',(select count(*) from public.courier_settlements where company_id=p_company and state in ('pending','partial')));
$sql$);

  definition:=pg_get_functiondef('access_private.partners(uuid,text,jsonb)'::regprocedure);
  marker:='b.phone_secondary,b.whatsapp,b.instagram,b.facebook,b.tax_id';
  if strpos(definition,marker)=0 then raise exception 'No se encontró el buscador de socios'; end if;
  definition:=overlay(definition placing marker||$sql$,
    case when typ in ('customer','supplier') then
      (select string_agg(a.address,chr(32)) from public.partner_addresses a
        where a.company_id=b.company_id and a.partner_id=b.id) end$sql$
    from strpos(definition,marker) for length(marker));
  marker:='b.phone_secondary,b.whatsapp,b.instagram,b.facebook,b.tax_id) ilike';
  if strpos(definition,marker)=0 then raise exception 'No se encontró la paginación de socios'; end if;
  execute replace(definition,marker,$sql$b.phone_secondary,b.whatsapp,b.instagram,b.facebook,b.tax_id,
    case when $2 in (''customer'',''supplier'') then
      (select string_agg(a.address,chr(32)) from public.partner_addresses a
        where a.company_id=b.company_id and a.partner_id=b.id) end) ilike$sql$);
end $migration$;
