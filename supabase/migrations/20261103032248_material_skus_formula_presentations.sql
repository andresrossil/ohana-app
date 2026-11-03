create function access_private.generate_missing_material_skus(c uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare r record;n integer:=0;sk text;begin
 if auth.uid() is null or not public.company_permission(c,'write','catalog') then raise exception 'No tienes permisos para generar SKU' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(c::text,0));
 for r in select id,classification from public.raw_materials where company_id=c and nullif(btrim(sku),'') is null and classification in('Materia prima','Material de empaque') order by id for update loop
  sk:=catalog_private.reserve_sku(c,case when r.classification='Material de empaque' then 'E' else 'M' end);
  update public.raw_materials set sku=sk where company_id=c and id=r.id and nullif(btrim(sku),'') is null;n:=n+1;
 end loop;
 return jsonb_build_object('generated',n,'unclassified',(select count(*) from public.raw_materials where company_id=c and nullif(btrim(sku),'') is null and coalesce(classification,'') not in('Materia prima','Material de empaque')));
end $$;
create function public.generate_missing_material_skus(p_company uuid) returns jsonb language sql security invoker set search_path='' as $$select access_private.generate_missing_material_skus(p_company)$$;
revoke all on function access_private.generate_missing_material_skus(uuid),public.generate_missing_material_skus(uuid) from public,anon;
grant execute on function access_private.generate_missing_material_skus(uuid),public.generate_missing_material_skus(uuid) to authenticated;

alter table public.formulas add column estimate_variant_id uuid,add foreign key(company_id,estimate_variant_id) references public.product_variants(company_id,id);
create index formula_estimate_variant on public.formulas(company_id,estimate_variant_id);
do $patch$declare def text;begin
 def:=pg_get_functiondef('access_private.formula_catalog(uuid)'::regprocedure);
 def:=replace(def,'''products'',coalesce(','''presentations'',coalesce((select jsonb_agg(jsonb_build_object(''id'',pv.id,''product_id'',pv.product_id,''name'',pv.name,''weight_min'',pv.weight_min,''weight_max'',pv.weight_max,''active'',pv.active)) from public.product_variants pv where pv.company_id=c),''[]''),''products'',coalesce(');
 if strpos(def,'''presentations''')=0 then raise exception 'Catálogo de fórmulas no reconocido';end if;execute def;
 def:=pg_get_functiondef('access_private.formula_command(uuid,text,uuid,jsonb)'::regprocedure);
 def:=replace(def,'product:=(data->>''product'')::uuid;', $new$product:=(data->>'product')::uuid;
 if nullif(data->>'estimate_variant_id','') is not null and not exists(select 1 from public.product_variants ev where ev.company_id=c and ev.id=(data->>'estimate_variant_id')::uuid and ev.product_id=product and ev.active) then raise exception 'La presentación no pertenece al producto o está archivada';end if;
 $new$);
 def:=replace(def,'join public.units pu on pu.company_id=ep.company_id','left join public.units pu on pu.company_id=ep.company_id');
 def:=replace(def,'eu.dimension=pu.dimension','(eu.dimension=pu.dimension or (eu.dimension=''mass'' and exists(select 1 from public.product_variants ev where ev.company_id=c and ev.product_id=product and ev.id=nullif(data->>''estimate_variant_id'','''')::uuid and ev.weight_min is not null)))');
 def:=replace(def,'set estimated_units=nullif','set estimate_variant_id=nullif(data->>''estimate_variant_id'','''')::uuid,estimated_units=nullif');
 if strpos(def,'set estimate_variant_id=')=0 then raise exception 'Guardado de estimación no reconocido';end if;execute def;
 def:=pg_get_functiondef('access_private.batch_recipe_snapshot(uuid,uuid,uuid,uuid,numeric,jsonb,text,numeric)'::regprocedure);
 def:=replace(def,'''quantity_per_unit'',f.quantity_per_unit)', '''quantity_per_unit'',f.quantity_per_unit,''estimate_variant_id'',f.estimate_variant_id,''estimate_variant_name'',(select pv.name from public.product_variants pv where pv.company_id=c and pv.id=f.estimate_variant_id))');execute def;
end $patch$;
notify pgrst,'reload schema';
