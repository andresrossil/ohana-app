alter table public.raw_materials add column minimum_stock numeric default null
 check(minimum_stock is null or (minimum_stock>=0 and minimum_stock<1e15));
comment on column public.raw_materials.minimum_stock is 'Mínimo opcional en la unidad de inventario. Solo se recalcula por solicitud explícita.';

create function access_private.material_minimum_plan(c uuid) returns jsonb
language sql stable set search_path='' as $$
 with current_formulas as (
  select f.*,count(*) over(partition by product_id) product_count
  from public.formulas f where f.company_id=c and f.state='current'
 ), lines as (
  select i.material_id,f.product_count,
   access_private.planned_material_quantity(i.quantity,i.quantity_basis,1,f.estimated_units) q,
   u.dimension source_dimension,bu.dimension target_dimension,u.base_factor source_factor,bu.base_factor target_factor,
   i.density_g_ml density
  from current_formulas f join public.formula_ingredients i on i.company_id=c and i.formula_id=f.id
  join public.raw_materials m on m.company_id=c and m.id=i.material_id
  left join public.units u on u.company_id=c and u.id=i.unit_id
  left join public.units bu on bu.company_id=c and bu.id=m.unit_id
 ), converted as (
  select *,case
   when product_count<>1 then 'El producto tiene más de una fórmula vigente'
   when q is null or q<=0 then 'Cantidad o unidades estimadas pendientes'
   when source_factor is null or target_factor is null or target_factor<=0 then 'Unidad de inventario o conversión no disponible'
   when source_dimension<>target_dimension and not coalesce(source_dimension in('mass','volume') and target_dimension in('mass','volume') and density>0,false) then 'Unidades incompatibles o falta densidad'
   end error,
   case when source_dimension=target_dimension then q*source_factor/nullif(target_factor,0)
    when source_dimension='volume' and target_dimension='mass' and density>0 then q*source_factor*density/nullif(target_factor,0)
    when source_dimension='mass' and target_dimension='volume' and density>0 then q*source_factor/density/nullif(target_factor,0) end converted
  from lines
 ), totals as (
  select material_id,count(*) uses,string_agg(distinct error,'; ') error,
   case when bool_or(error is not null or converted is null) then null else round(sum(converted),8) end suggested
  from converted group by material_id
 ), rows as (
  select m.id,m.name,m.sku,m.minimum_stock current_minimum,bu.symbol unit,
   coalesce(t.uses,0) uses,t.suggested,
   case when t.suggested>=1e15 then 'Cantidad calculada fuera del rango permitido' else t.error end error
  from public.raw_materials m left join public.units bu on bu.company_id=c and bu.id=m.unit_id
  left join totals t on t.material_id=m.id where m.company_id=c
 ) select coalesce(jsonb_agg(to_jsonb(rows) order by name,id),'[]'::jsonb) from rows
$$;
revoke all on function access_private.material_minimum_plan(uuid) from public,anon,authenticated;

create function access_private.material_minimum_stock(c uuid,action text,data jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare plan jsonb;r jsonb;token text;new_count integer:=0;updated_count integer:=0;kept_count integer:=0;unused_count integer:=0;error_count integer:=0;choice text;
begin
 if auth.uid() is null or not public.company_permission(c,'write','catalog') then raise exception 'No tienes permisos para configurar mínimos' using errcode='42501';end if;
 if action not in('preview','apply') then raise exception 'Acción no válida';end if;
 perform pg_advisory_xact_lock(hashtextextended(c::text,0));
 if action='apply' then perform id from public.raw_materials where company_id=c order by id for update;end if;
 plan:=access_private.material_minimum_plan(c);token:=md5(plan::text);
 if action='preview' then return jsonb_build_object('rows',plan,'token',token);end if;
 if data->>'token' is distinct from token then raise exception 'Los materiales o fórmulas cambiaron. Vuelve a calcular antes de aplicar los mínimos';end if;
 for r in select value from jsonb_array_elements(plan) loop
  if r->>'error' is not null then error_count:=error_count+1;
  elsif (r->>'uses')::integer=0 then unused_count:=unused_count+1;
  elsif coalesce((r->>'current_minimum')::numeric,0)=0 then
   update public.raw_materials set minimum_stock=(r->>'suggested')::numeric where company_id=c and id=(r->>'id')::uuid;
   new_count:=new_count+1;
  elsif (r->>'current_minimum')::numeric is distinct from (r->>'suggested')::numeric then
   choice:=coalesce(data->'choices'->>(r->>'id'),'keep');
   if choice not in('keep','update') then raise exception 'Selecciona Actualizar o Mantener';end if;
   if choice='update' then
    update public.raw_materials set minimum_stock=(r->>'suggested')::numeric where company_id=c and id=(r->>'id')::uuid;
    updated_count:=updated_count+1;
   else kept_count:=kept_count+1;end if;
  else kept_count:=kept_count+1;end if;
 end loop;
 return jsonb_build_object('processed',jsonb_array_length(plan),'assigned',new_count,'updated',updated_count,'kept',kept_count,'unused',unused_count,'errors',error_count);
end $$;
create function public.material_minimum_stock(p_company uuid,p_action text,p_data jsonb default '{}'::jsonb) returns jsonb
language sql security invoker set search_path='' as $$select access_private.material_minimum_stock(p_company,p_action,p_data)$$;
revoke all on function access_private.material_minimum_stock(uuid,text,jsonb),public.material_minimum_stock(uuid,text,jsonb) from public,anon;
grant execute on function access_private.material_minimum_stock(uuid,text,jsonb),public.material_minimum_stock(uuid,text,jsonb) to authenticated;

-- Individual creation remains atomic with its presentation and price.
do $patch$ declare def text;begin
 def:=pg_get_functiondef('public.save_material_sheet(uuid,uuid,jsonb)'::regprocedure);
 def:=replace(def,$s$'notes','productUrl']$s$,$s$'notes','productUrl','minimumStock']$s$);
 if strpos(def,$s$if r ? 'notes' then$s$)=0 then raise exception 'No se reconoce la creación de materiales';end if;
 def:=replace(def,$s$if r ? 'notes' then$s$,$s$
 if r ? 'minimumStock' then
  update public.raw_materials set minimum_stock=nullif(r->>'minimumStock','')::numeric where company_id=p_company and id=mid;
 end if;
 if r ? 'notes' then$s$);
 execute def;
end $patch$;
notify pgrst,'reload schema';
