-- Reuse name as commercial size; preserve UUIDs, SKUs, barcode registry and history.
alter table public.product_variants add column commercial_code text;
alter table public.product_variants drop constraint product_variants_name_check;
alter table public.product_variants add constraint product_variants_name_check check(length(trim(name))<=120);
alter table public.product_variants add constraint variant_commercial_code_length check(length(commercial_code) between 1 and 80);
-- Only unambiguous legacy code-shaped names are moved, never guessed from SKU.
update public.product_variants set commercial_code=name,name='' where name ~ '^[A-Za-z][A-Za-z0-9]*-[0-9]+$';
alter table public.product_variants add constraint variant_commercial_identity check(nullif(trim(name),'') is not null or nullif(trim(commercial_code),'') is not null);
comment on column public.product_variants.name is 'Tamaño comercial editable; puede repetirse según atributos y rango. Se reutiliza el campo existente.';
comment on column public.product_variants.commercial_code is 'Código comercial editable, distinto del SKU automático y del código de barras.';
-- Inspected standalone index: no FK/constraint dependencies. UUID relationships remain untouched.
drop index public.variant_name_unique;
create unique index variant_combination_unique on public.product_variants(company_id,product_id,public.catalog_key(name),(access_private.normalize_attributes(attributes)::text),coalesce(weight_min,-1),coalesce(weight_max,-1));
create unique index variant_commercial_code_unique on public.product_variants(company_id,product_id,public.catalog_key(commercial_code),(access_private.normalize_attributes(attributes)::text)) where commercial_code is not null;

create function access_private.variant_commercial_guard() returns trigger language plpgsql set search_path='' as $$
begin
 new.commercial_code:=upper(nullif(btrim(new.commercial_code),''));
 new.name:=upper(btrim(coalesce(new.name,'')));
 if tg_op='UPDATE' and new.sku is distinct from old.sku then raise exception 'El SKU es automático y no se puede modificar. Utiliza Código comercial'; end if;
 return new;
end $$;
revoke all on function access_private.variant_commercial_guard() from public,anon,authenticated;
create trigger a0_variant_commercial_guard before insert or update on public.product_variants for each row execute function access_private.variant_commercial_guard();

create function access_private.variant_label(v jsonb) returns text language sql immutable set search_path='' as $$
 select upper(concat_ws(' · ',nullif(v->>'commercial_code',''),nullif(v->>'name',''),
 case when nullif(v->>'weight_min','') is not null and nullif(v->>'weight_max','') is not null then
 trim_scale((v->>'weight_min')::numeric)::text||'–'||trim_scale((v->>'weight_max')::numeric)::text||' g' end,
 (select string_agg(value,' · ' order by case when key='aroma' then 0 else 1 end,key) from jsonb_each_text(coalesce(v->'attributes','{}')) where value<>'')));
$$;
revoke all on function access_private.variant_label(jsonb) from public,anon,authenticated;

do $migration$
declare source text; patched text; fn regprocedure;
begin
 source:=pg_get_functiondef('access_private.operations(uuid,text,uuid,jsonb)'::regprocedure);
 patched:=replace(source,
 'v_id:=nullif(p_data->>''id'','''')::uuid;code:=nullif(trim(p_data->>''sku''),'''');',
 'v_id:=nullif(p_data->>''id'','''')::uuid;code:=case when v_id is null then null else (select sku from public.product_variants where company_id=p_company and product_id=parent and id=v_id) end;
 if v_id is not null and p_data ? ''sku'' and nullif(trim(p_data->>''sku''),'''') is distinct from code then raise exception ''El SKU es automático. Utiliza Código comercial'';end if;');
 if patched=source then raise exception 'Variant save identity fragment changed';end if;
 source:=patched;
 patched:=replace(patched,'company_id,product_id,name,sku,barcode,barcode_custom,attributes,weight_min,weight_max,price,currency,published,allow_preorder) values(p_company,parent,trim(p_data->>''name''),code,',
 'company_id,product_id,name,commercial_code,sku,barcode,barcode_custom,attributes,weight_min,weight_max,price,currency,published,allow_preorder,active) values(p_company,parent,coalesce(trim(p_data->>''name''),''''),nullif(trim(p_data->>''commercial_code''),''''),code,');
 if patched=source then raise exception 'Variant insert fragment changed';end if;
 -- Add explicit active flag only to variant INSERT, not other commands.
 patched:=replace(patched,'coalesce((p_data->>''allow_preorder'')::boolean,false)) returning product_variants.id',
 'coalesce((p_data->>''allow_preorder'')::boolean,false),coalesce((p_data->>''active'')::boolean,true)) returning product_variants.id');
 patched:=replace(patched,'set name=trim(p_data->>''name''),sku=code,',
 'set name=coalesce(trim(p_data->>''name''),''''),commercial_code=case when p_data ? ''commercial_code'' then nullif(trim(p_data->>''commercial_code''),'''') else commercial_code end,sku=code,');
 -- Labels only: existing history rows and snapshots are not rewritten.
 patched:=replace(patched,'pv.name','access_private.variant_label(to_jsonb(pv))');
 execute patched;

 source:=pg_get_functiondef('access_private.variant_table_save(uuid,uuid,jsonb)'::regprocedure);
 source:=replace(source,'''name'',''sku'',''barcode''','''name'',''commercial_code'',''sku'',''barcode''');
 -- New creation now supports explicit active state/ranges. Remove temporary double creation.
 source:=replace(source,$old$   if nullif(line->>'id','') is null then
    -- Existing creation defaults to active; defer weight assignment until explicit state is set.
    saved:=access_private.operations(p_company,'variant_save',gen_random_uuid(),payload||jsonb_build_object('weight_min','','weight_max',''));
    payload:=payload||jsonb_build_object('id',saved->>'id');
    if nullif(trim(payload->>'sku'),'') is null then
     payload:=payload||jsonb_build_object('sku',(select sku from public.product_variants where company_id=p_company and id=(saved->>'id')::uuid));
    end if;
   end if;
$old$,'');
 if source like '%payload:=payload||jsonb_build_object(''id'',saved->>''id'')%' then raise exception 'Batch creation fragment changed';end if;
 execute source;

 -- All current projections that show a variant name use the same descriptive label.
 for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='access_private' and p.prokind='f' and p.proname in('sales','storefront','formula_catalog','recipe_catalog','price_list_catalog','pricing_catalog','place_order','checkout_quote') loop
  source:=pg_get_functiondef(fn);
  patched:=replace(source,'pv.name','access_private.variant_label(to_jsonb(pv))');
  if source<>patched then execute patched;end if;
 end loop;
end $migration$;

