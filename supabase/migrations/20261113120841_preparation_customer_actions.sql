do $migration$
declare
  definition text := pg_get_functiondef('access_private.sales_worklist(uuid,text,jsonb)'::regprocedure);
  fields text := '''confirmed_at'',confirmation.confirmed_at';
  relation text := 'cross join lateral (select max((event->>''at'')::timestamptz)';
  stages text := 'o.status=''pending'' and o.fulfillment_stage in (''invoiced'',''preparing'')';
begin
  if strpos(definition,fields)=0 or strpos(definition,relation)=0 or strpos(definition,stages)=0 then
    raise exception 'La consulta de preparación cambió';
  end if;
  definition:=replace(definition,fields,$sql$
    'phone',o.customer_snapshot->>'phone',
    'address',coalesce(nullif(d.address,''),o.customer_snapshot->>'address'),
    'department',d.department,'zone',d.zone,'delivery_kind',d.kind,
    'confirmed_at',confirmation.confirmed_at$sql$);
  definition:=replace(definition,relation,$sql$
    left join public.sales_deliveries d on d.company_id=o.company_id and d.order_id=o.id
    cross join lateral (select max((event->>'at')::timestamptz)$sql$);
  definition:=replace(definition,stages,$sql$(
    (o.status='pending' and o.fulfillment_stage in ('invoiced','preparing'))
    or (o.status='dispatched' and o.fulfillment_stage in ('finished','courier','delivered'))
  )$sql$);
  execute definition;
end $migration$;
