alter table public.sales_orders add column revision integer not null default 0,
 add column discount_basis text not null default 'amount' check(discount_basis in('amount','percent')),
 add column discount_input numeric(18,6) not null default 0;
update public.sales_orders set discount_input=discount where discount>0;
-- Retired lines remain linked to their original movements; their original quantities are preserved in revisions.
alter table public.order_lines drop constraint order_lines_quantity_check,
 drop constraint order_lines_company_id_order_id_variant_id_key;
alter table public.order_lines add constraint order_lines_quantity_check check(quantity between 0 and 1000);
create unique index order_active_variant_unique on public.order_lines(company_id,order_id,variant_id) where quantity>0;
create table public.sales_order_revisions(
 id uuid primary key default gen_random_uuid(),company_id uuid not null,order_id uuid not null,number integer not null,
 before_snapshot jsonb not null,after_snapshot jsonb,created_by uuid not null,created_at timestamptz not null default now(),
 unique(company_id,order_id,number),foreign key(company_id,order_id) references public.sales_orders(company_id,id)
);
alter table public.sales_order_revisions enable row level security;
revoke all on public.sales_order_revisions from public,anon,authenticated;
grant select on public.sales_order_revisions to authenticated;
create policy sales_revision_read on public.sales_order_revisions for select to authenticated using(public.company_permission(company_id,'read','sales'));

create function access_private.sale_discount(subtotal numeric,info jsonb) returns numeric language plpgsql immutable set search_path='' as $$
declare v numeric:=coalesce(nullif(info->>'value','')::numeric,0);begin
 if info->>'mode' not in('amount','percent') or info->>'mode' is null or not(v>=0 and v<1e12) then raise exception 'Descuento inválido';end if;
 if info->>'mode'='percent' then if v>100 then raise exception 'El descuento no puede superar el 100 %%';end if;v:=round(subtotal*v/100,2);else v:=round(v,2);end if;
 if v>subtotal then raise exception 'El descuento no puede superar el subtotal de productos';end if;return v;
end $$;
revoke all on function access_private.sale_discount(numeric,jsonb) from public,anon,authenticated;

create function access_private.return_edited_sale_line(c uuid,line uuid) returns void language plpgsql set search_path='' as $$
declare m public.inventory_movements%rowtype;a record;result jsonb;tracked_count numeric;valid boolean;returned numeric:=0;n integer:=0;begin
 select * into strict m from public.inventory_movements where company_id=c and source_kind='order_dispatch' and source_id=line and quantity<0;
 for a in select * from public.inventory_allocations where company_id=c and movement_id=m.id order by lot_id loop
  select count(*),coalesce(bool_and(u.last_movement_id=m.id and u.status='sold'),true) into tracked_count,valid from public.inventory_units u join public.inventory_unit_movements h on h.company_id=u.company_id and h.unit_id=u.id where h.company_id=c and h.movement_id=m.id and h.status_after='sold' and u.lot_id=a.lot_id;
  if not valid or (tracked_count>0 and tracked_count<>a.quantity) then raise exception 'Hay unidades con movimientos posteriores; revierte primero esos documentos';end if;
  n:=n+1;result:=access_private.post_stock_selected(c,'variant',m.item_id,a.quantity,0,0,'order_edit_return_'||n::text,line,a.unit_cost,'Devolución por edición de factura',a.lot_id,null);
  if tracked_count>0 then
   update public.inventory_units u set status='available',order_line_id=null,last_movement_id=(result->>'movement')::uuid from public.inventory_unit_movements h where h.company_id=c and h.movement_id=m.id and h.unit_id=u.id and h.status_after='sold' and u.company_id=c and u.lot_id=a.lot_id and u.last_movement_id=m.id;
  end if;returned:=returned+a.quantity;
 end loop;
 if returned<>-m.quantity then raise exception 'No existe detalle suficiente para ajustar esta factura';end if;
end $$;
revoke all on function access_private.return_edited_sale_line(uuid,uuid) from public,anon,authenticated;

