alter table public.business_partners add column is_courier boolean not null default false,
 add column courier_tariff_mode text not null default 'general' check(courier_tariff_mode in('general','zone','department'));
alter table public.business_partners drop constraint business_partners_partner_type_check,
 drop constraint partner_roles_present;
alter table public.business_partners add constraint business_partners_partner_type_check check(partner_type in('customer','supplier','courier')),
 add constraint partner_roles_present check(is_customer or is_supplier or is_courier);

create table public.courier_tariffs(
 id uuid primary key default gen_random_uuid(),company_id uuid not null,courier_id uuid not null,
 mode text not null check(mode in('general','zone','department')),destination text not null,
 amount numeric(18,2) check(amount>=0 and amount<1e12),available boolean not null default false,
 check(not available or amount is not null),unique(company_id,courier_id,mode,destination),
 foreign key(company_id,courier_id) references public.business_partners(company_id,id)
);
create table public.sales_deliveries(
 id uuid primary key default gen_random_uuid(),company_id uuid not null,order_id uuid not null,
 kind text not null check(kind in('courier','own','pickup')),courier_id uuid,
 courier_snapshot jsonb,address text not null default '',destination text not null default '',tariff_snapshot jsonb,
 shipping_cost numeric(18,2) not null default 0 check(shipping_cost>=0 and shipping_cost<1e12),
 shipping_charged numeric(18,2) not null default 0 check(shipping_charged>=0 and shipping_charged<1e12),
 payer text not null default 'ohana' check(payer in('ohana','customer')),
 guide text not null default '' check(length(guide)<=120),status text not null default 'pending' check(status in('pending','in_transit','delivered','cancelled')),
 notes text not null default '' check(length(notes)<=2000),updated_at timestamptz not null default now(),
 unique(company_id,id),unique(company_id,order_id),
 check(length(address)<=2000 and length(destination)<=120),
 check((kind='courier' and courier_id is not null) or (kind<>'courier' and courier_id is null)),
 check(payer<>'customer' or shipping_charged=0),
 foreign key(company_id,order_id) references public.sales_orders(company_id,id),
 foreign key(company_id,courier_id) references public.business_partners(company_id,id)
);
create table public.order_payments(
 id uuid primary key default gen_random_uuid(),company_id uuid not null,order_id uuid not null,
 amount numeric(18,2) not null check(amount>0 and amount<1e12),method text not null check(method in('cash','transfer')),
 receiver text not null check(receiver in('ohana','courier')),courier_id uuid,
 received_on date not null,notes text not null default '' check(length(notes)<=1000),
 created_by uuid not null,created_at timestamptz not null default now(),
 voided_at timestamptz,voided_by uuid,void_reason text,
 unique(company_id,id),
 check((receiver='courier' and courier_id is not null and method='cash') or (receiver='ohana' and courier_id is null)),
 foreign key(company_id,order_id) references public.sales_orders(company_id,id),
 foreign key(company_id,courier_id) references public.business_partners(company_id,id)
);
create index order_payments_order on public.order_payments(company_id,order_id);
create table public.courier_settlements(
 id uuid primary key default gen_random_uuid(),company_id uuid not null,courier_id uuid not null,number bigint not null,
 settled_on date not null,state text not null default 'draft' check(state in('draft','confirmed','cancelled')),
 notes text not null default '' check(length(notes)<=2000),collected numeric(18,2) not null default 0,
 shipping_cost numeric(18,2) not null default 0,net numeric(18,2) not null default 0,actual_amount numeric(18,2),
 created_by uuid not null,created_at timestamptz not null default now(),confirmed_at timestamptz,cancelled_at timestamptz,cancel_reason text,
 unique(company_id,id),unique(company_id,number),
 foreign key(company_id,courier_id) references public.business_partners(company_id,id)
);
create table public.courier_settlement_items(
 id uuid primary key default gen_random_uuid(),company_id uuid not null,settlement_id uuid not null,order_id uuid not null,
 payment_id uuid,delivery_id uuid,amount numeric(18,2) not null check(amount>=0),snapshot jsonb not null,
 active boolean not null default false,
 check((payment_id is null)<>(delivery_id is null)),
 foreign key(company_id,settlement_id) references public.courier_settlements(company_id,id),
 foreign key(company_id,order_id) references public.sales_orders(company_id,id),
 foreign key(company_id,payment_id) references public.order_payments(company_id,id),
 foreign key(company_id,delivery_id) references public.sales_deliveries(company_id,id)
);
create unique index courier_payment_settled_once on public.courier_settlement_items(company_id,payment_id) where active and payment_id is not null;
create unique index courier_shipping_settled_once on public.courier_settlement_items(company_id,delivery_id) where active and delivery_id is not null;
create index courier_settlement_items_document on public.courier_settlement_items(company_id,settlement_id);
create index courier_settlements_partner on public.courier_settlements(company_id,courier_id);
create index sales_deliveries_courier on public.sales_deliveries(company_id,courier_id);

