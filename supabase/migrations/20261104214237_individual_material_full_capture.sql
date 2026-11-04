-- Optional individual-creation fields reuse the existing authorized, atomic sheet command.
do $$declare d text;before_def text;begin
 d:=pg_get_functiondef('public.save_material_sheet(uuid,uuid,jsonb)'::regprocedure);
 before_def:=d;
 d:=replace(d,' output:=catalog_private.save_material_sheet(p_company,p_batch,p_rows);',
 $new$ if exists(select 1 from jsonb_array_elements(p_rows) line join public.raw_materials existing on existing.company_id=p_company and public.catalog_key(existing.name)=public.catalog_key(line->>'material') where coalesce((line->>'createOnly')::boolean,false)) then
 raise exception 'Este material ya existe. Ábrelo desde el catálogo para agregar o editar sus presentaciones';end if;
 output:=catalog_private.save_material_sheet(p_company,p_batch,p_rows);$new$);
 if d=before_def then raise exception 'No se reconoció el guardado de materiales';end if;
 d:=replace(d,$old$array['sku','classification','origin','barcode','barcodeCustom']$old$,$new$array['sku','classification','origin','barcode','barcodeCustom','notes','productUrl']$new$);
 d:=replace(d,'   o:=m.origin_id;',
 $new$   if r ? 'notes' then
    if length(coalesce(r->>'notes',''))>5000 then raise exception 'Las notas admiten hasta 5000 caracteres';end if;
    update public.raw_materials set notes=coalesce(r->>'notes','') where company_id=p_company and id=mid;
   end if;
   if r ? 'productUrl' then
    if nullif(trim(r->>'productUrl'),'') is not null and (length(r->>'productUrl')>2048 or r->>'productUrl' !~* '^https?://[^[:space:]]+$') then raise exception 'El enlace de compra debe ser una URL http o https válida';end if;
    update public.presentations set product_url=nullif(trim(r->>'productUrl'),'') where company_id=p_company and id=(entry->>'id')::uuid;
   end if;
   o:=m.origin_id;$new$);
 execute d;
end $$;
