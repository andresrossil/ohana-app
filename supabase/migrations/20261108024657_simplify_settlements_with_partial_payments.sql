alter table public.courier_settlements drop constraint courier_settlements_state_check;
alter table public.courier_settlements add constraint courier_settlements_state_check check(state in('draft','confirmed','pending','partial','settled','cancelled'));

create function access_private.settlement_remaining(c uuid,sid uuid) returns numeric language sql stable set search_path='' as $$
 select case when s.state='cancelled' then 0 when s.net>0 then greatest(0,coalesce((select sum(a.signed_amount) from public.courier_account_movements a where a.company_id=c and a.settlement_id=sid),s.net))
 when s.net<0 then least(0,coalesce((select sum(a.signed_amount) from public.courier_account_movements a where a.company_id=c and a.settlement_id=sid),s.net)) else 0 end
 from public.courier_settlements s where s.company_id=c and s.id=sid
$$;
revoke all on function access_private.settlement_remaining(uuid,uuid) from public,anon,authenticated;
update public.courier_settlements set state=case when access_private.settlement_remaining(company_id,id)=0 then 'settled'
 when abs(access_private.settlement_remaining(company_id,id))<abs(net) then 'partial' else 'pending' end where state='confirmed';
alter table public.courier_settlements drop constraint courier_settlements_state_check;
alter table public.courier_settlements add constraint courier_settlements_state_check check(state in('draft','pending','partial','settled','cancelled'));

create function access_private.reserve_settlement_order() returns trigger language plpgsql security definer set search_path='' as $$
declare reserved_number bigint;begin
 perform pg_advisory_xact_lock(hashtextextended(new.company_id::text,0));
 select st.number into reserved_number from public.courier_settlement_items i join public.courier_settlements st on st.company_id=i.company_id and st.id=i.settlement_id
 where i.company_id=new.company_id and i.order_id=new.order_id and i.settlement_id<>new.settlement_id and st.state<>'cancelled' limit 1;
 if found then raise exception 'La factura ya está reservada o liquidada en LIQ-%',lpad(reserved_number::text,greatest(4,length(reserved_number::text)),'0');end if;
 return new;
end $$;
revoke all on function access_private.reserve_settlement_order() from public,anon,authenticated;
create trigger reserve_settlement_order before insert or update on public.courier_settlement_items for each row execute function access_private.reserve_settlement_order();