do $rls$ declare t text;begin
 foreach t in array array['courier_tariffs','sales_deliveries','order_payments','courier_settlements','courier_settlement_items'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy company_sales_read on public.%I for select to authenticated using(public.company_permission(company_id,''read'',''sales''))',t);
 end loop;
end $rls$;

create function access_private.delivery_payment_summary(c uuid,o uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object(
 'paid',case when not exists(select 1 from public.order_payments p where p.company_id=c and p.order_id=o) and so.paid_at is not null then so.total else coalesce(sum(p.amount) filter(where p.voided_at is null),0) end,
 'ohana_received',case when not exists(select 1 from public.order_payments p where p.company_id=c and p.order_id=o) and so.paid_at is not null then so.total else coalesce(sum(p.amount) filter(where p.voided_at is null and p.receiver='ohana'),0) end,
 'courier_pending',coalesce(sum(p.amount) filter(where p.voided_at is null and p.receiver='courier' and not exists(select 1 from public.courier_settlement_items i where i.company_id=c and i.payment_id=p.id and i.active)),0),
 'courier_settled',coalesce(sum(p.amount) filter(where p.voided_at is null and p.receiver='courier' and exists(select 1 from public.courier_settlement_items i where i.company_id=c and i.payment_id=p.id and i.active)),0))
 from public.sales_orders so left join public.order_payments p on p.company_id=so.company_id and p.order_id=so.id where so.company_id=c and so.id=o group by so.id
$$;
revoke all on function access_private.delivery_payment_summary(uuid,uuid) from public,anon,authenticated;

create function access_private.courier_pending(c uuid,partner uuid) returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(z) order by created_at,number),'[]') from(
 select o.id order_id,o.number,o.created_at,o.customer_snapshot->>'name' customer,d.status,
 coalesce((select sum(p.amount) from public.order_payments p where p.company_id=c and p.order_id=o.id and p.courier_id=partner and p.receiver='courier' and p.voided_at is null and not exists(select 1 from public.courier_settlement_items i where i.company_id=c and i.payment_id=p.id and i.active)),0) collected,
 case when d.payer='ohana' and not exists(select 1 from public.courier_settlement_items i where i.company_id=c and i.delivery_id=d.id and i.active) then d.shipping_cost else 0 end shipping_cost
 from public.sales_orders o join public.sales_deliveries d on d.company_id=o.company_id and d.order_id=o.id where o.company_id=c and d.courier_id=partner and o.status not in('cancelled','expired') and d.status<>'cancelled'
 )z where collected>0 or shipping_cost>0
$$;
revoke all on function access_private.courier_pending(uuid,uuid) from public,anon,authenticated;

create function access_private.save_order_delivery(c uuid,o uuid,info jsonb) returns void language plpgsql set search_path='' as $$
declare current_delivery public.sales_deliveries%rowtype;partner public.business_partners%rowtype;kind text:=coalesce(info->>'kind','pickup');
 courier uuid:=nullif(info->>'courier_id','')::uuid;payer text:=coalesce(info->>'payer','ohana');cost numeric(18,2):=nullif(info->>'shipping_cost','')::numeric;charged numeric(18,2):=coalesce(nullif(info->>'shipping_charged','')::numeric,0);tariff jsonb;dest_value text:=coalesce(info->>'destination','');
