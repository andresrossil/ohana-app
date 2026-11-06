alter table public.sales_orders add column legacy_paid_amount numeric(18,2) not null default 0;
update public.sales_orders so set legacy_paid_amount=total where paid_at is not null and not exists(select 1 from public.order_payments p where p.company_id=so.company_id and p.order_id=so.id);
alter table public.order_payments add column confirmed boolean not null default true,add column confirmed_at timestamptz;
update public.order_payments set confirmed_at=created_at where voided_at is null;

create table public.customer_credit_applications(
 id uuid primary key default gen_random_uuid(),company_id uuid not null,customer_id uuid not null,
 source_order_id uuid not null,target_order_id uuid not null,currency text not null,
 amount numeric(18,2) not null check(amount>0 and amount<1e12),created_at timestamptz not null default now(),created_by uuid not null,
 voided_at timestamptz,voided_by uuid,void_reason text,
 check(source_order_id<>target_order_id),
 foreign key(company_id,customer_id) references public.business_partners(company_id,id),
 foreign key(company_id,source_order_id) references public.sales_orders(company_id,id),
 foreign key(company_id,target_order_id) references public.sales_orders(company_id,id)
);
create index credit_source on public.customer_credit_applications(company_id,source_order_id);
create index credit_target on public.customer_credit_applications(company_id,target_order_id);
create index credit_customer on public.customer_credit_applications(company_id,customer_id,currency);
alter table public.customer_credit_applications enable row level security;
revoke all on public.customer_credit_applications from public,anon,authenticated;
grant select on public.customer_credit_applications to authenticated;
create policy customer_credit_read on public.customer_credit_applications for select to authenticated using(public.company_permission(company_id,'read','sales'));

create function access_private.order_covered(c uuid,o uuid) returns numeric language sql stable set search_path='' as $$
 select so.legacy_paid_amount+coalesce((select sum(p.amount) from public.order_payments p where p.company_id=c and p.order_id=o and p.voided_at is null and p.confirmed),0)
 +coalesce((select sum(a.amount) from public.customer_credit_applications a where a.company_id=c and a.target_order_id=o and a.voided_at is null),0)
 -coalesce((select sum(a.amount) from public.customer_credit_applications a where a.company_id=c and a.source_order_id=o and a.voided_at is null),0)
 from public.sales_orders so where so.company_id=c and so.id=o
$$;
revoke all on function access_private.order_covered(uuid,uuid) from public,anon,authenticated;

create or replace function access_private.delivery_payment_summary(c uuid,o uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('paid',least(so.total,access_private.order_covered(c,o)),
 'excess',greatest(0,access_private.order_covered(c,o)-so.total),
 'credit_applied',coalesce((select sum(a.amount) from public.customer_credit_applications a where a.company_id=c and a.target_order_id=o and a.voided_at is null),0),
 'ohana_received',so.legacy_paid_amount+coalesce(sum(p.amount) filter(where p.voided_at is null and p.confirmed and p.receiver='ohana'),0),
 'pending_confirmation',coalesce(sum(p.amount) filter(where p.voided_at is null and not p.confirmed),0),
 'courier_pending',coalesce(sum(p.amount) filter(where p.voided_at is null and p.confirmed and p.receiver='courier' and not exists(select 1 from public.courier_settlement_items i where i.company_id=c and i.payment_id=p.id and i.active)),0),
 'courier_settled',coalesce(sum(p.amount) filter(where p.voided_at is null and p.confirmed and p.receiver='courier' and exists(select 1 from public.courier_settlement_items i where i.company_id=c and i.payment_id=p.id and i.active)),0))
 from public.sales_orders so left join public.order_payments p on p.company_id=so.company_id and p.order_id=so.id where so.company_id=c and so.id=o group by so.id
$$;

create function access_private.customer_account(c uuid,customer uuid) returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(z) order by currency),'[]') from(
  select o.currency,sum(greatest(0,o.total-access_private.order_covered(c,o.id))) pending,
   sum(greatest(0,access_private.order_covered(c,o.id)-o.total)) credit,
   sum(o.total-access_private.order_covered(c,o.id)) balance
  from public.sales_orders o where o.company_id=c and o.customer_id=customer and o.status not in('cancelled','expired') group by o.currency
 )z
$$;
revoke all on function access_private.customer_account(uuid,uuid) from public,anon,authenticated;

create function access_private.reconcile_customer_account(c uuid,customer uuid) returns void language plpgsql set search_path='' as $$
declare sale record;begin
 for sale in select so.id,so.total,access_private.order_covered(c,so.id) covered from public.sales_orders so where so.company_id=c and so.customer_id=customer and so.status not in('cancelled','expired') loop
  if sale.covered<sale.total and exists(select 1 from public.customer_credit_applications a where a.company_id=c and a.source_order_id=sale.id and a.voided_at is null) then raise exception 'El saldo de esta factura ya se usó en otro pedido. Revierte primero las aplicaciones de saldo a favor';end if;
  update public.sales_orders set paid_at=case when sale.covered>=sale.total then coalesce(paid_at,now()) else null end where company_id=c and id=sale.id;
 end loop;
