do $migration$
declare
  definition text := pg_get_functiondef('access_private.sales_worklist(uuid,text,jsonb)'::regprocedure);
begin
  if strpos(definition,'from visible)')=0 then
    raise exception 'No coincide la consulta paginada de facturas';
  end if;
  execute replace(definition,'from visible)','from visible v)');
end
$migration$;
