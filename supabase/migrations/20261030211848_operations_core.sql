-- Catalog extensions reuse the shared identifier registry.
create extension if not exists btree_gist with schema extensions;
alter table public.catalog_identifiers drop constraint catalog_identifiers_kind_check;
alter table public.catalog_identifiers add constraint catalog_identifiers_kind_check check(kind in('material','product','presentation','variant'));
insert into public.catalog_identifiers(company_id,kind,record_id,sku,barcode) select company_id,'material',id,sku,barcode from public.raw_materials on conflict do nothing;
insert into public.catalog_identifiers(company_id,kind,record_id,sku,barcode) select company_id,'product',id,sku,barcode from public.products on conflict do nothing;
alter table public.presentations add column sku text check(length(sku) between 1 and 80),add column barcode text check(length(barcode) between 1 and 80 and barcode~'^[ -~]+$'),add column barcode_custom boolean not null default false,add column alternative_name text not null default '';
create trigger prepare_presentation_codes before insert or update on public.presentations for each row execute function catalog_private.prepare_codes();
create trigger sync_presentation_codes after insert or update or delete on public.presentations for each row execute function catalog_private.sync_codes('presentation');
alter table public.products add column description text not null default '',add column photo_path text,add column published boolean not null default false;
create table public.product_variants(
 id uuid primary key default gen_random_uuid(),company_id uuid not null,product_id uuid not null,name text not null check(length(trim(name)) between 1 and 120),
 sku text not null check(length(sku) between 1 and 80),barcode text check(length(barcode) between 1 and 80 and barcode~'^[ -~]+$'),barcode_custom boolean not null default false,
 attributes jsonb not null default '{}' check(jsonb_typeof(attributes)='object' and length(attributes::text)<1500),weight_min numeric(16,4),weight_max numeric(16,4),price numeric(18,4) not null check(price>=0 and price<>'NaN' and price=round(price,2)),currency text not null,
 active boolean not null default true,published boolean not null default false,allow_preorder boolean not null default false,created_at timestamptz not null default now(),unique(company_id,id),
 foreign key(company_id,product_id) references public.products(company_id,id),check((weight_min is null)=(weight_max is null)),check((weight_min is null and weight_max is null) or (weight_min>0 and weight_min<>'NaN' and weight_max>=weight_min and weight_max<>'NaN')),
 exclude using gist(company_id extensions.gist_uuid_ops with =,product_id extensions.gist_uuid_ops with =,(attributes::text) extensions.gist_text_ops with =,numrange(weight_min,weight_max,'[]') with &&) where(active and weight_min is not null and weight_max is not null)
);
create unique index variant_name_unique on public.product_variants(company_id,product_id,public.catalog_key(name));
create trigger prepare_variant_codes before insert or update on public.product_variants for each row execute function catalog_private.prepare_codes();
create trigger sync_variant_codes after insert or update or delete on public.product_variants for each row execute function catalog_private.sync_codes('variant');
create table access_private.child_code_counters(company_id uuid not null,kind text not null,parent_id uuid not null,last_value bigint not null default 0,primary key(company_id,kind,parent_id));
alter table access_private.child_code_counters enable row level security;
revoke all on access_private.child_code_counters from public,anon,authenticated;
create table access_private.operation_requests(company_id uuid not null references public.companies(id),key uuid not null,action text not null,payload jsonb not null,result jsonb,created_at timestamptz not null default now(),primary key(company_id,key));
alter table access_private.operation_requests enable row level security;
revoke all on access_private.operation_requests from public,anon,authenticated;

create table public.inventory_balances(company_id uuid not null,item_kind text not null check(item_kind in('material','variant')),item_id uuid not null,on_hand numeric(20,8) not null default 0,blocked numeric(20,8) not null default 0,reserved numeric(20,8) not null default 0,
 primary key(company_id,item_kind,item_id),foreign key(company_id,item_kind,item_id) references public.catalog_identifiers(company_id,kind,record_id),check(on_hand>=0 and on_hand<>'NaN' and blocked>=0 and reserved>=0 and blocked+reserved<=on_hand),check(item_kind='material' or on_hand=trunc(on_hand)));
