alter table public.courier_settlements add column revision integer not null default 0,
 add column balance_before numeric(18,2),add column balance_after numeric(18,2),
 add column exchange_direction text check(exchange_direction in('received','paid')),
 add column exchange_method text check(exchange_method in('cash','transfer')),
 add column exchanged_on date,add column exchange_notes text not null default '';
alter table public.courier_settlement_items add column collection_pending boolean not null default false;
alter table public.courier_settlement_items drop constraint courier_settlement_items_check;
alter table public.courier_settlement_items add constraint settlement_item_source check(
 (collection_pending and payment_id is null and delivery_id is null) or
 (not collection_pending and ((payment_id is null)<>(delivery_id is null))));
alter table public.order_payments add column settlement_generated boolean not null default false;

create table public.courier_account_movements(
 id uuid primary key default gen_random_uuid(),company_id uuid not null,courier_id uuid not null,
 sequence bigint generated always as identity,kind text not null check(kind in('settlement','exchange','reversal')),
 signed_amount numeric(18,2) not null check(abs(signed_amount)<1e12),settlement_id uuid,
 reversal_of uuid,method text check(method in('cash','transfer')),occurred_on date not null,
 notes text not null default '' check(length(notes)<=2000),created_by uuid not null,created_at timestamptz not null default now(),
 unique(company_id,id),unique(company_id,reversal_of),
 foreign key(company_id,courier_id) references public.business_partners(company_id,id),
 foreign key(company_id,settlement_id) references public.courier_settlements(company_id,id),
 foreign key(company_id,reversal_of) references public.courier_account_movements(company_id,id),
 check((kind='reversal')=(reversal_of is not null))
);
create index courier_account_sequence on public.courier_account_movements(company_id,courier_id,sequence);
create index courier_account_document on public.courier_account_movements(company_id,settlement_id) where settlement_id is not null;
alter table public.courier_account_movements enable row level security;
revoke all on public.courier_account_movements from public,anon,authenticated;
grant select on public.courier_account_movements to authenticated;
create policy courier_account_read on public.courier_account_movements for select to authenticated using(public.company_permission(company_id,'read','sales'));

create function access_private.courier_balance(c uuid,partner uuid) returns numeric language sql stable set search_path='' as $$
 select coalesce(sum(signed_amount),0) from public.courier_account_movements where company_id=c and courier_id=partner
$$;
revoke all on function access_private.courier_balance(uuid,uuid) from public,anon,authenticated;

-- Reconstruct only confirmed historical documents from their recorded totals; no payment method is invented.
do $history$
declare s record;prior numeric;begin
 for s in select * from public.courier_settlements where state='confirmed' order by confirmed_at,created_at,id loop
  prior:=access_private.courier_balance(s.company_id,s.courier_id);
  insert into public.courier_account_movements(company_id,courier_id,kind,signed_amount,settlement_id,occurred_on,notes,created_by,created_at)
  values(s.company_id,s.courier_id,'settlement',s.net,s.id,s.settled_on,'Resultado de liquidación histórica',s.created_by,coalesce(s.confirmed_at,s.created_at));
  if coalesce(s.actual_amount,0)>0 then
   insert into public.courier_account_movements(company_id,courier_id,kind,signed_amount,settlement_id,occurred_on,notes,created_by,created_at)
   values(s.company_id,s.courier_id,'exchange',case when s.net>=0 then -s.actual_amount else s.actual_amount end,s.id,s.settled_on,'Intercambio histórico; método no registrado',s.created_by,coalesce(s.confirmed_at,s.created_at));
  end if;
  update public.courier_settlements set balance_before=prior,balance_after=access_private.courier_balance(s.company_id,s.courier_id),
   exchange_direction=case when s.net>=0 then 'received' else 'paid' end,exchanged_on=s.settled_on where id=s.id;
 end loop;
end $history$;

