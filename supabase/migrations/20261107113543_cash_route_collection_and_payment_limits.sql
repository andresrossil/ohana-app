alter table public.order_payments add column route_collection boolean not null default false;
create unique index order_route_pending_unique on public.order_payments(company_id,order_id) where route_collection and not confirmed and voided_at is null;

create function access_private.sync_cash_route(c uuid,o uuid) returns void language plpgsql set search_path='' as $$
declare so public.sales_orders%rowtype;d public.sales_deliveries%rowtype;p public.order_payments%rowtype;due numeric;
begin
 select * into strict so from public.sales_orders where company_id=c and id=o;
 select * into d from public.sales_deliveries where company_id=c and order_id=o;
 select * into p from public.order_payments where company_id=c and order_id=o and route_collection and not confirmed and voided_at is null for update;
 due:=greatest(0,so.total-access_private.order_covered(c,o));
 if so.payment<>'cash' or so.status in('cancelled','expired') or d.kind is distinct from 'courier' or d.status='cancelled' or d.courier_id is null or due<=0 then
  if p.id is not null then update public.order_payments set voided_at=now(),voided_by=auth.uid(),void_reason='Expectativa de cobro reemplazada o factura cubierta; no representa dinero recibido' where company_id=c and id=p.id;end if;
  return;
 end if;
 if p.id is null then
  if auth.uid() is null then return;end if;
  insert into public.order_payments(company_id,order_id,amount,method,receiver,courier_id,received_on,notes,created_by,confirmed,route_collection)
  values(c,o,due,'cash','courier',d.courier_id,current_date,'Efectivo pendiente de liquidación de ruta',auth.uid(),false,true);
 else update public.order_payments set amount=due,courier_id=d.courier_id,receiver='courier' where company_id=c and id=p.id;end if;
end $$;
revoke all on function access_private.sync_cash_route(uuid,uuid) from public,anon,authenticated;