create table public.inventory_lots(id uuid primary key default gen_random_uuid(),company_id uuid not null,item_kind text not null,item_id uuid not null,remaining numeric(20,8) not null check(remaining>=0 and remaining<>'NaN'),currency text not null,unit_cost numeric(24,8) check(unit_cost>=0 and unit_cost<>'NaN'),blocked boolean not null default false,source_kind text not null,source_id uuid not null,created_at timestamptz not null default now(),unique(company_id,id),foreign key(company_id,item_kind,item_id) references public.inventory_balances(company_id,item_kind,item_id));
create index inventory_lots_item on public.inventory_lots(company_id,item_kind,item_id,created_at,id);
create table public.inventory_movements(id uuid primary key default gen_random_uuid(),company_id uuid not null,item_kind text not null,item_id uuid not null,quantity numeric(20,8) not null default 0,blocked_delta numeric(20,8) not null default 0,reserved_delta numeric(20,8) not null default 0,source_kind text not null,source_id uuid not null,notes text not null default '',created_at timestamptz not null default clock_timestamp(),created_by uuid default auth.uid(),unique(company_id,id),unique(company_id,source_kind,source_id),foreign key(company_id,item_kind,item_id) references public.inventory_balances(company_id,item_kind,item_id));
create index inventory_movements_item on public.inventory_movements(company_id,item_kind,item_id,created_at);
create table public.inventory_allocations(company_id uuid not null,movement_id uuid not null,lot_id uuid not null,quantity numeric(20,8) not null check(quantity>0 and quantity<>'NaN'),unit_cost numeric(24,8),currency text not null,primary key(company_id,movement_id,lot_id),foreign key(company_id,movement_id) references public.inventory_movements(company_id,id),foreign key(company_id,lot_id) references public.inventory_lots(company_id,id));
create table public.purchase_receipts(id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),material_id uuid not null,supplier_id uuid,presentation_id uuid,quantity numeric(20,8) not null check(quantity>0 and quantity<>'NaN'),unit_id uuid not null,base_quantity numeric(20,8) not null check(base_quantity>0),amount numeric(18,4) not null check(amount>=0 and amount<>'NaN'),currency text not null,valuation_currency text not null,exchange_rate numeric(20,8) not null check(exchange_rate>0 and exchange_rate<>'NaN'),received_on date not null,reference text not null default '',created_at timestamptz not null default now(),unique(company_id,id),foreign key(company_id,material_id) references public.raw_materials(company_id,id),foreign key(company_id,supplier_id) references public.suppliers(company_id,id),foreign key(company_id,presentation_id) references public.presentations(company_id,id),foreign key(company_id,unit_id) references public.units(company_id,id));
create index receipts_material on public.purchase_receipts(company_id,material_id);
create table public.formulas(id uuid primary key default gen_random_uuid(),company_id uuid not null,product_id uuid not null,name text not null check(length(trim(name)) between 1 and 120),version integer not null check(version>0),standard_yield integer not null check(standard_yield>0),created_at timestamptz not null default now(),unique(company_id,id),unique(company_id,product_id,version),foreign key(company_id,product_id) references public.products(company_id,id));
create table public.formula_ingredients(company_id uuid not null,formula_id uuid not null,material_id uuid not null,quantity numeric(20,8) not null check(quantity>0 and quantity<>'NaN'),unit_id uuid not null,primary key(company_id,formula_id,material_id),foreign key(company_id,formula_id) references public.formulas(company_id,id),foreign key(company_id,material_id) references public.raw_materials(company_id,id),foreign key(company_id,unit_id) references public.units(company_id,id));
create index formula_ingredients_material on public.formula_ingredients(company_id,material_id);
create table public.production_batches(id uuid primary key default gen_random_uuid(),company_id uuid not null,product_id uuid not null,formula_id uuid not null,planned_quantity integer not null check(planned_quantity>0),actual_quantity integer,scrap_quantity integer not null default 0 check(scrap_quantity>=0),actual_weight numeric(20,4),production_date date not null,available_on date not null,state text not null default 'in_progress' check(state in('in_progress','curing','released','cancelled')),currency text not null,total_cost numeric(24,8),notes text not null default '',finish_payload jsonb,release_note text not null default '',created_at timestamptz not null default now(),unique(company_id,id),foreign key(company_id,product_id) references public.products(company_id,id),foreign key(company_id,formula_id) references public.formulas(company_id,id),check(available_on>=production_date));
create index batches_product on public.production_batches(company_id,product_id,state);
create table public.batch_consumptions(id uuid primary key default gen_random_uuid(),company_id uuid not null,batch_id uuid not null,material_id uuid not null,base_quantity numeric(20,8) not null check(base_quantity>=0 and base_quantity<>'NaN'),cost numeric(24,8),unique(company_id,batch_id,material_id),foreign key(company_id,batch_id) references public.production_batches(company_id,id),foreign key(company_id,material_id) references public.raw_materials(company_id,id));
create table public.batch_outputs(id uuid primary key default gen_random_uuid(),company_id uuid not null,batch_id uuid not null,variant_id uuid not null,quantity integer not null check(quantity>0),actual_weight numeric(20,4) check(actual_weight>0 and actual_weight<>'NaN'),allocation_weight numeric(24,8),unit_cost numeric(24,8),estimated_cost boolean not null default true,unique(company_id,id),unique(company_id,batch_id,variant_id),foreign key(company_id,batch_id) references public.production_batches(company_id,id),foreign key(company_id,variant_id) references public.product_variants(company_id,id));

