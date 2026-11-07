alter table public.sales_orders add column fulfillment_stage text not null default 'invoiced' check(fulfillment_stage in('invoiced','preparing','finished','courier','delivered')),
 add column fulfillment_history jsonb not null default '[]'::jsonb;

create function access_private.sales_fulfillment(c uuid,action text,k uuid default null,data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare so public.sales_orders%rowtype;d public.sales_deliveries%rowtype;cached access_private.operation_requests%rowtype;target text;answer jsonb;
begin
 if auth.uid() is null or not public.company_permission(c,case when action='detail' then 'read' else 'write' end,'sales') then raise exception 'Pedido no autorizado' using errcode='42501';end if;
 if action<>'detail' then
  if k is null then raise exception 'Identificador requerido';end if;
  perform pg_advisory_xact_lock(hashtextextended(c::text,0));
  select * into cached from access_private.operation_requests where company_id=c and key=k;
  if found then if cached.action<>'fulfillment_'||action or cached.payload<>data then raise exception 'Identificador utilizado con otros datos';end if;return cached.result;end if;
 end if;
 select * into strict so from public.sales_orders where company_id=c and id=(data->>'order')::uuid for update;
 select * into d from public.sales_deliveries where company_id=c and order_id=so.id;
 if action='detail' then return jsonb_build_object('order',to_jsonb(so),'delivery',to_jsonb(d),'summary',access_private.delivery_payment_summary(c,so.id),'lines',coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from public.order_lines l where l.company_id=c and l.order_id=so.id and l.quantity>0),'[]'));end if;
 if so.status<>'pending' or exists(select 1 from public.courier_settlement_items where company_id=c and order_id=so.id and active) then raise exception 'El pedido ya no permite cambiar su preparación';end if;
 if data->>'expected_stage' is distinct from so.fulfillment_stage then raise exception 'El pedido cambió. Actualiza su estado antes de continuar';end if;
 if action='prepare' and so.fulfillment_stage='invoiced' then target:='preparing';
 elsif action='finish' and so.fulfillment_stage='preparing' then target:='finished';
 elsif action='handoff' and so.fulfillment_stage='finished' then
  if d.status='cancelled' then raise exception 'La entrega está cancelada';end if;
  perform access_private.sales(c,'dispatch',gen_random_uuid(),jsonb_build_object('order',so.id));
  target:=case when d.kind='courier' then 'courier' else 'delivered' end;
  update public.sales_deliveries set status=case when kind='courier' then 'in_transit' else 'delivered' end,updated_at=now() where company_id=c and order_id=so.id;
 else raise exception 'Completa primero la etapa anterior del pedido';end if;
 update public.sales_orders set fulfillment_stage=target,fulfillment_history=fulfillment_history||jsonb_build_array(jsonb_build_object('stage',target,'at',now(),'by',auth.uid())) where company_id=c and id=so.id;
 answer:=jsonb_build_object('id',so.id,'stage',target);
 insert into access_private.operation_requests(company_id,key,action,payload,result) values(c,k,'fulfillment_'||action,data,answer);return answer;
