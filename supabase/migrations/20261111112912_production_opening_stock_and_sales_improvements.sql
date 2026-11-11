alter table public.production_batches
 add column opening_stock boolean not null default false,
 add column available_on_override date,
 alter column planned_quantity drop not null;
alter table public.production_batches add constraint production_batches_plan_required check(opening_stock or planned_quantity is not null);

alter table public.partner_addresses drop constraint partner_addresses_zone_check,
 add constraint partner_addresses_zone_check check(zone>0);
alter table public.sales_deliveries drop constraint sales_deliveries_zone_check,
 add constraint sales_deliveries_zone_check check(zone>0);

alter table public.order_lines add column line_discount numeric(18,2) not null default 0
 check(line_discount>=0 and (quantity=0 or line_discount<=quantity*unit_price));

CREATE OR REPLACE FUNCTION access_private.production_command(c uuid, action text, k uuid DEFAULT NULL::uuid, data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b public.production_batches%rowtype;f public.formulas%rowtype;cached access_private.operation_requests%rowtype;bid uuid;pid uuid;opening boolean;manual_available date;fid uuid;answer jsonb;stock_review jsonb;begin
 if auth.uid() is null or not public.company_permission(c,case when action in('list','detail') then 'read' else 'write' end,'production') then raise exception 'Producción no autorizada' using errcode='42501';end if;
 if action='cancel' then return access_private.document_cancellation(c,'confirm',k,jsonb_build_object('source_kind','production','source_id',data->>'id','reason',data->>'reason'));end if;
 if action='stock_review' then return access_private.production_stock_review(c,data->>'stage',data);end if;
 if action='list' then return coalesce((select jsonb_agg(to_jsonb(pb)||jsonb_build_object('product_name',coalesce(pb.recipe_snapshot#>>'{product,name}',p.name),'formula_code',coalesce(pb.recipe_snapshot#>>'{formula,code}',ff.code),'formula_name',coalesce(pb.recipe_snapshot#>>'{formula,name}',revision.name),'formula_version',coalesce((pb.recipe_snapshot#>>'{formula,version}')::integer,revision.version),'outputs',coalesce((select jsonb_agg(to_jsonb(o)||jsonb_build_object('variant_name',pv.name)) from public.batch_outputs o join public.product_variants pv on pv.company_id=o.company_id and pv.id=o.variant_id where o.company_id=c and o.batch_id=pb.id),'[]')) order by pb.batch_number desc) from public.production_batches pb join public.products p on p.company_id=pb.company_id and p.id=pb.product_id left join public.formulas revision on revision.company_id=pb.company_id and revision.id=pb.formula_id left join public.formula_families ff on ff.company_id=revision.company_id and ff.id=revision.family_id where pb.company_id=c),'[]');end if;
 if action='detail' then
  select * into strict b from public.production_batches where company_id=c and id=(data->>'id')::uuid;
  return jsonb_build_object('batch',to_jsonb(b),'snapshot',b.recipe_snapshot,'legacy_consumptions',case when b.confirmed and b.recipe_snapshot is null then coalesce((select jsonb_agg(jsonb_build_object('material_id',material_id,'base_quantity',base_quantity,'cost',cost)) from public.batch_consumptions where company_id=c and batch_id=b.id),'[]') else '[]'::jsonb end);
 end if;
 if action not in('draft_save','opening_save','start') or k is null then raise exception 'Acción de lote inválida';end if;
 perform pg_advisory_xact_lock(hashtextextended(c::text,0));
 select * into cached from access_private.operation_requests where company_id=c and key=k;
 if found then if cached.action<>'production_'||action or cached.payload<>data then raise exception 'Identificador utilizado con otros datos';end if;return cached.result;end if;
 if action='draft_save' then
  stock_review:=access_private.production_stock_review(c,'draft',data);
  if jsonb_array_length(stock_review->'shortages')>0 and (coalesce((data->>'acknowledge_shortages')::boolean,false)=false or data->>'stock_proof' is distinct from stock_review->>'proof') then raise exception 'Hay materiales insuficientes o cambiaron las existencias. Revisa la advertencia y confirma si deseas guardar el borrador';end if;
 end if;
 opening:=action='opening_save';
 manual_available:=nullif(data->>'available_on_override','')::date;
 if opening and (nullif(data->>'id','') is not null or (data->>'date')::date>current_date) then
  raise exception 'Indica la fecha de fabricación de un lote de saldo inicial nuevo';
 end if;
 bid:=nullif(data->>'id','')::uuid;
 if bid is not null then select * into strict b from public.production_batches where company_id=c and id=bid;end if;
 if action='start' then
  if b.id is null or b.state<>'draft' then raise exception 'Selecciona un lote borrador';end if;
  if b.formula_id is null then raise exception 'Selecciona una versión válida antes de preparar el lote';end if;
  select * into strict f from public.formulas where company_id=c and id=b.formula_id and product_id=b.product_id and state<>'inactive';
  update public.production_batches set state='in_progress',requires_curing=f.requires_curing,curing_days=f.curing_days,available_on=coalesce(b.available_on_override,b.production_date+f.curing_days),planned_quantity=access_private.planned_production_units(f.estimated_units,b.formula_scale) where company_id=c and id=bid;
 else
  if b.id is not null and b.state<>'draft' then raise exception 'Solo puedes editar un lote borrador';end if;
  pid:=(data->>'product')::uuid;fid:=nullif(data->>'formula','')::uuid;
  perform 1 from public.products where company_id=c and id=pid and active;if not found then raise exception 'Producto no disponible';end if;
  if fid is null then raise exception 'Selecciona una fórmula con unidades estimadas';end if;
  select * into f from public.formulas where company_id=c and id=fid and product_id=pid and state<>'inactive';if not found then raise exception 'La versión no corresponde al producto o está inactiva';end if;
  if b.id is null then
   insert into public.production_batches(company_id,product_id,formula_id,planned_quantity,formula_scale,production_date,available_on,currency,notes,state,requires_curing,curing_days,opening_stock,available_on_override)
   values(c,pid,fid,case when opening then null else access_private.planned_production_units(f.estimated_units,coalesce(nullif(data->>'formula_scale','')::numeric,1)) end,coalesce((data->>'formula_scale')::numeric,1),(data->>'date')::date,coalesce(manual_available,(data->>'date')::date+f.curing_days),(select currency from public.companies where id=c),left(coalesce(data->>'notes',''),1000),case when opening then 'curing' else 'draft' end,f.requires_curing,f.curing_days,opening,manual_available) returning id into bid;
  else
   update public.production_batches set product_id=pid,formula_id=fid,requires_curing=f.requires_curing,curing_days=f.curing_days,planned_quantity=access_private.planned_production_units(f.estimated_units,coalesce(nullif(data->>'formula_scale','')::numeric,1)),formula_scale=coalesce((data->>'formula_scale')::numeric,1),production_date=(data->>'date')::date,available_on=coalesce(manual_available,(data->>'date')::date+f.curing_days),available_on_override=manual_available,notes=left(coalesce(data->>'notes',''),1000) where company_id=c and id=bid;
  end if;
 end if;
 if action='draft_save' then update public.production_batches set stock_warnings=jsonb_set(stock_warnings,'{draft}',stock_review||jsonb_build_object('acknowledged',coalesce((data->>'acknowledge_shortages')::boolean,false),'user_id',auth.uid(),'recorded_at',clock_timestamp())) where company_id=c and id=bid;end if;
 answer:=jsonb_build_object('id',bid);
 insert into access_private.operation_requests(company_id,key,action,payload,result) values(c,k,'production_'||action,data,answer);return answer;
end $function$;

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
  if not (b.state='in_progress' or (b.opening_stock and b.state='curing' and not b.confirmed)) then if b.finish_payload=p_data then v_result:=jsonb_build_object('id',b.id,'state',b.state);update access_private.operation_requests set result=v_result where company_id=p_company and key=p_key;return v_result;end if;raise exception 'Este lote ya fue finalizado';end if;
  
 if nullif(p_data->>'expected_revision','') is not null and (p_data->>'expected_revision')::integer<>(select edit_revision from public.formulas where company_id=p_company and id=b.formula_id) then raise exception 'La fórmula fue corregida mientras preparabas el lote. Actualiza los consumos antes de confirmar' using errcode='40001';end if;
 if b.production_date>current_date then raise exception 'No se puede finalizar una producción futura';end if;
  -- Freeze curing from the same formula revision used for actual consumption.
  select * into strict f from public.formulas where company_id=p_company and id=b.formula_id;
  if b.opening_stock and b.available_on>current_date then raise exception 'Aún no llega la fecha de disponibilidad para pesar y registrar el lote';end if;
  if not b.opening_stock and (b.requires_curing,b.curing_days,b.available_on) is distinct from (f.requires_curing,f.curing_days,coalesce(b.available_on_override,b.production_date+f.curing_days)) then
   update public.production_batches set requires_curing=f.requires_curing,curing_days=f.curing_days,available_on=coalesce(b.available_on_override,production_date+f.curing_days) where company_id=p_company and id=b.id returning * into b;
  end if;
  if (
 (select coalesce(sum((e->>'quantity')::numeric),0) from jsonb_array_elements(p_data->'outputs')e) not between 1 and 10000
 or exists(select 1 from jsonb_array_elements(p_data->'outputs')e where not coalesce((e->>'quantity')::numeric>0 and (e->>'quantity')::numeric=trunc((e->>'quantity')::numeric),false))
 ) then raise exception 'Registra cantidades enteras positivas; máximo 10000 unidades por lote';end if;
 if coalesce(jsonb_typeof(p_data->'consumptions'),'')<>'array' or coalesce(jsonb_typeof(p_data->'outputs'),'')<>'array' or jsonb_array_length(p_data->'outputs') not between 1 and 100 then raise exception 'Registra consumos reales y variantes obtenidas';end if;
  if b.opening_stock then
   known:=false;
  else
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
  end if;
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
  if not b.opening_stock and (select production_mode from public.formulas where company_id=p_company and id=b.formula_id)='variable_weight' then
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
  if b.available_on<=current_date and (b.opening_stock or b.available_on_override is not null or b.requires_curing is false) then
   perform access_private.operations(p_company,'batch_release',gen_random_uuid(),jsonb_build_object('batch',b.id,'reason','Disponible inmediatamente: la fórmula no requiere curado'));
  end if;
  v_result:=jsonb_build_object('id',b.id,'state',case when b.available_on<=current_date and (b.opening_stock or b.available_on_override is not null or b.requires_curing is false) then 'released' else 'curing' end);
 elsif p_action='batch_release' then
  select * into strict b from public.production_batches where company_id=p_company and production_batches.id=(p_data->>'batch')::uuid for update;
  if b.state='released' then v_result:=jsonb_build_object('id',b.id,'state','released');update access_private.operation_requests set result=v_result where company_id=p_company and key=p_key;return v_result;end if;
  if b.state<>'curing' or not b.confirmed then raise exception 'Registra las unidades obtenidas antes de liberar el lote';end if;
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

CREATE OR REPLACE FUNCTION access_private.batch_recipe_snapshot(c uuid, bid uuid, fid uuid, pid uuid, factor numeric, payload jsonb, ccy text, total numeric)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select jsonb_build_object('schema',2,'captured_at',now(),'company_id',c,'product',jsonb_build_object('id',p.id,'name',p.name,'sku',p.sku),
 'formula',jsonb_build_object('id',f.id,'family_id',f.family_id,'code',ff.code,'name',f.name,'version',f.version,'production_mode',f.production_mode,'edit_revision',f.edit_revision,'formula_origen_id',ff.formula_origen_id,'own_reference',ff.own_reference,'estimated_final_weight_g',f.estimated_final_weight_g,'estimated_units',f.estimated_units,'estimate_unit_id',f.estimate_unit_id,'quantity_per_unit',f.quantity_per_unit,'estimate_variant_id',f.estimate_variant_id,'estimate_variant_name',(select pv.name from public.product_variants pv where pv.company_id=c and pv.id=f.estimate_variant_id)),
 'scale',factor,'loss',jsonb_build_object('enabled',f.loss_enabled,'percent',f.loss_percent),'currency',ccy,'total_cost',total,'cost_basis','catalog_purchase',
 'lines',coalesce((select jsonb_agg(jsonb_build_object('material_id',m.id,'material_name',m.name,'material_sku',m.sku,'line_kind',i.line_kind,'percentage',i.percentage,'density_g_ml',i.density_g_ml,
   'reference_notes',i.reference_notes,'quantity_basis',i.quantity_basis,'configured_quantity',i.quantity,'planned_quantity',access_private.planned_material_quantity(i.quantity,i.quantity_basis,factor,(select pb.planned_quantity from public.production_batches pb where pb.company_id=c and pb.id=bid)),'planned_unit',jsonb_build_object('id',pu.id,'symbol',pu.symbol,'name',pu.name,'dimension',pu.dimension,'base_factor',pu.base_factor),
   'actual_quantity',(actual.row->>'quantity')::numeric,'actual_unit',jsonb_build_object('id',au.id,'symbol',au.symbol,'name',au.name,'dimension',au.dimension,'base_factor',au.base_factor),
   'base_quantity',bc.base_quantity,'base_unit',jsonb_build_object('id',bu.id,'symbol',bu.symbol,'name',bu.name),
   'applied_unit_cost',case when (actual.row->>'quantity')::numeric>0 then bc.cost/(actual.row->>'quantity')::numeric else null end,
   'applied_base_unit_cost',case when bc.base_quantity>0 then bc.cost/bc.base_quantity else null end,'total_cost',bc.cost,'cost_basis','catalog_purchase','purchase_price_reference',bc.cost_reference) order by i.line_kind,m.name)
  from public.formula_ingredients i join public.raw_materials m on m.company_id=i.company_id and m.id=i.material_id
  join public.units pu on pu.company_id=i.company_id and pu.id=i.unit_id
  join public.units bu on bu.company_id=m.company_id and bu.id=m.unit_id
  left join public.batch_consumptions bc on bc.company_id=c and bc.batch_id=bid and bc.material_id=i.material_id
  left join lateral(select x as row from jsonb_array_elements(payload->'consumptions') x where x->>'material'=i.material_id::text limit 1)actual on true
  left join public.units au on au.company_id=c and au.id=(actual.row->>'unit')::uuid
  where i.company_id=c and i.formula_id=fid and ((bc.id is not null and au.id is not null) or exists(select 1 from public.production_batches b where b.company_id=c and b.id=bid and b.opening_stock))),'[]'))
 from public.formulas f join public.formula_families ff on ff.company_id=f.company_id and ff.id=f.family_id join public.products p on p.company_id=f.company_id and p.id=f.product_id
 where f.company_id=c and f.id=fid and f.product_id=pid
$function$;

CREATE OR REPLACE FUNCTION access_private.batch_trace_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$begin
 perform pg_advisory_xact_lock(hashtextextended(new.company_id::text,0));
 if tg_op='INSERT' then
  if new.batch_number is null then select coalesce(max(batch_number),0)+1 into new.batch_number from public.production_batches where company_id=new.company_id;end if;
  if new.confirmed or new.recipe_snapshot is not null or (new.state not in('draft','in_progress') and not (new.opening_stock and new.state='curing')) then raise exception 'El lote se confirma desde Producción';end if;
 else
  if row(new.id,new.company_id,new.batch_number) is distinct from row(old.id,old.company_id,old.batch_number) then raise exception 'La identidad del lote no cambia';end if;
  if old.confirmed then
   if (to_jsonb(new)-array['state','release_note']) is distinct from(to_jsonb(old)-array['state','release_note']) then raise exception 'El lote confirmado y su receta histórica son inmutables';end if;
   if new.state<>old.state and not((old.state='curing' and new.state='released') or(new.state='cancelled' and exists(select 1 from public.document_cancellations dc where dc.company_id=new.company_id and dc.source_kind='production' and dc.source_id=new.id and dc.state='posting' and dc.created_by=auth.uid()))) then raise exception 'Transición no válida para un lote confirmado';end if;
  elsif new.state='curing' then
   if (old.state<>'in_progress' and not (old.opening_stock and old.state='curing')) or new.formula_id is null or new.finish_payload is null then raise exception 'Completa la versión y los consumos antes de confirmar';end if;
   new.recipe_snapshot:=access_private.batch_recipe_snapshot(new.company_id,new.id,new.formula_id,new.product_id,new.formula_scale,new.finish_payload,new.currency,new.total_cost);
   if new.recipe_snapshot is null or jsonb_array_length(new.recipe_snapshot->'lines')<>(select count(*) from public.formula_ingredients where company_id=new.company_id and formula_id=new.formula_id) then raise exception 'No se pudo conservar la receta completa; no se confirmó la producción';end if;
   
   if new.opening_stock then
    new.recipe_snapshot:=new.recipe_snapshot||jsonb_build_object('opening_stock',true,'cost_basis','opening_stock');
   elsif (select production_mode from public.formulas where company_id=new.company_id and id=new.formula_id)='variable_weight' then
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
   new.recipe_snapshot:=new.recipe_snapshot||jsonb_build_object('curing',jsonb_build_object('required',coalesce(new.requires_curing,true),'days',new.curing_days,'available_on',new.available_on));
   new.recipe_snapshot:=new.recipe_snapshot||jsonb_build_object('stock_warnings',new.stock_warnings);
   new.confirmed:=true;new.confirmed_at:=now();
  elsif new.confirmed or new.recipe_snapshot is not null then raise exception 'La confirmación requiere el registro transaccional de consumos';end if;
 end if;return new;
end $function$;

CREATE OR REPLACE FUNCTION access_private.courier_operations(c uuid, action text, k uuid DEFAULT NULL::uuid, data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare answer jsonb;cached access_private.operation_requests%rowtype;pid uuid;oid uuid;sid uuid;tariff_mode_value text;r jsonb;line_record record;so public.sales_orders%rowtype;
 settlement public.courier_settlements%rowtype;delivery public.sales_deliveries%rowtype;payment public.order_payments%rowtype;
 v_collected numeric;v_cost numeric;net numeric;actual numeric;counted integer:=0;n bigint;
begin
 if auth.uid() is null or not public.company_permission(c,case when action in('options','tariffs','order','settlements','pending','settlement','account') then 'read' else 'write' end,'sales') then raise exception 'Mensajería no autorizada' using errcode='42501';end if;

 if action in('settlements','pending','settlement','settlement_save','settlement_confirm','settlement_payment','settlement_cancel','account','money_add','money_void') then return access_private.settlement_engine(c,action,k,data);end if;
 if action='options' then return jsonb_build_object('couriers',coalesce((select jsonb_agg(jsonb_build_object('id',id,'code',code,'name',name,'active',active,'mode',courier_tariff_mode) order by name) from public.business_partners where company_id=c and is_courier),'[]'),'tariffs',coalesce((select jsonb_agg(to_jsonb(t)) from public.courier_tariffs t where company_id=c),'[]'),'addresses',coalesce((select jsonb_agg(to_jsonb(a) order by is_primary desc,label) from public.partner_addresses a where company_id=c),'[]'));end if;
 pid:=nullif(data->>'courier','')::uuid;oid:=nullif(data->>'order','')::uuid;sid:=nullif(data->>'id','')::uuid;
 if action='tariffs' then
  select jsonb_build_object('courier',to_jsonb(b),'rows',coalesce((select jsonb_agg(to_jsonb(t)) from public.courier_tariffs t where t.company_id=c and t.courier_id=pid),'[]')) into strict answer from public.business_partners b where b.company_id=c and b.id=pid and b.is_courier;return answer;
 elsif action='order' then
  select * into strict so from public.sales_orders where company_id=c and id=oid;
  return jsonb_build_object('order',to_jsonb(so),'delivery',(select to_jsonb(d) from public.sales_deliveries d where d.company_id=c and d.order_id=oid),
   'payments',coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('settled',exists(select 1 from public.courier_settlement_items i where i.company_id=c and i.payment_id=p.id and i.active)) order by p.created_at) from public.order_payments p where p.company_id=c and p.order_id=oid),'[]'),
 'summary',access_private.delivery_payment_summary(c,oid),'account',access_private.customer_account(c,so.customer_id),
 'settled',exists(select 1 from public.courier_settlement_items where company_id=c and order_id=oid and active),
 'credit_applications',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('source_number',s.number,'target_number',t.number) order by a.created_at) from public.customer_credit_applications a join public.sales_orders s on s.company_id=a.company_id and s.id=a.source_order_id join public.sales_orders t on t.company_id=a.company_id and t.id=a.target_order_id where a.company_id=c and (a.source_order_id=oid or a.target_order_id=oid)),'[]'));
 elsif action='settlements' then return coalesce((select jsonb_agg(to_jsonb(z)) from(select s.*,b.name courier_name from public.courier_settlements s join public.business_partners b on b.company_id=s.company_id and b.id=s.courier_id where s.company_id=c order by s.number desc limit 300)z),'[]');
 elsif action='pending' then return access_private.courier_pending(c,pid);
 elsif action='settlement' then
  select * into strict settlement from public.courier_settlements where company_id=c and id=sid;
  return jsonb_build_object('document',to_jsonb(settlement),'items',coalesce((select jsonb_agg(to_jsonb(i)) from public.courier_settlement_items i where i.company_id=c and i.settlement_id=sid),'[]'));
 end if;
 if k is null or length(data::text)>100000 then raise exception 'Operación incompleta';end if;
 perform pg_advisory_xact_lock(hashtextextended(c::text,0));
 select * into cached from access_private.operation_requests where company_id=c and key=k;
 if found then if cached.action<>'courier_'||action or cached.payload<>data then raise exception 'Identificador utilizado con otros datos';end if;return cached.result;end if;
 if action='tariffs_save' then
  if not public.company_permission(c,'manage') then raise exception 'Solo administradores pueden cambiar tarifas' using errcode='42501';end if;
  perform 1 from public.business_partners where company_id=c and id=pid and is_courier for update;if not found then raise exception 'Mensajería no disponible';end if;
  tariff_mode_value:=data->>'mode';if tariff_mode_value not in('zone','department') or tariff_mode_value is null or jsonb_typeof(data->'rows') is distinct from 'array' or jsonb_array_length(data->'rows')>(case when tariff_mode_value='zone' then 200 else 22 end) then raise exception 'Tarifario inválido';end if;
  if exists(select 1 from jsonb_array_elements(data->'rows') e group by e->>'destination' having count(*)>1) then raise exception 'Destino repetido';end if;
  for r in select value from jsonb_array_elements(data->'rows') loop
   if (tariff_mode_value='general' and r->>'destination'<>'general') or (tariff_mode_value='zone' and (case when r->>'destination' ~ '^[1-9][0-9]{0,4}$' then (r->>'destination')::numeric>32767 else true end)) or (tariff_mode_value='department' and r->>'destination' not in('Alta Verapaz','Baja Verapaz','Chimaltenango','Chiquimula','El Progreso','Escuintla','Guatemala','Huehuetenango','Izabal','Jalapa','Jutiapa','Petén','Quetzaltenango','Quiché','Retalhuleu','Sacatepéquez','San Marcos','Santa Rosa','Sololá','Suchitepéquez','Totonicapán','Zacapa')) or r->>'destination' is null then raise exception 'Destino inválido';end if;
   insert into public.courier_tariffs(company_id,courier_id,mode,destination,amount,available,delivery_schedule) values(c,pid,tariff_mode_value,r->>'destination',nullif(r->>'amount','')::numeric,coalesce((r->>'available')::boolean,false),coalesce(r->>'delivery_schedule',''))
    on conflict(company_id,courier_id,mode,destination) do update set amount=excluded.amount,available=excluded.available,delivery_schedule=case when r?'delivery_schedule' then excluded.delivery_schedule else public.courier_tariffs.delivery_schedule end;
  end loop;
  
 if coalesce((data->>'general_enabled')::boolean,false) then
  if nullif(data->>'general_amount','') is null or not((data->>'general_amount')::numeric>=0 and (data->>'general_amount')::numeric<1e12) then raise exception 'Indica una tarifa general válida';end if;
  if (tariff_mode_value='department' and jsonb_array_length(data->'rows')<>22) or (tariff_mode_value='zone' and exists(select 1 from public.courier_tariffs t where t.company_id=c and t.courier_id=pid and t.mode='zone' and not exists(select 1 from jsonb_array_elements(data->'rows') x where x->>'destination'=t.destination))) or exists(select 1 from jsonb_array_elements(data->'rows') x where nullif(x->>'amount','')::numeric is distinct from (data->>'general_amount')::numeric) then raise exception 'La tarifa general debe coincidir en todos los destinos';end if;
 end if;
 update public.business_partners set courier_tariff_mode=tariff_mode_value,
  courier_tariff_defaults=jsonb_set(courier_tariff_defaults,array[tariff_mode_value],jsonb_build_object('enabled',coalesce((data->>'general_enabled')::boolean,false),'amount',nullif(data->>'general_amount','')::numeric))
 where company_id=c and id=pid;
 
  answer:=jsonb_build_object('saved',true);
 elsif action='delivery_save' then
  perform access_private.save_order_delivery(c,oid,data->'delivery');answer:=jsonb_build_object('saved',true);
 elsif action='payment_add' then
  answer:=jsonb_build_object('id',access_private.add_order_payment(c,oid,data));
 elsif action='payment_void' then
  select * into strict payment from public.order_payments where company_id=c and id=sid for update;
  if payment.voided_at is not null then raise exception 'El pago ya está anulado';end if;
  if exists(select 1 from public.courier_settlement_items where company_id=c and payment_id=sid and active) then raise exception 'Anula primero la liquidación de este cobro';end if;
  if length(trim(coalesce(data->>'reason',''))) not between 5 and 500 then raise exception 'Indica el motivo (5 a 500 caracteres)';end if;
  update public.order_payments set voided_at=now(),voided_by=auth.uid(),void_reason=data->>'reason' where company_id=c and id=sid;
  update public.sales_orders set paid_at=null where company_id=c and id=payment.order_id;
  perform access_private.reconcile_customer_account(c,(select customer_id from public.sales_orders where company_id=c and id=payment.order_id));answer:=jsonb_build_object('voided',true);
 elsif action='settlement_save' then
  perform 1 from public.business_partners where company_id=c and id=pid and is_courier;if not found then raise exception 'Mensajería no disponible';end if;
  if jsonb_typeof(data->'orders') is distinct from 'array' or jsonb_array_length(data->'orders') not between 1 and 300 then raise exception 'Selecciona entre 1 y 300 pedidos';end if;
  if (select count(distinct value) from jsonb_array_elements_text(data->'orders'))<>jsonb_array_length(data->'orders') then raise exception 'Pedido repetido';end if;
  if nullif(data->>'date','') is null then raise exception 'Indica la fecha de liquidación';end if;
  if sid is null then
   select coalesce(max(number),0)+1 into n from public.courier_settlements where company_id=c;
   insert into public.courier_settlements(company_id,courier_id,number,settled_on,notes,created_by) values(c,pid,n,(data->>'date')::date,coalesce(data->>'notes',''),auth.uid()) returning id into sid;
  else
   select * into strict settlement from public.courier_settlements where company_id=c and id=sid for update;
   if settlement.state<>'draft' then raise exception 'Solo se editan borradores';end if;
   update public.courier_settlements set courier_id=pid,settled_on=(data->>'date')::date,notes=coalesce(data->>'notes','') where company_id=c and id=sid;
   delete from public.courier_settlement_items where company_id=c and settlement_id=sid;
  end if;
  for oid in select value::uuid from jsonb_array_elements_text(data->'orders') loop
   counted:=0;
   select d.* into strict delivery from public.sales_deliveries d join public.sales_orders o on o.company_id=d.company_id and o.id=d.order_id where d.company_id=c and d.order_id=oid and d.courier_id=pid and d.status<>'cancelled' and o.status not in('cancelled','expired');
   select * into strict so from public.sales_orders where company_id=c and id=oid;
   for payment in select p.* from public.order_payments p where p.company_id=c and p.order_id=oid and p.receiver='courier' and p.courier_id=pid and p.voided_at is null and (p.confirmed or p.route_collection) and not exists(select 1 from public.courier_settlement_items i where i.company_id=c and i.payment_id=p.id and i.active) loop
    insert into public.courier_settlement_items(company_id,settlement_id,order_id,payment_id,amount,snapshot) values(c,sid,oid,payment.id,payment.amount,jsonb_build_object('number',so.number,'customer',so.customer_snapshot->>'name','date',so.created_at,'type','collection','route_collection',payment.route_collection,'status',delivery.status));counted:=counted+1;
   end loop;
   if delivery.payer='ohana' and delivery.shipping_cost>0 and not exists(select 1 from public.courier_settlement_items where company_id=c and delivery_id=delivery.id and active) then
    insert into public.courier_settlement_items(company_id,settlement_id,order_id,delivery_id,amount,snapshot) values(c,sid,oid,delivery.id,delivery.shipping_cost,jsonb_build_object('number',so.number,'customer',so.customer_snapshot->>'name','date',so.created_at,'type','shipping','status',delivery.status));counted:=counted+1;
   end if;
   if counted=0 then raise exception 'El pedido % ya está liquidado o no tiene conceptos pendientes',so.number;end if;
  end loop;
  select coalesce(sum(amount) filter(where payment_id is not null),0),coalesce(sum(amount) filter(where delivery_id is not null),0) into v_collected,v_cost from public.courier_settlement_items where company_id=c and settlement_id=sid;
  update public.courier_settlements set collected=v_collected,shipping_cost=v_cost,net=v_collected-v_cost where company_id=c and id=sid;
  answer:=jsonb_build_object('id',sid);
 elsif action in('settlement_confirm','settlement_payment','settlement_cancel') then
  select * into strict settlement from public.courier_settlements where company_id=c and id=sid for update;
  if action='settlement_confirm' then
   if settlement.state<>'draft' then raise exception 'La liquidación ya fue confirmada o anulada';end if;
   if settlement.settled_on>current_date then raise exception 'No confirmes intercambios con fecha futura';end if;
   actual:=nullif(data->>'actual_amount','')::numeric;
   if actual is null or actual<>abs(settlement.net) then raise exception 'El importe intercambiado debe coincidir con el saldo (%)',abs(settlement.net);end if;
   for line_record in select i.*,o.status order_status,d.courier_id,d.payer,d.shipping_cost,d.status delivery_status from public.courier_settlement_items i join public.sales_orders o on o.company_id=i.company_id and o.id=i.order_id join public.sales_deliveries d on d.company_id=i.company_id and d.order_id=i.order_id where i.company_id=c and i.settlement_id=sid loop
    if line_record.order_status in('cancelled','expired') or line_record.delivery_status='cancelled' or line_record.courier_id<>settlement.courier_id then raise exception 'La entrega cambió; actualiza el borrador';end if;
    if line_record.payment_id is not null then
     perform 1 from public.order_payments where company_id=c and id=line_record.payment_id and order_id=line_record.order_id and courier_id=settlement.courier_id and amount=line_record.amount and voided_at is null and (confirmed or route_collection);if not found then raise exception 'El cobro cambió; actualiza el borrador';end if;
    elsif line_record.payer<>'ohana' or line_record.shipping_cost<>line_record.amount then raise exception 'El costo de envío cambió; actualiza el borrador';end if;
   end loop;
   update public.order_payments p set confirmed=true,confirmed_at=now()
    from public.courier_settlement_items i where i.company_id=c and i.settlement_id=sid and p.company_id=c and p.id=i.payment_id and p.route_collection and p.voided_at is null;
   update public.courier_settlement_items set active=true where company_id=c and settlement_id=sid;
   if not found then raise exception 'Liquidación vacía';end if;
   update public.courier_settlements set state='confirmed',actual_amount=actual,confirmed_at=now() where company_id=c and id=sid;
  else
   if settlement.state='cancelled' then raise exception 'La liquidación ya está anulada';end if;
   if length(trim(coalesce(data->>'reason',''))) not between 5 and 500 then raise exception 'Indica el motivo de anulación (5 a 500 caracteres)';end if;
   update public.order_payments p set confirmed=false,confirmed_at=null
    from public.courier_settlement_items i where i.company_id=c and i.settlement_id=sid and i.active and p.company_id=c and p.id=i.payment_id and p.route_collection;
   update public.courier_settlement_items set active=false where company_id=c and settlement_id=sid;
   update public.courier_settlements set state='cancelled',cancelled_at=now(),cancel_reason=data->>'reason' where company_id=c and id=sid;
  end if;
  for line_record in select distinct o.customer_id from public.sales_orders o join public.courier_settlement_items i on i.company_id=o.company_id and i.order_id=o.id where i.company_id=c and i.settlement_id=sid loop perform access_private.reconcile_customer_account(c,line_record.customer_id);end loop;
  answer:=jsonb_build_object('id',sid);
 else raise exception 'Acción de mensajería inválida';end if;
 insert into access_private.operation_requests(company_id,key,action,payload,result) values(c,k,'courier_'||action,data,answer);return answer;
exception when unique_violation then raise exception 'Algún cobro o envío ya se liquidó. Actualiza la lista antes de continuar';
end $function$;

CREATE OR REPLACE FUNCTION access_private.place_order(c uuid, k uuid, data jsonb, staff boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cfg jsonb;ccy text;cached access_private.operation_requests%rowtype;r jsonb;v public.product_variants%rowtype;product_name text;stock numeric;qty integer;reserve_qty integer;oid uuid;cid uuid;lid uuid;num bigint;sub numeric:=0;discount_value numeric:=0;shipping_value numeric:=0;phone text;customer jsonb;answer jsonb;request_data jsonb:=data;matched_phone text;price_ref jsonb;selected_list uuid;gift_line boolean;sold_price numeric;line_discount numeric;begin
 if k is null or data is null or length(data::text)>30000 then raise exception 'Pedido incompleto';end if;
 if staff then if auth.uid() is null or not public.company_permission(c,'write','sales') then raise exception 'Venta no autorizada' using errcode='42501';end if;elsif not access_private.is_public_store(c) then raise exception 'Tienda no disponible';end if;
 perform pg_advisory_xact_lock(hashtextextended(c::text,0));
 if not staff and not access_private.is_public_store(c) then raise exception 'Tienda no disponible';end if;
 select * into cached from access_private.operation_requests where company_id=c and key=k;
 if found then if cached.action<>(case when staff then 'sale_create' else 'checkout' end) or cached.payload<>request_data then raise exception 'Identificador utilizado con otros datos';end if;return cached.result;end if;
 perform access_private.expire_orders(c);
 if (select count(*) from access_private.operation_requests where company_id=c and action='checkout' and created_at>now()-interval '1 minute')>=60 then raise exception 'Demasiados pedidos. Intenta nuevamente en un minuto';end if;
 select currency into strict ccy from public.companies where id=c and active;
 select coalesce(details->'store','{}') into cfg from public.company_settings where company_id=c;cfg:=coalesce(cfg,'{}');
 
 if staff and nullif(data->>'customer_id','') is not null then
  if auth.uid() is null or not public.company_permission(c,'write','sales') then raise exception 'Venta no autorizada' using errcode='42501';end if;
  select jsonb_build_object('name',bp.name,'phone',bp.phone,'email',bp.email,'address',bp.address) into customer from public.business_partners bp where bp.company_id=c and bp.id=(data->>'customer_id')::uuid and bp.is_customer and bp.active;
  if customer is null then raise exception 'Selecciona un cliente activo de esta empresa';end if;
  data:=data||jsonb_build_object('customer',customer);
 end if;
 phone:=regexp_replace(coalesce(data#>>'{customer,phone}',''),'[^0-9+]','','g');
 customer:=jsonb_build_object('name',trim(coalesce(data#>>'{customer,name}','')),'phone',phone,'email',trim(coalesce(data#>>'{customer,email}','')),'address',trim(coalesce(data#>>'{customer,address}','')));
 if length(customer->>'name') not between 2 and 120 or (not (staff and nullif(data->>'customer_id','') is not null) and phone!~'^\+?[0-9]{7,15}$' ) or length(customer->>'address')>500 or length(customer->>'email')>254 or (customer->>'email'<>'' and customer->>'email'!~'^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then raise exception 'Revisa los datos de contacto';end if;
 if not staff and (select count(*) from public.sales_orders where company_id=c and customer_snapshot->>'phone'=phone and status='pending' and paid_at is null)>=3 then raise exception 'Ya tienes tres pedidos pendientes. Contacta al negocio';end if;
 if data->>'payment' not in('cash','transfer','cod') or data->>'delivery' not in('pickup','delivery') or data->>'payment' is null or data->>'delivery' is null then raise exception 'Pago o entrega no válidos';end if;
 if staff and data ? 'delivery_info' then
  shipping_value:=access_private.delivery_shipping_charge(c,data->'delivery_info');
 elsif data->>'delivery'='delivery' then
  if cfg->>'delivery'<>'true' or cfg->>'currency'<>ccy or cfg->>'shipping_fee' is null or length(customer->>'address')<5 then raise exception 'Entrega no configurada o dirección incompleta';end if;shipping_value:=(cfg->>'shipping_fee')::numeric;
 elsif not staff and coalesce(cfg->>'pickup','true')<>'true' then raise exception 'Retiro no disponible';end if;
 if coalesce(jsonb_typeof(data->'items'),'')<>'array' or jsonb_array_length(data->'items') not between 1 and 30 then raise exception 'El carrito debe contener entre 1 y 30 variantes';end if;
 insert into access_private.child_code_counters(company_id,kind,parent_id,last_value) values(c,'order',c,1) on conflict(company_id,kind,parent_id) do update set last_value=access_private.child_code_counters.last_value+1 returning last_value into num;
 
 if staff and nullif(data->>'customer_id','') is not null then cid:=(data->>'customer_id')::uuid;
 else
  matched_phone:=phone;
  if exists(select 1 from public.business_partners bp where bp.company_id=c and bp.is_customer and not bp.active and regexp_replace(bp.phone,'[^0-9+]','','g')=matched_phone and public.catalog_key(bp.name)=public.catalog_key(customer->>'name')) then raise exception 'Este contacto está inactivo; contacta al negocio';end if;
  select bp.id into cid from public.business_partners bp where bp.company_id=c and bp.is_customer and bp.active and regexp_replace(bp.phone,'[^0-9+]','','g')=matched_phone and public.catalog_key(bp.name)=public.catalog_key(customer->>'name') order by bp.created_at,bp.id limit 1;
  if cid is null then
   insert into public.customers(company_id,name,phone,email,address) values(c,customer->>'name',phone,customer->>'email',customer->>'address') returning id into cid;
   if trim(coalesce(customer->>'address',''))<>'' then insert into public.partner_addresses(company_id,partner_id,label,address,is_primary) values(c,cid,'Principal',customer->>'address',true);end if;
  end if;
 end if;
 
 selected_list:=case when staff then (select coalesce(bp.price_list_id,access_private.default_customer_price_list(c)) from public.business_partners bp where bp.company_id=c and bp.id=cid) else (select id from public.price_lists where company_id=c and active and is_base) end;
 insert into public.sales_orders(company_id,number,customer_id,customer_snapshot,currency,subtotal,total,shipping,delivery,payment,gift_message,price_list_id) values(c,num,cid,customer,ccy,0,0,shipping_value,data->>'delivery',data->>'payment',left(coalesce(data->>'gift_message',''),500),selected_list) returning id into oid;
 for r in select value from jsonb_array_elements(data->'items')loop
  qty:=(r->>'quantity')::integer;if qty not between 1 and 1000 or qty is null then raise exception 'Cantidad inválida';end if;
  select pv.* into strict v from public.product_variants pv join public.products pr on pr.company_id=pv.company_id and pr.id=pv.product_id where pv.company_id=c and pv.id=(r->>'variant')::uuid and pv.active and pr.active and (staff or(pv.published and pr.published)) ;
  price_ref:=access_private.list_price_record(c,selected_list,v.id);gift_line:=staff and coalesce((r->>'is_gift')::boolean,false);
  sold_price:=case when gift_line then 0 when staff and r->>'unit_price' is not null then (r->>'unit_price')::numeric else (price_ref->>'price')::numeric end;
  if sold_price is null then raise exception 'Pendiente de precio. Configura la lista base o indica el precio realmente vendido';end if;
  if not(sold_price>=0 and sold_price<1e12) then raise exception 'Precio de venta inválido';end if;
  select name into product_name from public.products where company_id=c and id=v.product_id;
  select coalesce(on_hand-blocked-reserved,0) into stock from public.inventory_balances where company_id=c and item_kind='variant' and item_id=v.id;stock:=coalesce(stock,0);
  if qty>stock and (staff or not v.allow_preorder or v.weight_min is not null) then raise exception 'No hay suficientes unidades disponibles de %',v.name;end if;reserve_qty:=least(qty,stock)::integer;
  sold_price:=round(sold_price,2);
  line_discount:=case when staff and not gift_line and r ? 'discount' then access_private.sale_discount(qty*sold_price,r->'discount') else 0 end;
  insert into public.order_lines(company_id,order_id,variant_id,description,attributes,weight_min,weight_max,quantity,unit_price,reserved_quantity,price_reference,is_gift,line_discount) values(c,oid,v.id,product_name||' · '||v.name,v.attributes,v.weight_min,v.weight_max,qty,sold_price,reserve_qty,price_ref,gift_line,line_discount) returning id into lid;
  if reserve_qty>0 then perform access_private.post_stock(c,'variant',v.id,0,0,reserve_qty,'order_reservation',lid);end if;sub:=sub+qty*sold_price-line_discount;
 end loop;

 if staff and data ? 'discount' then discount_value:=access_private.sale_discount(sub,data->'discount');
 elsif cfg->>'currency'=ccy and length(coalesce(data->>'discount_code',''))>0 then
  if upper(trim(data->>'discount_code'))<>cfg->>'discount_code' then raise exception 'Código de descuento no válido';end if;discount_value:=round(sub*coalesce((cfg->>'discount_percent')::numeric,0)/100,2);
 elsif length(coalesce(data->>'discount_code',''))>0 then raise exception 'Código de descuento no disponible';end if;
 update public.sales_orders set subtotal=sub,discount=discount_value,total=sub-discount_value+shipping_value,gift=case when cfg->>'currency'=ccy and nullif(cfg->>'gift_threshold','') is not null and sub-discount_value>=(cfg->>'gift_threshold')::numeric then coalesce(cfg->>'gift','') else '' end where company_id=c and id=oid;
 
 if staff and data ? 'discount' then update public.sales_orders set discount_basis=data#>>'{discount,mode}',discount_input=coalesce(nullif(data#>>'{discount,value}','')::numeric,0) where company_id=c and id=oid;end if;
 if staff and data ? 'delivery_info' then perform access_private.save_order_delivery(c,oid,data->'delivery_info');end if;
 if staff and data ? 'payments' then
  if jsonb_typeof(data->'payments') is distinct from 'array' or jsonb_array_length(data->'payments')>30 then raise exception 'Máximo 30 pagos';end if;
  for r in select value from jsonb_array_elements(data->'payments') loop perform access_private.add_order_payment(c,oid,r);end loop;
 end if;

 if staff and coalesce(nullif(data->>'credit_amount','')::numeric,0)>0 then perform access_private.apply_customer_credit(c,oid,(data->>'credit_amount')::numeric);end if;
 if nullif(data->>'expected_total','') is not null and (data->>'expected_total')::numeric<>sub-discount_value+shipping_value then raise exception 'El precio cambió. Revisa el total actualizado antes de confirmar';end if;answer:=jsonb_build_object('id',oid,'number',num,'subtotal',sub,'discount',discount_value,'shipping',shipping_value,'total',sub-discount_value+shipping_value,'currency',ccy,'expires_at',now()+interval '24 hours');
 insert into access_private.operation_requests(company_id,key,action,payload,result) values(c,k,case when staff then 'sale_create' else 'checkout' end,request_data,answer);return answer;
exception when no_data_found then raise exception 'Una variante ya no está disponible. Actualiza el catálogo';end $function$;

CREATE OR REPLACE FUNCTION access_private.edit_sale(c uuid, k uuid, data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare sale public.sales_orders%rowtype;cached access_private.operation_requests%rowtype;old_line record;r jsonb;v public.product_variants%rowtype;
 rev uuid;customer uuid;customer_data jsonb;line_id uuid;qty integer;price numeric(18,2);sub numeric:=0;line_discount numeric;discount_amount numeric;available numeric;reserved_qty integer;seen text[]:='{}';gift_line boolean;selected_list uuid;answer jsonb;
begin
 if auth.uid() is null or not public.company_permission(c,'write','sales') then raise exception 'Venta no autorizada' using errcode='42501';end if;
 if k is null or length(data::text)>100000 then raise exception 'Factura incompleta';end if;
 perform pg_advisory_xact_lock(hashtextextended(c::text,0));
 select * into cached from access_private.operation_requests where company_id=c and key=k;
 if found then if cached.action<>'sale_edit' or cached.payload<>data then raise exception 'Identificador utilizado con otros datos';end if;return cached.result;end if;
 select * into strict sale from public.sales_orders where company_id=c and id=(data->>'order')::uuid for update;
 if sale.status in('cancelled','expired') then raise exception 'No se editan facturas canceladas o vencidas';end if;
 if exists(select 1 from public.courier_settlement_items where company_id=c and order_id=sale.id and active) then raise exception 'La factura está liquidada por mensajería; no se puede editar';end if;
 if sale.status<>'pending' or sale.fulfillment_stage<>'invoiced' then raise exception 'La factura ya fue preparada. Revierte el pedido antes de editarlo';end if;
 if (data->>'expected_revision')::integer is distinct from sale.revision then raise exception 'Otra persona modificó esta factura. Actualiza antes de editar';end if;
 if jsonb_typeof(data->'items') is distinct from 'array' or jsonb_array_length(data->'items') not between 1 and 30 then raise exception 'Captura entre 1 y 30 productos';end if;
 customer:=coalesce(nullif(data->>'customer_id','')::uuid,sale.customer_id);
 if customer<>sale.customer_id and (sale.legacy_paid_amount>0 or exists(select 1 from public.order_payments where company_id=c and order_id=sale.id and voided_at is null) or exists(select 1 from public.customer_credit_applications where company_id=c and (source_order_id=sale.id or target_order_id=sale.id) and voided_at is null)) then raise exception 'La factura tiene pagos o saldo aplicado; conserva el cliente';end if;
 select jsonb_build_object('name',b.name,'phone',b.phone,'email',b.email,'address',b.address) into customer_data from public.business_partners b where b.company_id=c and b.id=customer and b.is_customer and (b.active or b.id=sale.customer_id);
 selected_list:=case when customer=sale.customer_id then coalesce(sale.price_list_id,(select price_list_id from public.business_partners where company_id=c and id=customer),access_private.default_customer_price_list(c)) else (select coalesce(price_list_id,access_private.default_customer_price_list(c)) from public.business_partners where company_id=c and id=customer) end;
 if customer_data is null then raise exception 'Selecciona un cliente válido de esta empresa';end if;
 insert into public.sales_order_revisions(company_id,order_id,number,before_snapshot,created_by)
 values(c,sale.id,sale.revision+1,jsonb_build_object('order',to_jsonb(sale),'lines',(select jsonb_agg(to_jsonb(l)) from public.order_lines l where l.company_id=c and l.order_id=sale.id and l.quantity>0),'delivery',(select to_jsonb(d) from public.sales_deliveries d where d.company_id=c and d.order_id=sale.id)),auth.uid()) returning id into rev;
 for old_line in select * from public.order_lines where company_id=c and order_id=sale.id and quantity>0 order by id loop
  if sale.status='dispatched' then perform access_private.return_edited_sale_line(c,old_line.id);
  elsif old_line.reserved_quantity>0 then perform access_private.post_stock(c,'variant',old_line.variant_id,0,0,-old_line.reserved_quantity,'order_edit_release',old_line.id,null,'Liberación de reserva por edición de factura');end if;
  update public.order_lines set quantity=0,reserved_quantity=0 where company_id=c and id=old_line.id;
 end loop;
 for r in select value from jsonb_array_elements(data->'items') loop
  qty:=nullif(r->>'quantity','')::integer;gift_line:=coalesce((r->>'is_gift')::boolean,false);price:=case when gift_line then 0 else nullif(r->>'unit_price','')::numeric end;
  if qty is null or qty not between 1 and 1000 or price is null or not(price>=0 and price<1e12) then raise exception 'Cantidad o precio inválido';end if;
  select pv.* into strict v from public.product_variants pv join public.products p on p.company_id=pv.company_id and p.id=pv.product_id where pv.company_id=c and pv.id=(r->>'variant')::uuid and ((pv.active and p.active) or exists(select 1 from jsonb_array_elements((select before_snapshot->'lines' from public.sales_order_revisions where id=rev)) x where x->>'variant_id'=pv.id::text));
  if (v.id::text||':'||gift_line::text)=any(seen) then raise exception 'No repitas la misma variante y condición de regalo; ajusta su cantidad';end if;seen:=array_append(seen,v.id::text||':'||gift_line::text);
  select coalesce(on_hand-blocked-reserved,0) into available from public.inventory_balances where company_id=c and item_kind='variant' and item_id=v.id;available:=coalesce(available,0);
  if qty>available and (sale.status='dispatched' or not v.allow_preorder or v.weight_min is not null) then raise exception 'Existencias insuficientes para esta cantidad';end if;
  reserved_qty:=case when sale.status='pending' then least(qty,available)::integer else 0 end;
  line_discount:=case when not gift_line and r ? 'discount' then access_private.sale_discount(qty*price,r->'discount') else 0 end;
  insert into public.order_lines(company_id,order_id,variant_id,description,attributes,weight_min,weight_max,quantity,unit_price,reserved_quantity,price_reference,is_gift,line_discount)
  values(c,sale.id,v.id,(select name from public.products where company_id=c and id=v.product_id)||' · '||v.name,v.attributes,v.weight_min,v.weight_max,qty,price,reserved_qty,access_private.list_price_record(c,selected_list,v.id),gift_line,line_discount) returning id into line_id;
  if sale.status='dispatched' then perform access_private.post_stock(c,'variant',v.id,-qty,0,0,'order_dispatch',line_id);
  elsif reserved_qty>0 then perform access_private.post_stock(c,'variant',v.id,0,0,reserved_qty,'order_reservation',line_id);end if;
  sub:=sub+qty*price-line_discount;
 end loop;
 discount_amount:=access_private.sale_discount(sub,data->'discount');
 update public.sales_orders set price_list_id=selected_list,customer_id=customer,customer_snapshot=customer_data,subtotal=sub,discount=discount_amount,total=sub-discount_amount+shipping,
  discount_basis=data#>>'{discount,mode}',discount_input=coalesce(nullif(data#>>'{discount,value}','')::numeric,0),payment=coalesce(nullif(data->>'payment',''),payment),revision=revision+1 where company_id=c and id=sale.id;
 perform access_private.save_order_delivery(c,sale.id,data->'delivery_info');
 if (data->>'expected_total')::numeric is distinct from (select total from public.sales_orders where company_id=c and id=sale.id) then raise exception 'El total cambió. Revisa la factura antes de guardar';end if;
 perform access_private.reconcile_customer_account(c,customer);
 if coalesce(nullif(data->>'credit_amount','')::numeric,0)>0 then perform access_private.apply_customer_credit(c,sale.id,(data->>'credit_amount')::numeric);end if;
 update public.sales_order_revisions set after_snapshot=jsonb_build_object('order',(select to_jsonb(o) from public.sales_orders o where o.company_id=c and o.id=sale.id),'lines',(select jsonb_agg(to_jsonb(l)) from public.order_lines l where l.company_id=c and l.order_id=sale.id and l.quantity>0),'delivery',(select to_jsonb(d) from public.sales_deliveries d where d.company_id=c and d.order_id=sale.id)) where id=rev;
 answer:=jsonb_build_object('id',sale.id,'revision',sale.revision+1);
 insert into access_private.operation_requests(company_id,key,action,payload,result) values(c,k,'sale_edit',data,answer);return answer;
end $function$;

CREATE OR REPLACE FUNCTION access_private.sales_fulfillment(c uuid, action text, k uuid DEFAULT NULL::uuid, data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare so public.sales_orders%rowtype;d public.sales_deliveries%rowtype;cached access_private.operation_requests%rowtype;target text;answer jsonb;line public.order_lines%rowtype;rev uuid;
begin
 if auth.uid() is null or not public.company_permission(c,case when action='detail' then 'read' else 'write' end,'sales') then raise exception 'Pedido no autorizado' using errcode='42501';end if;
 if action<>'detail' then
  if k is null then raise exception 'Identificador requerido';end if;
  perform pg_advisory_xact_lock(hashtextextended(c::text,0));
  select * into cached from access_private.operation_requests where company_id=c and key=k;
  if found then if cached.action<>'fulfillment_'||action or cached.payload<>data then raise exception 'Identificador utilizado con otros datos';end if;return cached.result;end if;
 end if;
 select * into strict so from public.sales_orders where company_id=c and id=(data->>'order')::uuid for update;
 select * into d from public.sales_deliveries where company_id=c and order_id=so.id;
 if action='detail' then return jsonb_build_object('order',to_jsonb(so),'delivery',to_jsonb(d),'commercial_info',(select jsonb_build_object('commercial_notes',bp.commercial_notes,'delivery_instructions',bp.delivery_instructions) from public.business_partners bp where bp.company_id=c and bp.id=so.customer_id),'settled',exists(select 1 from public.courier_settlement_items where company_id=c and order_id=so.id and active),'summary',access_private.delivery_payment_summary(c,so.id),'lines',coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from public.order_lines l where l.company_id=c and l.order_id=so.id and l.quantity>0),'[]'));end if;
 if so.status not in('pending','dispatched') or exists(select 1 from public.courier_settlement_items where company_id=c and order_id=so.id and active) then raise exception 'El pedido ya no permite cambiar su preparación';end if;
 if data->>'expected_stage' is distinct from so.fulfillment_stage then raise exception 'El pedido cambió. Actualiza su estado antes de continuar';end if;
 if action='revert' then
  if so.status='pending' and so.fulfillment_stage='invoiced' then raise exception 'La factura ya está abierta';end if;
  if length(trim(coalesce(data->>'reason',''))) not between 5 and 500 then raise exception 'Indica el motivo de reversión (5 a 500 caracteres)';end if;
  if exists(select 1 from public.courier_settlement_items i join public.courier_settlements st on st.company_id=i.company_id and st.id=i.settlement_id where i.company_id=c and i.order_id=so.id and st.state='draft') then raise exception 'Anula primero el borrador de liquidación que incluye esta factura';end if;
  insert into public.sales_order_revisions(company_id,order_id,number,before_snapshot,created_by)
  values(c,so.id,so.revision+1,jsonb_build_object('action','revert','reason',data->>'reason','order',to_jsonb(so),'lines',(select jsonb_agg(to_jsonb(l)) from public.order_lines l where l.company_id=c and l.order_id=so.id and l.quantity>0),'delivery',to_jsonb(d)),auth.uid()) returning id into rev;
  for line in select * from public.order_lines where company_id=c and order_id=so.id and quantity>0 order by id loop
   if so.status='dispatched' then perform access_private.return_edited_sale_line(c,line.id);
   elsif line.reserved_quantity>0 then perform access_private.post_stock(c,'variant',line.variant_id,0,0,-line.reserved_quantity,'order_reopen_release',line.id,null,'Liberación de reserva al reabrir factura');end if;
   update public.order_lines set quantity=0,reserved_quantity=0 where company_id=c and id=line.id;
   -- Fresh line identities allow a later dispatch/reversal without reusing stock movement keys.
   insert into public.order_lines select (jsonb_populate_record(null::public.order_lines,to_jsonb(line)||jsonb_build_object('id',gen_random_uuid(),'reserved_quantity',0))).*;
  end loop;
  update public.sales_orders set status='pending',fulfillment_stage='invoiced',revision=revision+1,expires_at=now()+interval '24 hours',
   fulfillment_history=fulfillment_history||jsonb_build_array(jsonb_build_object('stage','invoiced','action','revert','from',so.fulfillment_stage,'reason',data->>'reason','at',now(),'by',auth.uid()))
  where company_id=c and id=so.id;
  update public.sales_deliveries set status='pending',updated_at=now() where company_id=c and order_id=so.id;
  update public.sales_order_revisions set after_snapshot=jsonb_build_object('order',(select to_jsonb(o) from public.sales_orders o where o.company_id=c and o.id=so.id),'lines',(select jsonb_agg(to_jsonb(l)) from public.order_lines l where l.company_id=c and l.order_id=so.id and l.quantity>0),'delivery',(select to_jsonb(x) from public.sales_deliveries x where x.company_id=c and x.order_id=so.id)) where id=rev;
  answer:=jsonb_build_object('id',so.id,'stage','invoiced','reopened',true);
  insert into access_private.operation_requests(company_id,key,action,payload,result) values(c,k,'fulfillment_'||action,data,answer);return answer;
 end if;
 if action='prepare' and so.status='pending' and so.fulfillment_stage='invoiced' then target:='preparing';
 elsif action='finish' and so.status='pending' and so.fulfillment_stage='preparing' then
  perform access_private.sales(c,'dispatch',gen_random_uuid(),jsonb_build_object('order',so.id));
  target:='finished';
 elsif action='handoff' and so.fulfillment_stage='finished' then
  if d.status='cancelled' then raise exception 'La entrega está cancelada';end if;
  if so.status='pending' then perform access_private.sales(c,'dispatch',gen_random_uuid(),jsonb_build_object('order',so.id));end if;
  target:=case when d.kind='courier' then 'courier' else 'delivered' end;
  update public.sales_deliveries set status=case when kind='courier' then 'in_transit' else 'delivered' end,updated_at=now() where company_id=c and order_id=so.id;
 else raise exception 'Completa primero la etapa anterior del pedido';end if;
 update public.sales_orders set fulfillment_stage=target,fulfillment_history=fulfillment_history||jsonb_build_array(jsonb_build_object('stage',target,'at',now(),'by',auth.uid())) where company_id=c and id=so.id;
 answer:=jsonb_build_object('id',so.id,'stage',target);
 insert into access_private.operation_requests(company_id,key,action,payload,result) values(c,k,'fulfillment_'||action,data,answer);return answer;
end $function$;
notify pgrst,'reload schema';
