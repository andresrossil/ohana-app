alter table public.raw_materials add column maximum_stock numeric default null check(maximum_stock is null or (maximum_stock>=0 and maximum_stock<1e15));
comment on column public.raw_materials.maximum_stock is 'Máximo opcional en la unidad de inventario; captura manual.';
do $patch$ declare def text;begin
 def:=pg_get_functiondef('public.save_material_sheet(uuid,uuid,jsonb)'::regprocedure);
 if strpos(def,$s$if r ? 'minimumStock' then$s$)=0 then raise exception 'No se reconoce el guardado de mínimos del material';end if;
 def:=replace(def,$s$'productUrl','minimumStock']$s$,$s$'productUrl','minimumStock','maximumStock']$s$);
 def:=replace(def,$s$if r ? 'minimumStock' then$s$,$s$
 if r ? 'maximumStock' then
  update public.raw_materials set maximum_stock=nullif(r->>'maximumStock','')::numeric where company_id=p_company and id=mid;
 end if;
 if r ? 'minimumStock' then$s$);
 execute def;
end $patch$;
notify pgrst,'reload schema';
