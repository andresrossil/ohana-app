alter table public.sales_orders
  drop constraint sales_orders_fulfillment_stage_check,
  add constraint sales_orders_fulfillment_stage_check
    check (fulfillment_stage in ('draft','invoiced','preparing','finished','courier','delivered'));

do $migration$
declare
  target regprocedure;
  change record;
  definition text;
  previous text;
begin
  for target in select unnest(array[
    'access_private.place_order(uuid,uuid,jsonb,boolean)'::regprocedure,
    'access_private.edit_sale(uuid,uuid,jsonb)'::regprocedure,
    'access_private.sales_fulfillment(uuid,text,uuid,jsonb)'::regprocedure,
    'access_private.add_order_payment(uuid,uuid,jsonb)'::regprocedure,
    'access_private.apply_customer_credit(uuid,uuid,numeric)'::regprocedure,
    'access_private.customer_account(uuid,uuid)'::regprocedure,
    'access_private.reconcile_customer_account(uuid,uuid)'::regprocedure,
    'access_private.delivery_payment_summary(uuid,uuid)'::regprocedure,
    'access_private.sales(uuid,text,uuid,jsonb)'::regprocedure
  ]) loop
    definition := pg_get_functiondef(target);
    for change in select * from (values
      ('access_private.place_order(uuid,uuid,jsonb,boolean)'::regprocedure, $old$gift_line boolean;sold_price$old$,
       $new$gift_line boolean; is_draft boolean:=staff and coalesce((data->>'draft')::boolean,false);sold_price$new$),
      ('access_private.place_order(uuid,uuid,jsonb,boolean)'::regprocedure, $old$and status='pending' and paid_at is null)>=3$old$,
       $new$and status='pending' and fulfillment_stage<>'draft' and paid_at is null)>=3$new$),
      ('access_private.place_order(uuid,uuid,jsonb,boolean)'::regprocedure, $old$gift_message,price_list_id) values$old$,
       $new$gift_message,price_list_id,fulfillment_stage) values$new$),
      ('access_private.place_order(uuid,uuid,jsonb,boolean)'::regprocedure, $old$500),selected_list) returning id into oid$old$,
       $new$500),selected_list,case when is_draft then 'draft' else 'invoiced' end) returning id into oid$new$),
      ('access_private.place_order(uuid,uuid,jsonb,boolean)'::regprocedure, $old$if qty>stock and (staff or not v.allow_preorder or v.weight_min is not null) then raise exception 'No hay suficientes unidades disponibles de %',v.name;end if;reserve_qty:=least(qty,stock)::integer;$old$,
       $new$if not is_draft and qty>stock and (staff or not v.allow_preorder or v.weight_min is not null) then raise exception 'No hay suficientes unidades disponibles de %',v.name;end if;reserve_qty:=case when is_draft then 0 else least(qty,stock)::integer end;$new$),
      ('access_private.edit_sale(uuid,uuid,jsonb)'::regprocedure, $old$sale.fulfillment_stage<>'invoiced'$old$,
       $new$sale.fulfillment_stage not in('draft','invoiced')$new$),
      ('access_private.edit_sale(uuid,uuid,jsonb)'::regprocedure, $old$if qty>available and$old$,
       $new$if sale.fulfillment_stage<>'draft' and qty>available and$new$),
      ('access_private.edit_sale(uuid,uuid,jsonb)'::regprocedure, $old$when sale.status='pending' then least(qty,available)$old$,
       $new$when sale.status='pending' and sale.fulfillment_stage<>'draft' then least(qty,available)$new$),
      ('access_private.sales_fulfillment(uuid,text,uuid,jsonb)'::regprocedure, $old$ if action='revert' then$old$,
       $new$ if so.fulfillment_stage='draft' then
  if action<>'confirm_customer' or so.status<>'pending' then
   raise exception 'Confirma primero el pedido con el cliente';
  end if;
  if (data->>'expected_revision')::integer is distinct from so.revision then
   raise exception 'La factura cambió. Actualiza el listado antes de confirmar';
  end if;
  for line in select * from public.order_lines where company_id=c and order_id=so.id and quantity>0 order by variant_id,id loop
   if not exists(select 1 from public.product_variants v join public.products p on p.company_id=v.company_id and p.id=v.product_id
      where v.company_id=c and v.id=line.variant_id and v.active and p.active) then
    raise exception 'La variante % ya no está activa',line.description;
   end if;
   if line.quantity > coalesce((select on_hand-blocked-reserved from public.inventory_balances
     where company_id=c and item_kind='variant' and item_id=line.variant_id),0) then
    raise exception 'No hay suficientes unidades disponibles de %',line.description;
   end if;
   perform access_private.post_stock(c,'variant',line.variant_id,0,0,line.quantity,'order_reservation',line.id);
   update public.order_lines set reserved_quantity=line.quantity where company_id=c and id=line.id;
  end loop;
  update public.sales_orders set fulfillment_stage='invoiced',revision=revision+1,expires_at=now()+interval '24 hours',
   fulfillment_history=fulfillment_history||jsonb_build_array(jsonb_build_object('stage','invoiced','action','confirm_customer','at',now(),'by',auth.uid()))
  where company_id=c and id=so.id;
  answer:=jsonb_build_object('id',so.id,'stage','invoiced');
  insert into access_private.operation_requests(company_id,key,action,payload,result) values(c,k,'fulfillment_'||action,data,answer);
  return answer;
 end if;
 if action='revert' then$new$),
      ('access_private.add_order_payment(uuid,uuid,jsonb)'::regprocedure, $old$ if sale.status in('cancelled','expired')$old$,
       $new$ if sale.fulfillment_stage='draft' then raise exception 'Confirma primero la factura con el cliente';end if;
 if sale.status in('cancelled','expired')$new$),
      ('access_private.apply_customer_credit(uuid,uuid,numeric)'::regprocedure, $old$ if sale.status in('cancelled','expired')$old$,
       $new$ if sale.fulfillment_stage='draft' then raise exception 'Confirma primero la factura con el cliente';end if;
 if sale.status in('cancelled','expired')$new$),
      ('access_private.customer_account(uuid,uuid)'::regprocedure, $old$o.status not in('cancelled','expired')$old$,
       $new$o.status not in('cancelled','expired') and o.fulfillment_stage<>'draft'$new$),
      ('access_private.reconcile_customer_account(uuid,uuid)'::regprocedure, $old$so.status not in('cancelled','expired')$old$,
       $new$so.status not in('cancelled','expired') and so.fulfillment_stage<>'draft'$new$),
      ('access_private.delivery_payment_summary(uuid,uuid)'::regprocedure, $old$when so.status in('cancelled','expired') then 0$old$,
       $new$when so.status in('cancelled','expired') or so.fulfillment_stage='draft' then 0$new$),
      ('access_private.sales(uuid,text,uuid,jsonb)'::regprocedure, $old$ if action='paid' then$old$,
       $new$ if o.fulfillment_stage='draft' and action in('paid','dispatch') then raise exception 'Confirma primero la factura con el cliente';end if;
 if action='paid' then$new$)
    ) as changes(function_id, old_sql, new_sql) where function_id=target loop
      previous := definition;
      definition := replace(definition,change.old_sql,change.new_sql);
      if definition=previous then raise exception 'No coincide la definición esperada de %: %',target,change.old_sql;end if;
    end loop;
    execute definition;
  end loop;
end
$migration$;
