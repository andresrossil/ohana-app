do $migration$
declare
  definition text := pg_get_functiondef('access_private.formula_command(uuid,text,uuid,jsonb)'::regprocedure);
  old_alias text := 'join public.units u on u.company_id=c and u.id=i.unit_id where i.company_id=c and i.formula_id=fm.id';
begin
  if strpos(definition,old_alias)=0 then raise exception 'No se encontró la consulta de unidades de productos intermedios'; end if;
  definition:=replace(definition,old_alias,'join public.units intermediate_unit on intermediate_unit.company_id=c and intermediate_unit.id=i.unit_id where i.company_id=c and i.formula_id=fm.id');
  definition:=replace(definition,$old$'name',p.name||' · '||v.name,'unit',u.symbol$old$,$new$'name',p.name||' · '||v.name,'unit',intermediate_unit.symbol$new$);
  execute definition;
end $migration$;
