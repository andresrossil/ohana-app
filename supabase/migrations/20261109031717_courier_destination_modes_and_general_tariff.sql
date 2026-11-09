alter table public.business_partners add column courier_tariff_defaults jsonb not null default '{}'::jsonb check(jsonb_typeof(courier_tariff_defaults)='object');
alter table public.business_partners alter column courier_tariff_mode set default 'zone';
-- Preserve the existing general amount and schedule in the new zone breakdown.
insert into public.courier_tariffs(company_id,courier_id,mode,destination,amount,available,delivery_schedule)
 select b.company_id,b.id,'zone',z::text,t.amount,t.available,t.delivery_schedule
 from public.business_partners b join public.courier_tariffs t on t.company_id=b.company_id and t.courier_id=b.id and t.mode='general' and t.destination='general'
 cross join generate_series(1,21) z where b.is_courier and b.courier_tariff_mode='general'
 on conflict(company_id,courier_id,mode,destination) do nothing;
update public.business_partners b set courier_tariff_defaults=jsonb_build_object('zone',jsonb_build_object('enabled',
 (select count(*)=21 and count(distinct t.amount)=1 and count(t.amount)=21 from public.courier_tariffs t where t.company_id=b.company_id and t.courier_id=b.id and t.mode='zone'),
 'amount',(select min(t.amount) from public.courier_tariffs t where t.company_id=b.company_id and t.courier_id=b.id and t.mode='zone'))),
 courier_tariff_mode='zone' where b.is_courier and b.courier_tariff_mode='general';
do $patch$ declare def text;begin
 def:=pg_get_functiondef('access_private.courier_operations(uuid,text,uuid,jsonb)'::regprocedure);
 if strpos(def,$s$tariff_mode_value not in('general','zone','department')$s$)=0 or strpos(def,$s$update public.business_partners set courier_tariff_mode=tariff_mode_value where company_id=c and id=pid;$s$)=0 then raise exception 'No se reconoce el guardado de tarifas';end if;
 def:=replace(def,$s$tariff_mode_value not in('general','zone','department')$s$,$s$tariff_mode_value not in('zone','department')$s$);
 def:=replace(def,$s$update public.business_partners set courier_tariff_mode=tariff_mode_value where company_id=c and id=pid;$s$,$new$
 if coalesce((data->>'general_enabled')::boolean,false) then
  if nullif(data->>'general_amount','') is null or not((data->>'general_amount')::numeric>=0 and (data->>'general_amount')::numeric<1e12) then raise exception 'Indica una tarifa general válida';end if;
  if jsonb_array_length(data->'rows')<>(case when tariff_mode_value='zone' then 21 else 22 end) or exists(select 1 from jsonb_array_elements(data->'rows') x where nullif(x->>'amount','')::numeric is distinct from (data->>'general_amount')::numeric) then raise exception 'La tarifa general debe coincidir en todos los destinos';end if;
 end if;
 update public.business_partners set courier_tariff_mode=tariff_mode_value,
  courier_tariff_defaults=jsonb_set(courier_tariff_defaults,array[tariff_mode_value],jsonb_build_object('enabled',coalesce((data->>'general_enabled')::boolean,false),'amount',nullif(data->>'general_amount','')::numeric))
 where company_id=c and id=pid;
 $new$);
 execute def;
end $patch$;
notify pgrst,'reload schema';
