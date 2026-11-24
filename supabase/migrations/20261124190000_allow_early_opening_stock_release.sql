do $migration$
declare
  definition text := pg_get_functiondef('access_private.operations(uuid,text,uuid,jsonb)'::regprocedure);
  guard text := $old$if b.opening_stock and b.available_on>current_date then raise exception 'Aún no llega la fecha de disponibilidad para pesar y registrar el lote';end if;$old$;
  release_condition text := 'b.available_on<=current_date and (b.opening_stock or b.available_on_override is not null or b.requires_curing is false)';
  release_payload text := $old$jsonb_build_object('batch',b.id,'reason','Disponible inmediatamente: la fórmula no requiere curado')$old$;
begin
  if strpos(definition,guard)=0 or strpos(definition,release_condition)=0 or strpos(definition,release_payload)=0 then
    raise exception 'No se encontró la confirmación de lotes de saldo inicial';
  end if;
  definition := replace(definition,guard,$new$
  if b.opening_stock and b.available_on>current_date and
     (not coalesce((p_data->>'override')::boolean,false)
      or not access_private.company_permission(p_company,'manage')
      or length(btrim(coalesce(p_data->>'reason','')))<5) then
    raise exception 'Aún no llega la fecha estimada. La liberación anticipada requiere autorización administrativa y motivo';
  end if;$new$);
  definition := replace(definition,release_condition,
    '('||release_condition||' or (b.opening_stock and b.available_on>current_date))');
  execute replace(definition,release_payload,$new$jsonb_build_object(
    'batch',b.id,
    'reason',coalesce(nullif(btrim(p_data->>'reason'),''),
      'Disponible inmediatamente: la fórmula no requiere curado'),
    'override',coalesce((p_data->>'override')::boolean,false))$new$);
end
$migration$;
