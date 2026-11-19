do $migration$
declare
  definition text := pg_get_functiondef('access_private.operations(uuid,text,uuid,jsonb)'::regprocedure);
  released_result text := $old$production_batches.id=b.id;v_result:=jsonb_build_object('id',b.id,'state','released');$old$;
begin
  if strpos(definition,released_result)=0 then
    raise exception 'Cambió el paso de liberación de producción';
  end if;
  execute replace(definition,released_result,$new$production_batches.id=b.id;
  update public.production_batches set finalized_at=clock_timestamp()
    where company_id=p_company and production_batches.id=b.id and finalized_at is null;
  v_result:=jsonb_build_object('id',b.id,'state','released');$new$);
end
$migration$;