CREATE OR REPLACE FUNCTION access_private.courier_pending(c uuid, partner uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select coalesce(jsonb_agg(to_jsonb(z) order by delivered_at,number),'[]') from(
 select o.id order_id,o.number,o.created_at,o.customer_snapshot->>'name' customer,d.status,
 (select st.id from public.courier_settlement_items i join public.courier_settlements st on st.company_id=i.company_id and st.id=i.settlement_id where i.company_id=c and i.order_id=o.id and st.state='draft' order by st.number limit 1) reserved_id,
 (select st.number from public.courier_settlement_items i join public.courier_settlements st on st.company_id=i.company_id and st.id=i.settlement_id where i.company_id=c and i.order_id=o.id and st.state='draft' order by st.number limit 1) reserved_number,
 coalesce((select max((h->>'at')::timestamptz) from jsonb_array_elements(o.fulfillment_history) h where h->>'stage' in('courier','delivered')),d.updated_at) delivered_at,
 coalesce((select sum(p.amount) from public.order_payments p where p.company_id=c and p.order_id=o.id and p.courier_id=partner and p.receiver='courier' and p.method='cash' and p.confirmed and p.voided_at is null and not exists(select 1 from public.courier_settlement_items i where i.company_id=c and i.payment_id=p.id and i.active)),0) collected,
 greatest(0,o.total-access_private.order_covered(c,o.id)) expected_cash,
 case when d.payer='ohana' and not exists(select 1 from public.courier_settlement_items i where i.company_id=c and i.delivery_id=d.id and i.active) then d.shipping_cost else 0 end shipping_cost,
 d.id delivery_id,o.total invoice_total
 from public.sales_orders o join public.sales_deliveries d on d.company_id=o.company_id and d.order_id=o.id
 where o.company_id=c and d.courier_id=partner and o.status='dispatched'
 and (d.status in('in_transit','delivered') or (o.fulfillment_stage='invoiced' and d.status<>'cancelled'))
 and not exists(select 1 from public.courier_settlement_items i where i.company_id=c and i.order_id=o.id and i.active)
 )z where collected>0 or shipping_cost>0 or expected_cash>0
$function$
;
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
   select st.*,access_private.settlement_remaining(c,st.id) remaining,abs(st.net)-abs(access_private.settlement_remaining(c,st.id)) paid_total,b.name courier_name,(select count(distinct i.order_id) from public.courier_settlement_items i where i.company_id=c and i.settlement_id=st.id) order_count
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
  return jsonb_build_object('document',to_jsonb(s)||jsonb_build_object('remaining',access_private.settlement_remaining(c,s.id),'paid_total',abs(s.net)-abs(access_private.settlement_remaining(c,s.id))),'payments',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('reversed',exists(select 1 from public.courier_account_movements rev where rev.company_id=c and rev.reversal_of=a.id)) order by a.sequence) from public.courier_account_movements a where a.company_id=c and a.settlement_id=s.id and a.kind='exchange'),'[]'),'balance',access_private.courier_balance(c,s.courier_id),'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.order_id,i.id) from public.courier_settlement_items i where i.company_id=c and i.settlement_id=sid),'[]'));
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
  pending:=access_private.courier_pending(c,partner);
  for x in select value from jsonb_array_elements(data->'orders') loop
   oid:=case when jsonb_typeof(x)='string' then (x#>>'{}')::uuid else (x->>'order')::uuid end;
   if oid=any(seen) then raise exception 'Pedido repetido';end if;seen:=array_append(seen,oid);
   select value into available from jsonb_array_elements(pending) where value->>'order_id'=oid::text;
   if available is not null and nullif(available->>'reserved_id','')::uuid is distinct from sid and nullif(available->>'reserved_id','') is not null then raise exception 'La factura está reservada para otro borrador';end if;
   if available is null then raise exception 'El pedido ya fue liquidado, no fue entregado a mensajería o pertenece a otra empresa';end if;
   extra:=case when jsonb_typeof(x)='object' and coalesce((x->>'mark_collected')::boolean,false) then coalesce(nullif(x->>'extra_cash','')::numeric,0) else 0 end;
   extra:=round(extra,2);
   if extra<0 or extra>=1e12 or (extra>0 and (available->>'expected_cash')::numeric<=0) then raise exception 'El efectivo adicional no es válido para esta factura';end if;

   if extra>0 and extra<>(available->>'expected_cash')::numeric and not coalesce((data->>'cash_discrepancies_confirmed')::boolean,false) then raise exception 'Confirma el cobro diferente al saldo pendiente antes de guardar';end if;
   select * into strict so from public.sales_orders where company_id=c and id=oid;
   for receipt in select op.* from public.order_payments op where op.company_id=c and op.order_id=oid and op.receiver='courier' and op.courier_id=partner and op.confirmed and op.method='cash' and op.voided_at is null and not exists(select 1 from public.courier_settlement_items i where i.company_id=c and i.payment_id=op.id and i.active) loop
    insert into public.courier_settlement_items(company_id,settlement_id,order_id,payment_id,amount,snapshot)
    values(c,sid,oid,receipt.id,receipt.amount,available||jsonb_build_object('type','collection','number',so.number,'customer',so.customer_snapshot->>'name','recorded_receipt',true));
   end loop;
   if extra>0 then
    insert into public.courier_settlement_items(company_id,settlement_id,order_id,collection_pending,amount,snapshot)
    values(c,sid,oid,true,extra,available||jsonb_build_object('type','collection','number',so.number,'customer',so.customer_snapshot->>'name','expected_due',available->'expected_cash','recorded_receipt',false));
   end if;
   if (available->>'shipping_cost')::numeric>0 then
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
  for r in select i.*,o.status order_status,d.courier_id,d.payer,d.shipping_cost,d.status delivery_status from public.courier_settlement_items i join public.sales_orders o on o.company_id=i.company_id and o.id=i.order_id join public.sales_deliveries d on d.company_id=i.company_id and d.order_id=i.order_id where i.company_id=c and i.settlement_id=sid order by i.order_id,i.collection_pending,i.id loop
   if r.order_status<>'dispatched' or r.delivery_status='cancelled' or r.courier_id<>partner or exists(select 1 from public.courier_settlement_items where company_id=c and order_id=r.order_id and active and settlement_id<>sid) then raise exception 'El pedido cambió o ya está liquidado; actualiza el borrador';end if;
   if r.collection_pending then
    due:=greatest(0,(select total from public.sales_orders where company_id=c and id=r.order_id)-access_private.order_covered(c,r.order_id));
    if due<=0 or due<>(r.snapshot->>'expected_due')::numeric then raise exception 'El saldo de una factura cambió; actualiza el borrador';end if;
    new_payment_id:=access_private.add_order_payment(c,r.order_id,jsonb_build_object('amount',r.amount,'method','cash','receiver','courier','received_on',exchange_date,'confirmed',true,'expected_due',due,'discrepancy_confirmed',true,'notes','Efectivo confirmado en liquidación LIQ-'||lpad(s.number::text,4,'0')));
    update public.order_payments set settlement_generated=true where company_id=c and id=new_payment_id;
    update public.courier_settlement_items set payment_id=new_payment_id,collection_pending=false where company_id=c and id=r.id;
   elsif r.payment_id is not null then
    perform 1 from public.order_payments where company_id=c and id=r.payment_id and order_id=r.order_id and courier_id=partner and receiver='courier' and confirmed and amount=r.amount and voided_at is null;
    if not found then raise exception 'El cobro cambió; actualiza el borrador';end if;
   elsif r.payer<>'ohana' or r.shipping_cost<>r.amount then raise exception 'El envío cambió; actualiza el borrador';end if;
  end loop;
  update public.courier_settlement_items set active=true where company_id=c and settlement_id=sid;
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
end $function$
;

do $dispatch$
declare f text;begin
 f:=pg_get_functiondef('access_private.courier_operations(uuid,text,uuid,jsonb)'::regprocedure);
 if strpos(f,'''settlement_confirm'',''settlement_cancel''')=0 then raise exception 'Unexpected settlement dispatcher';end if;
 f:=replace(f,'''settlement_confirm'',''settlement_cancel''','''settlement_confirm'',''settlement_payment'',''settlement_cancel''');execute f;
end $dispatch$;
notify pgrst,'reload schema';
