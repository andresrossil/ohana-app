do $migration$
declare
  definition text;
  marker constant text := 'd.id delivery_id,o.total invoice_total';
begin
  select pg_get_functiondef('access_private.courier_pending(uuid,uuid)'::regprocedure) into definition;
  if strpos(definition,marker)=0 then
    raise exception 'No se encontró la consulta de pedidos para liquidación';
  end if;
  execute replace(definition,marker,marker || ',o.shipping shipping_charged');
end;
$migration$;
