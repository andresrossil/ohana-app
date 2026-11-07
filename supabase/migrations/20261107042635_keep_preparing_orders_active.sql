do $patch$
declare d text;begin
 d:=pg_get_functiondef('access_private.expire_orders(uuid)'::regprocedure);
 if strpos(d,'and expires_at<=now()')=0 then raise exception 'Unexpected expiry definition';end if;
 d:=replace(d,'and expires_at<=now()','and fulfillment_stage=''invoiced'' and expires_at<=now()');
 execute d;
end $patch$;
