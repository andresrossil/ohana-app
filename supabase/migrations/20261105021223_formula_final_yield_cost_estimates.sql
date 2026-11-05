alter table public.formulas add column estimated_final_weight_g numeric check(estimated_final_weight_g>0 and estimated_final_weight_g<1e12);
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
  
  update public.formulas set estimated_final_weight_g=case when data ? 'estimated_final_weight_g' then nullif(data->>'estimated_final_weight_g','')::numeric else src.estimated_final_weight_g end,production_mode=coalesce(data->>'production_mode','fixed'),labor_level_id=nullif(data->>'labor_level_id','')::uuid,advertising_level_id=nullif(data->>'advertising_level_id','')::uuid,estimate_variant_id=nullif(data->>'estimate_variant_id','')::uuid,estimated_units=nullif(data->>'estimated_units','')::numeric,estimate_unit_id=nullif(data->>'estimate_unit_id','')::uuid,quantity_per_unit=nullif(data->>'quantity_per_unit','')::numeric where company_id=c and id=fid;
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
end $function$
;
CREATE OR REPLACE FUNCTION access_private.batch_recipe_snapshot(c uuid, bid uuid, fid uuid, pid uuid, factor numeric, payload jsonb, ccy text, total numeric)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select jsonb_build_object('schema',2,'captured_at',now(),'company_id',c,'product',jsonb_build_object('id',p.id,'name',p.name,'sku',p.sku),
 'formula',jsonb_build_object('id',f.id,'family_id',f.family_id,'code',ff.code,'name',f.name,'version',f.version,'production_mode',f.production_mode,'edit_revision',f.edit_revision,'formula_origen_id',ff.formula_origen_id,'own_reference',ff.own_reference,'estimated_final_weight_g',f.estimated_final_weight_g,'estimated_units',f.estimated_units,'estimate_unit_id',f.estimate_unit_id,'quantity_per_unit',f.quantity_per_unit,'estimate_variant_id',f.estimate_variant_id,'estimate_variant_name',(select pv.name from public.product_variants pv where pv.company_id=c and pv.id=f.estimate_variant_id)),
 'scale',factor,'loss',jsonb_build_object('enabled',f.loss_enabled,'percent',f.loss_percent),'currency',ccy,'total_cost',total,
 'lines',coalesce((select jsonb_agg(jsonb_build_object('material_id',m.id,'material_name',m.name,'material_sku',m.sku,'line_kind',i.line_kind,'percentage',i.percentage,'density_g_ml',i.density_g_ml,
   'reference_notes',i.reference_notes,'quantity_basis',i.quantity_basis,'configured_quantity',i.quantity,'planned_quantity',access_private.planned_material_quantity(i.quantity,i.quantity_basis,factor,(select pb.planned_quantity from public.production_batches pb where pb.company_id=c and pb.id=bid)),'planned_unit',jsonb_build_object('id',pu.id,'symbol',pu.symbol,'name',pu.name,'dimension',pu.dimension,'base_factor',pu.base_factor),
   'actual_quantity',(actual.row->>'quantity')::numeric,'actual_unit',jsonb_build_object('id',au.id,'symbol',au.symbol,'name',au.name,'dimension',au.dimension,'base_factor',au.base_factor),
   'base_quantity',bc.base_quantity,'base_unit',jsonb_build_object('id',bu.id,'symbol',bu.symbol,'name',bu.name),
   'applied_unit_cost',case when (actual.row->>'quantity')::numeric>0 then bc.cost/(actual.row->>'quantity')::numeric else null end,
   'applied_base_unit_cost',case when bc.base_quantity>0 then bc.cost/bc.base_quantity else null end,'total_cost',bc.cost) order by i.line_kind,m.name)
  from public.formula_ingredients i join public.raw_materials m on m.company_id=i.company_id and m.id=i.material_id
  join public.units pu on pu.company_id=i.company_id and pu.id=i.unit_id
  join public.units bu on bu.company_id=m.company_id and bu.id=m.unit_id
  join public.batch_consumptions bc on bc.company_id=c and bc.batch_id=bid and bc.material_id=i.material_id
  join lateral(select x as row from jsonb_array_elements(payload->'consumptions') x where x->>'material'=i.material_id::text limit 1)actual on true
  join public.units au on au.company_id=c and au.id=(actual.row->>'unit')::uuid
  where i.company_id=c and i.formula_id=fid),'[]'))
 from public.formulas f join public.formula_families ff on ff.company_id=f.company_id and ff.id=f.family_id join public.products p on p.company_id=f.company_id and p.id=f.product_id
 where f.company_id=c and f.id=fid and f.product_id=pid
