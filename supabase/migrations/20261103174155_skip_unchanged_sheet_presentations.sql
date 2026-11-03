-- Avoid rewriting unchanged presentations and firing their validation/identifier triggers.
do $patch$ declare def text; old_sql text; new_sql text; begin
 def:=pg_get_functiondef('catalog_private.save_material_sheet(uuid,uuid,jsonb)'::regprocedure);
 old_sql:=$s$update public.presentations set capacity=coalesce(r->>'capacity',''),comment=coalesce(r->>'comment','') where company_id=p_company and id=pid;$s$;
 new_sql:=$s$update public.presentations set capacity=coalesce(r->>'capacity',''),comment=coalesce(r->>'comment','') where company_id=p_company and id=pid and (capacity,comment) is distinct from (coalesce(r->>'capacity',''),coalesce(r->>'comment',''));$s$;
 if strpos(def,old_sql)=0 then raise exception 'No se encontró la actualización de presentación esperada';end if;
 execute replace(def,old_sql,new_sql);
end $patch$;
notify pgrst,'reload schema';
