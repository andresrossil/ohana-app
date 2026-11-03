-- The listing alias must not collide with the PL/pgSQL formula row variable f.
do $patch$declare def text;listing text;fixed text;a integer;b integer;begin
 def:=pg_get_functiondef('access_private.production_command(uuid,text,uuid,jsonb)'::regprocedure);
 a:=strpos(def,'if action=''list'' then');
 if a=0 then raise exception 'No se encontró la consulta de lotes';end if;
 b:=strpos(substring(def from a),'end if;');
 if b=0 then raise exception 'Consulta de lotes no reconocida';end if;
 listing:=substring(def from a for b+6);
 if strpos(listing,'public.formulas f on')=0 then raise exception 'No se encontró el alias de fórmula esperado';end if;
 fixed:=replace(listing,'public.formulas f on','public.formulas revision on');
 fixed:=regexp_replace(fixed,'\mf\.','revision.','g');
 execute replace(def,listing,fixed);
end $patch$;
notify pgrst,'reload schema';