-- All stock mutations pass through authorized commands; clients have read-only RLS.
do $$declare t text; module text;begin
 for t,module in select * from (values('product_variants','catalog'),('inventory_balances','inventory'),('inventory_lots','inventory'),('inventory_movements','inventory'),('inventory_allocations','inventory'),('purchase_receipts','inventory'),('formulas','production'),('formula_ingredients','production'),('production_batches','production'),('batch_consumptions','production'),('batch_outputs','production')) v(t,m) loop
  execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant select on public.%I to authenticated',t);execute format('create policy scoped_read on public.%I for select to authenticated using(public.company_permission(company_id,''read'',%L))',t,module);
 end loop;
end $$;

-- Internal helper inherits the checked command's owner; no client EXECUTE grants.
-- FIFO lot allocations keep purchase/production provenance through every stock issue.
create function access_private.post_stock(c uuid,k text,item uuid,q numeric,block_delta numeric,reserve_delta numeric,source text,source_uuid uuid,cost numeric default null,note text default '') returns jsonb language plpgsql security invoker set search_path='' as $$
declare movement uuid; lot public.inventory_lots%rowtype; take numeric; needed numeric; total numeric:=0; known boolean:=true; created_lot uuid;valuation text;begin
 select currency into strict valuation from public.companies where id=c;
 insert into public.inventory_balances(company_id,item_kind,item_id) values(c,k,item) on conflict do nothing;
 update public.inventory_balances set on_hand=on_hand+q,blocked=blocked+block_delta,reserved=reserved+reserve_delta where company_id=c and item_kind=k and item_id=item;
 insert into public.inventory_movements(company_id,item_kind,item_id,quantity,blocked_delta,reserved_delta,source_kind,source_id,notes) values(c,k,item,q,block_delta,reserve_delta,source,source_uuid,note) returning id into movement;
 if q>0 then
  insert into public.inventory_lots(company_id,item_kind,item_id,remaining,currency,unit_cost,blocked,source_kind,source_id) values(c,k,item,q,valuation,cost,block_delta>0,source,source_uuid) returning id into created_lot;
  total:=q*cost;known:=cost is not null;
 elsif q<0 then
  needed:=-q;
  for lot in select * from public.inventory_lots where company_id=c and item_kind=k and item_id=item and not blocked and remaining>0 order by created_at,id for update loop
   take:=least(needed,lot.remaining);update public.inventory_lots set remaining=remaining-take where company_id=c and id=lot.id;
   insert into public.inventory_allocations(company_id,movement_id,lot_id,quantity,unit_cost,currency) values(c,movement,lot.id,take,lot.unit_cost,lot.currency);
   if lot.unit_cost is null or lot.currency<>valuation then known:=false;else total:=total+take*lot.unit_cost;end if;
   needed:=needed-take;exit when needed=0;
  end loop;
  if needed<>0 then raise exception 'No hay lotes disponibles suficientes';end if;
 end if;
 return jsonb_build_object('movement',movement,'lot',created_lot,'cost',case when known then total else null end);
