alter table public.production_batches
  add column finalized_at timestamptz,
  add constraint production_finalized_requires_release
    check (finalized_at is null or (state = 'released' and confirmed));

do $migration$
declare
  command_sql text := pg_get_functiondef('access_private.production_command(uuid,text,uuid,jsonb)'::regprocedure);
  trigger_sql text := pg_get_functiondef('access_private.batch_trace_guard()'::regprocedure);
  cancel_sql text := pg_get_functiondef('access_private.document_cancellation(uuid,text,uuid,jsonb)'::regprocedure);
begin
  if strpos(command_sql, $old$ if action='cancel' then$old$) = 0
    or strpos(trigger_sql, $old$ if tg_op='INSERT' then$old$) = 0
    or strpos(cancel_sql, $old$select pb.state into strict state from public.production_batches pb$old$) = 0
    or strpos(cancel_sql, $old$ reason:=btrim(data->>'reason');$old$) = 0 then
    raise exception 'No coinciden los comandos esperados de producción';
  end if;

  execute replace(command_sql, $old$ if action='cancel' then$old$, $new$
 if action in ('curing_edit', 'finalize') then
  if k is null then raise exception 'Falta el identificador de la operación'; end if;
  perform pg_advisory_xact_lock(hashtextextended(c::text,0));
  select * into cached from access_private.operation_requests where company_id=c and key=k;
  if found then
   if cached.action <> 'production_'||action or cached.payload <> data then raise exception 'Identificador utilizado con otros datos'; end if;
   return cached.result;
  end if;
  bid:=nullif(data->>'id','')::uuid;
  select * into b from public.production_batches where company_id=c and id=bid for update;
  if not found then raise exception 'Lote no disponible'; end if;

  if action='finalize' then
   if b.state <> 'released' or not b.confirmed then raise exception 'Solo puedes terminar una producción liberada'; end if;
   if b.finalized_at is null then
    update public.production_batches set finalized_at=clock_timestamp() where company_id=c and id=bid;
   end if;
  else
   if b.state <> 'curing' then raise exception 'Solo puedes editar lotes en curación'; end if;
   if (b.production_date,b.available_on,b.notes) is distinct from
      ((data->>'previous_production_date')::date,(data->>'previous_available_on')::date,data->>'previous_notes') then
    raise exception 'El lote cambió. Actualiza Producción antes de editarlo';
   end if;
   manual_available:=nullif(data->>'available_on','')::date;
   if manual_available is null or nullif(data->>'production_date','') is null
      or (data->>'production_date')::date > current_date
      or manual_available < (data->>'production_date')::date
      or length(coalesce(data->>'notes','')) > 1000 then
    raise exception 'Revisa las fechas y las notas del lote';
   end if;
   update public.production_batches
   set production_date=(data->>'production_date')::date,
       available_on=manual_available,
       available_on_override=case when manual_available=available_on and (data->>'production_date')::date=production_date then available_on_override else manual_available end,
       notes=coalesce(data->>'notes','')
   where company_id=c and id=bid;
  end if;

  answer:=jsonb_build_object('id',bid);
  insert into access_private.operation_requests(company_id,key,action,payload,result)
    values(c,k,'production_'||action,data,answer);
  return answer;
 end if;
 if action='cancel' then$new$);

  execute replace(trigger_sql, $old$ if tg_op='INSERT' then$old$, $new$
 if tg_op='UPDATE' then
  if old.finalized_at is not null and new is distinct from old then
   raise exception 'La producción terminada está cerrada';
  end if;
  if new.finalized_at is distinct from old.finalized_at then
   if old.state='released' and old.confirmed and new.finalized_at is not null
      and (to_jsonb(new)-'finalized_at')=(to_jsonb(old)-'finalized_at') then return new; end if;
   raise exception 'Solo puedes terminar una producción liberada';
  end if;
  if old.state='curing' and new.state='curing' then
   if (to_jsonb(new)-array['notes','available_on','available_on_override']) =
      (to_jsonb(old)-array['notes','available_on','available_on_override']) then return new; end if;
   if old.opening_stock and not old.confirmed and
      (to_jsonb(new)-array['production_date','notes','available_on','available_on_override']) =
      (to_jsonb(old)-array['production_date','notes','available_on','available_on_override']) then return new; end if;
  end if;
 end if;
 if tg_op='INSERT' then$new$);

  cancel_sql := replace(cancel_sql,
    $old$select pb.state into strict state from public.production_batches pb$old$,
    $new$select case when pb.finalized_at is not null then 'finished' else pb.state end into strict state from public.production_batches pb$new$);
  if strpos(cancel_sql,$old$state not in('cancelled','expired')$old$)=0 then raise exception 'No coincide la regla de cancelación'; end if;
  cancel_sql := replace(cancel_sql,
    $old$state not in('cancelled','expired')$old$,
    $new$state not in('cancelled','expired','finished')$new$);
  execute replace(cancel_sql, $old$ reason:=btrim(data->>'reason');$old$, $new$
 if kind='production' and exists(select 1 from public.production_batches pb where pb.company_id=c and pb.id=sid and pb.finalized_at is not null) then
  raise exception 'La producción terminada está cerrada y no se puede cancelar';
 end if;
 reason:=btrim(data->>'reason');$new$);
end
$migration$;
