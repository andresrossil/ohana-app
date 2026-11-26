-- Gifts retain their inventory cost but do not participate in distributing receipts.
do $migration$
declare
  definition text := pg_get_functiondef('access_private.sync_sale_funds(uuid,uuid)'::regprocedure);
  original text := 'where ol.company_id=c and ol.order_id=oid and ol.quantity>0 order by ol.id';
begin
  if strpos(definition,original)=0 then
    raise exception 'No se encontró el filtro de líneas para distribuir fondos';
  end if;
  execute replace(definition,original,
    'where ol.company_id=c and ol.order_id=oid and ol.quantity>0 and not ol.is_gift order by ol.id');
end $migration$;