end $$;
revoke all on function access_private.reconcile_customer_account(uuid,uuid) from public,anon,authenticated;

create function access_private.apply_customer_credit(c uuid,target uuid,requested numeric) returns numeric language plpgsql set search_path='' as $$
declare sale public.sales_orders%rowtype;source record;remaining numeric:=round(requested,2);take numeric;begin
 select * into strict sale from public.sales_orders where company_id=c and id=target for update;
 if sale.status in('cancelled','expired') or remaining is null or remaining<=0 or remaining>sale.total-access_private.order_covered(c,target) then raise exception 'El saldo a aplicar debe ser positivo y no superar el pendiente de esta factura';end if;
 for source in select so.id,greatest(0,access_private.order_covered(c,so.id)-so.total) available from public.sales_orders so where so.company_id=c and so.customer_id=sale.customer_id and so.currency=sale.currency and so.id<>target and so.status not in('cancelled','expired') order by so.created_at,so.id loop
  take:=least(remaining,source.available);if take<=0 then continue;end if;
  insert into public.customer_credit_applications(company_id,customer_id,source_order_id,target_order_id,currency,amount,created_by) values(c,sale.customer_id,source.id,target,sale.currency,take,auth.uid());
  remaining:=remaining-take;exit when remaining=0;
 end loop;
 if remaining<>0 then raise exception 'Saldo a favor insuficiente o utilizado por otra operación';end if;
 perform access_private.reconcile_customer_account(c,sale.customer_id);return requested;
end $$;
revoke all on function access_private.apply_customer_credit(uuid,uuid,numeric) from public,anon,authenticated;

create or replace function access_private.add_order_payment(c uuid,o uuid,info jsonb) returns uuid language plpgsql set search_path='' as $$
declare sale public.sales_orders%rowtype;d public.sales_deliveries%rowtype;amount_value numeric(18,2):=nullif(info->>'amount','')::numeric;pid uuid;bank_confirmed boolean;
begin
 select * into strict sale from public.sales_orders where company_id=c and id=o for update;
 if sale.status in('cancelled','expired') then raise exception 'El pedido está cancelado o vencido';end if;
 if amount_value is null or amount_value<=0 then raise exception 'El importe debe ser positivo';end if;
 select * into d from public.sales_deliveries where company_id=c and order_id=o;
 if info->>'receiver'='courier' and (d.courier_id is null or d.status='cancelled') then raise exception 'Selecciona una mensajería válida en la entrega';end if;
 if nullif(info->>'received_on','') is null or (info->>'received_on')::date>current_date then raise exception 'Indica la fecha real del pago, sin fechas futuras';end if;
 bank_confirmed:=info->>'method'='cash' or coalesce((info->>'confirmed')::boolean,false);
 insert into public.order_payments(company_id,order_id,amount,method,receiver,courier_id,received_on,notes,created_by,confirmed,confirmed_at)
 values(c,o,amount_value,info->>'method',info->>'receiver',case when info->>'receiver'='courier' then d.courier_id end,(info->>'received_on')::date,coalesce(info->>'notes',''),auth.uid(),bank_confirmed,case when bank_confirmed then now() end) returning id into pid;
 perform access_private.reconcile_customer_account(c,sale.customer_id);return pid;
end $$;

create function access_private.customer_finance(c uuid,action text,k uuid default null,data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
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
  if p.voided_at is not null or p.confirmed or sale.status in('cancelled','expired') then raise exception 'El pago no se puede confirmar';end if;
  update public.order_payments set confirmed=true,confirmed_at=now() where company_id=c and id=p.id;
  perform access_private.reconcile_customer_account(c,sale.customer_id);answer:=jsonb_build_object('confirmed',true);
 else raise exception 'Acción financiera inválida';end if;
 insert into access_private.operation_requests(company_id,key,action,payload,result) values(c,k,'finance_'||action,data,answer);return answer;
end $$;
revoke all on function access_private.customer_finance(uuid,text,uuid,jsonb) from public,anon;
grant execute on function access_private.customer_finance(uuid,text,uuid,jsonb) to authenticated;
create function public.customer_finance(p_company uuid,p_action text,p_key uuid default null,p_data jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select access_private.customer_finance(p_company,p_action,p_key,p_data)$$;
revoke all on function public.customer_finance(uuid,text,uuid,jsonb) from public,anon;
grant execute on function public.customer_finance(uuid,text,uuid,jsonb) to authenticated;
