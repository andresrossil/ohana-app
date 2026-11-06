do $patch$
declare d text;anchor text;begin
 d:=pg_get_functiondef('access_private.expire_orders(uuid)'::regprocedure);
 anchor:='and expires_at<=now()';
 if position(anchor in d)=0 then raise exception 'Unexpected expiry definition';end if;
 d:=replace(d,anchor,anchor||' and not exists(select 1 from public.customer_credit_applications a where a.company_id=c and (a.source_order_id=public.sales_orders.id or a.target_order_id=public.sales_orders.id) and a.voided_at is null)');
 execute d;
end $patch$;
