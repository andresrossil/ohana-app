alter table public.partner_addresses add column zone smallint check(zone between 1 and 21);
alter table public.sales_deliveries add column zone smallint check(zone between 1 and 21),
 add column address_id uuid,add column address_label text check(length(address_label)<=100);
-- The address ID and label are historical references; deleting a saved address must not erase delivery history.
create function access_private.delivery_shipping_charge(c uuid,info jsonb) returns numeric language plpgsql stable set search_path='' as $charge$
declare v_amount numeric;v_destination text;v_mode text;begin
 if info->>'kind'='pickup' or info->>'payer'='customer' then return 0;end if;
 if not coalesce((info->>'single_shipping_cost')::boolean,false) then return coalesce(nullif(info->>'shipping_charged','')::numeric,0);end if;
 v_amount:=nullif(info->>'shipping_cost','')::numeric;
 if v_amount is null and info->>'kind'='courier' then
  select courier_tariff_mode into v_mode from public.business_partners where company_id=c and id=nullif(info->>'courier_id','')::uuid and is_courier;
  v_destination:=case when v_mode='general' then 'general' else coalesce(nullif(info->>'destination',''),case when v_mode='zone' then nullif(info->>'zone','') else nullif(info->>'department','') end) end;
  select amount into v_amount from public.courier_tariffs where company_id=c and courier_id=nullif(info->>'courier_id','')::uuid and mode=v_mode and destination=v_destination and available;
 end if;
 if v_amount is null then raise exception 'No hay tarifa configurada; indica el costo de envío';end if;
 return round(v_amount,2);
end $charge$;
revoke all on function access_private.delivery_shipping_charge(uuid,jsonb) from public,anon,authenticated;

