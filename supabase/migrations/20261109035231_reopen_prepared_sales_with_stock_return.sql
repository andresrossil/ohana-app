CREATE OR REPLACE FUNCTION access_private.sales_fulfillment(c uuid, action text, k uuid DEFAULT NULL::uuid, data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare so public.sales_orders%rowtype;d public.sales_deliveries%rowtype;cached access_private.operation_requests%rowtype;target text;answer jsonb;line public.order_lines%rowtype;rev uuid;
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
 if action='detail' then return jsonb_build_object('order',to_jsonb(so),'delivery',to_jsonb(d),'settled',exists(select 1 from public.courier_settlement_items where company_id=c and order_id=so.id and active),'summary',access_private.delivery_payment_summary(c,so.id),'lines',coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from public.order_lines l where l.company_id=c and l.order_id=so.id and l.quantity>0),'[]'));end if;
 if so.status not in('pending','dispatched') or exists(select 1 from public.courier_settlement_items where company_id=c and order_id=so.id and active) then raise exception 'El pedido ya no permite cambiar su preparación';end if;
 if data->>'expected_stage' is distinct from so.fulfillment_stage then raise exception 'El pedido cambió. Actualiza su estado antes de continuar';end if;
 if action='revert' then
  if so.status='pending' and so.fulfillment_stage='invoiced' then raise exception 'La factura ya está abierta';end if;
  if length(trim(coalesce(data->>'reason',''))) not between 5 and 500 then raise exception 'Indica el motivo de reversión (5 a 500 caracteres)';end if;
  if exists(select 1 from public.courier_settlement_items i join public.courier_settlements st on st.company_id=i.company_id and st.id=i.settlement_id where i.company_id=c and i.order_id=so.id and st.state='draft') then raise exception 'Anula primero el borrador de liquidación que incluye esta factura';end if;
  insert into public.sales_order_revisions(company_id,order_id,number,before_snapshot,created_by)
  values(c,so.id,so.revision+1,jsonb_build_object('action','revert','reason',data->>'reason','order',to_jsonb(so),'lines',(select jsonb_agg(to_jsonb(l)) from public.order_lines l where l.company_id=c and l.order_id=so.id and l.quantity>0),'delivery',to_jsonb(d)),auth.uid()) returning id into rev;
  for line in select * from public.order_lines where company_id=c and order_id=so.id and quantity>0 order by id loop
   if so.status='dispatched' then perform access_private.return_edited_sale_line(c,line.id);
   elsif line.reserved_quantity>0 then perform access_private.post_stock(c,'variant',line.variant_id,0,0,-line.reserved_quantity,'order_reopen_release',line.id,null,'Liberación de reserva al reabrir factura');end if;
   update public.order_lines set quantity=0,reserved_quantity=0 where company_id=c and id=line.id;
   -- Fresh line identities allow a later dispatch/reversal without reusing stock movement keys.
   insert into public.order_lines select (jsonb_populate_record(null::public.order_lines,to_jsonb(line)||jsonb_build_object('id',gen_random_uuid(),'reserved_quantity',0))).*;
  end loop;
  update public.sales_orders set status='pending',fulfillment_stage='invoiced',revision=revision+1,expires_at=now()+interval '24 hours',
   fulfillment_history=fulfillment_history||jsonb_build_array(jsonb_build_object('stage','invoiced','action','revert','from',so.fulfillment_stage,'reason',data->>'reason','at',now(),'by',auth.uid()))
  where company_id=c and id=so.id;
  update public.sales_deliveries set status='pending',updated_at=now() where company_id=c and order_id=so.id;
  update public.sales_order_revisions set after_snapshot=jsonb_build_object('order',(select to_jsonb(o) from public.sales_orders o where o.company_id=c and o.id=so.id),'lines',(select jsonb_agg(to_jsonb(l)) from public.order_lines l where l.company_id=c and l.order_id=so.id and l.quantity>0),'delivery',(select to_jsonb(x) from public.sales_deliveries x where x.company_id=c and x.order_id=so.id)) where id=rev;
  answer:=jsonb_build_object('id',so.id,'stage','invoiced','reopened',true);
  insert into access_private.operation_requests(company_id,key,action,payload,result) values(c,k,'fulfillment_'||action,data,answer);return answer;
 end if;
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

