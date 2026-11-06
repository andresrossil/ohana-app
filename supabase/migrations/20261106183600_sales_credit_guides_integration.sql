do $patch$
declare d text;anchor text;begin
 d:=pg_get_functiondef('access_private.partners(uuid,text,jsonb)'::regprocedure);
 d:=replace(d,'''canManage'',public.company_permission(c,''manage'')','''currency'',(select currency from public.companies where id=c),''canManage'',public.company_permission(c,''manage'')');
 d:=replace(d,'''partner'',to_jsonb(p)','''account'',case when p.is_customer and access_private.partner_read(c,''customer'') then access_private.customer_account(c,pid) else ''[]''::jsonb end,''partner'',to_jsonb(p)');execute d;

 d:=pg_get_functiondef('access_private.save_company_settings(uuid,text,text,jsonb,jsonb,text)'::regprocedure);
 d:=replace(d,' for link in select value', $validate$
 if nullif(p_details->>'shipping_guide_initials','') is not null and p_details->>'shipping_guide_initials' !~ '^[A-Za-z0-9]{1,12}$' then raise exception 'Las siglas de guías admiten de 1 a 12 letras o números';end if;
 for link in select value$validate$);execute d;

 d:=pg_get_functiondef('access_private.save_order_delivery(uuid,uuid,jsonb)'::regprocedure);
 anchor:=' select * into current_delivery from public.sales_deliveries where company_id=c and order_id=o for update;';
 if position(anchor in d)=0 then raise exception 'Unexpected delivery definition';end if;
 d:=replace(d,anchor,anchor||$delivery$
 if exists(select 1 from public.courier_settlement_items where company_id=c and order_id=o and active) then raise exception 'La factura está liquidada por mensajería; no se puede editar';end if;
 if kind='courier' and nullif(trim(info->>'guide'),'') is null then
  info:=info||jsonb_build_object('guide',coalesce((select case when nullif(details->>'shipping_guide_initials','') is null then '' else upper(details->>'shipping_guide_initials')||' - ' end from public.company_settings where company_id=c),'')|| (select lpad(number::text,greatest(4,length(number::text)),'0') from public.sales_orders where company_id=c and id=o));
 end if;
$delivery$);
 anchor:=' if charged is distinct from (select shipping from public.sales_orders where company_id=c and id=o) and ((select paid_at is not null from public.sales_orders where company_id=c and id=o) or exists(select 1 from public.order_payments where company_id=c and order_id=o)) then raise exception ''El pedido ya tiene pagos; conserva el envío cobrado al cliente'';end if;';
 if position(anchor in d)=0 then raise exception 'Unexpected shipping payment guard';end if;
 d:=replace(d,anchor,'');
 d:=replace(d,'end $function$', ' perform access_private.reconcile_customer_account(c,(select customer_id from public.sales_orders where company_id=c and id=o));'||chr(10)||'end $function$');execute d;

 d:=pg_get_functiondef('access_private.courier_operations(uuid,text,uuid,jsonb)'::regprocedure);
 d:=replace(d,'''summary'',access_private.delivery_payment_summary(c,oid)', $account$
 'summary',access_private.delivery_payment_summary(c,oid),'account',access_private.customer_account(c,so.customer_id),
 'settled',exists(select 1 from public.courier_settlement_items where company_id=c and order_id=oid and active),
 'credit_applications',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('source_number',s.number,'target_number',t.number) order by a.created_at) from public.customer_credit_applications a join public.sales_orders s on s.company_id=a.company_id and s.id=a.source_order_id join public.sales_orders t on t.company_id=a.company_id and t.id=a.target_order_id where a.company_id=c and (a.source_order_id=oid or a.target_order_id=oid)),'[]')$account$);
 d:=replace(d,'answer:=jsonb_build_object(''voided'',true);','perform access_private.reconcile_customer_account(c,(select customer_id from public.sales_orders where company_id=c and id=payment.order_id));answer:=jsonb_build_object(''voided'',true);');execute d;

 d:=pg_get_functiondef('access_private.place_order(uuid,uuid,jsonb,boolean)'::regprocedure);
 anchor:=' if cfg->>''currency''=ccy and length(coalesce(data->>''discount_code'',''''))>0 then';
 if position(anchor in d)=0 then raise exception 'Unexpected sale discount definition';end if;
 d:=replace(d,anchor,$discount$
 if staff and data ? 'discount' then discount_value:=access_private.sale_discount(sub,data->'discount');
 elsif cfg->>'currency'=ccy and length(coalesce(data->>'discount_code',''))>0 then$discount$);
 d:=replace(d,'if staff and data ? ''delivery_info'' then perform access_private.save_order_delivery', $meta$
 if staff and data ? 'discount' then update public.sales_orders set discount_basis=data#>>'{discount,mode}',discount_input=coalesce(nullif(data#>>'{discount,value}','')::numeric,0) where company_id=c and id=oid;end if;
 if staff and data ? 'delivery_info' then perform access_private.save_order_delivery$meta$);
 d:=replace(d,' if nullif(data->>''expected_total'','''') is not null', $credit$
 if staff and coalesce(nullif(data->>'credit_amount','')::numeric,0)>0 then perform access_private.apply_customer_credit(c,oid,(data->>'credit_amount')::numeric);end if;
 if nullif(data->>'expected_total','') is not null$credit$);execute d;

 d:=pg_get_functiondef('access_private.sales(uuid,text,uuid,jsonb)'::regprocedure);
 d:=replace(d,'jsonb_build_object(''delivery_info'',','jsonb_build_object(''settled'',exists(select 1 from public.courier_settlement_items where company_id=c and order_id=so.id and active),''delivery_info'',');
 d:=replace(d,'ol.order_id=so.id','ol.order_id=so.id and ol.quantity>0');
 d:=replace(d,'where company_id=c and order_id=o.id loop','where company_id=c and order_id=o.id and quantity>0 loop');
 d:=replace(d,'''receiver'',''ohana'',''received_on'',current_date','''receiver'',''ohana'',''confirmed'',true,''received_on'',current_date');execute d;

 d:=pg_get_functiondef('access_private.document_cancellation(uuid,text,uuid,jsonb)'::regprocedure);
 d:=replace(d,'where ol.company_id=c and ol.order_id=sid order by ol.id','where ol.company_id=c and ol.order_id=sid and ol.quantity>0 order by ol.id');execute d;
 d:=pg_get_functiondef('access_private.inventory_context(uuid,text,uuid,text,uuid,timestamp with time zone)'::regprocedure);
 d:=replace(d,' if source=''document_reversal'' then',' if source like ''order_edit_return_%'' then movement_type:=''entry'';end if;'||chr(10)||' if source=''document_reversal'' then');execute d;
end $patch$;

create or replace function access_private.guard_paid_order_cancel() returns trigger language plpgsql set search_path='' as $$
begin
 if new.status in('cancelled','expired') and old.status not in('cancelled','expired') then
  if exists(select 1 from public.order_payments where company_id=old.company_id and order_id=old.id and voided_at is null)
   or exists(select 1 from public.customer_credit_applications where company_id=old.company_id and (source_order_id=old.id or target_order_id=old.id) and voided_at is null)
  then raise exception 'Anula primero los pagos y aplicaciones de saldo a favor. No se procesan reembolsos automáticamente';end if;
 end if;return new;
end $$;
notify pgrst,'reload schema';