begin
 if jsonb_typeof(info) is distinct from 'object' or length(info::text)>10000 then raise exception 'Entrega incompleta';end if;
 if kind not in('courier','own','pickup') or payer not in('ohana','customer') then raise exception 'Tipo de entrega o pagador inválido';end if;
 if not exists(select 1 from public.sales_orders where company_id=c and id=o and status not in('cancelled','expired')) then raise exception 'Pedido no disponible';end if;
 select * into current_delivery from public.sales_deliveries where company_id=c and order_id=o for update;
 if kind='courier' then
  select * into strict partner from public.business_partners where company_id=c and id=courier and is_courier;
  if not partner.active and (current_delivery.id is null or current_delivery.courier_id is distinct from courier) then raise exception 'Selecciona una mensajería activa';end if;
  if (select currency from public.sales_orders where company_id=c and id=o)<>'GTQ' then raise exception 'Las tarifas de mensajería están en GTQ; no se convierten automáticamente';end if;
  select to_jsonb(t) into tariff from public.courier_tariffs t where t.company_id=c and t.courier_id=courier and t.mode=partner.courier_tariff_mode and t.destination=case when partner.courier_tariff_mode='general' then 'general' else dest_value end and t.available;
  cost:=coalesce(cost,(tariff->>'amount')::numeric);
  if cost is null then raise exception 'No existe tarifa; ingresa el costo real del envío';end if;
 else courier:=null;cost:=coalesce(cost,0);end if;
 if kind='pickup' then cost:=0;charged:=0;payer:='ohana';end if;
 if payer='customer' then charged:=0;end if;
 if kind<>'pickup' and length(trim(coalesce(info->>'address','')))<5 then raise exception 'Indica la dirección completa de entrega';end if;
 if exists(select 1 from public.courier_settlement_items i where i.company_id=c and i.delivery_id=current_delivery.id and i.active) and (current_delivery.courier_id,current_delivery.shipping_cost,current_delivery.payer) is distinct from (courier,cost,payer) then raise exception 'El envío ya está liquidado; anula la liquidación antes de cambiar sus importes';end if;
 if (current_delivery.courier_id is distinct from courier or coalesce(info->>'status','pending')='cancelled') and exists(select 1 from public.order_payments where company_id=c and order_id=o and receiver='courier' and voided_at is null) then raise exception 'Existen cobros del mensajero; anúlalos antes de cambiar la mensajería o cancelar la entrega';end if;
 if charged is distinct from (select shipping from public.sales_orders where company_id=c and id=o) and ((select paid_at is not null from public.sales_orders where company_id=c and id=o) or exists(select 1 from public.order_payments where company_id=c and order_id=o)) then raise exception 'El pedido ya tiene pagos; conserva el envío cobrado al cliente';end if;
 insert into public.sales_deliveries(company_id,order_id,kind,courier_id,courier_snapshot,address,destination,tariff_snapshot,shipping_cost,shipping_charged,payer,guide,status,notes)
 values(c,o,kind,courier,case when courier is not null then jsonb_build_object('code',partner.code,'name',partner.name) end,coalesce(info->>'address',''),dest_value,tariff,cost,charged,payer,coalesce(info->>'guide',''),coalesce(info->>'status','pending'),coalesce(info->>'notes',''))
 on conflict(company_id,order_id) do update set kind=excluded.kind,courier_id=excluded.courier_id,courier_snapshot=excluded.courier_snapshot,address=excluded.address,destination=excluded.destination,
 tariff_snapshot=case when (sales_deliveries.courier_id,sales_deliveries.destination,sales_deliveries.shipping_cost) is not distinct from (excluded.courier_id,excluded.destination,excluded.shipping_cost) then sales_deliveries.tariff_snapshot else excluded.tariff_snapshot end,
 shipping_cost=excluded.shipping_cost,shipping_charged=excluded.shipping_charged,payer=excluded.payer,guide=excluded.guide,status=excluded.status,notes=excluded.notes,updated_at=now();
 update public.sales_orders set shipping=charged,total=subtotal-discount+charged,delivery=case when kind='pickup' then 'pickup' else 'delivery' end where company_id=c and id=o;
end $$;
revoke all on function access_private.save_order_delivery(uuid,uuid,jsonb) from public,anon,authenticated;

create function access_private.add_order_payment(c uuid,o uuid,info jsonb) returns uuid language plpgsql set search_path='' as $$
declare sale public.sales_orders%rowtype;d public.sales_deliveries%rowtype;paid numeric;amount numeric(18,2):=nullif(info->>'amount','')::numeric;pid uuid;
begin
 select * into strict sale from public.sales_orders where company_id=c and id=o for update;
 if sale.status in('cancelled','expired') then raise exception 'El pedido está cancelado o vencido';end if;
 select * into d from public.sales_deliveries where company_id=c and order_id=o;
 paid:=(access_private.delivery_payment_summary(c,o)->>'paid')::numeric;
 if amount is null or amount<=0 or amount+paid>sale.total then raise exception 'El pago debe ser positivo y no superar el saldo pendiente (%)',sale.total-paid;end if;
 if info->>'receiver'='courier' and (d.courier_id is null or d.status='cancelled') then raise exception 'Selecciona una mensajería válida en la entrega';end if;
 if nullif(info->>'received_on','') is null or (info->>'received_on')::date>current_date then raise exception 'Indica la fecha real del pago, sin fechas futuras';end if;
 insert into public.order_payments(company_id,order_id,amount,method,receiver,courier_id,received_on,notes,created_by)
 values(c,o,amount,info->>'method',info->>'receiver',case when info->>'receiver'='courier' then d.courier_id end,(info->>'received_on')::date,coalesce(info->>'notes',''),auth.uid()) returning id into pid;
 update public.sales_orders set paid_at=case when paid+amount>=total then coalesce(paid_at,now()) else null end where company_id=c and id=o;
 return pid;
