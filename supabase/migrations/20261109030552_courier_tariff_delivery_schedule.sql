alter table public.courier_tariffs add column delivery_schedule text not null default '' check(length(delivery_schedule)<=500);
comment on column public.courier_tariffs.delivery_schedule is 'Horario de entrega opcional, texto libre por tarifa y destino.';
do $patch$
declare def text;old_insert text:=$s$insert into public.courier_tariffs(company_id,courier_id,mode,destination,amount,available) values(c,pid,tariff_mode_value,r->>'destination',nullif(r->>'amount','')::numeric,coalesce((r->>'available')::boolean,false))$s$;
begin
 def:=pg_get_functiondef('access_private.courier_operations(uuid,text,uuid,jsonb)'::regprocedure);
 if strpos(def,old_insert)=0 or strpos(def,'set amount=excluded.amount,available=excluded.available;')=0 then raise exception 'No se reconoce el guardado de tarifas';end if;
 def:=replace(def,old_insert,$s$insert into public.courier_tariffs(company_id,courier_id,mode,destination,amount,available,delivery_schedule) values(c,pid,tariff_mode_value,r->>'destination',nullif(r->>'amount','')::numeric,coalesce((r->>'available')::boolean,false),coalesce(r->>'delivery_schedule',''))$s$);
 def:=replace(def,'set amount=excluded.amount,available=excluded.available;',$s$set amount=excluded.amount,available=excluded.available,delivery_schedule=case when r?'delivery_schedule' then excluded.delivery_schedule else public.courier_tariffs.delivery_schedule end;$s$);
 execute def;
end $patch$;
notify pgrst,'reload schema';