do $patch$
declare d text;begin
 d:=pg_get_functiondef('access_private.partners(uuid,text,jsonb)'::regprocedure);
 if position('is_primary,department) values' in d)=0 then raise exception 'Unexpected address insert';end if;
 d:=replace(d,'is_primary,department) values','is_primary,department,zone) values');
 d:=replace(d,'nullif(trim(a->>''department''),''''));','nullif(trim(a->>''department''),''''),nullif(a->>''zone'','''')::smallint);');
 d:=replace(d,'department=case when a ? ''department''','zone=case when a ? ''zone'' then nullif(a->>''zone'','''')::smallint else public.partner_addresses.zone end,department=case when a ? ''department''');
 execute d;
 d:=pg_get_functiondef('access_private.place_order(uuid,uuid,jsonb,boolean)'::regprocedure);
 if position($old$shipping_value:=case when data#>>'{delivery_info,payer}'='customer' or data#>>'{delivery_info,kind}'='pickup' then 0 else coalesce(nullif(data#>>'{delivery_info,shipping_charged}','')::numeric,0) end;$old$ in d)=0 then raise exception 'Unexpected order shipping calculation';end if;
 d:=replace(d,$old$shipping_value:=case when data#>>'{delivery_info,payer}'='customer' or data#>>'{delivery_info,kind}'='pickup' then 0 else coalesce(nullif(data#>>'{delivery_info,shipping_charged}','')::numeric,0) end;$old$,$new$shipping_value:=access_private.delivery_shipping_charge(c,data->'delivery_info');$new$);
 execute d;
end $patch$;
CREATE OR REPLACE FUNCTION access_private.save_order_delivery(c uuid, o uuid, info jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare current_delivery public.sales_deliveries%rowtype;partner public.business_partners%rowtype;kind text:=coalesce(info->>'kind','pickup');
 courier uuid:=nullif(info->>'courier_id','')::uuid;payer text:=coalesce(info->>'payer','ohana');cost numeric(18,2):=nullif(info->>'shipping_cost','')::numeric;charged numeric(18,2):=coalesce(nullif(info->>'shipping_charged','')::numeric,0);tariff jsonb;dest_value text:=coalesce(info->>'destination','');v_address uuid;v_label text;
begin
 if jsonb_typeof(info) is distinct from 'object' or length(info::text)>10000 then raise exception 'Entrega incompleta';end if;
 if kind not in('courier','own','pickup') or payer not in('ohana','customer') then raise exception 'Tipo de entrega o pagador inválido';end if;
 if not exists(select 1 from public.sales_orders where company_id=c and id=o and status not in('cancelled','expired')) then raise exception 'Pedido no disponible';end if;
 select * into current_delivery from public.sales_deliveries where company_id=c and order_id=o for update;
 v_address:=case when info ? 'address_id' then nullif(info->>'address_id','')::uuid else current_delivery.address_id end;
 v_label:=current_delivery.address_label;
 if v_address is null then v_label:=null;
 elsif v_address is distinct from current_delivery.address_id or current_delivery.id is null then
  select a.label into v_label from public.partner_addresses a join public.sales_orders so on so.company_id=a.company_id and so.customer_id=a.partner_id where so.company_id=c and so.id=o and a.id=v_address;
  if not found then raise exception 'La dirección seleccionada no pertenece al cliente de este pedido' using errcode='42501';end if;
 end if;
 if kind='courier' then
  select * into strict partner from public.business_partners where company_id=c and id=courier and is_courier;
  if not partner.active and (current_delivery.id is null or current_delivery.courier_id is distinct from courier) then raise exception 'Selecciona una mensajería activa';end if;
  if (select currency from public.sales_orders where company_id=c and id=o)<>'GTQ' then raise exception 'Las tarifas de mensajería están en GTQ; no se convierten automáticamente';end if;

  if partner.courier_tariff_mode='department' and dest_value='' then
   dest_value:=coalesce(nullif(info->>'department',''),current_delivery.department,'');
  end if;
  if partner.courier_tariff_mode='zone' and dest_value='' then
   dest_value:=coalesce(nullif(info->>'zone',''),current_delivery.zone::text,'');
  end if;
  select to_jsonb(t) into tariff from public.courier_tariffs t where t.company_id=c and t.courier_id=courier and t.mode=partner.courier_tariff_mode and t.destination=case when partner.courier_tariff_mode='general' then 'general' else dest_value end and t.available;
  cost:=coalesce(cost,(tariff->>'amount')::numeric);
  if cost is null then raise exception 'No existe tarifa; ingresa el costo real del envío';end if;
 else courier:=null;cost:=coalesce(cost,0);end if;
 if kind='pickup' then cost:=0;charged:=0;payer:='ohana';end if;
 if coalesce((info->>'single_shipping_cost')::boolean,false) then charged:=cost;end if;
 if kind='pickup' or payer='customer' then charged:=0;end if;
 if kind<>'pickup' and length(trim(coalesce(info->>'address','')))<5 then raise exception 'Indica la dirección completa de entrega';end if;
 if exists(select 1 from public.courier_settlement_items i where i.company_id=c and i.delivery_id=current_delivery.id and i.active) and (current_delivery.courier_id,current_delivery.shipping_cost,current_delivery.payer) is distinct from (courier,cost,payer) then raise exception 'El envío ya está liquidado; anula la liquidación antes de cambiar sus importes';end if;
 if (current_delivery.courier_id is distinct from courier or coalesce(info->>'status','pending')='cancelled') and exists(select 1 from public.order_payments where company_id=c and order_id=o and receiver='courier' and voided_at is null) then raise exception 'Existen cobros del mensajero; anúlalos antes de cambiar la mensajería o cancelar la entrega';end if;
 if charged is distinct from (select shipping from public.sales_orders where company_id=c and id=o) and ((select paid_at is not null from public.sales_orders where company_id=c and id=o) or exists(select 1 from public.order_payments where company_id=c and order_id=o)) then raise exception 'El pedido ya tiene pagos; conserva el envío cobrado al cliente';end if;
 insert into public.sales_deliveries(company_id,order_id,kind,courier_id,courier_snapshot,address,department,zone,address_id,address_label,destination,tariff_snapshot,shipping_cost,shipping_charged,payer,guide,status,notes)
 values(c,o,kind,courier,case when courier is not null then jsonb_build_object('code',partner.code,'name',partner.name) end,coalesce(info->>'address',''),nullif(info->>'department',''),nullif(info->>'zone','')::smallint,v_address,v_label,dest_value,tariff,cost,charged,payer,coalesce(info->>'guide',''),coalesce(info->>'status','pending'),coalesce(info->>'notes',''))
 on conflict(company_id,order_id) do update set kind=excluded.kind,courier_id=excluded.courier_id,courier_snapshot=excluded.courier_snapshot,address=excluded.address,zone=case when info ? 'zone' then excluded.zone else sales_deliveries.zone end,address_id=excluded.address_id,address_label=excluded.address_label,department=case when info ? 'department' then excluded.department else sales_deliveries.department end,destination=excluded.destination,
 tariff_snapshot=case when (sales_deliveries.courier_id,sales_deliveries.destination,sales_deliveries.shipping_cost) is not distinct from (excluded.courier_id,excluded.destination,excluded.shipping_cost) then sales_deliveries.tariff_snapshot else excluded.tariff_snapshot end,
 shipping_cost=excluded.shipping_cost,shipping_charged=excluded.shipping_charged,payer=excluded.payer,guide=excluded.guide,status=excluded.status,notes=excluded.notes,updated_at=now();
 update public.sales_orders set shipping=charged,total=subtotal-discount+charged,delivery=case when kind='pickup' then 'pickup' else 'delivery' end where company_id=c and id=o;
end $function$
;
notify pgrst,'reload schema';