end $$;
revoke all on function access_private.add_order_payment(uuid,uuid,jsonb) from public,anon,authenticated;

create function access_private.courier_operations(c uuid,action text,k uuid default null,data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
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
   'payments',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('settled',exists(select 1 from public.courier_settlement_items i where i.company_id=c and i.payment_id=p.id and i.active)) order by p.created_at) from public.order_payments p where p.company_id=c and p.order_id=oid),'[]'),'summary',access_private.delivery_payment_summary(c,oid));
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
  answer:=jsonb_build_object('voided',true);
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
   for payment in select p.* from public.order_payments p where p.company_id=c and p.order_id=oid and p.receiver='courier' and p.courier_id=pid and p.voided_at is null and not exists(select 1 from public.courier_settlement_items i where i.company_id=c and i.payment_id=p.id and i.active) loop
    insert into public.courier_settlement_items(company_id,settlement_id,order_id,payment_id,amount,snapshot) values(c,sid,oid,payment.id,payment.amount,jsonb_build_object('number',so.number,'customer',so.customer_snapshot->>'name','date',so.created_at,'type','collection','status',delivery.status));counted:=counted+1;
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
     perform 1 from public.order_payments where company_id=c and id=line_record.payment_id and order_id=line_record.order_id and courier_id=settlement.courier_id and amount=line_record.amount and voided_at is null;if not found then raise exception 'El cobro cambió; actualiza el borrador';end if;
    elsif line_record.payer<>'ohana' or line_record.shipping_cost<>line_record.amount then raise exception 'El costo de envío cambió; actualiza el borrador';end if;
   end loop;
   update public.courier_settlement_items set active=true where company_id=c and settlement_id=sid;
   if not found then raise exception 'Liquidación vacía';end if;
   update public.courier_settlements set state='confirmed',actual_amount=actual,confirmed_at=now() where company_id=c and id=sid;
  else
   if settlement.state='cancelled' then raise exception 'La liquidación ya está anulada';end if;
   if length(trim(coalesce(data->>'reason',''))) not between 5 and 500 then raise exception 'Indica el motivo de anulación (5 a 500 caracteres)';end if;
   update public.courier_settlement_items set active=false where company_id=c and settlement_id=sid;
   update public.courier_settlements set state='cancelled',cancelled_at=now(),cancel_reason=data->>'reason' where company_id=c and id=sid;
  end if;answer:=jsonb_build_object('id',sid);
 else raise exception 'Acción de mensajería inválida';end if;
 insert into access_private.operation_requests(company_id,key,action,payload,result) values(c,k,'courier_'||action,data,answer);return answer;
