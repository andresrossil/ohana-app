-- Archived materials may be edited after a UI warning, without reactivating them.
-- Retain scoped authorization, atomic writes, conflict checks and history.
do $patch$declare def text;guard text:=$old$if not material.active then raise exception 'La materia prima está archivada'; end if;$old$;begin
 def:=pg_get_functiondef('catalog_private.save_material_sheet(uuid,uuid,jsonb)'::regprocedure);
 if strpos(def,guard)=0 then raise exception 'Validación de material archivado no reconocida';end if;
 def:=replace(def,guard,'-- Archived state is preserved; editing is permitted.');execute def;
end $patch$;
notify pgrst,'reload schema';
