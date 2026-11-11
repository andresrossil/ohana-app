alter table public.partner_addresses
  drop constraint partner_addresses_zone_check,
  alter column zone type text using zone::text,
  add constraint partner_addresses_zone_check check (length(btrim(zone)) between 1 and 120);

alter table public.sales_deliveries
  drop constraint sales_deliveries_zone_check,
  alter column zone type text using zone::text,
  add constraint sales_deliveries_zone_check check (length(btrim(zone)) between 1 and 120);

create unique index courier_tariffs_zone_name_unique
  on public.courier_tariffs (company_id, courier_id, lower(btrim(destination)))
  where mode = 'zone';

alter table public.courier_tariffs add constraint courier_tariffs_zone_name_check
  check (mode <> 'zone' or length(btrim(destination)) between 1 and 120);

-- Change only the zone handling in the existing permission-checked commands.
do $migration$
declare
  change record;
  definition text;
  previous text;
  target regprocedure;
begin
  for target in select unnest(array[
    'access_private.partners(uuid,text,jsonb)'::regprocedure,
    'access_private.save_order_delivery(uuid,uuid,jsonb)'::regprocedure,
    'access_private.delivery_shipping_charge(uuid,jsonb)'::regprocedure,
    'access_private.courier_operations(uuid,text,uuid,jsonb)'::regprocedure
  ]) loop
    definition := pg_get_functiondef(target);
    for change in
      select * from (values
        ('access_private.partners(uuid,text,jsonb)'::regprocedure,
          $old$nullif(a->>'zone','')::smallint$old$,
          $new$nullif(btrim(a->>'zone'),'')$new$),
        ('access_private.save_order_delivery(uuid,uuid,jsonb)'::regprocedure,
          $old$nullif(info->>'zone','')::smallint$old$,
          $new$nullif(btrim(info->>'zone'),'')$new$),
        ('access_private.save_order_delivery(uuid,uuid,jsonb)'::regprocedure,
          $old$t.destination=case when partner.courier_tariff_mode='general' then 'general' else dest_value end$old$,
          $new$(case when t.mode='zone' then lower(btrim(t.destination))=lower(btrim(dest_value)) else t.destination=case when t.mode='general' then 'general' else dest_value end end)$new$),
        ('access_private.delivery_shipping_charge(uuid,jsonb)'::regprocedure,
          $old$destination=v_destination and available$old$,
          $new$(case when v_mode='zone' then lower(btrim(destination))=lower(btrim(v_destination)) else destination=v_destination end) and available$new$),
        ('access_private.courier_operations(uuid,text,uuid,jsonb)'::regprocedure,
          $old$group by e->>'destination' having count(*)>1$old$,
          $new$group by case when tariff_mode_value='zone' then lower(btrim(e->>'destination')) else e->>'destination' end having count(*)>1$new$),
        ('access_private.courier_operations(uuid,text,uuid,jsonb)'::regprocedure,
          $old$(case when r->>'destination' ~ '^[1-9][0-9]{0,4}$' then (r->>'destination')::numeric>32767 else true end)$old$,
          $new$(length(btrim(r->>'destination')) not between 1 and 120)$new$),
        ('access_private.courier_operations(uuid,text,uuid,jsonb)'::regprocedure,
          $old$values(c,pid,tariff_mode_value,r->>'destination',nullif(r->>'amount','')::numeric$old$,
          $new$values(c,pid,tariff_mode_value,case when tariff_mode_value='zone' then coalesce(
              (select t.destination from public.courier_tariffs t where t.company_id=c and t.courier_id=pid and t.mode='zone' and lower(btrim(t.destination))=lower(btrim(r->>'destination'))),
              btrim(r->>'destination')) else r->>'destination' end,nullif(r->>'amount','')::numeric$new$),
        ('access_private.courier_operations(uuid,text,uuid,jsonb)'::regprocedure,
          $old$x->>'destination'=t.destination$old$,
          $new$lower(btrim(x->>'destination'))=lower(btrim(t.destination))$new$)
      ) as edits(function_id, old_sql, new_sql) where function_id=target
    loop
      previous := definition;
      definition := replace(definition, change.old_sql, change.new_sql);
      if definition = previous then
        raise exception 'No coincide la definición esperada de %', target;
      end if;
    end loop;
    execute definition;
  end loop;
end
$migration$;
