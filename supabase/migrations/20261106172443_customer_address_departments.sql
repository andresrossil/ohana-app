alter table public.partner_addresses add column department text;
alter table public.sales_deliveries add column department text;
do $constraints$
declare t text;begin
 foreach t in array array['partner_addresses','sales_deliveries'] loop
  execute format('alter table public.%I add constraint %I check(department is null or department in(''Alta Verapaz'',''Baja Verapaz'',''Chimaltenango'',''Chiquimula'',''El Progreso'',''Escuintla'',''Guatemala'',''Huehuetenango'',''Izabal'',''Jalapa'',''Jutiapa'',''Petén'',''Quetzaltenango'',''Quiché'',''Retalhuleu'',''Sacatepéquez'',''San Marcos'',''Santa Rosa'',''Sololá'',''Suchitepéquez'',''Totonicapán'',''Zacapa''))',t,t||'_department_valid');
 end loop;
end $constraints$;
do $patch$
declare d text;begin
 d:=pg_get_functiondef('access_private.partners(uuid,text,jsonb)'::regprocedure);
 if position('partner_id,label,address,instructions,phone,is_primary) values' in d)=0 or position('is_primary=coalesce((a->>''is_primary'')::boolean,false) where' in d)=0 then raise exception 'Unexpected partner address save definition';end if;
 d:=replace(d,'partner_id,label,address,instructions,phone,is_primary) values','partner_id,label,address,instructions,phone,is_primary,department) values');
 d:=replace(d,'coalesce((a->>''is_primary'')::boolean,false));','coalesce((a->>''is_primary'')::boolean,false),nullif(trim(a->>''department''),''''));');
 d:=replace(d,'is_primary=coalesce((a->>''is_primary'')::boolean,false) where','department=case when a ? ''department'' then nullif(trim(a->>''department''),'''') else public.partner_addresses.department end,is_primary=coalesce((a->>''is_primary'')::boolean,false) where');
 execute d;
 d:=pg_get_functiondef('access_private.save_order_delivery(uuid,uuid,jsonb)'::regprocedure);
 if position('courier_snapshot,address,destination,tariff_snapshot' in d)=0 then raise exception 'Unexpected delivery save definition';end if;
 d:=replace(d,'  select to_jsonb(t) into tariff', $fallback$
  if partner.courier_tariff_mode='department' and dest_value='' then
   dest_value:=coalesce(nullif(info->>'department',''),current_delivery.department,'');
  end if;
  select to_jsonb(t) into tariff$fallback$);
 d:=replace(d,'courier_snapshot,address,destination,tariff_snapshot','courier_snapshot,address,department,destination,tariff_snapshot');
 d:=replace(d,'coalesce(info->>''address'',''''),dest_value,tariff','coalesce(info->>''address'',''''),nullif(info->>''department'',''''),dest_value,tariff');
 d:=replace(d,'address=excluded.address,destination=excluded.destination,','address=excluded.address,department=case when info ? ''department'' then excluded.department else sales_deliveries.department end,destination=excluded.destination,');
 execute d;
end $patch$;
notify pgrst,'reload schema';