do $patch$
declare d text;begin
 d:=pg_get_functiondef('access_private.reconcile_customer_account(uuid,uuid)'::regprocedure);
 if strpos(d,' end loop;')=0 then raise exception 'Unexpected account reconciliation';end if;
 d:=replace(d,' end loop;',' perform access_private.sync_cash_route(c,sale.id); end loop;');execute d;
 d:=pg_get_functiondef('access_private.save_order_delivery(uuid,uuid,jsonb)'::regprocedure);
 d:=replace(d,'and receiver=''courier'' and voided_at is null','and receiver=''courier'' and voided_at is null and not(route_collection and not confirmed)');execute d;
 d:=pg_get_functiondef('access_private.guard_paid_order_cancel()'::regprocedure);
 d:=replace(d,'  if exists(select 1 from public.order_payments',$guard$
  update public.order_payments set voided_at=now(),voided_by=auth.uid(),void_reason='Pedido cancelado; el cobro de ruta no se recibió' where company_id=old.company_id and order_id=old.id and route_collection and not confirmed and voided_at is null;
  if exists(select 1 from public.order_payments$guard$);execute d;
end $patch$;
CREATE OR REPLACE FUNCTION access_private.add_order_payment(c uuid, o uuid, info jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare sale public.sales_orders%rowtype;d public.sales_deliveries%rowtype;amount_value numeric(18,2):=nullif(info->>'amount','')::numeric;pid uuid;bank_confirmed boolean;remaining numeric;
begin
 select * into strict sale from public.sales_orders where company_id=c and id=o for update;
 if sale.status in('cancelled','expired') then raise exception 'El pedido está cancelado o vencido';end if;
 remaining:=greatest(0,sale.total-access_private.order_covered(c,o));
 if remaining<=0 then raise exception 'La factura ya está pagada; no admite nuevos pagos';end if;
 if info ? 'expected_due' and (info->>'expected_due')::numeric is distinct from remaining then raise exception 'El saldo cambió; actualiza la factura antes de registrar el pago';end if;
 if amount_value is not null and amount_value<>remaining and not coalesce((info->>'discrepancy_confirmed')::boolean,false) then
  raise exception 'Confirma el importe diferente. Total de factura: %. Pendiente: %. Pago: %. Diferencia: %.',sale.total,remaining,amount_value,amount_value-remaining;
 end if;
 if amount_value is null or amount_value<=0 then raise exception 'El importe debe ser positivo';end if;
 select * into d from public.sales_deliveries where company_id=c and order_id=o;
 if info->>'receiver'='courier' and (d.courier_id is null or d.status='cancelled') then raise exception 'Selecciona una mensajería válida en la entrega';end if;
 if nullif(info->>'received_on','') is null or (info->>'received_on')::date>current_date then raise exception 'Indica la fecha real del pago, sin fechas futuras';end if;
 bank_confirmed:=info->>'method'='cash' or coalesce((info->>'confirmed')::boolean,false);
 insert into public.order_payments(company_id,order_id,amount,method,receiver,courier_id,received_on,notes,created_by,confirmed,confirmed_at)
 values(c,o,amount_value,info->>'method',info->>'receiver',case when info->>'receiver'='courier' then d.courier_id end,(info->>'received_on')::date,coalesce(info->>'notes',''),auth.uid(),bank_confirmed,case when bank_confirmed then now() end) returning id into pid;
 perform access_private.reconcile_customer_account(c,sale.customer_id);return pid;
end $function$
;
CREATE OR REPLACE FUNCTION access_private.customer_finance(c uuid, action text, k uuid DEFAULT NULL::uuid, data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare sale public.sales_orders%rowtype;p public.order_payments%rowtype;a public.customer_credit_applications%rowtype;cached access_private.operation_requests%rowtype;answer jsonb;customer uuid;
begin
 if auth.uid() is null or not public.company_permission(c,case when action='account' then 'read' else 'write' end,'sales') then raise exception 'Cuenta del cliente no autorizada' using errcode='42501';end if;
 if action='account' then
  customer:=(data->>'customer')::uuid;perform 1 from public.business_partners where company_id=c and id=customer and is_customer;if not found then raise exception 'Cliente no disponible';end if;
  return access_private.customer_account(c,customer);
 end if;
 if k is null then raise exception 'Identificador de operación requerido';end if;
 perform pg_advisory_xact_lock(hashtextextended(c::text,0));
 select * into cached from access_private.operation_requests where company_id=c and key=k;
 if found then if cached.action<>'finance_'||action or cached.payload<>data then raise exception 'Identificador utilizado con otros datos';end if;return cached.result;end if;
 if action='credit_apply' then
  answer:=jsonb_build_object('applied',access_private.apply_customer_credit(c,(data->>'order')::uuid,(data->>'amount')::numeric));
 elsif action='credit_void' then
  select * into strict a from public.customer_credit_applications where company_id=c and id=(data->>'id')::uuid for update;
  if a.voided_at is not null then raise exception 'La aplicación ya está anulada';end if;
  if length(trim(coalesce(data->>'reason',''))) not between 5 and 500 then raise exception 'Indica el motivo de reversión (5 a 500 caracteres)';end if;
  update public.customer_credit_applications set voided_at=now(),voided_by=auth.uid(),void_reason=data->>'reason' where id=a.id and company_id=c;
  perform access_private.reconcile_customer_account(c,a.customer_id);answer:=jsonb_build_object('voided',true);
 elsif action='payment_confirm' then
  select * into strict p from public.order_payments where company_id=c and id=(data->>'id')::uuid for update;
  select * into strict sale from public.sales_orders where company_id=c and id=p.order_id;
  if p.route_collection or p.method<>'transfer' or p.voided_at is not null or p.confirmed or sale.status in('cancelled','expired') then raise exception 'El pago no se puede confirmar';end if;
  if access_private.order_covered(c,sale.id)>=sale.total then raise exception 'La factura ya está pagada; anula el comprobante duplicado';end if;
  update public.order_payments set confirmed=true,confirmed_at=now() where company_id=c and id=p.id;
  perform access_private.reconcile_customer_account(c,sale.customer_id);answer:=jsonb_build_object('confirmed',true);
 else raise exception 'Acción financiera inválida';end if;
 insert into access_private.operation_requests(company_id,key,action,payload,result) values(c,k,'finance_'||action,data,answer);return answer;
end $function$
;
CREATE OR REPLACE FUNCTION access_private.courier_operations(c uuid, action text, k uuid DEFAULT NULL::uuid, data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare answer jsonb;cached access_private.operation_requests%rowtype;pid uuid;oid uuid;sid uuid;tariff_mode_value text;r jsonb;line_record record;so public.sales_orders%rowtype;
 settlement public.courier_settlements%rowtype;delivery public.sales_deliveries%rowtype;payment public.order_payments%rowtype;
 v_collected numeric;v_cost numeric;net numeric;actual numeric;counted integer:=0;n bigint;
begin
 if auth.uid() is null or not public.company_permission(c,case when action in('options','tariffs','order','settlements','pending','settlement') then 'read' else 'write' end,'sales') then raise exception 'Mensajería no autorizada' using errcode='42501';end if;
 if action='options' then return jsonb_build_object('couriers',coalesce((select jsonb_agg(jsonb_build_object('id',id,'code',code,'name',name,'active',active,'mode',courier_tariff_mode) order by name) from public.business_partners where company_id=c and is_courier),'[]'),'tariffs',coalesce((select jsonb_agg(to_jsonb(t)) from public.courier_tariffs t where company_id=c),'[]'),'addresses',coalesce((select jsonb_agg(to_jsonb(a) order by is_primary desc,label) from public.partner_addresses a where company_id=c),'[]'));end if;
 pid:=nullif(data->>'courier','')::uuid;oid:=nullif(data->>'order','')::uuid;sid:=nullif(data->>'id','')::uuid;
 if action='tariffs' then
  select jsonb_build_object('courier',to_jsonb(b),'rows',coalesce((select jsonb_agg(to_jsonb(t)) from public.courier_tariffs t where t.company_id=c and t.courier_id=pid),'[]')) into strict answer from public.business_partners b where b.company_id=c and b.id=pid and b.is_courier;return answer;
 elsif action='order' then
  select * into strict so from public.sales_orders where company_id=c and id=oid;
  return jsonb_build_object('order',to_jsonb(so),'delivery',(select to_jsonb(d) from public.sales_deliveries d where d.company_id=c and d.order_id=oid),
   'payments',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('settled',exists(select 1 from public.courier_settlement_items i where i.company_id=c and i.payment_id=p.id and i.active)) order by p.created_at) from public.order_payments p where p.company_id=c and p.order_id=oid),'[]'),
 'summary',access_private.delivery_payment_summary(c,oid),'account',access_private.customer_account(c,so.customer_id),
 'settled',exists(select 1 from public.courier_settlement_items where company_id=c and order_id=oid and active),
 'credit_applications',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('source_number',s.number,'target_number',t.number) order by a.created_at) from public.customer_credit_applications a join public.sales_orders s on s.company_id=a.company_id and s.id=a.source_order_id join public.sales_orders t on t.company_id=a.company_id and t.id=a.target_order_id where a.company_id=c and (a.source_order_id=oid or a.target_order_id=oid)),'[]'));
 elsif action='settlements' then return coalesce((select jsonb_agg(to_jsonb(z)) from(select s.*,b.name courier_name from public.courier_settlements s join public.business_partners b on b.company_id=s.company_id and b.id=s.courier_id where s.company_id=c order by s.number desc limit 300)z),'[]');
 elsif action='pending' then return access_private.courier_pending(c,pid);
 elsif action='settlement' then
  select * into strict settlement from public.courier_settlements where company_id=c and id=sid;
  return jsonb_build_object('document',to_jsonb(settlement),'items',coalesce((select jsonb_agg(to_jsonb(i)) from public.courier_settlement_items i where i.company_id=c and i.settlement_id=sid),'[]'));
 end if;
 if k is null or length(data::text)>100000 then raise exception 'Operación incompleta';end if;
 perform pg_advisory_xact_lock(hashtextextended(c::text,0));
 select * into cached from access_private.operation_requests where company_id=c and key=k;
 if found then if cached.action<>'courier_'||action or cached.payload<>data then raise exception 'Identificador utilizado con otros datos';end if;return cached.result;end if;
 if action='tariffs_save' then
  if not public.company_permission(c,'manage') then raise exception 'Solo administradores pueden cambiar tarifas' using errcode='42501';end if;
  perform 1 from public.business_partners where company_id=c and id=pid and is_courier for update;if not found then raise exception 'Mensajería no disponible';end if;
  tariff_mode_value:=data->>'mode';if tariff_mode_value not in('general','zone','department') or tariff_mode_value is null or jsonb_typeof(data->'rows') is distinct from 'array' or jsonb_array_length(data->'rows')>22 then raise exception 'Tarifario inválido';end if;
  if exists(select 1 from jsonb_array_elements(data->'rows') e group by e->>'destination' having count(*)>1) then raise exception 'Destino repetido';end if;
  for r in select value from jsonb_array_elements(data->'rows') loop
   if (tariff_mode_value='general' and r->>'destination'<>'general') or (tariff_mode_value='zone' and r->>'destination' not in(select generate_series(1,21)::text)) or (tariff_mode_value='department' and r->>'destination' not in('Alta Verapaz','Baja Verapaz','Chimaltenango','Chiquimula','El Progreso','Escuintla','Guatemala','Huehuetenango','Izabal','Jalapa','Jutiapa','Petén','Quetzaltenango','Quiché','Retalhuleu','Sacatepéquez','San Marcos','Santa Rosa','Sololá','Suchitepéquez','Totonicapán','Zacapa')) or r->>'destination' is null then raise exception 'Destino inválido';end if;
   insert into public.courier_tariffs(company_id,courier_id,mode,destination,amount,available) values(c,pid,tariff_mode_value,r->>'destination',nullif(r->>'amount','')::numeric,coalesce((r->>'available')::boolean,false))
    on conflict(company_id,courier_id,mode,destination) do update set amount=excluded.amount,available=excluded.available;
  end loop;
  update public.business_partners set courier_tariff_mode=tariff_mode_value where company_id=c and id=pid;
  answer:=jsonb_build_object('saved',true);
 elsif action='delivery_save' then
  perform access_private.save_order_delivery(c,oid,data->'delivery');answer:=jsonb_build_object('saved',true);
 elsif action='payment_add' then
  answer:=jsonb_build_object('id',access_private.add_order_payment(c,oid,data));
 elsif action='payment_void' then
  select * into strict payment from public.order_payments where company_id=c and id=sid for update;
  if payment.voided_at is not null then raise exception 'El pago ya está anulado';end if;
  if exists(select 1 from public.courier_settlement_items where company_id=c and payment_id=sid and active) then raise exception 'Anula primero la liquidación de este cobro';end if;
  if length(trim(coalesce(data->>'reason',''))) not between 5 and 500 then raise exception 'Indica el motivo (5 a 500 caracteres)';end if;
  update public.order_payments set voided_at=now(),voided_by=auth.uid(),void_reason=data->>'reason' where company_id=c and id=sid;
  update public.sales_orders set paid_at=null where company_id=c and id=payment.order_id;
  perform access_private.reconcile_customer_account(c,(select customer_id from public.sales_orders where company_id=c and id=payment.order_id));answer:=jsonb_build_object('voided',true);
 elsif action='settlement_save' then
  perform 1 from public.business_partners where company_id=c and id=pid and is_courier;if not found then raise exception 'Mensajería no disponible';end if;
  if jsonb_typeof(data->'orders') is distinct from 'array' or jsonb_array_length(data->'orders') not between 1 and 300 then raise exception 'Selecciona entre 1 y 300 pedidos';end if;
  if (select count(distinct value) from jsonb_array_elements_text(data->'orders'))<>jsonb_array_length(data->'orders') then raise exception 'Pedido repetido';end if;
  if nullif(data->>'date','') is null then raise exception 'Indica la fecha de liquidación';end if;
  if sid is null then
   select coalesce(max(number),0)+1 into n from public.courier_settlements where company_id=c;
   insert into public.courier_settlements(company_id,courier_id,number,settled_on,notes,created_by) values(c,pid,n,(data->>'date')::date,coalesce(data->>'notes',''),auth.uid()) returning id into sid;
  else
   select * into strict settlement from public.courier_settlements where company_id=c and id=sid for update;
   if settlement.state<>'draft' then raise exception 'Solo se editan borradores';end if;
   update public.courier_settlements set courier_id=pid,settled_on=(data->>'date')::date,notes=coalesce(data->>'notes','') where company_id=c and id=sid;
   delete from public.courier_settlement_items where company_id=c and settlement_id=sid;
  end if;
  for oid in select value::uuid from jsonb_array_elements_text(data->'orders') loop
   counted:=0;
   select d.* into strict delivery from public.sales_deliveries d join public.sales_orders o on o.company_id=d.company_id and o.id=d.order_id where d.company_id=c and d.order_id=oid and d.courier_id=pid and d.status<>'cancelled' and o.status not in('cancelled','expired');
   select * into strict so from public.sales_orders where company_id=c and id=oid;
   for payment in select p.* from public.order_payments p where p.company_id=c and p.order_id=oid and p.receiver='courier' and p.courier_id=pid and p.voided_at is null and (p.confirmed or p.route_collection) and not exists(select 1 from public.courier_settlement_items i where i.company_id=c and i.payment_id=p.id and i.active) loop
    insert into public.courier_settlement_items(company_id,settlement_id,order_id,payment_id,amount,snapshot) values(c,sid,oid,payment.id,payment.amount,jsonb_build_object('number',so.number,'customer',so.customer_snapshot->>'name','date',so.created_at,'type','collection','route_collection',payment.route_collection,'status',delivery.status));counted:=counted+1;
   end loop;
   if delivery.payer='ohana' and delivery.shipping_cost>0 and not exists(select 1 from public.courier_settlement_items where company_id=c and delivery_id=delivery.id and active) then
    insert into public.courier_settlement_items(company_id,settlement_id,order_id,delivery_id,amount,snapshot) values(c,sid,oid,delivery.id,delivery.shipping_cost,jsonb_build_object('number',so.number,'customer',so.customer_snapshot->>'name','date',so.created_at,'type','shipping','status',delivery.status));counted:=counted+1;
   end if;
   if counted=0 then raise exception 'El pedido % ya está liquidado o no tiene conceptos pendientes',so.number;end if;
  end loop;
  select coalesce(sum(amount) filter(where payment_id is not null),0),coalesce(sum(amount) filter(where delivery_id is not null),0) into v_collected,v_cost from public.courier_settlement_items where company_id=c and settlement_id=sid;
  update public.courier_settlements set collected=v_collected,shipping_cost=v_cost,net=v_collected-v_cost where company_id=c and id=sid;
  answer:=jsonb_build_object('id',sid);
 elsif action in('settlement_confirm','settlement_cancel') then
  select * into strict settlement from public.courier_settlements where company_id=c and id=sid for update;
  if action='settlement_confirm' then
   if settlement.state<>'draft' then raise exception 'La liquidación ya fue confirmada o anulada';end if;
   if settlement.settled_on>current_date then raise exception 'No confirmes intercambios con fecha futura';end if;
   actual:=nullif(data->>'actual_amount','')::numeric;
   if actual is null or actual<>abs(settlement.net) then raise exception 'El importe intercambiado debe coincidir con el saldo (%)',abs(settlement.net);end if;
   for line_record in select i.*,o.status order_status,d.courier_id,d.payer,d.shipping_cost,d.status delivery_status from public.courier_settlement_items i join public.sales_orders o on o.company_id=i.company_id and o.id=i.order_id join public.sales_deliveries d on d.company_id=i.company_id and d.order_id=i.order_id where i.company_id=c and i.settlement_id=sid loop
    if line_record.order_status in('cancelled','expired') or line_record.delivery_status='cancelled' or line_record.courier_id<>settlement.courier_id then raise exception 'La entrega cambió; actualiza el borrador';end if;
    if line_record.payment_id is not null then
     perform 1 from public.order_payments where company_id=c and id=line_record.payment_id and order_id=line_record.order_id and courier_id=settlement.courier_id and amount=line_record.amount and voided_at is null and (confirmed or route_collection);if not found then raise exception 'El cobro cambió; actualiza el borrador';end if;
    elsif line_record.payer<>'ohana' or line_record.shipping_cost<>line_record.amount then raise exception 'El costo de envío cambió; actualiza el borrador';end if;
   end loop;
   update public.order_payments p set confirmed=true,confirmed_at=now()
    from public.courier_settlement_items i where i.company_id=c and i.settlement_id=sid and p.company_id=c and p.id=i.payment_id and p.route_collection and p.voided_at is null;
   update public.courier_settlement_items set active=true where company_id=c and settlement_id=sid;
   if not found then raise exception 'Liquidación vacía';end if;
   update public.courier_settlements set state='confirmed',actual_amount=actual,confirmed_at=now() where company_id=c and id=sid;
  else
   if settlement.state='cancelled' then raise exception 'La liquidación ya está anulada';end if;
   if length(trim(coalesce(data->>'reason',''))) not between 5 and 500 then raise exception 'Indica el motivo de anulación (5 a 500 caracteres)';end if;
   update public.order_payments p set confirmed=false,confirmed_at=null
    from public.courier_settlement_items i where i.company_id=c and i.settlement_id=sid and i.active and p.company_id=c and p.id=i.payment_id and p.route_collection;
   update public.courier_settlement_items set active=false where company_id=c and settlement_id=sid;
   update public.courier_settlements set state='cancelled',cancelled_at=now(),cancel_reason=data->>'reason' where company_id=c and id=sid;
  end if;
  for line_record in select distinct o.customer_id from public.sales_orders o join public.courier_settlement_items i on i.company_id=o.company_id and i.order_id=o.id where i.company_id=c and i.settlement_id=sid loop perform access_private.reconcile_customer_account(c,line_record.customer_id);end loop;
  answer:=jsonb_build_object('id',sid);
 else raise exception 'Acción de mensajería inválida';end if;
 insert into access_private.operation_requests(company_id,key,action,payload,result) values(c,k,'courier_'||action,data,answer);return answer;