CREATE OR REPLACE FUNCTION access_private.edit_sale(c uuid, k uuid, data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare sale public.sales_orders%rowtype;cached access_private.operation_requests%rowtype;old_line record;r jsonb;v public.product_variants%rowtype;
 rev uuid;customer uuid;customer_data jsonb;line_id uuid;qty integer;price numeric(18,2);sub numeric:=0;discount_amount numeric;available numeric;reserved_qty integer;seen text[]:='{}';gift_line boolean;selected_list uuid;answer jsonb;
begin
 if auth.uid() is null or not public.company_permission(c,'write','sales') then raise exception 'Venta no autorizada' using errcode='42501';end if;
 if k is null or length(data::text)>100000 then raise exception 'Factura incompleta';end if;
 perform pg_advisory_xact_lock(hashtextextended(c::text,0));
 select * into cached from access_private.operation_requests where company_id=c and key=k;
 if found then if cached.action<>'sale_edit' or cached.payload<>data then raise exception 'Identificador utilizado con otros datos';end if;return cached.result;end if;
 select * into strict sale from public.sales_orders where company_id=c and id=(data->>'order')::uuid for update;
 if sale.status in('cancelled','expired') then raise exception 'No se editan facturas canceladas o vencidas';end if;
 if exists(select 1 from public.courier_settlement_items where company_id=c and order_id=sale.id and active) then raise exception 'La factura está liquidada por mensajería; no se puede editar';end if;
 if sale.status<>'pending' or sale.fulfillment_stage<>'invoiced' then raise exception 'La factura ya fue preparada. Revierte el pedido antes de editarlo';end if;
 if (data->>'expected_revision')::integer is distinct from sale.revision then raise exception 'Otra persona modificó esta factura. Actualiza antes de editar';end if;
 if jsonb_typeof(data->'items') is distinct from 'array' or jsonb_array_length(data->'items') not between 1 and 30 then raise exception 'Captura entre 1 y 30 productos';end if;
 customer:=coalesce(nullif(data->>'customer_id','')::uuid,sale.customer_id);
 if customer<>sale.customer_id and (sale.legacy_paid_amount>0 or exists(select 1 from public.order_payments where company_id=c and order_id=sale.id and voided_at is null) or exists(select 1 from public.customer_credit_applications where company_id=c and (source_order_id=sale.id or target_order_id=sale.id) and voided_at is null)) then raise exception 'La factura tiene pagos o saldo aplicado; conserva el cliente';end if;
 select jsonb_build_object('name',b.name,'phone',b.phone,'email',b.email,'address',b.address) into customer_data from public.business_partners b where b.company_id=c and b.id=customer and b.is_customer and (b.active or b.id=sale.customer_id);
 selected_list:=case when customer=sale.customer_id then coalesce(sale.price_list_id,(select price_list_id from public.business_partners where company_id=c and id=customer),access_private.default_customer_price_list(c)) else (select coalesce(price_list_id,access_private.default_customer_price_list(c)) from public.business_partners where company_id=c and id=customer) end;
 if customer_data is null then raise exception 'Selecciona un cliente válido de esta empresa';end if;
 insert into public.sales_order_revisions(company_id,order_id,number,before_snapshot,created_by)
 values(c,sale.id,sale.revision+1,jsonb_build_object('order',to_jsonb(sale),'lines',(select jsonb_agg(to_jsonb(l)) from public.order_lines l where l.company_id=c and l.order_id=sale.id and l.quantity>0),'delivery',(select to_jsonb(d) from public.sales_deliveries d where d.company_id=c and d.order_id=sale.id)),auth.uid()) returning id into rev;
 for old_line in select * from public.order_lines where company_id=c and order_id=sale.id and quantity>0 order by id loop
  if sale.status='dispatched' then perform access_private.return_edited_sale_line(c,old_line.id);
  elsif old_line.reserved_quantity>0 then perform access_private.post_stock(c,'variant',old_line.variant_id,0,0,-old_line.reserved_quantity,'order_edit_release',old_line.id,null,'Liberación de reserva por edición de factura');end if;
  update public.order_lines set quantity=0,reserved_quantity=0 where company_id=c and id=old_line.id;
 end loop;
 for r in select value from jsonb_array_elements(data->'items') loop
  qty:=nullif(r->>'quantity','')::integer;gift_line:=coalesce((r->>'is_gift')::boolean,false);price:=case when gift_line then 0 else nullif(r->>'unit_price','')::numeric end;
  if qty is null or qty not between 1 and 1000 or price is null or not(price>=0 and price<1e12) then raise exception 'Cantidad o precio inválido';end if;
  select pv.* into strict v from public.product_variants pv join public.products p on p.company_id=pv.company_id and p.id=pv.product_id where pv.company_id=c and pv.id=(r->>'variant')::uuid and ((pv.active and p.active) or exists(select 1 from jsonb_array_elements((select before_snapshot->'lines' from public.sales_order_revisions where id=rev)) x where x->>'variant_id'=pv.id::text));
  if (v.id::text||':'||gift_line::text)=any(seen) then raise exception 'No repitas la misma variante y condición de regalo; ajusta su cantidad';end if;seen:=array_append(seen,v.id::text||':'||gift_line::text);
  select coalesce(on_hand-blocked-reserved,0) into available from public.inventory_balances where company_id=c and item_kind='variant' and item_id=v.id;available:=coalesce(available,0);
  if qty>available and (sale.status='dispatched' or not v.allow_preorder or v.weight_min is not null) then raise exception 'Existencias insuficientes para esta cantidad';end if;
  reserved_qty:=case when sale.status='pending' then least(qty,available)::integer else 0 end;
  insert into public.order_lines(company_id,order_id,variant_id,description,attributes,weight_min,weight_max,quantity,unit_price,reserved_quantity,price_reference,is_gift)
  values(c,sale.id,v.id,(select name from public.products where company_id=c and id=v.product_id)||' · '||v.name,v.attributes,v.weight_min,v.weight_max,qty,price,reserved_qty,access_private.list_price_record(c,selected_list,v.id),gift_line) returning id into line_id;
  if sale.status='dispatched' then perform access_private.post_stock(c,'variant',v.id,-qty,0,0,'order_dispatch',line_id);
  elsif reserved_qty>0 then perform access_private.post_stock(c,'variant',v.id,0,0,reserved_qty,'order_reservation',line_id);end if;
  sub:=sub+qty*price;
 end loop;
 discount_amount:=access_private.sale_discount(sub,data->'discount');
 update public.sales_orders set price_list_id=selected_list,customer_id=customer,customer_snapshot=customer_data,subtotal=sub,discount=discount_amount,total=sub-discount_amount+shipping,
  discount_basis=data#>>'{discount,mode}',discount_input=coalesce(nullif(data#>>'{discount,value}','')::numeric,0),payment=coalesce(nullif(data->>'payment',''),payment),revision=revision+1 where company_id=c and id=sale.id;
 perform access_private.save_order_delivery(c,sale.id,data->'delivery_info');
 if (data->>'expected_total')::numeric is distinct from (select total from public.sales_orders where company_id=c and id=sale.id) then raise exception 'El total cambió. Revisa la factura antes de guardar';end if;
 perform access_private.reconcile_customer_account(c,customer);
 if coalesce(nullif(data->>'credit_amount','')::numeric,0)>0 then perform access_private.apply_customer_credit(c,sale.id,(data->>'credit_amount')::numeric);end if;
 update public.sales_order_revisions set after_snapshot=jsonb_build_object('order',(select to_jsonb(o) from public.sales_orders o where o.company_id=c and o.id=sale.id),'lines',(select jsonb_agg(to_jsonb(l)) from public.order_lines l where l.company_id=c and l.order_id=sale.id and l.quantity>0),'delivery',(select to_jsonb(d) from public.sales_deliveries d where d.company_id=c and d.order_id=sale.id)) where id=rev;
 answer:=jsonb_build_object('id',sale.id,'revision',sale.revision+1);
 insert into access_private.operation_requests(company_id,key,action,payload,result) values(c,k,'sale_edit',data,answer);return answer;
end $function$
;