create or replace function access_private.courier_pending(c uuid,partner uuid) returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(z) order by delivered_at,number),'[]') from(
 select o.id order_id,o.number,o.created_at,o.customer_snapshot->>'name' customer,d.status,
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
$$;

create function access_private.settlement_engine(c uuid,action text,k uuid default null,data jsonb default '{}') returns jsonb language plpgsql set search_path='' as $$
declare cached access_private.operation_requests%rowtype;s public.courier_settlements%rowtype;so public.sales_orders%rowtype;
 d public.sales_deliveries%rowtype;p public.order_payments%rowtype;m public.courier_account_movements%rowtype;
 partner uuid:=nullif(data->>'courier','')::uuid;sid uuid:=nullif(data->>'id','')::uuid;oid uuid;new_payment_id uuid;
 r record;x jsonb;pending jsonb;available jsonb;extra numeric;due numeric;v_collected numeric;v_cost numeric;actual numeric;before_value numeric;after_value numeric;signed_value numeric;
 n bigint;last_sequence bigint;reason text;answer jsonb;seen uuid[]:='{}';exchange_date date;v_direction text;v_method text;
begin
 if auth.uid() is null or not public.company_permission(c,case when action in('settlements','pending','settlement','account') then 'read' else 'write' end,'sales') then raise exception 'Liquidación no autorizada' using errcode='42501';end if;
 if length(data::text)>200000 then raise exception 'Solicitud demasiado extensa';end if;
 if action='settlements' then
  return coalesce((select jsonb_agg(to_jsonb(z) order by number desc) from(
   select st.*,b.name courier_name,(select count(distinct i.order_id) from public.courier_settlement_items i where i.company_id=c and i.settlement_id=st.id) order_count
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
  return jsonb_build_object('document',to_jsonb(s),'balance',access_private.courier_balance(c,s.courier_id),'items',coalesce((select jsonb_agg(to_jsonb(i) order by i.order_id,i.id) from public.courier_settlement_items i where i.company_id=c and i.settlement_id=sid),'[]'));
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
   if available is null then raise exception 'El pedido ya fue liquidado, no fue entregado a mensajería o pertenece a otra empresa';end if;
   extra:=case when jsonb_typeof(x)='object' and coalesce((x->>'mark_collected')::boolean,false) then coalesce(nullif(x->>'extra_cash','')::numeric,0) else 0 end;
   extra:=round(extra,2);
   if extra<0 or extra>=1e12 or (extra>0 and (available->>'expected_cash')::numeric<=0) then raise exception 'El efectivo adicional no es válido para esta factura';end if;
   select * into strict so from public.sales_orders where company_id=c and id=oid;
   for p in select op.* from public.order_payments op where op.company_id=c and op.order_id=oid and op.receiver='courier' and op.courier_id=partner and op.confirmed and op.method='cash' and op.voided_at is null and not exists(select 1 from public.courier_settlement_items i where i.company_id=c and i.payment_id=op.id and i.active) loop
    insert into public.courier_settlement_items(company_id,settlement_id,order_id,payment_id,amount,snapshot)
    values(c,sid,oid,p.id,p.amount,available||jsonb_build_object('type','collection','number',so.number,'customer',so.customer_snapshot->>'name','recorded_receipt',true));
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
  actual:=round(nullif(data->>'actual_amount','')::numeric,2);v_direction:=data->>'direction';v_method:=data->>'method';exchange_date:=nullif(data->>'exchange_date','')::date;
  if actual is null or actual<0 or actual>=1e12 or v_direction not in('received','paid') or v_direction is null or v_method not in('cash','transfer') or v_method is null or exchange_date is null or exchange_date>current_date or length(coalesce(data->>'exchange_notes',''))>2000 then raise exception 'Revisa importe, dirección, método y fecha del intercambio';end if;
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
  update public.courier_settlements set state='confirmed',actual_amount=actual,confirmed_at=now(),balance_before=before_value,balance_after=after_value,exchange_direction=v_direction,exchange_method=v_method,exchanged_on=exchange_date,exchange_notes=coalesce(data->>'exchange_notes','') where company_id=c and id=sid;
  for r in select distinct o.customer_id from public.sales_orders o join public.courier_settlement_items i on i.company_id=o.company_id and i.order_id=o.id where i.company_id=c and i.settlement_id=sid loop perform access_private.reconcile_customer_account(c,r.customer_id);end loop;
  answer:=jsonb_build_object('id',sid,'balance',after_value);
 elsif action='settlement_cancel' then
  select * into strict s from public.courier_settlements where company_id=c and id=sid for update;
  if s.state='cancelled' then raise exception 'La liquidación ya está anulada';end if;
  reason:=trim(coalesce(data->>'reason',''));if length(reason) not between 5 and 500 then raise exception 'Indica un motivo de 5 a 500 caracteres';end if;
  partner:=s.courier_id;
  select max(sequence) into last_sequence from public.courier_account_movements where company_id=c and settlement_id=sid and reversal_of is null;
  if s.state='confirmed' and exists(select 1 from public.courier_account_movements a where a.company_id=c and a.courier_id=partner and a.sequence>last_sequence and a.reversal_of is null and not exists(select 1 from public.courier_account_movements rev where rev.company_id=c and rev.reversal_of=a.id)) then raise exception 'Existen compensaciones o intercambios posteriores. Revierte primero esos movimientos o liquidaciones';end if;
  if s.state='confirmed' then
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
  perform 1 from public.business_partners where company_id=c and id=partner and is_courier;
  if not found then raise exception 'Mensajería no disponible';end if;
  actual:=round(nullif(data->>'amount','')::numeric,2);v_direction:=data->>'direction';v_method:=data->>'method';exchange_date:=nullif(data->>'date','')::date;
  if actual is null or actual<=0 or actual>=1e12 or v_direction not in('received','paid') or v_direction is null or v_method not in('cash','transfer') or v_method is null or exchange_date is null or exchange_date>current_date or length(coalesce(data->>'notes',''))>2000 then raise exception 'Revisa los datos del movimiento de dinero';end if;
  before_value:=access_private.courier_balance(c,partner);
  if data ? 'expected_balance' and (data->>'expected_balance')::numeric is distinct from before_value then raise exception 'El saldo cambió; actualiza antes de registrar el intercambio';end if;
  signed_value:=case when v_direction='received' then -actual else actual end;
  insert into public.courier_account_movements(company_id,courier_id,kind,signed_amount,method,occurred_on,notes,created_by)
  values(c,partner,'exchange',signed_value,v_method,exchange_date,coalesce(data->>'notes',''),auth.uid()) returning id into sid;
  answer:=jsonb_build_object('id',sid,'balance',before_value+signed_value);
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
end $$;
revoke all on function access_private.settlement_engine(uuid,text,uuid,jsonb) from public,anon,authenticated;

do $route$
declare d text;begin
 d:=pg_get_functiondef('access_private.courier_operations(uuid,text,uuid,jsonb)'::regprocedure);
 d:=replace(d,'action in(''options'',''tariffs'',''order'',''settlements'',''pending'',''settlement'')','action in(''options'',''tariffs'',''order'',''settlements'',''pending'',''settlement'',''account'')');
 d:=replace(d,' if action=''options'' then',$dispatch$
 if action in('settlements','pending','settlement','settlement_save','settlement_confirm','settlement_cancel','account','money_add','money_void') then return access_private.settlement_engine(c,action,k,data);end if;
 if action='options' then$dispatch$);execute d;
 d:=pg_get_functiondef('access_private.sync_cash_route(uuid,uuid)'::regprocedure);
 d:=replace(d,'or due<=0 then','or due<=0 or exists(select 1 from public.courier_settlement_items where company_id=c and order_id=o and active) then');execute d;
 d:=pg_get_functiondef('access_private.partners(uuid,text,jsonb)'::regprocedure);
 d:=replace(d,'''account'',case when p.is_customer', '''courier_account'',case when p.is_courier and access_private.partner_read(c,''courier'') then access_private.courier_balance(c,pid) else null end,''account'',case when p.is_customer');execute d;
end $route$;
notify pgrst,'reload schema';