$function$
;
CREATE OR REPLACE FUNCTION access_private.variable_cost_plan(c uuid, bid uuid, payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare b public.production_batches%rowtype; f public.formulas%rowtype; cc text; n numeric; wtotal numeric;
 common_material numeric; per_material numeric; common_known boolean; per_known boolean; common_total numeric;
 fixed_lines jsonb; commercial_lines jsonb; fixed_quote jsonb; quote jsonb; o jsonb; w record; m record;
 qty numeric; actual_qty numeric; allocations jsonb; units jsonb:='[]'; manufacturing numeric; commercial numeric;
 unit_material_cost numeric; assigned numeric; cost_known boolean; code text; allocation_sum numeric;variant_name text;variant_sku text;
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
 common_total:=case when common_known then common_material end;
 for o in select value from jsonb_array_elements(payload->'outputs') loop
  if jsonb_typeof(o->'unit_weights') is distinct from 'array' or jsonb_array_length(o->'unit_weights')<>(o->>'quantity')::integer then raise exception 'Registra una fila por cada barra';end if;
  if o ? 'unit_materials' and (jsonb_typeof(o->'unit_materials')<>'array' or jsonb_array_length(o->'unit_materials')<>jsonb_array_length(o->'unit_weights')) then raise exception 'Los consumos por unidad no coinciden con las barras';end if;
  select access_private.variant_label(to_jsonb(pv)),pv.sku into variant_name,variant_sku from public.product_variants pv where pv.company_id=c and pv.id=(o->>'variant')::uuid;quote:=access_private.additional_cost_quote(c,1,(o->>'variant')::uuid,null,null,commercial_lines);
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
   units:=units||jsonb_build_array(jsonb_build_object('variant_id',o->>'variant','variant_name',variant_name,'variant_sku',variant_sku,'position',w.ordinality,'weight',(w.value#>>'{}')::numeric,
    'manufacturing_cost',manufacturing,'commercial_cost',commercial,'overhead_cost',(fixed_quote->>'additional_total')::numeric/n,'total_cost',manufacturing+commercial+(fixed_quote->>'additional_total')::numeric/n,'currency',cc,
    'formula_id',f.id,'formula_code',code,'formula_version',f.version,'batch_id',bid,'batch_number',b.batch_number,
    'price_reference',ref,'commercial_lines',quote->'cost_lines','material_allocations',allocations,
    'margin',price-manufacturing-commercial-(fixed_quote->>'additional_total')::numeric/n,'margin_on_sale_percent',(price-manufacturing-commercial-(fixed_quote->>'additional_total')::numeric/n)/nullif(price,0)*100,
    'markup_on_cost_percent',(price-manufacturing-commercial-(fixed_quote->>'additional_total')::numeric/n)/nullif(manufacturing+commercial+(fixed_quote->>'additional_total')::numeric/n,0)*100));
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
 all_total:=manufacturing_total+commercial_total+(fixed_quote->>'additional_total')::numeric;
 return jsonb_build_object('batch_id',bid,'production_mode','variable_weight','unit_count',n,'total_weight',wtotal,'cost_per_gram',common_total/wtotal,
 'common_manufacturing_cost',common_total,'per_unit_materials_total',case when per_known then per_material end,'fixed_costs',fixed_quote,
 'overhead_total',(fixed_quote->>'additional_total')::numeric,'cost_schema',3,'manufacturing_total',manufacturing_total,'commercial_total',commercial_total,'total_cost',all_total,'units',units,'currency',cc);
end $function$
;