exception when unique_violation then raise exception 'Algún cobro o envío ya se liquidó. Actualiza la lista antes de continuar';
end $function$
;
CREATE OR REPLACE FUNCTION access_private.courier_pending(c uuid, partner uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select coalesce(jsonb_agg(to_jsonb(z) order by created_at,number),'[]') from(
 select o.id order_id,o.number,o.created_at,o.customer_snapshot->>'name' customer,d.status,
 coalesce((select sum(p.amount) from public.order_payments p where p.company_id=c and p.order_id=o.id and p.courier_id=partner and p.receiver='courier' and p.voided_at is null and (p.confirmed or p.route_collection) and not exists(select 1 from public.courier_settlement_items i where i.company_id=c and i.payment_id=p.id and i.active)),0) collected,
 case when d.payer='ohana' and not exists(select 1 from public.courier_settlement_items i where i.company_id=c and i.delivery_id=d.id and i.active) then d.shipping_cost else 0 end shipping_cost
 from public.sales_orders o join public.sales_deliveries d on d.company_id=o.company_id and d.order_id=o.id where o.company_id=c and d.courier_id=partner and o.status not in('cancelled','expired') and d.status<>'cancelled'
 )z where collected>0 or shipping_cost>0
$function$
;
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
 if nullif(data->>'expected_total','') is not null and (data->>'expected_total')::numeric<>sub-discount_value+shipping_value then raise exception 'El precio cambió. Revisa el total actualizado antes de confirmar';end if;answer:=jsonb_build_object('id',oid,'number',num,'subtotal',sub,'discount',discount_value,'shipping',shipping_value,'total',sub-discount_value+shipping_value,'currency',ccy,'expires_at',now()+interval '24 hours');
 insert into access_private.operation_requests(company_id,key,action,payload,result) values(c,k,case when staff then 'sale_create' else 'checkout' end,request_data,answer);return answer;
exception when no_data_found then raise exception 'Una variante ya no está disponible. Actualiza el catálogo';end $function$
;

-- Only undo the previous generated automatic receipts; actual manually registered and settled payments are preserved.
do $repair$
declare r record;begin
 for r in select p.id,p.company_id,p.order_id,o.customer_id,d.courier_id from public.order_payments p join public.sales_orders o on o.company_id=p.company_id and o.id=p.order_id left join public.sales_deliveries d on d.company_id=o.company_id and d.order_id=o.id
 where p.notes='Pago automático de factura en efectivo' and p.method='cash' and p.confirmed and p.voided_at is null
 and not exists(select 1 from public.courier_settlement_items i where i.company_id=p.company_id and i.payment_id=p.id and i.active)
 and not exists(select 1 from public.customer_credit_applications a where a.company_id=p.company_id and a.source_order_id=p.order_id and a.voided_at is null)
 loop
  update public.order_payments set confirmed=false,confirmed_at=null,route_collection=true,courier_id=r.courier_id,receiver=case when r.courier_id is null then 'ohana' else 'courier' end,notes='Efectivo pendiente de liquidación de ruta' where id=r.id and company_id=r.company_id;
  perform access_private.reconcile_customer_account(r.company_id,r.customer_id);
 end loop;
end $repair$;
notify pgrst,'reload schema';
