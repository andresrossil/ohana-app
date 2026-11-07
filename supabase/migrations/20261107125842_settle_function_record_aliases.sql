do $fix$
declare f text;begin
 f:=pg_get_functiondef('access_private.settlement_engine(uuid,text,uuid,jsonb)'::regprocedure);
 f:=replace(f,' d public.sales_deliveries%rowtype;p public.order_payments%rowtype;m',' receipt public.order_payments%rowtype;m');
 f:=replace(f,'for p in select op.*','for receipt in select op.*');
 f:=replace(f,'values(c,sid,oid,p.id,p.amount,','values(c,sid,oid,receipt.id,receipt.amount,');
 execute f;
end $fix$;
