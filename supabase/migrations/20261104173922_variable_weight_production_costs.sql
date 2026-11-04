-- Extend existing rows and ledger; no historical backfill or parallel stock.
alter table public.formulas add column production_mode text not null default 'fixed' check(production_mode in('fixed','variable_weight'));
alter table public.inventory_units add column cost_snapshot jsonb check(cost_snapshot is null or jsonb_typeof(cost_snapshot)='object');
comment on column public.inventory_units.cost_snapshot is 'Immutable actual manufacturing cost, commercial estimates, sale reference and per-unit material allocations at production confirmation.';

create function access_private.variable_cost_plan(c uuid,bid uuid,payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare b public.production_batches%rowtype; f public.formulas%rowtype; cc text; n numeric; wtotal numeric;
 common_material numeric; per_material numeric; common_known boolean; per_known boolean; common_total numeric;
 fixed_lines jsonb; commercial_lines jsonb; fixed_quote jsonb; quote jsonb; o jsonb; w record; m record;
 qty numeric; actual_qty numeric; allocations jsonb; units jsonb:='[]'; manufacturing numeric; commercial numeric;
 unit_material_cost numeric; assigned numeric; cost_known boolean; code text; allocation_sum numeric;
 manufacturing_total numeric;commercial_total numeric; all_total numeric; price numeric; ref jsonb;
begin
 select * into strict b from public.production_batches where company_id=c and id=bid and not confirmed;
 select * into strict f from public.formulas where company_id=c and id=b.formula_id;
 if f.production_mode<>'variable_weight' then raise exception 'El lote no usa producción variable por peso';end if;
 cc:=b.currency;
 select sum(quantity),sum(actual_weight) into n,wtotal from public.batch_outputs where company_id=c and batch_id=bid;
 if n is null or n<=0 or n>10000 or wtotal is null or wtotal<=0 then raise exception 'Registra el peso real de cada unidad';end if;
 if exists(select 1 from public.batch_outputs where company_id=c and batch_id=bid and (actual_weight is null or actual_weight<=0)) then raise exception 'Todas las salidas variables requieren pesos reales';end if;
 select ff.code into code from public.formula_families ff where ff.company_id=c and ff.id=f.family_id;
 select coalesce(sum(bc.cost) filter(where not(i.line_kind='packaging' or i.line_kind='auxiliary' and i.quantity_basis='unit')),0),
 coalesce(bool_and(bc.cost is not null) filter(where not(i.line_kind='packaging' or i.line_kind='auxiliary' and i.quantity_basis='unit')),true),
 coalesce(sum(bc.cost) filter(where i.line_kind='packaging' or i.line_kind='auxiliary' and i.quantity_basis='unit'),0),
 coalesce(bool_and(bc.cost is not null) filter(where i.line_kind='packaging' or i.line_kind='auxiliary' and i.quantity_basis='unit'),true)
 into common_material,common_known,per_material,per_known
 from public.formula_ingredients i join public.batch_consumptions bc on bc.company_id=i.company_id and bc.material_id=i.material_id and bc.batch_id=bid
 where i.company_id=c and i.formula_id=f.id;
 select coalesce(jsonb_agg(jsonb_build_object('cost_id',l.cost_id,'quantity',l.quantity,'percent',l.percent))filter(where ac.kind='overhead'),'[]'),
 coalesce(jsonb_agg(jsonb_build_object('cost_id',l.cost_id,'quantity',l.quantity,'percent',l.percent))filter(where ac.kind<>'overhead'),'[]')
 into fixed_lines,commercial_lines from public.formula_overhead_lines l join public.additional_cost_catalog ac on ac.company_id=l.company_id and ac.id=l.cost_id where l.company_id=c and l.formula_id=f.id;
 fixed_quote:=access_private.additional_cost_quote(c,n,null,null,null,fixed_lines);
 common_total:=case when common_known then common_material+(fixed_quote->>'additional_total')::numeric end;
 for o in select value from jsonb_array_elements(payload->'outputs') loop
  if jsonb_typeof(o->'unit_weights') is distinct from 'array' or jsonb_array_length(o->'unit_weights')<>(o->>'quantity')::integer then raise exception 'Registra una fila por cada barra';end if;
  if o ? 'unit_materials' and (jsonb_typeof(o->'unit_materials')<>'array' or jsonb_array_length(o->'unit_materials')<>jsonb_array_length(o->'unit_weights')) then raise exception 'Los consumos por unidad no coinciden con las barras';end if;
  quote:=access_private.additional_cost_quote(c,1,(o->>'variant')::uuid,null,null,commercial_lines);
  commercial:=(quote->>'additional_total')::numeric;ref:=quote->'price_reference';price:=(quote->>'sale_price')::numeric;
  for w in select value,ordinality from jsonb_array_elements(o->'unit_weights') with ordinality loop
   allocations:='[]';unit_material_cost:=0;cost_known:=per_known;
   if o ? 'unit_materials' and jsonb_typeof(o->'unit_materials'->(w.ordinality::integer-1))<>'object' then raise exception 'Detalle de consumo por unidad inválido';end if;
   if exists(select 1 from jsonb_object_keys(coalesce(o->'unit_materials'->(w.ordinality::integer-1),'{}')) k(material)
     where not exists(select 1 from public.formula_ingredients i where i.company_id=c and i.formula_id=f.id and i.material_id::text=k.material and (i.line_kind='packaging' or i.line_kind='auxiliary' and i.quantity_basis='unit'))) then raise exception 'Solo puedes asignar por unidad empaque e insumos de la fórmula';end if;
   for m in select i.material_id,rm.name,bc.cost,u.symbol,bc.base_quantity,
     (select (a->>'quantity')::numeric from jsonb_array_elements(payload->'consumptions') a where a->>'material'=i.material_id::text) consumed_quantity
    from public.formula_ingredients i join public.raw_materials rm on rm.company_id=i.company_id and rm.id=i.material_id
    join public.units u on u.company_id=i.company_id and u.id=i.unit_id
    join public.batch_consumptions bc on bc.company_id=i.company_id and bc.material_id=i.material_id and bc.batch_id=bid
    where i.company_id=c and i.formula_id=f.id and (i.line_kind='packaging' or i.line_kind='auxiliary' and i.quantity_basis='unit') loop
    actual_qty:=m.consumed_quantity;
    qty:=coalesce(nullif(o->'unit_materials'->(w.ordinality::integer-1)->>m.material_id::text,'')::numeric,actual_qty/n);
    if qty is null or qty<0 or qty>=1e12 or qty='NaN'::numeric then raise exception 'Cantidad inválida en consumo individual de %',m.name;end if;
    assigned:=case when actual_qty=0 and qty=0 then 0 when actual_qty>0 then m.cost*qty/actual_qty end;
    if assigned is null then cost_known:=false;else unit_material_cost:=unit_material_cost+assigned;end if;
    allocations:=allocations||jsonb_build_array(jsonb_build_object('material_id',m.material_id,'name',m.name,'quantity',qty,'unit',m.symbol,'cost',assigned));
   end loop;
   manufacturing:=case when cost_known then common_total*(w.value#>>'{}')::numeric/wtotal+unit_material_cost end;
   units:=units||jsonb_build_array(jsonb_build_object('variant_id',o->>'variant','position',w.ordinality,'weight',(w.value#>>'{}')::numeric,
    'manufacturing_cost',manufacturing,'commercial_cost',commercial,'total_cost',manufacturing+commercial,'currency',cc,
    'formula_id',f.id,'formula_code',code,'formula_version',f.version,'batch_id',bid,'batch_number',b.batch_number,
    'price_reference',ref,'commercial_lines',quote->'cost_lines','material_allocations',allocations,
    'margin',price-manufacturing-commercial,'margin_on_sale_percent',(price-manufacturing-commercial)/nullif(price,0)*100,
    'markup_on_cost_percent',(price-manufacturing-commercial)/nullif(manufacturing+commercial,0)*100));
  end loop;
 end loop;
 for m in select i.material_id,rm.name,(a->>'quantity')::numeric consumed_quantity
 from public.formula_ingredients i join public.raw_materials rm on rm.company_id=i.company_id and rm.id=i.material_id
 join lateral(select value a from jsonb_array_elements(payload->'consumptions') where value->>'material'=i.material_id::text)actual on true
 where i.company_id=c and i.formula_id=f.id and (i.line_kind='packaging' or i.line_kind='auxiliary' and i.quantity_basis='unit') loop
  select sum((allocation->>'quantity')::numeric) into allocation_sum from jsonb_array_elements(units) unit_line cross join lateral jsonb_array_elements(unit_line->'material_allocations') allocation where allocation->>'material_id'=m.material_id::text;
  if allocation_sum is null or abs(allocation_sum-m.consumed_quantity)>0.000001 then raise exception 'El consumo individual de % suma %, pero el consumo real del lote es %',m.name,allocation_sum,m.consumed_quantity;end if;
 end loop;
 select case when bool_and(u->>'manufacturing_cost' is not null)then sum((u->>'manufacturing_cost')::numeric)end,
 case when bool_and(u->>'commercial_cost' is not null)then sum((u->>'commercial_cost')::numeric)end
 into manufacturing_total,commercial_total from jsonb_array_elements(units)u;
 all_total:=manufacturing_total+commercial_total;
 return jsonb_build_object('batch_id',bid,'production_mode','variable_weight','unit_count',n,'total_weight',wtotal,'cost_per_gram',common_total/wtotal,
 'common_manufacturing_cost',common_total,'per_unit_materials_total',case when per_known then per_material end,'fixed_costs',fixed_quote,
 'manufacturing_total',manufacturing_total,'commercial_total',commercial_total,'total_cost',all_total,'units',units,'currency',cc);
end $$;
revoke all on function access_private.variable_cost_plan(uuid,uuid,jsonb) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION access_private.formula_command(c uuid, action text, k uuid DEFAULT NULL::uuid, data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare src public.formulas%rowtype;f public.formulas%rowtype;mat public.raw_materials%rowtype;u public.units%rowtype;tu public.units%rowtype;
 cached access_private.operation_requests%rowtype;fid uuid;family uuid;product uuid;ver integer;code text;capture text;kind text;status text;qty numeric;pct numeric;total numeric;sum_pct numeric:=0;dimensions integer;sum_base numeric;
 lines jsonb:='[]';r jsonb;duplicates jsonb;signature jsonb;answer jsonb;begin
 if auth.uid() is null or not public.company_permission(c,case when action='list' then 'read' else 'write' end,'production') then raise exception 'Fórmulas no autorizadas' using errcode='42501';end if;
 if action='list' then return coalesce((select jsonb_agg(to_jsonb(fm)||jsonb_build_object('locked',access_private.formula_locked(c,fm.id),'used_batches',coalesce((select jsonb_agg(jsonb_build_object('id',pb.id,'batch_number',pb.batch_number,'state',pb.state,'confirmed',pb.confirmed,'production_date',pb.production_date) order by pb.created_at desc) from public.production_batches pb where pb.company_id=c and pb.formula_id=fm.id),'[]'),'overhead_lines',coalesce((select jsonb_agg(jsonb_build_object('cost_id',ol.cost_id,'quantity',ol.quantity,'percent',ol.percent) order by ol.cost_id) from public.formula_overhead_lines ol where ol.company_id=c and ol.formula_id=fm.id),'[]'),'own_reference',ff.own_reference,'formula_origen_id',ff.formula_origen_id,'code',ff.code,'product_name',p.name,'ingredients',coalesce((select jsonb_agg(to_jsonb(i)||jsonb_build_object('name',rm.name,'unit',un.symbol) order by line_kind,rm.name) from public.formula_ingredients i join public.raw_materials rm on rm.company_id=i.company_id and rm.id=i.material_id join public.units un on un.company_id=i.company_id and un.id=i.unit_id where i.company_id=c and i.formula_id=fm.id),'[]')) order by ff.code,fm.version desc) from public.formulas fm join public.formula_families ff on ff.company_id=fm.company_id and ff.id=fm.family_id join public.products p on p.company_id=fm.company_id and p.id=fm.product_id where fm.company_id=c),'[]');end if;
 if action not in('save','state','edit','notes') or k is null then raise exception 'Acción inválida';end if;
 perform pg_advisory_xact_lock(hashtextextended(c::text,0));
 if data->>'production_mode'='variable_weight' then data:=data||jsonb_build_object('estimate_variant_id','','estimate_unit_id','','quantity_per_unit','');end if;
 select * into cached from access_private.operation_requests where company_id=c and key=k;
 if found then if cached.action<>'formula_'||action or cached.payload<>data then raise exception 'Identificador utilizado con otros datos';end if;return cached.result;end if;
 if action='notes' then
  if data ? 'own_reference' then
   update public.formula_families ff set own_reference=data->>'own_reference' from public.formulas rf where rf.company_id=c and rf.id=(data->>'id')::uuid and ff.company_id=c and ff.id=rf.family_id;
  end if;
 
  if length(coalesce(data->>'admin_notes',''))>4000 then raise exception 'Las notas administrativas admiten 4000 caracteres';end if;
  update public.formulas set admin_notes=coalesce(data->>'admin_notes','') where company_id=c and id=(data->>'id')::uuid returning id into fid;
  if not found then raise exception 'Fórmula no disponible';end if;answer:=jsonb_build_object('id',fid);
 elsif action='state' then
  status:=data->>'state';if coalesce(status,'') not in('testing','current','inactive') then raise exception 'Estado inválido';end if;
  select * into strict f from public.formulas where company_id=c and id=(data->>'id')::uuid;
  if status='current' then update public.formulas set state='inactive' where company_id=c and family_id=f.family_id and state='current' and id<>f.id;end if;
  update public.formulas set state=status where company_id=c and id=f.id;answer:=jsonb_build_object('id',f.id);
 else
  if length(data::text)>80000 then raise exception 'Fórmula demasiado extensa';end if;
  if coalesce(data->>'kind','') not in('new','version','variation','duplicate','edit') then raise exception 'Selecciona la acción de fórmula';end if;
  if data->>'kind'<>'new' then select * into strict src from public.formulas where company_id=c and id=(data->>'source')::uuid;end if;
  
  if (action='edit' and data->>'kind'<>'edit') or (action='save' and data->>'kind'='edit') then raise exception 'Acción y modalidad incompatibles';end if;
  if action='edit' then
   if access_private.formula_locked(c,src.id) then raise exception 'La versión ya se utilizó en producción confirmada. Crea una nueva versión' using errcode='55000';end if;
   if (data->>'edit_revision')::integer is distinct from src.edit_revision then raise exception 'La fórmula cambió mientras la editabas. Actualiza antes de guardar' using errcode='40001';end if;
  end if;
  
 if coalesce(jsonb_typeof(data->'overhead_lines'),'array')<>'array' or jsonb_array_length(coalesce(data->'overhead_lines','[]'))>100 then raise exception 'Añade hasta 100 conceptos de Costos adicionales';end if;
 if exists(select 1 from jsonb_array_elements(coalesce(data->'overhead_lines','[]')) e group by e->>'cost_id' having count(*)>1) then raise exception 'Un concepto de Costos adicionales solo puede aparecer una vez';end if;
 if exists(select 1 from jsonb_array_elements(coalesce(data->'overhead_lines','[]')) e left join public.additional_cost_catalog ac on ac.company_id=c and ac.id=(e->>'cost_id')::uuid 
 where ac.id is null or not coalesce((e->>'quantity')::numeric>0 and (e->>'quantity')::numeric<1e12,false)
 or (ac.kind<>'overhead' and e->>'percent' is not null and not coalesce((e->>'percent')::numeric>=0 and (e->>'percent')::numeric<=100,false)) or (not ac.active and not(action='edit' and exists(select 1 from public.formula_overhead_lines old_line where old_line.company_id=c and old_line.formula_id=src.id and old_line.cost_id=ac.id)))) then raise exception 'Revisa los conceptos activos y las cantidades de Costos adicionales';end if;
 if coalesce(data->>'production_mode','fixed') not in('fixed','variable_weight') then raise exception 'Modalidad de producción inválida';end if;
 product:=(data->>'product')::uuid;
  perform 1 from public.additional_cost_catalog x where x.company_id=c and (
   (x.id=nullif(data->>'labor_level_id','')::uuid and (x.kind<>'labor' or (not x.active and not(action='edit' and x.id is not distinct from src.labor_level_id)))) or
   (x.id=nullif(data->>'advertising_level_id','')::uuid and (x.kind<>'advertising' or (not x.active and not(action='edit' and x.id is not distinct from src.advertising_level_id)))));
  if found then raise exception 'Selecciona niveles activos del catálogo correspondiente';end if;
 
 if nullif(data->>'estimate_variant_id','') is not null and not exists(select 1 from public.product_variants ev where ev.company_id=c and ev.id=(data->>'estimate_variant_id')::uuid and ev.product_id=product and ev.active) then raise exception 'La presentación no pertenece al producto o está archivada';end if;
 
  if nullif(data->>'estimate_unit_id','') is not null and not exists(
   select 1 from public.units eu join public.products ep on ep.company_id=eu.company_id and ep.id=product
   left join public.units pu on pu.company_id=ep.company_id and pu.id=ep.unit_id
   where eu.company_id=c and eu.id=(data->>'estimate_unit_id')::uuid and eu.active and (eu.dimension=pu.dimension or (eu.dimension='mass' and exists(select 1 from public.product_variants ev where ev.company_id=c and ev.product_id=product and ev.id=nullif(data->>'estimate_variant_id','')::uuid and ev.weight_min is not null))) and lower(eu.symbol) in('g','kg','ml','l')
  ) then raise exception 'Selecciona una presentación compatible con el producto';end if;
 
  if data->>'kind' in('version','variation','edit') and product is distinct from src.product_id then raise exception 'Una versión o variación pertenece al mismo producto';end if;
  perform 1 from public.products where company_id=c and id=product and active;if not found then raise exception 'Producto no disponible';end if;
  capture:=coalesce(data->>'capture_mode','quantity');status:=coalesce(data->>'state','testing');
  if capture not in('quantity','percentage') or status not in('testing','current','inactive') then raise exception 'Revisa modalidad y estado';end if;
  if coalesce(jsonb_typeof(data->'ingredients'),'')<>'array' or jsonb_array_length(data->'ingredients') not between 1 and 100 then raise exception 'Añade entre 1 y 100 materiales';end if;
  if capture='percentage' then
   total:=nullif(data->>'total_quantity','')::numeric;
   if total is null or not(total>0 and total<1000000000000) then raise exception 'Define la cantidad total a preparar';end if;
   select * into strict tu from public.units where company_id=c and id=(data->>'total_unit')::uuid and active;
  end if;
  for r in select value from jsonb_array_elements(data->'ingredients') loop
   select * into strict mat from public.raw_materials where company_id=c and id=(r->>'material')::uuid and active;
   select * into strict u from public.units where company_id=c and id=(r->>'unit')::uuid and active;
   if u.dimension<>(select dimension from public.units where company_id=c and id=mat.unit_id) then raise exception 'Unidad incompatible con %',mat.name;end if;
   kind:=coalesce(r->>'line_kind','ingredient');if kind not in('ingredient','packaging','auxiliary') then raise exception 'Tipo de material inválido';end if;
   if mat.classification='Material de empaque' and kind='ingredient' then raise exception 'El empaque se registra en su sección independiente';end if;
   if exists(select 1 from jsonb_array_elements(lines) x where x->>'material'=mat.id::text) then raise exception 'La materia prima % ya está incluida; modifica su fila',mat.name;end if;
   
   if length(coalesce(r->>'reference_notes',''))>2000 then raise exception 'Las observaciones admiten hasta 2000 caracteres por renglón';end if;
   if kind='auxiliary' then
    if coalesce(r->>'quantity_basis','batch') not in('batch','unit') then raise exception 'Selecciona Por lote o Por unidad para el insumo';end if;
    if r->>'quantity_basis'='unit' and not coalesce(nullif(data->>'estimated_units','')::numeric>0,false) then raise exception 'Define las unidades estimadas para los insumos por unidad';end if;
   elsif coalesce(r->>'quantity_basis','recipe')<>'recipe' then raise exception 'La composición y el empaque conservan el escalado de la receta';end if;
   pct:=null;
   if capture='percentage' and kind='ingredient' then
    pct:=nullif(r->>'percentage','')::numeric;
    if pct is null or not(pct>0 and pct<=100) then raise exception 'Revisa el porcentaje de %',mat.name;end if;
    if u.dimension<>tu.dimension then raise exception 'No se pueden sumar gramos, mililitros ni conteos sin una conversión válida';end if;
    qty:=round(total*tu.base_factor*pct/100/u.base_factor,8);sum_pct:=sum_pct+pct;
   else qty:=nullif(r->>'quantity','')::numeric;end if;
   if qty is null or not(qty>0 and qty<1000000000000) then raise exception 'Cantidad inválida para %',mat.name;end if;
   lines:=lines||jsonb_build_array(jsonb_build_object('material',mat.id,'unit',u.id,'quantity',round(qty,8),'percentage',pct,'line_kind',kind,'reference_notes',coalesce(r->>'reference_notes',''),'quantity_basis',case when kind='auxiliary' then coalesce(r->>'quantity_basis','batch') else 'recipe' end,'base',round(qty*u.base_factor,8),'dimension',u.dimension,'density_g_ml',nullif(r->>'density_g_ml','')::numeric));
  end loop;
  if not exists(select 1 from jsonb_array_elements(lines)x where x->>'line_kind'='ingredient') then raise exception 'Añade al menos una materia prima';end if;
  if capture='percentage' and abs(sum_pct-100)>0.000001 then raise exception 'Los porcentajes deben sumar 100 %% (actual: %)',sum_pct;end if;
  select count(distinct x->>'dimension'),sum((x->>'base')::numeric) into dimensions,sum_base from jsonb_array_elements(lines)x where x->>'line_kind'='ingredient';
  if data->>'kind'='edit' then family:=src.family_id;ver:=src.version;elsif data->>'kind'='version' then family:=src.family_id;ver:=(select coalesce(max(version),0)+1 from public.formulas where company_id=c and family_id=family);
  else family:=null;ver:=1;end if;
  select jsonb_agg(jsonb_build_array(x->>'material',x->>'line_kind',x->>'quantity_basis',(x->>'base')::numeric) order by x->>'material') into signature from jsonb_array_elements(lines)x;
  select coalesce(jsonb_agg(to_jsonb(z)),'[]') into duplicates from(select fm.id,ff.code,fm.name,fm.version from public.formulas fm join public.formula_families ff on ff.company_id=fm.company_id and ff.id=fm.family_id
    where fm.company_id=c and fm.product_id=product and (family is null or fm.family_id<>family) and signature=(select jsonb_agg(jsonb_build_array(i.material_id::text,i.line_kind,i.quantity_basis,round(i.quantity*un.base_factor,8)) order by i.material_id::text) from public.formula_ingredients i join public.units un on un.company_id=i.company_id and un.id=i.unit_id where i.company_id=c and i.formula_id=fm.id) order by ff.code,fm.version desc limit 10)z;
  if jsonb_array_length(duplicates)>0 and not coalesce((data->>'confirm_duplicate')::boolean,false) then return jsonb_build_object('duplicates',duplicates);end if;
  if family is null then
   code:=access_private.next_formula_code(c);
   insert into public.formula_families(company_id,product_id,code,formula_origen_id,own_reference) values(c,product,code,case when data->>'kind'='variation' then (select formula_origen_id from public.formula_families where company_id=c and id=src.family_id) else null end,nullif(btrim(data->>'own_reference'),'')) returning id into family;
  end if;
  if status='current' then update public.formulas set state='inactive' where company_id=c and family_id=family and state='current';end if;
  
  if action='edit' then
   update public.formulas set name=trim(data->>'name'),state=status,capture_mode=capture,total_quantity=case when capture='percentage' then total else null end,total_unit_id=case when capture='percentage' then tu.id else null end,loss_enabled=coalesce((data->>'loss_enabled')::boolean,false),loss_percent=coalesce(nullif(data->>'loss_percent','')::numeric,5),admin_notes=coalesce(data->>'admin_notes',src.admin_notes),edit_revision=edit_revision+1 where company_id=c and id=src.id;
   fid:=src.id;delete from public.formula_ingredients where company_id=c and formula_id=fid;
  else insert into public.formulas(company_id,product_id,family_id,name,version,standard_yield,state,capture_mode,total_quantity,total_unit_id,loss_enabled,loss_percent,source_formula_id,origin_action)
    values(c,product,family,trim(data->>'name'),ver,null,status,capture,case when capture='percentage' then total else null end,case when capture='percentage' then tu.id else null end,coalesce((data->>'loss_enabled')::boolean,false),coalesce(nullif(data->>'loss_percent','')::numeric,5),src.id,data->>'kind') returning id into fid; update public.formulas set admin_notes=coalesce(data->>'admin_notes','') where company_id=c and id=fid; end if;
  
  update public.formulas set production_mode=coalesce(data->>'production_mode','fixed'),labor_level_id=nullif(data->>'labor_level_id','')::uuid,advertising_level_id=nullif(data->>'advertising_level_id','')::uuid,estimate_variant_id=nullif(data->>'estimate_variant_id','')::uuid,estimated_units=nullif(data->>'estimated_units','')::numeric,estimate_unit_id=nullif(data->>'estimate_unit_id','')::uuid,quantity_per_unit=nullif(data->>'quantity_per_unit','')::numeric where company_id=c and id=fid;
  if data ? 'own_reference' then update public.formula_families set own_reference=data->>'own_reference' where company_id=c and id=family;end if;
  for r in select value from jsonb_array_elements(lines) loop
   insert into public.formula_ingredients(company_id,formula_id,material_id,quantity,unit_id,line_kind,percentage,density_g_ml,reference_notes,quantity_basis)
   values(c,fid,(r->>'material')::uuid,(r->>'quantity')::numeric,(r->>'unit')::uuid,r->>'line_kind',case when r->>'line_kind'<>'ingredient' or dimensions<>1 then null when capture='percentage' then(r->>'percentage')::numeric else round((r->>'base')::numeric/sum_base*100,8) end,(r->>'density_g_ml')::numeric,r->>'reference_notes',r->>'quantity_basis');
  end loop;
 delete from public.formula_overhead_lines where company_id=c and formula_id=fid;
 insert into public.formula_overhead_lines(company_id,formula_id,cost_id,quantity,percent) select c,fid,(e->>'cost_id')::uuid,(e->>'quantity')::numeric,nullif(e->>'percent','')::numeric from jsonb_array_elements(coalesce(data->'overhead_lines','[]')) e;
 answer:=jsonb_build_object('id',fid,'version',ver);
 end if;
 insert into access_private.operation_requests(company_id,key,action,payload,result) values(c,k,'formula_'||action,data,answer);return answer;
end $function$;

CREATE OR REPLACE FUNCTION access_private.operations(p_company uuid, p_action text, p_key uuid DEFAULT NULL::uuid, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare module text; cached access_private.operation_requests%rowtype; v_result jsonb:='{}'; r jsonb; x record; m public.raw_materials%rowtype; u public.units%rowtype; base public.units%rowtype; v public.product_variants%rowtype; b public.production_batches%rowtype; f public.formulas%rowtype; q numeric; converted numeric; amount numeric; rate numeric; v_id uuid; parent uuid; code text; n bigint; total numeric:=0; known boolean:=true; weight_sum numeric:=0; qty_sum integer:=0; v_kind text; price_currency text; weighed_item jsonb; weighed_sum numeric; weighed_value numeric;variable_plan jsonb;
begin
 module:=case when p_action in('variants','variant_save','presentation_codes') then 'catalog' when p_action in('inventory','receive','adjust','receipts') then 'inventory' when p_action in('formulas','formula_create','batches','batch_start','batch_finish','batch_release','production_catalog') then 'production' else null end;
 if auth.uid() is null or module is null or not access_private.company_permission(p_company,case when p_action in('variants','inventory','receipts','formulas','batches','production_catalog') then 'read' else 'write' end,module) then raise exception 'Operación no autorizada para esta empresa' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company::text,0));
 if not access_private.company_permission(p_company,case when p_action in('variants','inventory','receipts','formulas','batches','production_catalog') then 'read' else 'write' end,module) then raise exception 'Permiso revocado' using errcode='42501';end if;
 if p_action='inventory' then
  return jsonb_build_object('balances',coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('name',case when s.item_kind='material' then rm.name else pr.name||' · '||access_private.variant_label(to_jsonb(pv)) end,'sku',case when s.item_kind='material' then rm.sku else pv.sku end,'barcode',case when s.item_kind='material' then rm.barcode else pv.barcode end,'unit',case when s.item_kind='material' then un.symbol else 'ud' end,'classification',rm.classification,'origin_id',case when s.item_kind='material' then rm.origin_id else pr.origin_id end,'available',s.on_hand-s.blocked-s.reserved)) from public.inventory_balances s left join public.raw_materials rm on rm.company_id=s.company_id and rm.id=s.item_id and s.item_kind='material' left join public.units un on un.company_id=rm.company_id and un.id=rm.unit_id left join public.product_variants pv on pv.company_id=s.company_id and pv.id=s.item_id and s.item_kind='variant' left join public.products pr on pr.company_id=pv.company_id and pr.id=pv.product_id where s.company_id=p_company),'[]'),'materials',coalesce((select jsonb_agg(jsonb_build_object('id',rm.id,'name',rm.name,'unit_id',rm.unit_id,'sku',rm.sku)) from public.raw_materials rm where rm.company_id=p_company and rm.active),'[]'),'variants',coalesce((select jsonb_agg(jsonb_build_object('id',pv.id,'name',p.name||' · '||access_private.variant_label(to_jsonb(pv)),'sku',pv.sku,'product_id',pv.product_id,'attributes',pv.attributes,'weight_min',pv.weight_min,'weight_max',pv.weight_max)) from public.product_variants pv join public.products p on p.company_id=pv.company_id and p.id=pv.product_id where pv.company_id=p_company and pv.active),'[]'),'units',coalesce((select jsonb_agg(to_jsonb(un)) from public.units un where un.company_id=p_company and active),'[]'),'suppliers',coalesce((select jsonb_agg(jsonb_build_object('id',suppliers.id,'name',suppliers.name)) from public.suppliers where company_id=p_company and active),'[]'),'movements',coalesce((select jsonb_agg(to_jsonb(z)) from(select * from public.inventory_movements where company_id=p_company order by created_at desc limit 100)z),'[]'));
 elsif p_action='variants' then return coalesce((select jsonb_agg(to_jsonb(pv)||jsonb_build_object('currency',(select currency from public.companies where id=p_company),'price',access_private.base_sale_price(pv.company_id,pv.id),'available',coalesce(s.on_hand-s.blocked-s.reserved,0),'on_hand',coalesce(s.on_hand,0),'blocked',coalesce(s.blocked,0))) from public.product_variants pv left join public.inventory_balances s on s.company_id=pv.company_id and s.item_id=pv.id and s.item_kind='variant' where pv.company_id=p_company and pv.product_id=(p_data->>'product')::uuid),'[]');
 elsif p_action='receipts' then return coalesce((select jsonb_agg(to_jsonb(z)) from(select rc.*,rm.name as material_name from public.purchase_receipts rc join public.raw_materials rm on rm.company_id=rc.company_id and rm.id=rc.material_id where rc.company_id=p_company order by rc.created_at desc limit 100)z),'[]');
 elsif p_action='formulas' then return coalesce((select jsonb_agg(to_jsonb(fm)||jsonb_build_object('product_name',p.name,'ingredients',(select jsonb_agg(to_jsonb(i)||jsonb_build_object('name',rm.name,'unit',un.symbol)) from public.formula_ingredients i join public.raw_materials rm on rm.company_id=i.company_id and rm.id=i.material_id join public.units un on un.company_id=i.company_id and un.id=i.unit_id where i.company_id=fm.company_id and i.formula_id=fm.id))) from public.formulas fm join public.products p on p.company_id=fm.company_id and p.id=fm.product_id where fm.company_id=p_company),'[]');
 elsif p_action='batches' then return coalesce((select jsonb_agg(to_jsonb(pb)||jsonb_build_object('product_name',p.name,'outputs',coalesce((select jsonb_agg(to_jsonb(o)||jsonb_build_object('variant_name',access_private.variant_label(to_jsonb(pv)))) from public.batch_outputs o join public.product_variants pv on pv.company_id=o.company_id and pv.id=o.variant_id where o.company_id=pb.company_id and o.batch_id=pb.id),'[]'))) from public.production_batches pb join public.products p on p.company_id=pb.company_id and p.id=pb.product_id where pb.company_id=p_company),'[]');
 elsif p_action='production_catalog' then return jsonb_build_object('products',coalesce((select jsonb_agg(jsonb_build_object('id',products.id,'name',products.name)) from public.products where company_id=p_company and active),'[]'),'materials',coalesce((select jsonb_agg(jsonb_build_object('id',raw_materials.id,'name',raw_materials.name,'unit_id',raw_materials.unit_id)) from public.raw_materials where company_id=p_company and active),'[]'),'units',coalesce((select jsonb_agg(to_jsonb(un)) from public.units un where un.company_id=p_company and active),'[]'),'variants',coalesce((select jsonb_agg(to_jsonb(pv)) from public.product_variants pv where company_id=p_company and active),'[]'));
 end if;
 if p_key is null then raise exception 'Falta identificador de operación';end if;
 select * into cached from access_private.operation_requests where company_id=p_company and key=p_key;
 if found then if cached.action<>p_action or cached.payload<>p_data then raise exception 'La clave de operación ya se utilizó con otros datos';end if;return cached.result;end if;
 insert into access_private.operation_requests(company_id,key,action,payload) values(p_company,p_key,p_action,p_data);
 if p_action='variant_save' then
  parent:=(p_data->>'product')::uuid;select * into strict x from public.products where company_id=p_company and products.id=parent and active;
  v_id:=nullif(p_data->>'id','')::uuid;code:=case when v_id is null then null else (select sku from public.product_variants where company_id=p_company and product_id=parent and id=v_id) end;
 if v_id is not null and p_data ? 'sku' and nullif(trim(p_data->>'sku'),'') is distinct from code then raise exception 'El SKU es automático. Utiliza Código comercial';end if;
  if v_id is null and code is null then
   if x.sku is null then update public.products set sku=catalog_private.reserve_sku(p_company,'P') where company_id=p_company and products.id=parent returning * into x;end if;
   loop
    insert into access_private.child_code_counters(company_id,kind,parent_id,last_value) values(p_company,'variant',parent,1) on conflict(company_id,kind,parent_id) do update set last_value=access_private.child_code_counters.last_value+1 returning last_value into n;
    code:=x.sku||'-'||case when n<100 then lpad(n::text,2,'0') else n::text end;
    exit when not exists(select 1 from public.catalog_identifiers where company_id=p_company and (public.catalog_key(sku)=public.catalog_key(code) or public.catalog_key(barcode)=public.catalog_key(code)));
   end loop;
  end if;
  if v_id is null then
   insert into public.product_variants(company_id,product_id,name,commercial_code,sku,barcode,barcode_custom,attributes,weight_min,weight_max,price,currency,published,allow_preorder,active) values(p_company,parent,coalesce(trim(p_data->>'name'),''),nullif(trim(p_data->>'commercial_code'),''),code,nullif(trim(p_data->>'barcode'),''),coalesce((p_data->>'barcode_custom')::boolean,false),access_private.normalize_attributes(coalesce(p_data->'attributes','{}')),nullif(p_data->>'weight_min','')::numeric,nullif(p_data->>'weight_max','')::numeric,null::numeric,(select currency from public.companies where companies.id=p_company),coalesce((p_data->>'published')::boolean,false),coalesce((p_data->>'allow_preorder')::boolean,false),coalesce((p_data->>'active')::boolean,true)) returning product_variants.id into v_id;
  else
   update public.product_variants set name=coalesce(trim(p_data->>'name'),''),commercial_code=case when p_data ? 'commercial_code' then nullif(trim(p_data->>'commercial_code'),'') else commercial_code end,sku=code,barcode=nullif(trim(p_data->>'barcode'),''),barcode_custom=coalesce((p_data->>'barcode_custom')::boolean,false),attributes=access_private.normalize_attributes(coalesce(p_data->'attributes','{}')),weight_min=nullif(p_data->>'weight_min','')::numeric,weight_max=nullif(p_data->>'weight_max','')::numeric,currency=(select currency from public.companies where companies.id=p_company),published=coalesce((p_data->>'published')::boolean,false),active=coalesce((p_data->>'active')::boolean,true),allow_preorder=coalesce((p_data->>'allow_preorder')::boolean,false) where company_id=p_company and product_id=parent and product_variants.id=v_id;
   if not found then raise exception 'Variante no disponible';end if;
  end if;v_result:=jsonb_build_object('id',v_id);
 elsif p_action='presentation_codes' then
  v_id:=(p_data->>'id')::uuid;
  update public.presentations set sku=nullif(trim(p_data->>'sku'),''),barcode=nullif(trim(p_data->>'barcode'),''),barcode_custom=coalesce((p_data->>'barcode_custom')::boolean,false),alternative_name=coalesce(p_data->>'alternative_name','') where company_id=p_company and presentations.id=v_id;
  if not found then raise exception 'Presentación no disponible';end if;v_result:=jsonb_build_object('id',v_id);
 elsif p_action='receive' then
  select * into strict m from public.raw_materials where company_id=p_company and raw_materials.id=(p_data->>'material')::uuid and active;
  select * into strict u from public.units where company_id=p_company and units.id=(p_data->>'unit')::uuid and active;
  select * into strict base from public.units where company_id=p_company and units.id=m.unit_id;
  if u.dimension<>base.dimension then raise exception 'No se puede convertir entre masa, volumen y conteo sin una conversión definida';end if;
  q:=(p_data->>'quantity')::numeric;amount:=(p_data->>'amount')::numeric;rate:=coalesce(nullif(p_data->>'exchange_rate','')::numeric,1);converted:=q*u.base_factor/base.base_factor;
  select currency into price_currency from public.companies where companies.id=p_company;
  if coalesce(p_data->>'currency',price_currency)<>price_currency and nullif(p_data->>'exchange_rate','') is null then raise exception 'Indica el tipo de cambio de la compra';end if;
  if coalesce(p_data->>'currency',price_currency)=price_currency then rate:=1;end if;
  if not exists(select 1 from public.currencies where currencies.code=coalesce(p_data->>'currency',price_currency) and active) then raise exception 'Moneda no válida';end if;
  if (p_data->>'date')::date>current_date then raise exception 'Una compra futura no puede recibirse todavía';end if;
  insert into public.purchase_receipts(company_id,material_id,supplier_id,presentation_id,quantity,unit_id,base_quantity,amount,currency,valuation_currency,exchange_rate,received_on,reference) values(p_company,m.id,nullif(p_data->>'supplier','')::uuid,nullif(p_data->>'presentation','')::uuid,q,u.id,converted,amount,coalesce(p_data->>'currency',price_currency),price_currency,rate,(p_data->>'date')::date,coalesce(p_data->>'reference','')) returning purchase_receipts.id into v_id;
  if nullif(p_data->>'presentation','') is not null and not exists(select 1 from public.presentations where company_id=p_company and presentations.id=(p_data->>'presentation')::uuid and raw_material_id=m.id) then raise exception 'La presentación no corresponde al material';end if;
  v_result:=access_private.post_stock(p_company,'material',m.id,converted,0,0,'receipt',v_id,amount*rate/converted,coalesce(p_data->>'reference',''))||jsonb_build_object('id',v_id);
 elsif p_action='adjust' then
  v_kind:=p_data->>'kind';v_id:=(p_data->>'item')::uuid;q:=(p_data->>'quantity')::numeric;
  if q=0 or q='NaN'::numeric or length(trim(coalesce(p_data->>'reason','')))<3 then raise exception 'Indica cantidad y motivo del ajuste';end if;
  if v_kind='material' then perform 1 from public.raw_materials where company_id=p_company and raw_materials.id=v_id;
  elsif v_kind='variant' then perform 1 from public.product_variants where company_id=p_company and product_variants.id=v_id;
  else raise exception 'Tipo no válido';end if;
  if not found then raise exception 'Registro no disponible';end if;
  if q<0 and coalesce((select on_hand-blocked-reserved from public.inventory_balances where company_id=p_company and inventory_balances.item_kind=v_kind and item_id=v_id),0)<-q then raise exception 'El ajuste excede las existencias disponibles';end if;
  
  if v_kind='variant' and q>0 and exists(select 1 from public.product_variants pv where pv.company_id=p_company and pv.id=v_id and pv.weight_min is not null) then
   select * into strict v from public.product_variants where company_id=p_company and id=v_id;
   if coalesce(jsonb_typeof(p_data->'unit_weights'),'')<>'array' or jsonb_array_length(p_data->'unit_weights')<>q or q>10000 then raise exception 'Registra un peso real por cada unidad que se agrega';end if;
   for x in select resolved.variant_id,jsonb_agg(resolved.w) weights,count(*) qty from(
    select e.value w,access_private.match_weight_variant(p_company,v.product_id,v.attributes,(e.value#>>'{}')::numeric) variant_id from jsonb_array_elements(p_data->'unit_weights')e
   )resolved group by resolved.variant_id loop
    v_result:=access_private.post_stock(p_company,'variant',x.variant_id,x.qty,0,0,'adjustment',case when x.variant_id=v_id then p_key else gen_random_uuid() end,nullif(p_data->>'unit_cost','')::numeric,p_data->>'reason');
    insert into public.inventory_units(company_id,lot_id,variant_id,weight,variant_snapshot,status,last_movement_id)
    select p_company,(v_result->>'lot')::uuid,pv.id,(w.value#>>'{}')::numeric,
     jsonb_build_object('name',access_private.variant_label(to_jsonb(pv)),'sku',pv.sku,'attributes',pv.attributes,'weight_min',pv.weight_min,'weight_max',pv.weight_max,'product_name',pr.name,'product_sku',pr.sku,'origin','adjustment'),
     'available',(v_result->>'movement')::uuid
    from jsonb_array_elements(x.weights)w join public.product_variants pv on pv.company_id=p_company and pv.id=x.variant_id join public.products pr on pr.company_id=pv.company_id and pr.id=pv.product_id;
   end loop;v_result:=jsonb_build_object('units',q);
  else
   v_result:=access_private.post_stock(p_company,v_kind,v_id,q,0,0,'adjustment',p_key,nullif(p_data->>'unit_cost','')::numeric,p_data->>'reason');
  end if;
 
 elsif p_action='formula_create' then
  parent:=(p_data->>'product')::uuid;perform 1 from public.products where company_id=p_company and products.id=parent and active;if not found then raise exception 'Producto no disponible';end if;
  insert into public.formulas(company_id,product_id,name,version,standard_yield) values(p_company,parent,trim(p_data->>'name'),coalesce((select max(version) from public.formulas where company_id=p_company and product_id=parent),0)+1,(p_data->>'yield')::integer) returning formulas.id into v_id;
  if coalesce(jsonb_typeof(p_data->'ingredients'),'')<>'array' or jsonb_array_length(p_data->'ingredients') not between 1 and 100 then raise exception 'Añade entre 1 y 100 ingredientes';end if;
  for r in select value from jsonb_array_elements(p_data->'ingredients') loop
   select * into strict m from public.raw_materials where company_id=p_company and raw_materials.id=(r->>'material')::uuid and active;
   select * into strict u from public.units where company_id=p_company and units.id=(r->>'unit')::uuid and active;
   if u.dimension<>(select dimension from public.units where company_id=p_company and units.id=m.unit_id) then raise exception 'Unidad incompatible con el material';end if;
   insert into public.formula_ingredients(company_id,formula_id,material_id,quantity,unit_id) values(p_company,v_id,m.id,(r->>'quantity')::numeric,u.id);
  end loop;v_result:=jsonb_build_object('id',v_id);
 elsif p_action='batch_start' then
  select * into strict f from public.formulas where company_id=p_company and formulas.id=(p_data->>'formula')::uuid;
  if f.state='inactive' then raise exception 'Selecciona una versión vigente o en pruebas';end if; insert into public.production_batches(company_id,product_id,formula_id,planned_quantity,formula_scale,production_date,available_on,currency,notes) values(p_company,f.product_id,f.id,(p_data->>'quantity')::integer,coalesce(nullif(p_data->>'formula_scale','')::numeric,case when f.standard_yield is not null then (p_data->>'quantity')::numeric/f.standard_yield else 1 end),(p_data->>'date')::date,(p_data->>'available_on')::date,(select currency from public.companies where companies.id=p_company),coalesce(p_data->>'notes','')) returning production_batches.id into v_id;v_result:=jsonb_build_object('id',v_id);
 elsif p_action='batch_finish' then
  select * into strict b from public.production_batches where company_id=p_company and production_batches.id=(p_data->>'batch')::uuid for update;
  if b.state<>'in_progress' then if b.finish_payload=p_data then v_result:=jsonb_build_object('id',b.id,'state',b.state);update access_private.operation_requests set result=v_result where company_id=p_company and key=p_key;return v_result;end if;raise exception 'Este lote ya fue finalizado';end if;
  
 if nullif(p_data->>'expected_revision','') is not null and (p_data->>'expected_revision')::integer<>(select edit_revision from public.formulas where company_id=p_company and id=b.formula_id) then raise exception 'La fórmula fue corregida mientras preparabas el lote. Actualiza los consumos antes de confirmar' using errcode='40001';end if;
 if b.production_date>current_date then raise exception 'No se puede finalizar una producción futura';end if;
  if coalesce(jsonb_typeof(p_data->'consumptions'),'')<>'array' or coalesce(jsonb_typeof(p_data->'outputs'),'')<>'array' or jsonb_array_length(p_data->'outputs') not between 1 and 100 then raise exception 'Registra consumos reales y variantes obtenidas';end if;
  for r in select value from jsonb_array_elements(p_data->'consumptions') loop
   select * into strict m from public.raw_materials where company_id=p_company and raw_materials.id=(r->>'material')::uuid;
   if not exists(select 1 from public.formula_ingredients where company_id=p_company and formula_id=b.formula_id and material_id=m.id) then raise exception 'Material no incluido en la fórmula';end if;
   select * into strict u from public.units where company_id=p_company and units.id=(r->>'unit')::uuid;
   select * into strict base from public.units where company_id=p_company and units.id=m.unit_id;
   if u.dimension<>base.dimension then raise exception 'Unidad incompatible';end if;
   q:=(r->>'quantity')::numeric;converted:=q*u.base_factor/base.base_factor;
   if converted<0 or converted='NaN'::numeric then raise exception 'Consumo inválido';end if;
   if converted>coalesce((select on_hand-blocked-reserved from public.inventory_balances where company_id=p_company and item_kind='material' and item_id=m.id),0) then raise exception 'Existencias insuficientes de %',m.name;end if;
   insert into public.batch_consumptions(company_id,batch_id,material_id,base_quantity) values(p_company,b.id,m.id,converted) returning batch_consumptions.id into v_id;
   if converted>0 then v_result:=access_private.post_stock(p_company,'material',m.id,-converted,0,0,'production_consumption',v_id,null,'Lote '||b.id);amount:=nullif(v_result->>'cost','')::numeric;else amount:=0;end if;
   if amount is null then known:=false;else total:=total+amount;end if;
   update public.batch_consumptions set cost=amount where company_id=p_company and batch_consumptions.id=v_id;
  end loop;
  if (select count(*) from public.batch_consumptions where company_id=p_company and batch_id=b.id)<>(select count(*) from public.formula_ingredients where company_id=p_company and formula_id=b.formula_id) or not exists(select 1 from public.batch_consumptions where company_id=p_company and batch_id=b.id and base_quantity>0) then raise exception 'Completa el consumo real de todos los materiales';end if;
  for r in select value from jsonb_array_elements(p_data->'outputs') loop
   select * into strict v from public.product_variants where company_id=p_company and product_variants.id=(r->>'variant')::uuid and product_id=b.product_id and active;
   q:=(r->>'quantity')::integer;
   if v.weight_min is not null and not(r ? 'unit_weights') then raise exception 'Esta variante requiere registrar cada unidad por su peso real';end if;
   if r ? 'unit_weights' then
    if jsonb_typeof(r->'unit_weights')<>'array' or jsonb_array_length(r->'unit_weights')<>q or q not between 1 and 10000 then raise exception 'Revisa la cantidad y los pesos individuales de la variante';end if;
    weighed_sum:=0;
    for weighed_item in select value from jsonb_array_elements(r->'unit_weights') loop
     weighed_value:=(weighed_item#>>'{}')::numeric;
     if access_private.match_weight_variant(p_company,b.product_id,v.attributes,weighed_value)<>v.id then raise exception 'El peso % g corresponde a otra variante. Revisa los rangos y vuelve a registrar la unidad',weighed_value;end if;
     weighed_sum:=weighed_sum+weighed_value;
    end loop;
    if nullif(r->>'weight','')::numeric is distinct from weighed_sum then raise exception 'El peso total no coincide con los pesos individuales';end if;
   elsif q=1 and nullif(r->>'weight','') is not null then
    if access_private.match_weight_variant(p_company,b.product_id,v.attributes,(r->>'weight')::numeric)<>v.id then raise exception 'Ese peso corresponde a otra variante. Usa Registrar por peso unitario';end if;
   end if;
   converted:=coalesce(nullif(r->>'weight','')::numeric,(v.weight_min+v.weight_max)/2*q);
   insert into public.batch_outputs(company_id,batch_id,variant_id,quantity,actual_weight,allocation_weight,estimated_cost) values(p_company,b.id,v.id,q,nullif(r->>'weight','')::numeric,converted,nullif(r->>'weight','') is null);
   qty_sum:=qty_sum+q;if converted is null then weight_sum:=null;elsif weight_sum is not null then weight_sum:=weight_sum+converted;end if;
  end loop;
  if (select production_mode from public.formulas where company_id=p_company and id=b.formula_id)='variable_weight' then
   variable_plan:=access_private.variable_cost_plan(p_company,b.id,p_data);
  end if;
  for x in select * from public.batch_outputs where company_id=p_company and batch_id=b.id loop
   if variable_plan is not null then
 select case when bool_and(u->>'manufacturing_cost' is not null)then sum((u->>'manufacturing_cost')::numeric)/x.quantity end into amount from jsonb_array_elements(variable_plan->'units')u where u->>'variant_id'=x.variant_id::text;
 else amount:=case when known and qty_sum>0 then total/qty_sum else null end;end if;
   update public.batch_outputs set unit_cost=amount where company_id=p_company and batch_outputs.id=x.id;
   
   v_result:=access_private.post_stock(p_company,'variant',x.variant_id,x.quantity,x.quantity,0,'production_output',x.id,amount,'Lote '||b.id);
   insert into public.inventory_units(company_id,lot_id,batch_id,output_id,variant_id,weight,variant_snapshot,status,last_movement_id,cost_snapshot)
   select p_company,(v_result->>'lot')::uuid,b.id,x.id,x.variant_id,(w.value#>>'{}')::numeric,
    jsonb_build_object('name',access_private.variant_label(to_jsonb(pv)),'sku',pv.sku,'attributes',pv.attributes,'weight_min',pv.weight_min,'weight_max',pv.weight_max,'product_name',pr.name,'product_sku',pr.sku,'batch_number',b.batch_number),
    'curing',(v_result->>'movement')::uuid,
    (select u from jsonb_array_elements(coalesce(variable_plan->'units','[]'))u where u->>'variant_id'=x.variant_id::text and (u->>'position')::bigint=w.position)
   from jsonb_array_elements(p_data->'outputs') output_line
   cross join lateral jsonb_array_elements(coalesce(output_line->'unit_weights','[]'::jsonb)) with ordinality w(value,position)
   join public.product_variants pv on pv.company_id=p_company and pv.id=x.variant_id
   join public.products pr on pr.company_id=pv.company_id and pr.id=pv.product_id
   where output_line->>'variant'=x.variant_id::text;

  end loop;
  update public.production_batches set currency=(select currency from public.companies where companies.id=p_company),state='curing',actual_quantity=qty_sum,scrap_quantity=coalesce((p_data->>'scrap')::integer,0),actual_weight=case when variable_plan is not null then (variable_plan->>'total_weight')::numeric else nullif(p_data->>'weight','')::numeric end,total_cost=case when known then total else null end,finish_payload=p_data||jsonb_build_object('_server_cost_plan',variable_plan) where company_id=p_company and production_batches.id=b.id;
  v_result:=jsonb_build_object('id',b.id,'state','curing');
 elsif p_action='batch_release' then
  select * into strict b from public.production_batches where company_id=p_company and production_batches.id=(p_data->>'batch')::uuid for update;
  if b.state='released' then v_result:=jsonb_build_object('id',b.id,'state','released');update access_private.operation_requests set result=v_result where company_id=p_company and key=p_key;return v_result;end if;
  if b.state<>'curing' then raise exception 'El lote no está en curado';end if;
  if b.available_on>current_date and (not coalesce((p_data->>'override')::boolean,false) or not access_private.company_permission(p_company,'manage') or length(trim(coalesce(p_data->>'reason','')))<5) then raise exception 'Aún no llega la fecha estimada. La liberación anticipada requiere autorización administrativa y motivo';end if;
  for x in select * from public.batch_outputs where company_id=p_company and batch_id=b.id loop
   perform access_private.post_stock(p_company,'variant',x.variant_id,0,-x.quantity,0,'release',x.id,null,coalesce(p_data->>'reason','Liberación manual'));
   update public.inventory_lots set blocked=false where company_id=p_company and source_kind='production_output' and source_id=x.id;
  end loop;
  update public.production_batches set state='released',release_note=coalesce(p_data->>'reason','Liberación manual') where company_id=p_company and production_batches.id=b.id;v_result:=jsonb_build_object('id',b.id,'state','released');
 end if;
 update access_private.operation_requests set result=v_result where company_id=p_company and key=p_key;
 return v_result;
exception when unique_violation then
 get stacked diagnostics code=constraint_name;
 if code='variant_commercial_code_unique' then raise exception 'Ya existe ese código comercial para el producto y atributos seleccionados';
 elsif code='variant_combination_unique' then raise exception 'Ya existe una variante con el mismo tamaño comercial, atributos y rango de peso';
 else raise; end if;
 when exclusion_violation then raise exception 'Los rangos de peso se solapan con otra variante de los mismos atributos';
end $function$;

CREATE OR REPLACE FUNCTION access_private.physical_unit_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$begin
 if tg_op='UPDATE' then
  if (new.id,new.company_id,new.lot_id,new.batch_id,new.output_id,new.variant_id,new.weight,new.variant_snapshot,new.created_at,new.cost_snapshot) is distinct from (old.id,old.company_id,old.lot_id,old.batch_id,old.output_id,old.variant_id,old.weight,old.variant_snapshot,old.created_at,old.cost_snapshot) then raise exception 'La identidad, peso y variante histórica de una unidad no cambian';end if;
  if old.status in('sold','retired') then raise exception 'La unidad ya salió del inventario';end if;
  if new.last_movement_id=old.last_movement_id then raise exception 'Cada cambio de estado requiere un movimiento';end if;
 end if;
 if not exists(select 1 from public.inventory_movements m where m.company_id=new.company_id and m.id=new.last_movement_id and m.item_kind='variant' and m.item_id=new.variant_id) then raise exception 'Movimiento no válido para esta unidad';end if;
 if new.batch_id is null then
  if not exists(select 1 from public.inventory_lots l where l.company_id=new.company_id and l.id=new.lot_id and l.item_kind='variant' and l.item_id=new.variant_id and l.source_kind='adjustment') then raise exception 'La unidad no corresponde al lote de ajuste';end if;
  if tg_op='INSERT' and new.status<>'available' then raise exception 'Una entrada por ajuste debe estar disponible';end if;
 else
  if not exists(select 1 from public.inventory_lots l join public.batch_outputs o on o.company_id=l.company_id and o.id=new.output_id where l.company_id=new.company_id and l.id=new.lot_id and l.item_kind='variant' and l.item_id=new.variant_id and o.variant_id=new.variant_id and o.batch_id=new.batch_id and l.source_kind='production_output' and l.source_id=o.id) then raise exception 'La unidad no corresponde al lote y variante';end if;
  if tg_op='INSERT' and new.status<>'curing' then raise exception 'La producción inicia en curación';end if;
 end if;return new;end $function$;

CREATE OR REPLACE FUNCTION access_private.batch_trace_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$begin
 perform pg_advisory_xact_lock(hashtextextended(new.company_id::text,0));
 if tg_op='INSERT' then
  if new.batch_number is null then select coalesce(max(batch_number),0)+1 into new.batch_number from public.production_batches where company_id=new.company_id;end if;
  if new.confirmed or new.recipe_snapshot is not null or new.state not in('draft','in_progress') then raise exception 'El lote se confirma desde Producción';end if;
 else
  if row(new.id,new.company_id,new.batch_number) is distinct from row(old.id,old.company_id,old.batch_number) then raise exception 'La identidad del lote no cambia';end if;
  if old.confirmed then
   if (to_jsonb(new)-array['state','release_note']) is distinct from(to_jsonb(old)-array['state','release_note']) then raise exception 'El lote confirmado y su receta histórica son inmutables';end if;
   if new.state<>old.state and not(old.state='curing' and new.state='released') then raise exception 'Transición no válida para un lote confirmado';end if;
  elsif new.state='curing' then
   if old.state<>'in_progress' or new.formula_id is null or new.finish_payload is null then raise exception 'Completa la versión y los consumos antes de confirmar';end if;
   new.recipe_snapshot:=access_private.batch_recipe_snapshot(new.company_id,new.id,new.formula_id,new.product_id,new.formula_scale,new.finish_payload,new.currency,new.total_cost);
   if new.recipe_snapshot is null or jsonb_array_length(new.recipe_snapshot->'lines')<>(select count(*) from public.formula_ingredients where company_id=new.company_id and formula_id=new.formula_id) then raise exception 'No se pudo conservar la receta completa; no se confirmó la producción';end if;
   
   if (select production_mode from public.formulas where company_id=new.company_id and id=new.formula_id)='variable_weight' then
    if new.finish_payload#>>'{_server_cost_plan,batch_id}' is distinct from new.id::text or (new.finish_payload#>>'{_server_cost_plan,unit_count}')::numeric is distinct from new.actual_quantity then raise exception 'No se pudo conservar el reparto de costos por peso';end if;
    new.recipe_snapshot:=new.recipe_snapshot||jsonb_build_object('production_mode','variable_weight','weight_costs',new.finish_payload->'_server_cost_plan',
     'estimated_total_cost',new.finish_payload#>'{_server_cost_plan,total_cost}',
     'estimated_unit_cost',(new.finish_payload#>>'{_server_cost_plan,total_cost}')::numeric/nullif(new.actual_quantity,0));
   else
   new.recipe_snapshot:=new.recipe_snapshot||jsonb_build_object('additional_costs',access_private.additional_cost_quote(new.company_id,new.actual_quantity,(select f.estimate_variant_id from public.formulas f where f.company_id=new.company_id and f.id=new.formula_id),(select f.labor_level_id from public.formulas f where f.company_id=new.company_id and f.id=new.formula_id),(select f.advertising_level_id from public.formulas f where f.company_id=new.company_id and f.id=new.formula_id),coalesce((select jsonb_agg(jsonb_build_object('cost_id',ol.cost_id,'quantity',ol.quantity,'percent',ol.percent)) from public.formula_overhead_lines ol where ol.company_id=new.company_id and ol.formula_id=new.formula_id),'[]')));
   
   new.recipe_snapshot:=jsonb_set(new.recipe_snapshot,'{additional_costs}',(new.recipe_snapshot->'additional_costs')||jsonb_build_object('unit_basis_count',coalesce(nullif(new.actual_quantity,0),(new.recipe_snapshot#>>'{additional_costs,estimated_units}')::numeric),'overhead_unit',(new.recipe_snapshot#>>'{additional_costs,overhead_total}')::numeric/coalesce(nullif(new.actual_quantity,0),(new.recipe_snapshot#>>'{additional_costs,estimated_units}')::numeric),'additional_unit',(new.recipe_snapshot#>>'{additional_costs,additional_total}')::numeric/coalesce(nullif(new.actual_quantity,0),(new.recipe_snapshot#>>'{additional_costs,estimated_units}')::numeric)));
   new.recipe_snapshot:=new.recipe_snapshot||jsonb_build_object('estimated_total_cost',new.total_cost+(new.recipe_snapshot#>>'{additional_costs,additional_total}')::numeric,'estimated_unit_cost',(new.total_cost+(new.recipe_snapshot#>>'{additional_costs,additional_total}')::numeric)/nullif((new.recipe_snapshot#>>'{additional_costs,unit_basis_count}')::numeric,0));
   end if;
   update public.additional_cost_catalog x set used_in_history=true where x.company_id=new.company_id and not x.used_in_history and ((exists(select 1 from public.formula_overhead_lines ol where ol.company_id=new.company_id and ol.formula_id=new.formula_id and ol.cost_id=x.id)) or x.id in(select f.labor_level_id from public.formulas f where f.company_id=new.company_id and f.id=new.formula_id union all select f.advertising_level_id from public.formulas f where f.company_id=new.company_id and f.id=new.formula_id));
   new.confirmed:=true;new.confirmed_at:=now();
  elsif new.confirmed or new.recipe_snapshot is not null then raise exception 'La confirmación requiere el registro transaccional de consumos';end if;
 end if;return new;
end $function$;

CREATE OR REPLACE FUNCTION access_private.post_stock(c uuid, k text, item uuid, q numeric, block_delta numeric, reserve_delta numeric, source text, source_uuid uuid, cost numeric DEFAULT NULL::numeric, note text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare movement uuid;lot public.inventory_lots%rowtype;take numeric;needed numeric;total numeric:=0;known boolean:=true;created_lot uuid;valuation text;available_lot numeric;tracked boolean;changed integer;assigned_cost numeric;assigned_known boolean;begin
 select currency into strict valuation from public.companies where id=c;
 insert into public.inventory_balances(company_id,item_kind,item_id) values(c,k,item) on conflict do nothing;
 update public.inventory_balances set on_hand=on_hand+q,blocked=blocked+block_delta,reserved=reserved+reserve_delta where company_id=c and item_kind=k and item_id=item;
 insert into public.inventory_movements(company_id,item_kind,item_id,quantity,blocked_delta,reserved_delta,source_kind,source_id,notes) values(c,k,item,q,block_delta,reserve_delta,source,source_uuid,note) returning id into movement;
 if q>0 then
  insert into public.inventory_lots(company_id,item_kind,item_id,remaining,currency,unit_cost,blocked,source_kind,source_id) values(c,k,item,q,valuation,cost,block_delta>0,source,source_uuid) returning id into created_lot;
  total:=q*cost;known:=cost is not null;
 elsif q<0 then
  needed:=-q;
  for lot in select il.* from public.inventory_lots il where il.company_id=c and il.item_kind=k and il.item_id=item and not il.blocked and il.remaining>0
   order by case when source='order_dispatch' and exists(select 1 from public.inventory_units u where u.company_id=c and u.lot_id=il.id and u.status='reserved' and u.order_line_id=source_uuid) then 0 else 1 end,il.created_at,il.id for update loop
   select exists(select 1 from public.inventory_units u where u.company_id=c and u.lot_id=lot.id) into tracked;
   available_lot:=lot.remaining;
   if tracked then
    select count(*) into available_lot from public.inventory_units u where u.company_id=c and u.lot_id=lot.id and (u.status='available' or(source='order_dispatch' and u.status='reserved' and u.order_line_id=source_uuid));
   end if;
   take:=least(needed,available_lot);if take<=0 then continue;end if;
   update public.inventory_lots set remaining=remaining-take where company_id=c and id=lot.id;
   assigned_cost:=take*lot.unit_cost;assigned_known:=lot.unit_cost is not null;
   if tracked then
    with picked as(select u.id from public.inventory_units u where u.company_id=c and u.lot_id=lot.id and (u.status='available' or(source='order_dispatch' and u.status='reserved' and u.order_line_id=source_uuid))
     order by (u.status='reserved') desc,u.created_at,u.id limit take::integer for update),
    changed_units as(
     update public.inventory_units u set status=case when source='order_dispatch' then 'sold' else 'retired' end,order_line_id=case when source='order_dispatch' then source_uuid end,last_movement_id=movement
     from picked where u.company_id=c and u.id=picked.id
     returning case when u.cost_snapshot is not null then (u.cost_snapshot->>'manufacturing_cost')::numeric else lot.unit_cost end applied_cost)
    select count(*),sum(applied_cost),bool_and(applied_cost is not null) into changed,assigned_cost,assigned_known from changed_units;
    if changed<>take then raise exception 'No se pudo conservar la asignación individual del inventario';end if;
   end if;
   insert into public.inventory_allocations(company_id,movement_id,lot_id,quantity,unit_cost,currency) values(c,movement,lot.id,take,case when assigned_known then assigned_cost/take end,lot.currency);
   if not assigned_known or lot.currency<>valuation then known:=false;else total:=total+assigned_cost;end if;
   needed:=needed-take;exit when needed=0;
  end loop;
  if needed<>0 then raise exception 'No hay lotes disponibles suficientes';end if;
 end if;
 if k='variant' and reserve_delta>0 then
  with picked as(select u.id from public.inventory_units u join public.inventory_lots l on l.company_id=u.company_id and l.id=u.lot_id where u.company_id=c and u.variant_id=item and u.status='available' and not l.blocked order by l.created_at,l.id,u.created_at,u.id limit reserve_delta::integer for update of u)
  update public.inventory_units u set status='reserved',order_line_id=source_uuid,last_movement_id=movement from picked where u.company_id=c and u.id=picked.id;
 elsif k='variant' and reserve_delta<0 then
  update public.inventory_units set status='available',order_line_id=null,last_movement_id=movement where company_id=c and variant_id=item and status='reserved' and order_line_id=source_uuid;
 end if;
 if k='variant' and source='release' and block_delta<0 then
  update public.inventory_units set status='available',last_movement_id=movement where company_id=c and variant_id=item and output_id=source_uuid and status='curing';
 end if;
 return jsonb_build_object('movement',movement,'lot',created_lot,'cost',case when known then total else null end);
end $function$;

