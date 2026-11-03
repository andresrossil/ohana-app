-- Extend the version-owned inventory lines; existing rows retain recipe scaling.
alter table public.formula_ingredients
 add column reference_notes text not null default '' check(length(reference_notes)<=2000),
 add column quantity_basis text not null default 'recipe';
alter table public.formula_ingredients drop constraint formula_ingredients_line_kind_check;
alter table public.formula_ingredients add constraint formula_ingredients_line_kind_check check(line_kind in('ingredient','packaging','auxiliary')),
 add constraint formula_line_quantity_basis check((line_kind='auxiliary' and quantity_basis in('batch','unit')) or (line_kind in('ingredient','packaging') and quantity_basis='recipe'));

create function access_private.planned_material_quantity(q numeric,basis text,factor numeric,n numeric) returns numeric language sql immutable set search_path='' as $$
 select case basis when 'batch' then q when 'unit' then q*n else q*factor end
$$;
revoke all on function access_private.planned_material_quantity(numeric,text,numeric,numeric) from public,anon,authenticated;

do $patch$declare def text;begin
 def:=pg_get_functiondef('access_private.formula_command(uuid,text,uuid,jsonb)'::regprocedure);
 def:=replace(def,$s$kind not in('ingredient','packaging')$s$,$s$kind not in('ingredient','packaging','auxiliary')$s$);
 def:=replace(def,$s$mat.classification='Material de empaque' and kind<>'packaging'$s$,$s$mat.classification='Material de empaque' and kind='ingredient'$s$);
 def:=replace(def,$s$pct:=null;$s$,$new$
   if length(coalesce(r->>'reference_notes',''))>2000 then raise exception 'Las observaciones admiten hasta 2000 caracteres por renglón';end if;
   if kind='auxiliary' then
    if coalesce(r->>'quantity_basis','batch') not in('batch','unit') then raise exception 'Selecciona Por lote o Por unidad para el insumo';end if;
    if r->>'quantity_basis'='unit' and not coalesce(nullif(data->>'estimated_units','')::numeric>0,false) then raise exception 'Define las unidades estimadas para los insumos por unidad';end if;
   elsif coalesce(r->>'quantity_basis','recipe')<>'recipe' then raise exception 'La composición y el empaque conservan el escalado de la receta';end if;
   pct:=null;$new$);
 def:=replace(def,$s$'line_kind',kind,'base'$s$,$s$'line_kind',kind,'reference_notes',coalesce(r->>'reference_notes',''),'quantity_basis',case when kind='auxiliary' then coalesce(r->>'quantity_basis','batch') else 'recipe' end,'base'$s$);
 def:=replace(def,$s$x->>'line_kind',(x->>'base')::numeric$s$, $s$x->>'line_kind',x->>'quantity_basis',(x->>'base')::numeric$s$);
 def:=replace(def,$s$i.line_kind,round(i.quantity*un.base_factor,8)$s$,$s$i.line_kind,i.quantity_basis,round(i.quantity*un.base_factor,8)$s$);
 def:=replace(def,'unit_id,line_kind,percentage,density_g_ml)', 'unit_id,line_kind,percentage,density_g_ml,reference_notes,quantity_basis)');
 def:=replace(def,$s$when r->>'line_kind'='packaging' or dimensions<>1$s$, $s$when r->>'line_kind'<>'ingredient' or dimensions<>1$s$);
 def:=replace(def,$s$(r->>'density_g_ml')::numeric);$s$, $s$(r->>'density_g_ml')::numeric,r->>'reference_notes',r->>'quantity_basis');$s$);
 if strpos(def,$s$kind not in('ingredient','packaging','auxiliary')$s$)=0 or strpos(def,$s$r->>'quantity_basis');$s$)=0 then raise exception 'Comando de fórmula no reconocido';end if;
 execute def;
 def:=pg_get_functiondef('access_private.batch_recipe_snapshot(uuid,uuid,uuid,uuid,numeric,jsonb,text,numeric)'::regprocedure);
 def:=replace(def,$s$'schema',1$s$, $s$'schema',2$s$);
 def:=replace(def,$s$'planned_quantity',i.quantity*factor$s$, $s$'reference_notes',i.reference_notes,'quantity_basis',i.quantity_basis,'configured_quantity',i.quantity,'planned_quantity',access_private.planned_material_quantity(i.quantity,i.quantity_basis,factor,(select pb.planned_quantity from public.production_batches pb where pb.company_id=c and pb.id=bid))$s$);
 if strpos(def,$s$'reference_notes',i.reference_notes$s$)=0 then raise exception 'Snapshot de fórmula no reconocido';end if;execute def;
