-- Empty optional scrap quantities mean zero; preserve all other posting logic.
CREATE OR REPLACE FUNCTION access_private.operations(p_company uuid, p_action text, p_key uuid DEFAULT NULL::uuid, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare module text; cached access_private.operation_requests%rowtype; v_result jsonb:='{}'; r jsonb; x record; m public.raw_materials%rowtype; u public.units%rowtype; base public.units%rowtype; v public.product_variants%rowtype; b public.production_batches%rowtype; f public.formulas%rowtype; q numeric; converted numeric; amount numeric; rate numeric; v_id uuid; parent uuid; code text; n bigint; total numeric:=0; known boolean:=true; weight_sum numeric:=0; qty_sum integer:=0; v_kind text; price_currency text; weighed_item jsonb; weighed_sum numeric; weighed_value numeric;variable_plan jsonb;stock_review jsonb;
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
  if f.state='inactive' then raise exception 'Selecciona una versión vigente o en pruebas';end if; insert into public.production_batches(company_id,product_id,formula_id,planned_quantity,formula_scale,production_date,available_on,currency,notes,requires_curing,curing_days) values(p_company,f.product_id,f.id,access_private.planned_production_units(f.estimated_units,coalesce(nullif(p_data->>'formula_scale','')::numeric,1)),coalesce(nullif(p_data->>'formula_scale','')::numeric,1),(p_data->>'date')::date,(p_data->>'date')::date+f.curing_days,(select currency from public.companies where companies.id=p_company),coalesce(p_data->>'notes',''),f.requires_curing,f.curing_days) returning production_batches.id into v_id;v_result:=jsonb_build_object('id',v_id);
 elsif p_action='batch_finish' then
  select * into strict b from public.production_batches where company_id=p_company and production_batches.id=(p_data->>'batch')::uuid for update;
  if b.state<>'in_progress' then if b.finish_payload=p_data then v_result:=jsonb_build_object('id',b.id,'state',b.state);update access_private.operation_requests set result=v_result where company_id=p_company and key=p_key;return v_result;end if;raise exception 'Este lote ya fue finalizado';end if;
  
 if nullif(p_data->>'expected_revision','') is not null and (p_data->>'expected_revision')::integer<>(select edit_revision from public.formulas where company_id=p_company and id=b.formula_id) then raise exception 'La fórmula fue corregida mientras preparabas el lote. Actualiza los consumos antes de confirmar' using errcode='40001';end if;
 if b.production_date>current_date then raise exception 'No se puede finalizar una producción futura';end if;
  -- Freeze curing from the same formula revision used for actual consumption.
  select * into strict f from public.formulas where company_id=p_company and id=b.formula_id;
  if (b.requires_curing,b.curing_days,b.available_on) is distinct from (f.requires_curing,f.curing_days,b.production_date+f.curing_days) then
   update public.production_batches set requires_curing=f.requires_curing,curing_days=f.curing_days,available_on=production_date+f.curing_days where company_id=p_company and id=b.id returning * into b;
  end if;
  if p_data->>'capture_mode'='variant_units' and (
 (select coalesce(sum((e->>'quantity')::numeric),0) from jsonb_array_elements(p_data->'outputs')e) not between 1 and 10000
 or exists(select 1 from jsonb_array_elements(p_data->'outputs')e where not coalesce((e->>'quantity')::numeric>0 and (e->>'quantity')::numeric=trunc((e->>'quantity')::numeric),false))
 ) then raise exception 'Registra cantidades enteras positivas; máximo 10000 unidades por lote';end if;
 if coalesce(jsonb_typeof(p_data->'consumptions'),'')<>'array' or coalesce(jsonb_typeof(p_data->'outputs'),'')<>'array' or jsonb_array_length(p_data->'outputs') not between 1 and 100 then raise exception 'Registra consumos reales y variantes obtenidas';end if;
  stock_review:=access_private.production_stock_review(p_company,'confirm',p_data);
  if jsonb_array_length(stock_review->'shortages')>0 and (coalesce((p_data->>'acknowledge_shortages')::boolean,false)=false or p_data->>'stock_proof' is distinct from stock_review->>'proof') then raise exception 'Hay materiales insuficientes o cambiaron las existencias. Revisa la advertencia y confirma si deseas producir con negativos';end if;
  update public.production_batches set stock_warnings=jsonb_set(stock_warnings,'{confirmation}',stock_review||jsonb_build_object('acknowledged',coalesce((p_data->>'acknowledge_shortages')::boolean,false),'user_id',auth.uid(),'recorded_at',clock_timestamp())) where company_id=p_company and id=b.id;
  for r in select value from jsonb_array_elements(p_data->'consumptions') loop
   select * into strict m from public.raw_materials where company_id=p_company and raw_materials.id=(r->>'material')::uuid;
   if not exists(select 1 from public.formula_ingredients where company_id=p_company and formula_id=b.formula_id and material_id=m.id) then raise exception 'Material no incluido en la fórmula';end if;
   select * into strict u from public.units where company_id=p_company and units.id=(r->>'unit')::uuid;
   select * into strict base from public.units where company_id=p_company and units.id=m.unit_id;
   if u.dimension<>base.dimension then raise exception 'Unidad incompatible';end if;
   q:=(r->>'quantity')::numeric;converted:=q*u.base_factor/base.base_factor;
   if converted<0 or converted='NaN'::numeric then raise exception 'Consumo inválido';end if;
   -- Shortages were collectively reviewed and explicitly acknowledged before any consumption.
   insert into public.batch_consumptions(company_id,batch_id,material_id,base_quantity) values(p_company,b.id,m.id,converted) returning batch_consumptions.id into v_id;
   if converted>0 then v_result:=access_private.post_stock(p_company,'material',m.id,-converted,0,0,'production_consumption',v_id,null,'Lote '||b.id);amount:=nullif(v_result->>'cost','')::numeric;else amount:=0;end if;
   if amount is null then known:=false;else total:=total+amount;end if;
   update public.batch_consumptions set cost=amount,cost_reference=(select im.snapshot->'purchase_price_reference' from public.inventory_movements im where im.company_id=p_company and im.source_kind='production_consumption' and im.source_id=v_id) where company_id=p_company and batch_consumptions.id=v_id;
  end loop;
  if (select count(*) from public.batch_consumptions where company_id=p_company and batch_id=b.id)<>(select count(*) from public.formula_ingredients where company_id=p_company and formula_id=b.formula_id) or not exists(select 1 from public.batch_consumptions where company_id=p_company and batch_id=b.id and base_quantity>0) then raise exception 'Completa el consumo real de todos los materiales';end if;
  for r in select value from jsonb_array_elements(p_data->'outputs') loop
   select * into strict v from public.product_variants where company_id=p_company and product_variants.id=(r->>'variant')::uuid and product_id=b.product_id and active;
   q:=(r->>'quantity')::integer;
   if v.weight_min is not null and coalesce(p_data->>'capture_mode','')<>'variant_units' and not(r ? 'unit_weights') then raise exception 'Esta variante requiere registrar cada unidad por su peso real';end if;
   if coalesce(p_data->>'capture_mode','')='variant_units' then
    if r ? 'unit_weights' or nullif(r->>'weight','') is not null then raise exception 'La captura por variantes utiliza cantidades, sin pesos reales';end if;
   elsif r ? 'unit_weights' then
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
 select case when bool_and(cost_row.value->>'manufacturing_cost' is not null)then sum((cost_row.value->>'manufacturing_cost')::numeric)/x.quantity end into amount from jsonb_array_elements(variable_plan->'units')cost_row(value) where cost_row.value->>'variant_id'=x.variant_id::text;
 else amount:=case when known and qty_sum>0 then total/qty_sum else null end;end if;
   update public.batch_outputs set unit_cost=amount where company_id=p_company and batch_outputs.id=x.id;
   
   v_result:=access_private.post_stock(p_company,'variant',x.variant_id,x.quantity,x.quantity,0,'production_output',x.id,amount,'Lote '||b.id);
   insert into public.inventory_units(company_id,lot_id,batch_id,output_id,variant_id,weight,variant_snapshot,status,last_movement_id,cost_snapshot)
   select p_company,(v_result->>'lot')::uuid,b.id,x.id,x.variant_id,(w.value#>>'{}')::numeric,
    jsonb_build_object('name',access_private.variant_label(to_jsonb(pv)),'sku',pv.sku,'attributes',pv.attributes,'weight_min',pv.weight_min,'weight_max',pv.weight_max,'product_name',pr.name,'product_sku',pr.sku,'batch_number',b.batch_number),
    'curing',(v_result->>'movement')::uuid,
    (select cost_row.value from jsonb_array_elements(coalesce(variable_plan->'units','[]'))cost_row(value) where cost_row.value->>'variant_id'=x.variant_id::text and (cost_row.value->>'position')::bigint=w.position)
   from jsonb_array_elements(p_data->'outputs') output_line
   cross join lateral jsonb_array_elements(coalesce(output_line->'unit_weights','[]'::jsonb)) with ordinality w(value,position)
   join public.product_variants pv on pv.company_id=p_company and pv.id=x.variant_id
   join public.products pr on pr.company_id=pv.company_id and pr.id=pv.product_id
   where output_line->>'variant'=x.variant_id::text;
   if p_data->>'capture_mode'='variant_units' and exists(select 1 from public.product_variants pv where pv.company_id=p_company and pv.id=x.variant_id and pv.weight_min is not null) then
    insert into public.inventory_units(company_id,lot_id,batch_id,output_id,variant_id,weight,variant_snapshot,status,last_movement_id,cost_snapshot)
    select p_company,(v_result->>'lot')::uuid,b.id,x.id,x.variant_id,null,
     jsonb_build_object('name',access_private.variant_label(to_jsonb(pv)),'sku',pv.sku,'attributes',pv.attributes,'weight_min',pv.weight_min,'weight_max',pv.weight_max,'product_name',pr.name,'product_sku',pr.sku,'batch_number',b.batch_number,'capture_mode','variant_units','reference_weight',(pv.weight_min+pv.weight_max)/2),
     'curing',(v_result->>'movement')::uuid,
     (select cost_row.value from jsonb_array_elements(coalesce(variable_plan->'units','[]'))cost_row(value) where cost_row.value->>'variant_id'=x.variant_id::text and (cost_row.value->>'position')::bigint=unit_index)
    from generate_series(1,x.quantity)unit_index
    join public.product_variants pv on pv.company_id=p_company and pv.id=x.variant_id
    join public.products pr on pr.company_id=pv.company_id and pr.id=pv.product_id;
   end if;

  end loop;
  update public.production_batches set currency=(select currency from public.companies where companies.id=p_company),state='curing',actual_quantity=qty_sum,scrap_quantity=coalesce(nullif(btrim(p_data->>'scrap'),'')::integer,0),actual_weight=case when variable_plan is not null then (variable_plan->>'total_weight')::numeric else nullif(p_data->>'weight','')::numeric end,total_cost=case when known then total else null end,finish_payload=p_data||jsonb_build_object('_server_cost_plan',variable_plan) where company_id=p_company and production_batches.id=b.id;
  if b.requires_curing is false then
   perform access_private.operations(p_company,'batch_release',gen_random_uuid(),jsonb_build_object('batch',b.id,'reason','Disponible inmediatamente: la fórmula no requiere curado'));
  end if;
  v_result:=jsonb_build_object('id',b.id,'state',case when b.requires_curing is false then 'released' else 'curing' end);
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
end $function$
;
