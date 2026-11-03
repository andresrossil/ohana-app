-- Read the authorized company's material names once, not through RLS for every row.
-- The unique normalized-name index remains the authority for concurrent writes.
do $patch$ declare def text; old_sql text; begin
 def:=pg_get_functiondef('catalog_private.save_material_sheet(uuid,uuid,jsonb)'::regprocedure);
 def:=replace(def,'mode text; basis text;','mode text; basis text; material_names jsonb;');
 old_sql:='insert into public.catalog_batches(company_id,id,payload) values(p_company,p_batch,p_rows);';
 if strpos(def,old_sql)=0 then raise exception 'No se encontró el inicio esperado del lote';end if;
 def:=replace(def,old_sql,$s$select coalesce(jsonb_object_agg(public.catalog_key(name),id::text),'{}'::jsonb) into material_names from public.raw_materials where company_id=p_company;
 insert into public.catalog_batches(company_id,id,payload) values(p_company,p_batch,p_rows);$s$);
 old_sql:=$s$select array_agg(id) into ids from public.raw_materials where company_id=p_company and public.catalog_key(name)=public.catalog_key(r->>'material');
    if cardinality(ids)>1 then raise exception 'Hay varias materias primas con ese nombre; selecciona una fila existente'; end if;
    mid:=ids[1];$s$;
 if strpos(def,old_sql)=0 then raise exception 'No se encontró la búsqueda esperada del material';end if;
 def:=replace(def,old_sql,$s$mid:=(material_names->>public.catalog_key(r->>'material'))::uuid;$s$);
 old_sql:=$s$if exists(select 1 from public.raw_materials where company_id=p_company and id<>mid and public.catalog_key(name)=public.catalog_key(r->>'material')) then raise exception 'Ya existe otra materia prima con ese nombre'; end if;$s$;
 if strpos(def,old_sql)=0 then raise exception 'No se encontró la validación esperada de nombres';end if;
 def:=replace(def,old_sql,$s$if (material_names->>public.catalog_key(r->>'material'))::uuid is distinct from mid and material_names ? public.catalog_key(r->>'material') then raise exception 'Ya existe otra materia prima con ese nombre'; end if;
   material_names:=(material_names-public.catalog_key(material.name))||jsonb_build_object(public.catalog_key(r->>'material'),mid::text);$s$);
 execute def;
end $patch$;
notify pgrst,'reload schema';
