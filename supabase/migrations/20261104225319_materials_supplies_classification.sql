alter table public.raw_materials drop constraint raw_materials_classification_check;
alter table public.raw_materials add constraint raw_materials_classification_check check(classification in ('Materia prima','Material de empaque','Insumos'));
CREATE OR REPLACE FUNCTION access_private.generate_missing_material_skus(c uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$declare r record;n integer:=0;sk text;begin
 if auth.uid() is null or not public.company_permission(c,'write','catalog') then raise exception 'No tienes permisos para generar SKU' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(c::text,0));
 for r in select id,classification from public.raw_materials where company_id=c and nullif(btrim(sku),'') is null and classification in('Materia prima','Material de empaque','Insumos') order by id for update loop
  sk:=catalog_private.reserve_sku(c,case when r.classification='Material de empaque' then 'E' else 'M' end);
  update public.raw_materials set sku=sk where company_id=c and id=r.id and nullif(btrim(sku),'') is null;n:=n+1;
 end loop;
 return jsonb_build_object('generated',n,'unclassified',(select count(*) from public.raw_materials where company_id=c and nullif(btrim(sku),'') is null and coalesce(classification,'') not in('Materia prima','Material de empaque','Insumos')));
end $function$
;
