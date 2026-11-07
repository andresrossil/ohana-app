CREATE OR REPLACE FUNCTION access_private.sales_fulfillment(c uuid, action text, k uuid DEFAULT NULL::uuid, data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 if so.status not in('pending','dispatched') or exists(select 1 from public.courier_settlement_items where company_id=c and order_id=so.id and active) then raise exception 'El pedido ya no permite cambiar su preparación';end if;
 if data->>'expected_stage' is distinct from so.fulfillment_stage then raise exception 'El pedido cambió. Actualiza su estado antes de continuar';end if;
 if action='prepare' and so.status='pending' and so.fulfillment_stage='invoiced' then target:='preparing';
 elsif action='finish' and so.status='pending' and so.fulfillment_stage='preparing' then
  perform access_private.sales(c,'dispatch',gen_random_uuid(),jsonb_build_object('order',so.id));
  target:='finished';
 elsif action='handoff' and so.fulfillment_stage='finished' then
  if d.status='cancelled' then raise exception 'La entrega está cancelada';end if;
  if so.status='pending' then perform access_private.sales(c,'dispatch',gen_random_uuid(),jsonb_build_object('order',so.id));end if;
  target:=case when d.kind='courier' then 'courier' else 'delivered' end;
  update public.sales_deliveries set status=case when kind='courier' then 'in_transit' else 'delivered' end,updated_at=now() where company_id=c and order_id=so.id;
 else raise exception 'Completa primero la etapa anterior del pedido';end if;
 update public.sales_orders set fulfillment_stage=target,fulfillment_history=fulfillment_history||jsonb_build_array(jsonb_build_object('stage',target,'at',now(),'by',auth.uid())) where company_id=c and id=so.id;
 answer:=jsonb_build_object('id',so.id,'stage',target);
 insert into access_private.operation_requests(company_id,key,action,payload,result) values(c,k,'fulfillment_'||action,data,answer);return answer;
end $function$
;
CREATE OR REPLACE FUNCTION access_private.sales(c uuid, action text, k uuid DEFAULT NULL::uuid, data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$declare o public.sales_orders%rowtype;l record;available numeric;answer jsonb;cached access_private.operation_requests%rowtype;begin
 if auth.uid() is null or not public.company_permission(c,case when action='list' then 'read' else 'write' end,'sales') then raise exception 'Ventas no autorizadas' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(c::text,0));perform access_private.expire_orders(c);
 if action='list' then return jsonb_build_object('orders',coalesce((select jsonb_agg(to_jsonb(so)||jsonb_build_object('settled',exists(select 1 from public.courier_settlement_items where company_id=c and order_id=so.id and active),'delivery_info',(select to_jsonb(d) from public.sales_deliveries d where d.company_id=c and d.order_id=so.id),'payment_summary',access_private.delivery_payment_summary(c,so.id),'lines',(select jsonb_agg(to_jsonb(ol)||jsonb_build_object('physical_units',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'weight',u.weight,'variant_snapshot',u.variant_snapshot,'status',case when u.order_line_id=ol.id then u.status else 'released' end)) from public.inventory_units u where u.company_id=c and (u.order_line_id=ol.id or exists(select 1 from public.inventory_unit_movements h where h.company_id=c and h.unit_id=u.id and (h.order_line_before=ol.id or h.order_line_after=ol.id)))),'[]'))) from public.order_lines ol where ol.company_id=c and ol.order_id=so.id and ol.quantity>0))) from (select * from public.sales_orders where company_id=c order by created_at desc limit 100)so),'[]'),'customers',coalesce((select jsonb_agg(to_jsonb(cs)) from(select * from public.business_partners where company_id=c and is_customer and active order by name,id limit 200)cs),'[]'),'price_lists',coalesce((select jsonb_agg(to_jsonb(pl) order by pl.name) from public.price_lists pl where pl.company_id=c and pl.active),'[]'),'default_price_list',access_private.default_customer_price_list(c),'price_entries',coalesce((select jsonb_agg(to_jsonb(pe)) from public.price_list_entries pe join public.price_lists pl on pl.company_id=pe.company_id and pl.id=pe.list_id where pe.company_id=c and pe.active and pl.active),'[]'),'variants',coalesce((select jsonb_agg(jsonb_build_object('id',pv.id,'name',pr.name||' · '||access_private.variant_label(to_jsonb(pv)),'product_name',pr.name,'size',pv.name,'weight_max',pv.weight_max,'sku',pv.sku,'barcode',pv.barcode,'price',access_private.base_sale_price(pv.company_id,pv.id),'currency',(select currency from public.companies where id=c),'available',coalesce(bal.on_hand-bal.blocked-bal.reserved,0),'allow_preorder',pv.allow_preorder)) from public.product_variants pv join public.products pr on pr.company_id=pv.company_id and pr.id=pv.product_id left join public.inventory_balances bal on bal.company_id=pv.company_id and bal.item_kind='variant' and bal.item_id=pv.id where pv.company_id=c and pv.active and pr.active),'[]'));end if;
 if action='create' then return access_private.place_order(c,k,data,true);end if;
 if action not in('paid','cancel','dispatch') or k is null then raise exception 'Operación no válida';end if;
 select * into cached from access_private.operation_requests where company_id=c and key=k;if found then if cached.action<>'sale_'||action or cached.payload<>data then raise exception 'Identificador ya utilizado';end if;return cached.result;end if;
 select * into strict o from public.sales_orders where company_id=c and id=(data->>'order')::uuid for update;
 if action='paid' then
  perform access_private.add_order_payment(c,o.id,jsonb_build_object('amount',o.total-(access_private.delivery_payment_summary(c,o.id)->>'paid')::numeric,'method',case when o.payment='transfer' then 'transfer' else 'cash' end,'receiver','ohana','confirmed',true,'received_on',current_date,'notes','Confirmación de saldo recibido'));
  if o.status in('cancelled','expired') then raise exception 'El pedido está cancelado o vencido. Registra una nueva venta si corresponde';end if;update public.sales_orders set paid_at=coalesce(paid_at,now()) where company_id=c and id=o.id;
 elsif action='cancel' then
  if o.status='dispatched' then answer:=access_private.document_cancellation(c,'confirm',gen_random_uuid(),jsonb_build_object('source_kind','sale','source_id',o.id,'reason',data->>'reason'));insert into access_private.operation_requests(company_id,key,action,payload,result) values(c,k,'sale_'||action,data,answer);return answer;end if;
  if o.status='pending' then for l in select * from public.order_lines where company_id=c and order_id=o.id and quantity>0 loop if l.reserved_quantity>0 then perform access_private.post_stock(c,'variant',l.variant_id,0,0,-l.reserved_quantity,'order_cancel',l.id);end if;end loop;update public.sales_orders set status='cancelled',refund_pending=paid_at is not null where company_id=c and id=o.id;end if;
 elsif o.status<>'dispatched' then
  if o.status<>'pending' then raise exception 'El pedido no puede entregarse';end if;
  for l in select * from public.order_lines where company_id=c and order_id=o.id and quantity>0 loop
   select on_hand-blocked-reserved+l.reserved_quantity into available from public.inventory_balances where company_id=c and item_kind='variant' and item_id=l.variant_id;if coalesce(available,0)<l.quantity then raise exception 'Existencias insuficientes; hay unidades pendientes de producir o liberar';end if;
   perform access_private.post_stock(c,'variant',l.variant_id,-l.quantity,0,-l.reserved_quantity,'order_dispatch',l.id);
  end loop;update public.sales_orders set status='dispatched' where company_id=c and id=o.id;
 end if;
 answer:=jsonb_build_object('id',o.id);insert into access_private.operation_requests(company_id,key,action,payload,result) values(c,k,'sale_'||action,data,answer);return answer;
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
 'pending_confirmation',coalesce(sum(p.amount) filter(where p.voided_at is null and not p.confirmed),0),
 'courier_pending',coalesce(sum(p.amount) filter(where p.voided_at is null and p.confirmed and p.receiver='courier' and not exists(select 1 from public.courier_settlement_items i where i.company_id=c and i.payment_id=p.id and i.active)),0),
 'courier_settled',coalesce(sum(p.amount) filter(where p.voided_at is null and p.confirmed and p.receiver='courier' and exists(select 1 from public.courier_settlement_items i where i.company_id=c and i.payment_id=p.id and i.active)),0))
 from public.sales_orders so left join public.order_payments p on p.company_id=so.company_id and p.order_id=so.id where so.company_id=c and so.id=o group by so.id
$function$
;
notify pgrst,'reload schema';