end $patch$;

-- Live stock requirements: one formula preview, or aggregate all open batches.
create function access_private.production_requirements(c uuid,fid uuid,factor numeric,n numeric) returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 if auth.uid() is null or not(case when fid is not null then public.company_permission(c,'read','production') else public.company_permission(c,'read','reports') and public.company_permission(c,'read','inventory') end) then raise exception 'Requerimientos no autorizados' using errcode='42501';end if;
 if factor is null or not(factor>0 and factor<=1e6) or (n is not null and not(n>0 and n<1e12)) then raise exception 'Escala o unidades no válidas';end if;
 if fid is not null and not exists(select 1 from public.formulas f where f.company_id=c and f.id=fid) then raise exception 'Fórmula no disponible';end if;
 return coalesce((with selected as (
  select f.id,factor scale,coalesce(n,f.estimated_units*factor) units from public.formulas f where f.company_id=c and f.id=fid
  union all
  select pb.formula_id,pb.formula_scale,pb.planned_quantity::numeric from public.production_batches pb where fid is null and pb.company_id=c and pb.state in('draft','in_progress') and not pb.confirmed and pb.formula_id is not null
 ), needed as (
  select i.material_id,array_agg(distinct i.line_kind) kinds,bool_or(qty.q is null) pending,sum(qty.q*u.base_factor/bu.base_factor) required
  from selected s join public.formula_ingredients i on i.company_id=c and i.formula_id=s.id
  join public.units u on u.company_id=c and u.id=i.unit_id
  join public.raw_materials m on m.company_id=c and m.id=i.material_id
  join public.units bu on bu.company_id=c and bu.id=m.unit_id
  cross join lateral(select access_private.planned_material_quantity(i.quantity,i.quantity_basis,s.scale,s.units) q)qty
  group by i.material_id
 ), rows as (
  select m.id material_id,m.name,m.sku,bu.symbol unit,k.kinds,case when k.pending then null else k.required end required,
   greatest(0,coalesce(b.on_hand-b.blocked-b.reserved,0)) available,
   case when k.pending then null else greatest(0,k.required-greatest(0,coalesce(b.on_hand-b.blocked-b.reserved,0))) end shortage
  from needed k join public.raw_materials m on m.company_id=c and m.id=k.material_id
  join public.units bu on bu.company_id=c and bu.id=m.unit_id
  left join public.inventory_balances b on b.company_id=c and b.item_kind='material' and b.item_id=m.id
 ) select jsonb_agg(to_jsonb(rows) order by name) from rows),'[]'::jsonb);
end $$;
create function public.production_requirements(p_company uuid,p_formula uuid default null,p_scale numeric default 1,p_units numeric default null) returns jsonb language sql stable security invoker set search_path='' as $$select access_private.production_requirements(p_company,p_formula,p_scale,p_units)$$;
revoke all on function access_private.production_requirements(uuid,uuid,numeric,numeric),public.production_requirements(uuid,uuid,numeric,numeric) from public,anon;
grant execute on function access_private.production_requirements(uuid,uuid,numeric,numeric),public.production_requirements(uuid,uuid,numeric,numeric) to authenticated;
notify pgrst,'reload schema';