end $$;
revoke all on function access_private.sales_fulfillment(uuid,text,uuid,jsonb) from public,anon;
grant execute on function access_private.sales_fulfillment(uuid,text,uuid,jsonb) to authenticated;
create function public.sales_fulfillment(p_company uuid,p_action text,p_key uuid default null,p_data jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select access_private.sales_fulfillment(p_company,p_action,p_key,p_data)$$;
revoke all on function public.sales_fulfillment(uuid,text,uuid,jsonb) from public,anon;
grant execute on function public.sales_fulfillment(uuid,text,uuid,jsonb) to authenticated;
CREATE OR REPLACE FUNCTION access_private.place_order(c uuid, k uuid, data jsonb, staff boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cfg jsonb;ccy text;cached access_private.operation_requests%rowtype;r jsonb;v public.product_variants%rowtype;product_name text;stock numeric;qty integer;reserve_qty integer;oid uuid;cid uuid;lid uuid;num bigint;sub numeric:=0;discount_value numeric:=0;shipping_value numeric:=0;phone text;customer jsonb;answer jsonb;request_data jsonb:=data;matched_phone text;price_ref jsonb;selected_list uuid;gift_line boolean;sold_price numeric;begin
 if k is null or data is null or length(data::text)>30000 then raise exception 'Pedido incompleto';end if;
 if staff then if auth.uid() is null or not public.company_permission(c,'write','sales') then raise exception 'Venta no autorizada' using errcode='42501';end if;elsif not access_private.is_public_store(c) then raise exception 'Tienda no disponible';end if;
 perform pg_advisory_xact_lock(hashtextextended(c::text,0));
 if not staff and not access_private.is_public_store(c) then raise exception 'Tienda no disponible';end if;
 select * into cached from access_private.operation_requests where company_id=c and key=k;
 if found then if cached.action<>(case when staff then 'sale_create' else 'checkout' end) or cached.payload<>request_data then raise exception 'Identificador utilizado con otros datos';end if;return cached.result;end if;
 perform access_private.expire_orders(c);
 if (select count(*) from access_private.operation_requests where company_id=c and action='checkout' and created_at>now()-interval '1 minute')>=60 then raise exception 'Demasiados pedidos. Intenta nuevamente en un minuto';end if;
 select currency into strict ccy from public.companies where id=c and active;
 select coalesce(details->'store','{}') into cfg from public.company_settings where company_id=c;cfg:=coalesce(cfg,'{}');
 
 if staff and nullif(data->>'customer_id','') is not null then
  if auth.uid() is null or not public.company_permission(c,'write','sales') then raise exception 'Venta no autorizada' using errcode='42501';end if;
  select jsonb_build_object('name',bp.name,'phone',bp.phone,'email',bp.email,'address',bp.address) into customer from public.business_partners bp where bp.company_id=c and bp.id=(data->>'customer_id')::uuid and bp.is_customer and bp.active;
  if customer is null then raise exception 'Selecciona un cliente activo de esta empresa';end if;
  data:=data||jsonb_build_object('customer',customer);
 end if;
 phone:=regexp_replace(coalesce(data#>>'{customer,phone}',''),'[^0-9+]','','g');
 customer:=jsonb_build_object('name',trim(coalesce(data#>>'{customer,name}','')),'phone',phone,'email',trim(coalesce(data#>>'{customer,email}','')),'address',trim(coalesce(data#>>'{customer,address}','')));
 if length(customer->>'name') not between 2 and 120 or (not (staff and nullif(data->>'customer_id','') is not null) and phone!~'^\+?[0-9]{7,15}$' ) or length(customer->>'address')>500 or length(customer->>'email')>254 or (customer->>'email'<>'' and customer->>'email'!~'^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then raise exception 'Revisa los datos de contacto';end if;
 if not staff and (select count(*) from public.sales_orders where company_id=c and customer_snapshot->>'phone'=phone and status='pending' and paid_at is null)>=3 then raise exception 'Ya tienes tres pedidos pendientes. Contacta al negocio';end if;
 if data->>'payment' not in('cash','transfer','cod') or data->>'delivery' not in('pickup','delivery') or data->>'payment' is null or data->>'delivery' is null then raise exception 'Pago o entrega no válidos';end if;
 if staff and data ? 'delivery_info' then
  shipping_value:=access_private.delivery_shipping_charge(c,data->'delivery_info');
 elsif data->>'delivery'='delivery' then
  if cfg->>'delivery'<>'true' or cfg->>'currency'<>ccy or cfg->>'shipping_fee' is null or length(customer->>'address')<5 then raise exception 'Entrega no configurada o dirección incompleta';end if;shipping_value:=(cfg->>'shipping_fee')::numeric;
 elsif not staff and coalesce(cfg->>'pickup','true')<>'true' then raise exception 'Retiro no disponible';end if;
 if coalesce(jsonb_typeof(data->'items'),'')<>'array' or jsonb_array_length(data->'items') not between 1 and 30 then raise exception 'El carrito debe contener entre 1 y 30 variantes';end if;
 insert into access_private.child_code_counters(company_id,kind,parent_id,last_value) values(c,'order',c,1) on conflict(company_id,kind,parent_id) do update set last_value=access_private.child_code_counters.last_value+1 returning last_value into num;
 
 if staff and nullif(data->>'customer_id','') is not null then cid:=(data->>'customer_id')::uuid;
 else
  matched_phone:=phone;
  if exists(select 1 from public.business_partners bp where bp.company_id=c and bp.is_customer and not bp.active and regexp_replace(bp.phone,'[^0-9+]','','g')=matched_phone and public.catalog_key(bp.name)=public.catalog_key(customer->>'name')) then raise exception 'Este contacto está inactivo; contacta al negocio';end if;
  select bp.id into cid from public.business_partners bp where bp.company_id=c and bp.is_customer and bp.active and regexp_replace(bp.phone,'[^0-9+]','','g')=matched_phone and public.catalog_key(bp.name)=public.catalog_key(customer->>'name') order by bp.created_at,bp.id limit 1;
  if cid is null then
   insert into public.customers(company_id,name,phone,email,address) values(c,customer->>'name',phone,customer->>'email',customer->>'address') returning id into cid;
   if trim(coalesce(customer->>'address',''))<>'' then insert into public.partner_addresses(company_id,partner_id,label,address,is_primary) values(c,cid,'Principal',customer->>'address',true);end if;
  end if;
 end if;
 
 selected_list:=case when staff then (select coalesce(bp.price_list_id,access_private.default_customer_price_list(c)) from public.business_partners bp where bp.company_id=c and bp.id=cid) else (select id from public.price_lists where company_id=c and active and is_base) end;
 insert into public.sales_orders(company_id,number,customer_id,customer_snapshot,currency,subtotal,total,shipping,delivery,payment,gift_message,price_list_id) values(c,num,cid,customer,ccy,0,0,shipping_value,data->>'delivery',data->>'payment',left(coalesce(data->>'gift_message',''),500),selected_list) returning id into oid;
 for r in select value from jsonb_array_elements(data->'items')loop
  qty:=(r->>'quantity')::integer;if qty not between 1 and 1000 or qty is null then raise exception 'Cantidad inválida';end if;
  select pv.* into strict v from public.product_variants pv join public.products pr on pr.company_id=pv.company_id and pr.id=pv.product_id where pv.company_id=c and pv.id=(r->>'variant')::uuid and pv.active and pr.active and (staff or(pv.published and pr.published)) ;
  price_ref:=access_private.list_price_record(c,selected_list,v.id);gift_line:=staff and coalesce((r->>'is_gift')::boolean,false);
  sold_price:=case when gift_line then 0 when staff and r->>'unit_price' is not null then (r->>'unit_price')::numeric else (price_ref->>'price')::numeric end;
  if sold_price is null then raise exception 'Pendiente de precio. Configura la lista base o indica el precio realmente vendido';end if;
  if not(sold_price>=0 and sold_price<1e12) then raise exception 'Precio de venta inválido';end if;
  select name into product_name from public.products where company_id=c and id=v.product_id;
  select coalesce(on_hand-blocked-reserved,0) into stock from public.inventory_balances where company_id=c and item_kind='variant' and item_id=v.id;stock:=coalesce(stock,0);
  if qty>stock and (staff or not v.allow_preorder or v.weight_min is not null) then raise exception 'No hay suficientes unidades disponibles de %',v.name;end if;reserve_qty:=least(qty,stock)::integer;
  insert into public.order_lines(company_id,order_id,variant_id,description,attributes,weight_min,weight_max,quantity,unit_price,reserved_quantity,price_reference,is_gift) values(c,oid,v.id,product_name||' · '||v.name,v.attributes,v.weight_min,v.weight_max,qty,sold_price,reserve_qty,price_ref,gift_line) returning id into lid;
  if reserve_qty>0 then perform access_private.post_stock(c,'variant',v.id,0,0,reserve_qty,'order_reservation',lid);end if;sub:=sub+qty*sold_price;
 end loop;

 if staff and data ? 'discount' then discount_value:=access_private.sale_discount(sub,data->'discount');
 elsif cfg->>'currency'=ccy and length(coalesce(data->>'discount_code',''))>0 then
  if upper(trim(data->>'discount_code'))<>cfg->>'discount_code' then raise exception 'Código de descuento no válido';end if;discount_value:=round(sub*coalesce((cfg->>'discount_percent')::numeric,0)/100,2);
 elsif length(coalesce(data->>'discount_code',''))>0 then raise exception 'Código de descuento no disponible';end if;
 update public.sales_orders set subtotal=sub,discount=discount_value,total=sub-discount_value+shipping_value,gift=case when cfg->>'currency'=ccy and nullif(cfg->>'gift_threshold','') is not null and sub-discount_value>=(cfg->>'gift_threshold')::numeric then coalesce(cfg->>'gift','') else '' end where company_id=c and id=oid;
 
 if staff and data ? 'discount' then update public.sales_orders set discount_basis=data#>>'{discount,mode}',discount_input=coalesce(nullif(data#>>'{discount,value}','')::numeric,0) where company_id=c and id=oid;end if;
 if staff and data ? 'delivery_info' then perform access_private.save_order_delivery(c,oid,data->'delivery_info');end if;
 if staff and data ? 'payments' then
  if jsonb_typeof(data->'payments') is distinct from 'array' or jsonb_array_length(data->'payments')>30 then raise exception 'Máximo 30 pagos';end if;
  for r in select value from jsonb_array_elements(data->'payments') loop perform access_private.add_order_payment(c,oid,r);end loop;
 end if;

 if staff and coalesce(nullif(data->>'credit_amount','')::numeric,0)>0 then perform access_private.apply_customer_credit(c,oid,(data->>'credit_amount')::numeric);end if;
 if staff and data->>'payment'='cash' and access_private.order_covered(c,oid)<(select total from public.sales_orders where company_id=c and id=oid) then
  perform access_private.add_order_payment(c,oid,jsonb_build_object('amount',(select total from public.sales_orders where company_id=c and id=oid)-access_private.order_covered(c,oid),'method','cash','receiver','ohana','received_on',current_date,'notes','Pago automático de factura en efectivo'));
 end if;
 if nullif(data->>'expected_total','') is not null and (data->>'expected_total')::numeric<>sub-discount_value+shipping_value then raise exception 'El precio cambió. Revisa el total actualizado antes de confirmar';end if;answer:=jsonb_build_object('id',oid,'number',num,'subtotal',sub,'discount',discount_value,'shipping',shipping_value,'total',sub-discount_value+shipping_value,'currency',ccy,'expires_at',now()+interval '24 hours');
 insert into access_private.operation_requests(company_id,key,action,payload,result) values(c,k,case when staff then 'sale_create' else 'checkout' end,request_data,answer);return answer;
exception when no_data_found then raise exception 'Una variante ya no está disponible. Actualiza el catálogo';end $function$
;
notify pgrst,'reload schema';