exception when unique_violation then raise exception 'Algún cobro o envío ya se liquidó. Actualiza la lista antes de continuar';
end $$;
revoke all on function access_private.courier_operations(uuid,text,uuid,jsonb) from public,anon;
grant execute on function access_private.courier_operations(uuid,text,uuid,jsonb) to authenticated;
create function public.courier_operations(p_company uuid,p_action text,p_key uuid default null,p_data jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$ select access_private.courier_operations(p_company,p_action,p_key,p_data) $$;
revoke all on function public.courier_operations(uuid,text,uuid,jsonb) from public,anon;
grant execute on function public.courier_operations(uuid,text,uuid,jsonb) to authenticated;
CREATE OR REPLACE FUNCTION access_private.partner_read(c uuid, t text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select auth.uid() is not null and (public.company_permission(c,'manage') or
 (t in('customer','courier') and public.company_permission(c,'read','sales')) or
 (t='supplier' and(public.company_permission(c,'read','catalog') or public.company_permission(c,'read','inventory'))))
$function$
;
CREATE OR REPLACE FUNCTION access_private.next_partner_code(c uuid, t text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select (case when t='supplier' then 'PR' when t='courier' then 'MS' else 'C' end)||lpad((coalesce(max(substring(code from '[0-9]+$')::bigint),0)+1)::text,
 greatest(4,length((coalesce(max(substring(code from '[0-9]+$')::bigint),0)+1)::text)),'0')
 from public.business_partners where company_id=c and code ~ (case when t='supplier' then '^PR[0-9]{1,12}$' when t='courier' then '^MS[0-9]{1,12}$' else '^C[0-9]{1,12}$' end)
$function$
;
CREATE OR REPLACE FUNCTION access_private.guard_partner()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 perform pg_advisory_xact_lock(hashtextextended(new.company_id::text,0));
 if tg_op='UPDATE' then
  if new.id<>old.id or new.company_id<>old.company_id then raise exception 'La identidad del socio no se puede cambiar';end if;
  new.partner_type:=old.partner_type;new.code:=old.code;
  if (new.is_customer,new.is_supplier,new.is_courier,new.courier_tariff_mode) is distinct from (old.is_customer,old.is_supplier,old.is_courier,old.courier_tariff_mode) and auth.uid() is not null and not public.company_permission(new.company_id,'manage') then raise exception 'Solo administradores pueden cambiar los tipos de socio' using errcode='42501';end if;
  if not new.is_supplier and (exists(select 1 from public.presentations where company_id=old.company_id and supplier_id=old.id) or exists(select 1 from public.purchase_receipts where company_id=old.company_id and supplier_id=old.id)) then raise exception 'El proveedor tiene relaciones existentes; conserva su tipo';end if;
  if not new.is_customer and exists(select 1 from public.sales_orders where company_id=old.company_id and customer_id=old.id) then raise exception 'El cliente tiene pedidos; conserva su tipo';end if;
 else
  if (new.partner_type in('supplier','courier') or new.is_supplier or new.is_courier) and auth.uid() is not null and not public.company_permission(new.company_id,'manage') then raise exception 'Solo administradores pueden crear proveedores' using errcode='42501';end if;
  new.code:=access_private.next_partner_code(new.company_id,new.partner_type);
 end if;
 -- Keep the original role for compatibility; adding the other role never changes identity.
 if new.partner_type='customer' then new.is_customer:=true;elsif new.partner_type='courier' then new.is_courier:=true;else new.is_supplier:=true;end if;
 new.name:=trim(new.name);new.alternate_code:=nullif(trim(new.alternate_code),'');
 if new.whatsapp_same then new.whatsapp:=new.phone;end if;
 new.updated_at:=now();return new;
end $function$
;
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
  return jsonb_build_object('rows',res,'total',cnt,'canManage',public.company_permission(c,'manage'),'supplierRead',access_private.partner_read(c,'supplier'),'customerRead',access_private.partner_read(c,'customer'));
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
  return jsonb_build_object('partner',to_jsonb(p),'canChangeType',not(exists(select 1 from public.presentations where company_id=c and supplier_id=pid) or exists(select 1 from public.purchase_receipts where company_id=c and supplier_id=pid) or exists(select 1 from public.sales_orders where company_id=c and customer_id=pid)), 'addresses',coalesce((select jsonb_agg(to_jsonb(d) order by is_primary desc,label,id) from public.partner_addresses d where d.company_id=c and d.partner_id=pid),'[]'),
   'related',case when p.is_supplier and(public.company_permission(c,'read','catalog') or public.company_permission(c,'manage')) then
     jsonb_build_object('presentations',coalesce((select jsonb_agg(to_jsonb(z)) from(select pp.id,rm.name material,pp.quantity,u.symbol unit,pp.active from public.presentations pp join public.raw_materials rm on rm.company_id=pp.company_id and rm.id=pp.raw_material_id join public.units u on u.company_id=pp.company_id and u.id=pp.unit_id where pp.company_id=c and pp.supplier_id=pid order by rm.name limit 100)z),'[]'),
     'prices',coalesce((select jsonb_agg(to_jsonb(z)) from(select h.effective_on,h.amount,h.currency,rm.name material from public.price_history h join public.presentations pp on pp.company_id=h.company_id and pp.id=h.presentation_id join public.raw_materials rm on rm.company_id=pp.company_id and rm.id=pp.raw_material_id where pp.company_id=c and pp.supplier_id=pid order by h.effective_on desc nulls last,h.created_at desc limit 100)z),'[]')) else '{}'::jsonb end ||
    case when p.is_supplier and(public.company_permission(c,'read','inventory') or public.company_permission(c,'manage')) then jsonb_build_object('purchases',coalesce((select jsonb_agg(to_jsonb(z)) from(select received_on,reference,quantity,amount,currency from public.purchase_receipts where company_id=c and supplier_id=pid order by created_at desc limit 100)z),'[]')) else '{}'::jsonb end ||
    case when p.is_customer and access_private.partner_read(c,'customer') then jsonb_build_object('orders',coalesce((select jsonb_agg(to_jsonb(z)) from(select number,status,total,currency,created_at from public.sales_orders where company_id=c and customer_id=pid order by created_at desc limit 100)z),'[]')) else '{}'::jsonb end);
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
 update public.business_partners set name=trim(data->>'name'),is_customer=coalesce((data->>'is_customer')::boolean,is_customer),is_supplier=coalesce((data->>'is_supplier')::boolean,is_supplier),alternate_code=nullif(trim(data->>'alternate_code'),''),instagram=coalesce(data->>'instagram',''),facebook=coalesce(data->>'facebook',''),phone_secondary=coalesce(data->>'phone_secondary',''),whatsapp_same=coalesce((data->>'whatsapp_same')::boolean,false),payment_preference=nullif(data->>'payment_preference',''),legal_name=coalesce(data->>'legal_name',''),tax_id=coalesce(data->>'tax_id',''),phone=coalesce(data->>'phone',''),whatsapp=coalesce(data->>'whatsapp',''),email=trim(coalesce(data->>'email','')),active=coalesce((data->>'active')::boolean,true),notes=coalesce(data->>'notes',''),commercial_notes=coalesce(data->>'commercial_notes',''),purchase_terms=coalesce(data->>'purchase_terms',''),delivery_instructions=coalesce(data->>'delivery_instructions','') where company_id=c and id=pid;
 update public.partner_addresses set is_primary=false where company_id=c and partner_id=pid;
 for a in select value from jsonb_array_elements(data->'addresses') loop
  aid:=nullif(a->>'id','')::uuid;
  if aid is null then aid:=gen_random_uuid();
   insert into public.partner_addresses(id,company_id,partner_id,label,address,instructions,phone,is_primary) values(aid,c,pid,trim(a->>'label'),trim(a->>'address'),coalesce(a->>'instructions',''),coalesce(a->>'phone',''),coalesce((a->>'is_primary')::boolean,false));
  else
   update public.partner_addresses set label=trim(a->>'label'),address=trim(a->>'address'),instructions=coalesce(a->>'instructions',''),phone=coalesce(a->>'phone',''),is_primary=coalesce((a->>'is_primary')::boolean,false) where company_id=c and partner_id=pid and id=aid;
   if not found then raise exception 'Dirección ajena o inexistente' using errcode='42501';end if;
  end if;
  if aid=any(used) then raise exception 'Dirección repetida';end if;used:=array_append(used,aid);
 end loop;
 delete from public.partner_addresses where company_id=c and partner_id=pid and not(id=any(used));
 update public.business_partners set address=coalesce((select address from public.partner_addresses where company_id=c and partner_id=pid order by is_primary desc,label,id limit 1),'') where company_id=c and id=pid;
 return jsonb_build_object('id',pid);
end $function$
;
drop policy partners_read on public.business_partners;
create policy partners_read on public.business_partners for select to authenticated using(
 (is_customer and access_private.partner_read(company_id,'customer')) or (is_supplier and access_private.partner_read(company_id,'supplier')) or (is_courier and access_private.partner_read(company_id,'courier')));
CREATE OR REPLACE FUNCTION access_private.place_order(c uuid, k uuid, data jsonb, staff boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cfg jsonb;ccy text;cached access_private.operation_requests%rowtype;r jsonb;v public.product_variants%rowtype;product_name text;stock numeric;qty integer;reserve_qty integer;oid uuid;cid uuid;lid uuid;num bigint;sub numeric:=0;discount_value numeric:=0;shipping_value numeric:=0;phone text;customer jsonb;answer jsonb;request_data jsonb:=data;matched_phone text;price_ref jsonb;sold_price numeric;begin
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
  shipping_value:=case when data#>>'{delivery_info,payer}'='customer' or data#>>'{delivery_info,kind}'='pickup' then 0 else coalesce(nullif(data#>>'{delivery_info,shipping_charged}','')::numeric,0) end;
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
 
 insert into public.sales_orders(company_id,number,customer_id,customer_snapshot,currency,subtotal,total,shipping,delivery,payment,gift_message) values(c,num,cid,customer,ccy,0,0,shipping_value,data->>'delivery',data->>'payment',left(coalesce(data->>'gift_message',''),500)) returning id into oid;
 for r in select value from jsonb_array_elements(data->'items')loop
  qty:=(r->>'quantity')::integer;if qty not between 1 and 1000 or qty is null then raise exception 'Cantidad inválida';end if;
  select pv.* into strict v from public.product_variants pv join public.products pr on pr.company_id=pv.company_id and pr.id=pv.product_id where pv.company_id=c and pv.id=(r->>'variant')::uuid and pv.active and pr.active and (staff or(pv.published and pr.published)) ;
  price_ref:=access_private.base_price_record(c,v.id);
  sold_price:=case when staff and r->>'unit_price' is not null then (r->>'unit_price')::numeric else (price_ref->>'price')::numeric end;
  if sold_price is null then raise exception 'Pendiente de precio. Configura la lista base o indica el precio realmente vendido';end if;
  if not(sold_price>=0 and sold_price<1e12) then raise exception 'Precio de venta inválido';end if;
  select name into product_name from public.products where company_id=c and id=v.product_id;
  select coalesce(on_hand-blocked-reserved,0) into stock from public.inventory_balances where company_id=c and item_kind='variant' and item_id=v.id;stock:=coalesce(stock,0);
  if qty>stock and (not v.allow_preorder or v.weight_min is not null) then raise exception 'No hay suficientes unidades disponibles de %',v.name;end if;reserve_qty:=least(qty,stock)::integer;
  insert into public.order_lines(company_id,order_id,variant_id,description,attributes,weight_min,weight_max,quantity,unit_price,reserved_quantity,price_reference) values(c,oid,v.id,product_name||' · '||v.name,v.attributes,v.weight_min,v.weight_max,qty,sold_price,reserve_qty,price_ref) returning id into lid;
  if reserve_qty>0 then perform access_private.post_stock(c,'variant',v.id,0,0,reserve_qty,'order_reservation',lid);end if;sub:=sub+qty*sold_price;
 end loop;
 if cfg->>'currency'=ccy and length(coalesce(data->>'discount_code',''))>0 then
  if upper(trim(data->>'discount_code'))<>cfg->>'discount_code' then raise exception 'Código de descuento no válido';end if;discount_value:=round(sub*coalesce((cfg->>'discount_percent')::numeric,0)/100,2);
 elsif length(coalesce(data->>'discount_code',''))>0 then raise exception 'Código de descuento no disponible';end if;
 update public.sales_orders set subtotal=sub,discount=discount_value,total=sub-discount_value+shipping_value,gift=case when cfg->>'currency'=ccy and nullif(cfg->>'gift_threshold','') is not null and sub-discount_value>=(cfg->>'gift_threshold')::numeric then coalesce(cfg->>'gift','') else '' end where company_id=c and id=oid;
 if staff and data ? 'delivery_info' then perform access_private.save_order_delivery(c,oid,data->'delivery_info');end if;
 if staff and data ? 'payments' then
  if jsonb_typeof(data->'payments') is distinct from 'array' or jsonb_array_length(data->'payments')>30 then raise exception 'Máximo 30 pagos';end if;
  for r in select value from jsonb_array_elements(data->'payments') loop perform access_private.add_order_payment(c,oid,r);end loop;
 end if;
 if nullif(data->>'expected_total','') is not null and (data->>'expected_total')::numeric<>sub-discount_value+shipping_value then raise exception 'El precio cambió. Revisa el total actualizado antes de confirmar';end if;answer:=jsonb_build_object('id',oid,'number',num,'subtotal',sub,'discount',discount_value,'shipping',shipping_value,'total',sub-discount_value+shipping_value,'currency',ccy,'expires_at',now()+interval '24 hours');
 insert into access_private.operation_requests(company_id,key,action,payload,result) values(c,k,case when staff then 'sale_create' else 'checkout' end,request_data,answer);return answer;
exception when no_data_found then raise exception 'Una variante ya no está disponible. Actualiza el catálogo';end $function$
;
CREATE OR REPLACE FUNCTION access_private.sales(c uuid, action text, k uuid DEFAULT NULL::uuid, data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$declare o public.sales_orders%rowtype;l record;available numeric;answer jsonb;cached access_private.operation_requests%rowtype;begin
 if auth.uid() is null or not public.company_permission(c,case when action='list' then 'read' else 'write' end,'sales') then raise exception 'Ventas no autorizadas' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(c::text,0));perform access_private.expire_orders(c);
 if action='list' then return jsonb_build_object('orders',coalesce((select jsonb_agg(to_jsonb(so)||jsonb_build_object('delivery_info',(select to_jsonb(d) from public.sales_deliveries d where d.company_id=c and d.order_id=so.id),'payment_summary',access_private.delivery_payment_summary(c,so.id),'lines',(select jsonb_agg(to_jsonb(ol)||jsonb_build_object('physical_units',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'weight',u.weight,'variant_snapshot',u.variant_snapshot,'status',case when u.order_line_id=ol.id then u.status else 'released' end)) from public.inventory_units u where u.company_id=c and (u.order_line_id=ol.id or exists(select 1 from public.inventory_unit_movements h where h.company_id=c and h.unit_id=u.id and (h.order_line_before=ol.id or h.order_line_after=ol.id)))),'[]'))) from public.order_lines ol where ol.company_id=c and ol.order_id=so.id))) from (select * from public.sales_orders where company_id=c order by created_at desc limit 100)so),'[]'),'customers',coalesce((select jsonb_agg(to_jsonb(cs)) from(select * from public.customers where company_id=c and active order by name,id limit 200)cs),'[]'),'variants',coalesce((select jsonb_agg(jsonb_build_object('id',pv.id,'name',pr.name||' · '||access_private.variant_label(to_jsonb(pv)),'sku',pv.sku,'barcode',pv.barcode,'price',access_private.base_sale_price(pv.company_id,pv.id),'currency',(select currency from public.companies where id=c),'available',coalesce(bal.on_hand-bal.blocked-bal.reserved,0),'allow_preorder',pv.allow_preorder)) from public.product_variants pv join public.products pr on pr.company_id=pv.company_id and pr.id=pv.product_id left join public.inventory_balances bal on bal.company_id=pv.company_id and bal.item_kind='variant' and bal.item_id=pv.id where pv.company_id=c and pv.active and pr.active),'[]'));end if;
 if action='create' then return access_private.place_order(c,k,data,true);end if;
 if action not in('paid','cancel','dispatch') or k is null then raise exception 'Operación no válida';end if;
 select * into cached from access_private.operation_requests where company_id=c and key=k;if found then if cached.action<>'sale_'||action or cached.payload<>data then raise exception 'Identificador ya utilizado';end if;return cached.result;end if;
 select * into strict o from public.sales_orders where company_id=c and id=(data->>'order')::uuid for update;
 if action='paid' then
  perform access_private.add_order_payment(c,o.id,jsonb_build_object('amount',o.total-(access_private.delivery_payment_summary(c,o.id)->>'paid')::numeric,'method',case when o.payment='transfer' then 'transfer' else 'cash' end,'receiver','ohana','received_on',current_date,'notes','Confirmación de saldo recibido'));
  if o.status in('cancelled','expired') then raise exception 'El pedido está cancelado o vencido. Registra una nueva venta si corresponde';end if;update public.sales_orders set paid_at=coalesce(paid_at,now()) where company_id=c and id=o.id;
 elsif action='cancel' then
  if o.status='dispatched' then answer:=access_private.document_cancellation(c,'confirm',gen_random_uuid(),jsonb_build_object('source_kind','sale','source_id',o.id,'reason',data->>'reason'));insert into access_private.operation_requests(company_id,key,action,payload,result) values(c,k,'sale_'||action,data,answer);return answer;end if;
  if o.status='pending' then for l in select * from public.order_lines where company_id=c and order_id=o.id loop if l.reserved_quantity>0 then perform access_private.post_stock(c,'variant',l.variant_id,0,0,-l.reserved_quantity,'order_cancel',l.id);end if;end loop;update public.sales_orders set status='cancelled',refund_pending=paid_at is not null where company_id=c and id=o.id;end if;
 elsif o.status<>'dispatched' then
  if o.status<>'pending' then raise exception 'El pedido no puede entregarse';end if;if o.payment='transfer' and o.paid_at is null and not exists(select 1 from public.sales_deliveries where company_id=c and order_id=o.id and kind='courier' and status<>'cancelled') then raise exception 'Confirma la transferencia recibida antes de entregar';end if;
  for l in select * from public.order_lines where company_id=c and order_id=o.id loop
   select on_hand-blocked-reserved+l.reserved_quantity into available from public.inventory_balances where company_id=c and item_kind='variant' and item_id=l.variant_id;if coalesce(available,0)<l.quantity then raise exception 'Existencias insuficientes; hay unidades pendientes de producir o liberar';end if;
   perform access_private.post_stock(c,'variant',l.variant_id,-l.quantity,0,-l.reserved_quantity,'order_dispatch',l.id);
  end loop;update public.sales_orders set status='dispatched' where company_id=c and id=o.id;
 end if;
 answer:=jsonb_build_object('id',o.id);insert into access_private.operation_requests(company_id,key,action,payload,result) values(c,k,'sale_'||action,data,answer);return answer;