create function access_private.edit_sale(c uuid,k uuid,data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare sale public.sales_orders%rowtype;cached access_private.operation_requests%rowtype;old_line record;r jsonb;v public.product_variants%rowtype;
 rev uuid;customer uuid;customer_data jsonb;line_id uuid;qty integer;price numeric(18,2);sub numeric:=0;discount_amount numeric;available numeric;reserved_qty integer;seen uuid[]:='{}';answer jsonb;
begin
 if auth.uid() is null or not public.company_permission(c,'write','sales') then raise exception 'Venta no autorizada' using errcode='42501';end if;
 if k is null or length(data::text)>100000 then raise exception 'Factura incompleta';end if;
 perform pg_advisory_xact_lock(hashtextextended(c::text,0));
 select * into cached from access_private.operation_requests where company_id=c and key=k;
 if found then if cached.action<>'sale_edit' or cached.payload<>data then raise exception 'Identificador utilizado con otros datos';end if;return cached.result;end if;
 select * into strict sale from public.sales_orders where company_id=c and id=(data->>'order')::uuid for update;
 if sale.status in('cancelled','expired') then raise exception 'No se editan facturas canceladas o vencidas';end if;
 if exists(select 1 from public.courier_settlement_items where company_id=c and order_id=sale.id and active) then raise exception 'La factura está liquidada por mensajería; no se puede editar';end if;
 if (data->>'expected_revision')::integer is distinct from sale.revision then raise exception 'Otra persona modificó esta factura. Actualiza antes de editar';end if;
 if jsonb_typeof(data->'items') is distinct from 'array' or jsonb_array_length(data->'items') not between 1 and 30 then raise exception 'Captura entre 1 y 30 productos';end if;
 customer:=coalesce(nullif(data->>'customer_id','')::uuid,sale.customer_id);
 if customer<>sale.customer_id and (sale.legacy_paid_amount>0 or exists(select 1 from public.order_payments where company_id=c and order_id=sale.id and voided_at is null) or exists(select 1 from public.customer_credit_applications where company_id=c and (source_order_id=sale.id or target_order_id=sale.id) and voided_at is null)) then raise exception 'La factura tiene pagos o saldo aplicado; conserva el cliente';end if;
 select jsonb_build_object('name',b.name,'phone',b.phone,'email',b.email,'address',b.address) into customer_data from public.business_partners b where b.company_id=c and b.id=customer and b.is_customer and (b.active or b.id=sale.customer_id);
 if customer_data is null then raise exception 'Selecciona un cliente válido de esta empresa';end if;
 insert into public.sales_order_revisions(company_id,order_id,number,before_snapshot,created_by)
 values(c,sale.id,sale.revision+1,jsonb_build_object('order',to_jsonb(sale),'lines',(select jsonb_agg(to_jsonb(l)) from public.order_lines l where l.company_id=c and l.order_id=sale.id and l.quantity>0),'delivery',(select to_jsonb(d) from public.sales_deliveries d where d.company_id=c and d.order_id=sale.id)),auth.uid()) returning id into rev;
 for old_line in select * from public.order_lines where company_id=c and order_id=sale.id and quantity>0 order by id loop
  if sale.status='dispatched' then perform access_private.return_edited_sale_line(c,old_line.id);
  elsif old_line.reserved_quantity>0 then perform access_private.post_stock(c,'variant',old_line.variant_id,0,0,-old_line.reserved_quantity,'order_edit_release',old_line.id,null,'Liberación de reserva por edición de factura');end if;
  update public.order_lines set quantity=0,reserved_quantity=0 where company_id=c and id=old_line.id;
 end loop;
 for r in select value from jsonb_array_elements(data->'items') loop
  qty:=nullif(r->>'quantity','')::integer;price:=nullif(r->>'unit_price','')::numeric;
  if qty is null or qty not between 1 and 1000 or price is null or not(price>=0 and price<1e12) then raise exception 'Cantidad o precio inválido';end if;
  select pv.* into strict v from public.product_variants pv join public.products p on p.company_id=pv.company_id and p.id=pv.product_id where pv.company_id=c and pv.id=(r->>'variant')::uuid and ((pv.active and p.active) or exists(select 1 from jsonb_array_elements((select before_snapshot->'lines' from public.sales_order_revisions where id=rev)) x where x->>'variant_id'=pv.id::text));
  if v.id=any(seen) then raise exception 'No repitas la misma variante; ajusta su cantidad';end if;seen:=array_append(seen,v.id);
  select coalesce(on_hand-blocked-reserved,0) into available from public.inventory_balances where company_id=c and item_kind='variant' and item_id=v.id;available:=coalesce(available,0);
  if qty>available and (sale.status='dispatched' or not v.allow_preorder or v.weight_min is not null) then raise exception 'Existencias insuficientes para esta cantidad';end if;
  reserved_qty:=case when sale.status='pending' then least(qty,available)::integer else 0 end;
  insert into public.order_lines(company_id,order_id,variant_id,description,attributes,weight_min,weight_max,quantity,unit_price,reserved_quantity,price_reference)
  values(c,sale.id,v.id,(select name from public.products where company_id=c and id=v.product_id)||' · '||v.name,v.attributes,v.weight_min,v.weight_max,qty,price,reserved_qty,access_private.base_price_record(c,v.id)) returning id into line_id;
  if sale.status='dispatched' then perform access_private.post_stock(c,'variant',v.id,-qty,0,0,'order_dispatch',line_id);
  elsif reserved_qty>0 then perform access_private.post_stock(c,'variant',v.id,0,0,reserved_qty,'order_reservation',line_id);end if;
  sub:=sub+qty*price;
 end loop;
 discount_amount:=access_private.sale_discount(sub,data->'discount');
 update public.sales_orders set customer_id=customer,customer_snapshot=customer_data,subtotal=sub,discount=discount_amount,total=sub-discount_amount+shipping,
  discount_basis=data#>>'{discount,mode}',discount_input=coalesce(nullif(data#>>'{discount,value}','')::numeric,0),payment=coalesce(nullif(data->>'payment',''),payment),revision=revision+1 where company_id=c and id=sale.id;
 perform access_private.save_order_delivery(c,sale.id,data->'delivery_info');
 if (data->>'expected_total')::numeric is distinct from (select total from public.sales_orders where company_id=c and id=sale.id) then raise exception 'El total cambió. Revisa la factura antes de guardar';end if;
 perform access_private.reconcile_customer_account(c,customer);
 if coalesce(nullif(data->>'credit_amount','')::numeric,0)>0 then perform access_private.apply_customer_credit(c,sale.id,(data->>'credit_amount')::numeric);end if;
 update public.sales_order_revisions set after_snapshot=jsonb_build_object('order',(select to_jsonb(o) from public.sales_orders o where o.company_id=c and o.id=sale.id),'lines',(select jsonb_agg(to_jsonb(l)) from public.order_lines l where l.company_id=c and l.order_id=sale.id and l.quantity>0),'delivery',(select to_jsonb(d) from public.sales_deliveries d where d.company_id=c and d.order_id=sale.id)) where id=rev;
 answer:=jsonb_build_object('id',sale.id,'revision',sale.revision+1);
 insert into access_private.operation_requests(company_id,key,action,payload,result) values(c,k,'sale_edit',data,answer);return answer;
end $$;
revoke all on function access_private.edit_sale(uuid,uuid,jsonb) from public,anon;
grant execute on function access_private.edit_sale(uuid,uuid,jsonb) to authenticated;
create function public.edit_sale(p_company uuid,p_key uuid,p_data jsonb) returns jsonb language sql security invoker set search_path='' as $$select access_private.edit_sale(p_company,p_key,p_data)$$;
revoke all on function public.edit_sale(uuid,uuid,jsonb) from public,anon;
grant execute on function public.edit_sale(uuid,uuid,jsonb) to authenticated;
