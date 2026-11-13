do $migration$
declare
  definition text := pg_get_functiondef('access_private.sales_worklist(uuid,text,jsonb)'::regprocedure);
  contact_field text := '''phone'',o.customer_snapshot->>''phone''';
begin
  if strpos(definition,contact_field)=0 then
    raise exception 'La consulta de preparación cambió';
  end if;
  execute replace(definition,contact_field,'''total'',o.total,''currency'',o.currency,'||contact_field);
end $migration$;