end $function$
;
CREATE OR REPLACE FUNCTION access_private.expire_orders(c uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$declare o record;l record;begin
 for o in select id from public.sales_orders where company_id=c and status='pending' and paid_at is null and expires_at<=now() and not exists(select 1 from public.order_payments p where p.company_id=c and p.order_id=public.sales_orders.id and p.voided_at is null) for update loop
  for l in select * from public.order_lines where company_id=c and order_id=o.id loop
   if l.reserved_quantity>0 then perform access_private.post_stock(c,'variant',l.variant_id,0,0,-l.reserved_quantity,'order_expire',l.id);end if;
  end loop;
  update public.sales_orders set status='expired' where company_id=c and id=o.id;
 end loop;
end $function$
;
create function access_private.guard_paid_order_cancel() returns trigger language plpgsql set search_path='' as $guard$
begin
 if new.status in('cancelled','expired') and old.status not in('cancelled','expired') and exists(select 1 from public.order_payments where company_id=old.company_id and order_id=old.id and voided_at is null) then
  raise exception 'El pedido tiene cobros registrados. Anula primero los cobros y sus liquidaciones; no se procesan reembolsos automáticamente';
 end if;return new;
end $guard$;
revoke all on function access_private.guard_paid_order_cancel() from public,anon,authenticated;
create trigger order_collection_cancel_guard before update of status on public.sales_orders for each row execute function access_private.guard_paid_order_cancel();
notify pgrst,'reload schema';



