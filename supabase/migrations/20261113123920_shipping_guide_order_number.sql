create function access_private.shipping_guide_for_order(c uuid, o uuid)
returns text language sql stable set search_path='' as $$
  select concat_ws('-',nullif(upper(trim(cs.details->>'shipping_guide_initials')),''),
    coalesce(so.invoice_number,lpad(so.number::text,greatest(6,length(so.number::text)),'0')))
  from public.sales_orders so
  left join public.company_settings cs on cs.company_id=so.company_id
  where so.company_id=c and so.id=o
$$;
revoke all on function access_private.shipping_guide_for_order(uuid,uuid) from public,anon,authenticated;

do $migration$
declare
  definition text := pg_get_functiondef('access_private.save_order_delivery(uuid,uuid,jsonb)'::regprocedure);
  old_expression text := $old$(select concat_ws('-',nullif(upper(trim(cs.details->>'shipping_guide_initials')),''),to_char(so.created_at at time zone 'America/Guatemala','DDMMYY'),bp.code) from public.sales_orders so join public.business_partners bp on bp.company_id=so.company_id and bp.id=so.customer_id left join public.company_settings cs on cs.company_id=so.company_id where so.company_id=c and so.id=o)$old$;
begin
  if strpos(definition,old_expression)=0 then raise exception 'La generación de guías cambió'; end if;
  execute replace(definition,old_expression,'access_private.shipping_guide_for_order(c,o)');
end $migration$;

create function access_private.finalize_shipping_guide()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  update public.sales_deliveries
  set guide=access_private.shipping_guide_for_order(new.company_id,new.id),updated_at=now()
  where company_id=new.company_id and order_id=new.id and kind='courier';
  return null;
end $$;
revoke all on function access_private.finalize_shipping_guide() from public,anon,authenticated;
create trigger sale_finalize_shipping_guide after update of fulfillment_stage on public.sales_orders
  for each row when (old.fulfillment_stage='draft' and new.fulfillment_stage='invoiced' and new.invoice_number is not null)
  execute function access_private.finalize_shipping_guide();
