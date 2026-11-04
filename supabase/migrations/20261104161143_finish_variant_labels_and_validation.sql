-- Finish projections without changing authorization or historical snapshots.
create or replace function access_private.variant_label(v jsonb) returns text language sql immutable set search_path='' as $$
 select concat_ws(' · ',upper(nullif(v->>'commercial_code','')),upper(nullif(v->>'name','')),
 case when nullif(v->>'weight_min','') is not null and nullif(v->>'weight_max','') is not null then
 trim_scale((v->>'weight_min')::numeric)::text||'–'||trim_scale((v->>'weight_max')::numeric)::text||' g' end,
 (select string_agg(upper(value),' · ' order by case when key='aroma' then 0 else 1 end,key) from jsonb_each_text(coalesce(v->'attributes','{}')) where value<>''));
$$;
revoke all on function access_private.variant_label(jsonb) from public,anon,authenticated;
do $migration$ declare source text;patched text;begin
 source:=pg_get_functiondef('access_private.price_list_command(uuid,text,jsonb)'::regprocedure);
 patched:=replace(source,'''id'',id,''name'',name,''sku'',sku,''product_id'',product_id',
 '''id'',id,''name'',name,''commercial_code'',commercial_code,''sku'',sku,''product_id'',product_id');
 if source=patched then raise exception 'Price list variant projection changed';end if;
 execute patched;
 source:=pg_get_functiondef('access_private.operations(uuid,text,uuid,jsonb)'::regprocedure);
 patched:=replace(source,
 'exception when exclusion_violation then raise exception ''Los rangos de peso se solapan con otra variante de los mismos atributos'';',
 'exception when unique_violation then
 get stacked diagnostics code=constraint_name;
 if code=''variant_commercial_code_unique'' then raise exception ''Ya existe ese código comercial para el producto y atributos seleccionados'';
 elsif code=''variant_combination_unique'' then raise exception ''Ya existe una variante con el mismo tamaño comercial, atributos y rango de peso'';
 else raise; end if;
 when exclusion_violation then raise exception ''Los rangos de peso se solapan con otra variante de los mismos atributos'';');
 if source=patched then raise exception 'Variant validation handler changed';end if;
 execute patched;
 source:=pg_get_functiondef('access_private.admin_text()'::regprocedure);
 execute replace(source,'Ya existe esa variante con el mismo nombre, atributos y rango','Ya existe una variante con el mismo tamaño comercial, atributos y rango');
end $migration$;

