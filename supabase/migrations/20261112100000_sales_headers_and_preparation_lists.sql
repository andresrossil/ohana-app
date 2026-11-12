create function access_private.sales_worklist(c uuid, action text, filters jsonb)
returns jsonb language plpgsql stable set search_path='' as $function$
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
      select o.id,o.number,o.created_at,o.customer_id,
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
    select jsonb_build_object('orders',coalesce((select jsonb_agg(to_jsonb(v) order by v.created_at desc,v.id desc) from visible),'[]'),
      'has_more',(select count(*)=51 from page_rows)) into result;
    return result;
  end if;

  if action='preparation_list' then
    return coalesce((select jsonb_agg(jsonb_build_object(
      'id',o.id,'number',o.number,'customer_id',o.customer_id,'customer_name',o.customer_snapshot->>'name',
      'confirmed_at',confirmation.confirmed_at,'stage',o.fulfillment_stage,'lines',
      coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'variant_id',l.variant_id,'description',l.description,
        'quantity',l.quantity,'weight_min',l.weight_min,'weight_max',l.weight_max,'is_gift',l.is_gift,
        'attributes',l.attributes,'commercial_code',v.commercial_code,'sku',v.sku) order by l.id)
        from public.order_lines l
        left join public.product_variants v on v.company_id=l.company_id and v.id=l.variant_id
        where l.company_id=c and l.order_id=o.id and l.quantity>0),'[]')
    ) order by confirmation.confirmed_at,o.number)
    from public.sales_orders o
    cross join lateral (select max((event->>'at')::timestamptz) as confirmed_at
      from jsonb_array_elements(o.fulfillment_history) event where event->>'action'='confirm_customer') confirmation
    where o.company_id=c and o.status='pending' and o.fulfillment_stage in ('invoiced','preparing')
      and confirmation.confirmed_at>=lower_bound and confirmation.confirmed_at<upper_bound),'[]');
  end if;
  raise exception 'Consulta de ventas no válida';
end
$function$;
revoke all on function access_private.sales_worklist(uuid,text,jsonb) from public,anon,authenticated;

do $migration$
declare
  fulfillment_sql text := pg_get_functiondef('access_private.sales_fulfillment(uuid,text,uuid,jsonb)'::regprocedure);
  sales_sql text := pg_get_functiondef('access_private.sales(uuid,text,uuid,jsonb)'::regprocedure);
begin
  if strpos(fulfillment_sql,$old$when action='detail' then 'read'$old$)=0
    or strpos(fulfillment_sql,$old$ if action<>'detail' then$old$)=0
    or strpos(sales_sql,$old$'orders',coalesce((select jsonb_agg(to_jsonb(so)$old$)=0 then
    raise exception 'No coincide la definición esperada de las consultas de ventas';
  end if;
  fulfillment_sql:=replace(fulfillment_sql,$old$when action='detail' then 'read'$old$,
    $new$when action in ('detail','invoice_customers','invoice_headers','preparation_list') then 'read'$new$);
  execute replace(fulfillment_sql,$old$ if action<>'detail' then$old$,$new$
 if action in ('invoice_customers','invoice_headers','preparation_list') then
  return access_private.sales_worklist(c,action,data);
 end if;
 if action<>'detail' then$new$);
  sales_sql:=replace(sales_sql,$old$'orders',coalesce((select jsonb_agg(to_jsonb(so)$old$,
    $new$'orders',case when data->>'catalog_only'='true' then '[]'::jsonb else coalesce((select jsonb_agg(to_jsonb(so)$new$);
  if strpos(sales_sql,$old$so),'[]'),'customers'$old$)=0 then raise exception 'No coincide el listado de ventas';end if;
  execute replace(sales_sql,$old$so),'[]'),'customers'$old$,$new$so),'[]') end,'customers'$new$);
end
$migration$;
