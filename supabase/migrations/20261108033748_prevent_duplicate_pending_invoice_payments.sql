CREATE OR REPLACE FUNCTION access_private.add_order_payment(c uuid, o uuid, info jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare sale public.sales_orders%rowtype;d public.sales_deliveries%rowtype;amount_value numeric(18,2):=nullif(info->>'amount','')::numeric;pid uuid;bank_confirmed boolean;remaining numeric;pending_amount numeric;
begin
 select * into strict sale from public.sales_orders where company_id=c and id=o for update;
 if sale.status in('cancelled','expired') then raise exception 'El pedido está cancelado o vencido';end if;
 remaining:=greatest(0,sale.total-access_private.order_covered(c,o));
 if remaining<=0 then raise exception 'La factura ya está pagada; no admite nuevos pagos';end if;
 select coalesce(sum(p.amount),0) into pending_amount from public.order_payments p
 where p.company_id=c and p.order_id=o and p.voided_at is null and not p.confirmed and not p.route_collection and p.method='transfer';
 remaining:=greatest(0,remaining-pending_amount);
 if remaining<=0 then raise exception 'Hay transferencias pendientes que cubren la factura. Confirma el ingreso o anula los comprobantes duplicados antes de registrar otro pago';end if;
 if info ? 'expected_due' and (info->>'expected_due')::numeric is distinct from remaining then raise exception 'El saldo cambió; actualiza la factura antes de registrar el pago';end if;
 if amount_value is not null and amount_value<>remaining and not coalesce((info->>'discrepancy_confirmed')::boolean,false) then
  raise exception 'Confirma el importe diferente. Total de factura: %. Pendiente: %. Pago: %. Diferencia: %.',sale.total,remaining,amount_value,amount_value-remaining;
 end if;
 if amount_value is null or amount_value<=0 then raise exception 'El importe debe ser positivo';end if;
 select * into d from public.sales_deliveries where company_id=c and order_id=o;

 if info->>'receiver'='courier' and exists(select 1 from public.courier_settlement_items where company_id=c and order_id=o and active) then raise exception 'La ruta de esta factura ya está liquidada. Revierte la liquidación antes de registrar otro cobro del mensajero';end if;
 if info->>'receiver'='courier' and (d.courier_id is null or d.status='cancelled') then raise exception 'Selecciona una mensajería válida en la entrega';end if;
 if nullif(info->>'received_on','') is null or (info->>'received_on')::date>current_date then raise exception 'Indica la fecha real del pago, sin fechas futuras';end if;
 bank_confirmed:=info->>'method'='cash' or coalesce((info->>'confirmed')::boolean,false);
 insert into public.order_payments(company_id,order_id,amount,method,receiver,courier_id,received_on,notes,created_by,confirmed,confirmed_at)
 values(c,o,amount_value,info->>'method',info->>'receiver',case when info->>'receiver'='courier' then d.courier_id end,(info->>'received_on')::date,coalesce(info->>'notes',''),auth.uid(),bank_confirmed,case when bank_confirmed then now() end) returning id into pid;
 perform access_private.reconcile_customer_account(c,sale.customer_id);return pid;
end $function$
;

CREATE OR REPLACE FUNCTION access_private.delivery_payment_summary(c uuid, o uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select jsonb_build_object('balance',case when so.status in('cancelled','expired') then 0 else greatest(0,so.total-access_private.order_covered(c,o)) end,'paid',least(so.total,access_private.order_covered(c,o)),
 'excess',greatest(0,access_private.order_covered(c,o)-so.total),
 'credit_applied',coalesce((select sum(a.amount) from public.customer_credit_applications a where a.company_id=c and a.target_order_id=o and a.voided_at is null),0),
 'ohana_received',so.legacy_paid_amount+coalesce(sum(p.amount) filter(where p.voided_at is null and p.confirmed and p.receiver='ohana'),0),
 'pending_transfers',coalesce(sum(p.amount) filter(where p.voided_at is null and not p.confirmed and not p.route_collection and p.method='transfer'),0),
 'pending_confirmation',coalesce(sum(p.amount) filter(where p.voided_at is null and not p.confirmed),0),
 'courier_pending',coalesce(sum(p.amount) filter(where p.voided_at is null and p.confirmed and p.receiver='courier' and not exists(select 1 from public.courier_settlement_items i where i.company_id=c and i.payment_id=p.id and i.active)),0),
 'courier_settled',coalesce(sum(p.amount) filter(where p.voided_at is null and p.confirmed and p.receiver='courier' and exists(select 1 from public.courier_settlement_items i where i.company_id=c and i.payment_id=p.id and i.active)),0))
 from public.sales_orders so left join public.order_payments p on p.company_id=so.company_id and p.order_id=so.id where so.company_id=c and so.id=o group by so.id
$function$
;