end $$;
revoke all on function access_private.post_stock(uuid,text,uuid,numeric,numeric,numeric,text,uuid,numeric,text) from public,anon,authenticated;

create function access_private.operations(p_company uuid,p_action text,p_key uuid default null,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare module text; cached access_private.operation_requests%rowtype; v_result jsonb:='{}'; r jsonb; x record; m public.raw_materials%rowtype; u public.units%rowtype; base public.units%rowtype; v public.product_variants%rowtype; b public.production_batches%rowtype; f public.formulas%rowtype; q numeric; converted numeric; amount numeric; rate numeric; v_id uuid; parent uuid; code text; n bigint; total numeric:=0; known boolean:=true; weight_sum numeric:=0; qty_sum integer:=0; v_kind text; price_currency text;
begin
 module:=case when p_action in('variants','variant_save','presentation_codes') then 'catalog' when p_action in('inventory','receive','adjust','receipts') then 'inventory' when p_action in('formulas','formula_create','batches','batch_start','batch_finish','batch_release','production_catalog') then 'production' else null end;
 if auth.uid() is null or module is null or not access_private.company_permission(p_company,case when p_action in('variants','inventory','receipts','formulas','batches','production_catalog') then 'read' else 'write' end,module) then raise exception 'Operación no autorizada para esta empresa' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company::text,0));
 if not access_private.company_permission(p_company,case when p_action in('variants','inventory','receipts','formulas','batches','production_catalog') then 'read' else 'write' end,module) then raise exception 'Permiso revocado' using errcode='42501';end if;
 if p_action='inventory' then
  return jsonb_build_object('balances',coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('name',case when s.item_kind='material' then rm.name else pr.name||' · '||pv.name end,'sku',case when s.item_kind='material' then rm.sku else pv.sku end,'barcode',case when s.item_kind='material' then rm.barcode else pv.barcode end,'unit',case when s.item_kind='material' then un.symbol else 'ud' end,'classification',rm.classification,'origin_id',case when s.item_kind='material' then rm.origin_id else pr.origin_id end,'available',s.on_hand-s.blocked-s.reserved)) from public.inventory_balances s left join public.raw_materials rm on rm.company_id=s.company_id and rm.id=s.item_id and s.item_kind='material' left join public.units un on un.company_id=rm.company_id and un.id=rm.unit_id left join public.product_variants pv on pv.company_id=s.company_id and pv.id=s.item_id and s.item_kind='variant' left join public.products pr on pr.company_id=pv.company_id and pr.id=pv.product_id where s.company_id=p_company),'[]'),'materials',coalesce((select jsonb_agg(jsonb_build_object('id',rm.id,'name',rm.name,'unit_id',rm.unit_id,'sku',rm.sku)) from public.raw_materials rm where rm.company_id=p_company and rm.active),'[]'),'variants',coalesce((select jsonb_agg(jsonb_build_object('id',pv.id,'name',p.name||' · '||pv.name,'sku',pv.sku)) from public.product_variants pv join public.products p on p.company_id=pv.company_id and p.id=pv.product_id where pv.company_id=p_company and pv.active),'[]'),'units',coalesce((select jsonb_agg(to_jsonb(un)) from public.units un where un.company_id=p_company and active),'[]'),'suppliers',coalesce((select jsonb_agg(jsonb_build_object('id',suppliers.id,'name',suppliers.name)) from public.suppliers where company_id=p_company and active),'[]'),'movements',coalesce((select jsonb_agg(to_jsonb(z)) from(select * from public.inventory_movements where company_id=p_company order by created_at desc limit 100)z),'[]'));
 elsif p_action='variants' then return coalesce((select jsonb_agg(to_jsonb(pv)||jsonb_build_object('available',coalesce(s.on_hand-s.blocked-s.reserved,0),'on_hand',coalesce(s.on_hand,0),'blocked',coalesce(s.blocked,0))) from public.product_variants pv left join public.inventory_balances s on s.company_id=pv.company_id and s.item_id=pv.id and s.item_kind='variant' where pv.company_id=p_company and pv.product_id=(p_data->>'product')::uuid),'[]');
 elsif p_action='receipts' then return coalesce((select jsonb_agg(to_jsonb(z)) from(select rc.*,rm.name as material_name from public.purchase_receipts rc join public.raw_materials rm on rm.company_id=rc.company_id and rm.id=rc.material_id where rc.company_id=p_company order by rc.created_at desc limit 100)z),'[]');
 elsif p_action='formulas' then return coalesce((select jsonb_agg(to_jsonb(fm)||jsonb_build_object('product_name',p.name,'ingredients',(select jsonb_agg(to_jsonb(i)||jsonb_build_object('name',rm.name,'unit',un.symbol)) from public.formula_ingredients i join public.raw_materials rm on rm.company_id=i.company_id and rm.id=i.material_id join public.units un on un.company_id=i.company_id and un.id=i.unit_id where i.company_id=fm.company_id and i.formula_id=fm.id))) from public.formulas fm join public.products p on p.company_id=fm.company_id and p.id=fm.product_id where fm.company_id=p_company),'[]');
 elsif p_action='batches' then return coalesce((select jsonb_agg(to_jsonb(pb)||jsonb_build_object('product_name',p.name,'outputs',coalesce((select jsonb_agg(to_jsonb(o)||jsonb_build_object('variant_name',pv.name)) from public.batch_outputs o join public.product_variants pv on pv.company_id=o.company_id and pv.id=o.variant_id where o.company_id=pb.company_id and o.batch_id=pb.id),'[]'))) from public.production_batches pb join public.products p on p.company_id=pb.company_id and p.id=pb.product_id where pb.company_id=p_company),'[]');
 elsif p_action='production_catalog' then return jsonb_build_object('products',coalesce((select jsonb_agg(jsonb_build_object('id',products.id,'name',products.name)) from public.products where company_id=p_company and active),'[]'),'materials',coalesce((select jsonb_agg(jsonb_build_object('id',raw_materials.id,'name',raw_materials.name,'unit_id',raw_materials.unit_id)) from public.raw_materials where company_id=p_company and active),'[]'),'units',coalesce((select jsonb_agg(to_jsonb(un)) from public.units un where un.company_id=p_company and active),'[]'),'variants',coalesce((select jsonb_agg(to_jsonb(pv)) from public.product_variants pv where company_id=p_company and active),'[]'));
 end if;
 if p_key is null then raise exception 'Falta identificador de operación';end if;
 select * into cached from access_private.operation_requests where company_id=p_company and key=p_key;
 if found then if cached.action<>p_action or cached.payload<>p_data then raise exception 'La clave de operación ya se utilizó con otros datos';end if;return cached.result;end if;
 insert into access_private.operation_requests(company_id,key,action,payload) values(p_company,p_key,p_action,p_data);
 if p_action='variant_save' then
  parent:=(p_data->>'product')::uuid;select * into strict x from public.products where company_id=p_company and products.id=parent and active;
  v_id:=nullif(p_data->>'id','')::uuid;code:=nullif(trim(p_data->>'sku'),'');
  if v_id is null and code is null then
   if x.sku is null then update public.products set sku=catalog_private.reserve_sku(p_company,'P') where company_id=p_company and products.id=parent returning * into x;end if;
   loop
    insert into access_private.child_code_counters(company_id,kind,parent_id,last_value) values(p_company,'variant',parent,1) on conflict(company_id,kind,parent_id) do update set last_value=access_private.child_code_counters.last_value+1 returning last_value into n;
    code:=x.sku||'-'||case when n<100 then lpad(n::text,2,'0') else n::text end;
    exit when not exists(select 1 from public.catalog_identifiers where company_id=p_company and (public.catalog_key(sku)=public.catalog_key(code) or public.catalog_key(barcode)=public.catalog_key(code)));
   end loop;
  end if;
  if v_id is null then
   insert into public.product_variants(company_id,product_id,name,sku,barcode,barcode_custom,attributes,weight_min,weight_max,price,currency,published,allow_preorder) values(p_company,parent,trim(p_data->>'name'),code,nullif(trim(p_data->>'barcode'),''),coalesce((p_data->>'barcode_custom')::boolean,false),coalesce(p_data->'attributes','{}'),nullif(p_data->>'weight_min','')::numeric,nullif(p_data->>'weight_max','')::numeric,(p_data->>'price')::numeric,(select currency from public.companies where companies.id=p_company),coalesce((p_data->>'published')::boolean,false),coalesce((p_data->>'allow_preorder')::boolean,false)) returning product_variants.id into v_id;
  else
   update public.product_variants set name=trim(p_data->>'name'),sku=code,barcode=nullif(trim(p_data->>'barcode'),''),barcode_custom=coalesce((p_data->>'barcode_custom')::boolean,false),attributes=coalesce(p_data->'attributes','{}'),weight_min=nullif(p_data->>'weight_min','')::numeric,weight_max=nullif(p_data->>'weight_max','')::numeric,price=(p_data->>'price')::numeric,currency=(select currency from public.companies where companies.id=p_company),published=coalesce((p_data->>'published')::boolean,false),active=coalesce((p_data->>'active')::boolean,true),allow_preorder=coalesce((p_data->>'allow_preorder')::boolean,false) where company_id=p_company and product_id=parent and product_variants.id=v_id;
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
  v_result:=access_private.post_stock(p_company,v_kind,v_id,q,0,0,'adjustment',p_key,nullif(p_data->>'unit_cost','')::numeric,p_data->>'reason');
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
  insert into public.production_batches(company_id,product_id,formula_id,planned_quantity,production_date,available_on,currency,notes) values(p_company,f.product_id,f.id,(p_data->>'quantity')::integer,(p_data->>'date')::date,(p_data->>'available_on')::date,(select currency from public.companies where companies.id=p_company),coalesce(p_data->>'notes','')) returning production_batches.id into v_id;v_result:=jsonb_build_object('id',v_id);
 elsif p_action='batch_finish' then
  select * into strict b from public.production_batches where company_id=p_company and production_batches.id=(p_data->>'batch')::uuid for update;
  if b.state<>'in_progress' then if b.finish_payload=p_data then v_result:=jsonb_build_object('id',b.id,'state',b.state);update access_private.operation_requests set result=v_result where company_id=p_company and key=p_key;return v_result;end if;raise exception 'Este lote ya fue finalizado';end if;
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
   converted:=coalesce(nullif(r->>'weight','')::numeric,(v.weight_min+v.weight_max)/2*q);
   insert into public.batch_outputs(company_id,batch_id,variant_id,quantity,actual_weight,allocation_weight,estimated_cost) values(p_company,b.id,v.id,q,nullif(r->>'weight','')::numeric,converted,nullif(r->>'weight','') is null);
   qty_sum:=qty_sum+q;if converted is null then weight_sum:=null;elsif weight_sum is not null then weight_sum:=weight_sum+converted;end if;
  end loop;
  for x in select * from public.batch_outputs where company_id=p_company and batch_id=b.id loop
   amount:=case when known and weight_sum>0 then total*x.allocation_weight/weight_sum/x.quantity else null end;
   update public.batch_outputs set unit_cost=amount where company_id=p_company and batch_outputs.id=x.id;
   perform access_private.post_stock(p_company,'variant',x.variant_id,x.quantity,x.quantity,0,'production_output',x.id,amount,'Lote '||b.id);
  end loop;
  update public.production_batches set currency=(select currency from public.companies where companies.id=p_company),state='curing',actual_quantity=qty_sum,scrap_quantity=coalesce((p_data->>'scrap')::integer,0),actual_weight=nullif(p_data->>'weight','')::numeric,total_cost=case when known then total else null end,finish_payload=p_data where company_id=p_company and production_batches.id=b.id;
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
exception when exclusion_violation then raise exception 'Los rangos de peso se solapan con otra variante de los mismos atributos';
end $$;
create function public.operations(p_company uuid,p_action text,p_key uuid default null,p_data jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select access_private.operations(p_company,p_action,p_key,p_data)$$;
revoke all on function access_private.operations(uuid,text,uuid,jsonb),public.operations(uuid,text,uuid,jsonb) from public,anon;
grant execute on function access_private.operations(uuid,text,uuid,jsonb),public.operations(uuid,text,uuid,jsonb) to authenticated;
notify pgrst,'reload schema';

do $$declare def text;begin def:=pg_get_functiondef('access_private.save_company_settings(uuid,text,text,jsonb,jsonb,text)'::regprocedure);def:=replace(def,'declare link jsonb; key text;begin','declare link jsonb; key text;begin perform pg_advisory_xact_lock(hashtextextended(p_company::text,0));');execute def;end $$;
