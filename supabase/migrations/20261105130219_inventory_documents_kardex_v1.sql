-- A document layer over the existing stock ledger. No second stock balance source.
create table public.inventory_documents(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
 number bigint not null,kind text not null check(kind in('opening','adjust_in','adjust_out','reversal')),
 effective_on date not null,reason text not null check(length(btrim(reason)) between 3 and 500),notes text not null default '',
 state text not null default 'posting' check(state in('posting','confirmed')),
 reverses_id uuid,corrects_id uuid,created_by uuid references auth.users(id),created_at timestamptz not null default clock_timestamp(),
 unique(company_id,id),unique(company_id,number),foreign key(company_id,reverses_id) references public.inventory_documents(company_id,id),
 foreign key(company_id,corrects_id) references public.inventory_documents(company_id,id),
 check((kind='reversal')=(reverses_id is not null)),check(corrects_id is null or kind in('adjust_in','adjust_out'))
);
create unique index inventory_one_reversal on public.inventory_documents(company_id,reverses_id) where reverses_id is not null;
create table public.inventory_document_lines(
 id uuid primary key,company_id uuid not null,document_id uuid not null,line_number integer not null,
 item_kind text not null check(item_kind in('material','variant')),item_id uuid not null,material_id uuid,variant_id uuid,
 input_unit_id uuid,quantity numeric not null check(quantity>0 and quantity<1e12),base_quantity numeric not null check(base_quantity>0 and base_quantity<1e12),
 unit_cost numeric check(unit_cost>=0 and unit_cost<1e12),base_unit_cost numeric check(base_unit_cost>=0 and base_unit_cost<1e12),
 total_value numeric,currency text not null,lot_id uuid,individual_unit_id uuid,movement_id uuid,
 weight numeric,external_code text,notes text not null default '',snapshot jsonb not null,
 unique(company_id,id),unique(company_id,document_id,line_number),unique(company_id,movement_id),
 foreign key(company_id,document_id) references public.inventory_documents(company_id,id),
 foreign key(company_id,material_id) references public.raw_materials(company_id,id),foreign key(company_id,variant_id) references public.product_variants(company_id,id),
 foreign key(company_id,input_unit_id) references public.units(company_id,id),foreign key(company_id,lot_id) references public.inventory_lots(company_id,id),
 foreign key(company_id,individual_unit_id) references public.inventory_units(company_id,id),foreign key(company_id,movement_id) references public.inventory_movements(company_id,id),
 check((item_kind='material' and material_id=item_id and variant_id is null) or(item_kind='variant' and variant_id=item_id and material_id is null))
);
create table access_private.inventory_document_counters(company_id uuid primary key references public.companies(id),last_value bigint not null default 0);
alter table access_private.inventory_document_counters enable row level security;
revoke all on access_private.inventory_document_counters from public,anon,authenticated;
create index inventory_document_date on public.inventory_documents(company_id,effective_on,number);
create index inventory_document_item on public.inventory_document_lines(company_id,item_kind,item_id);
alter table public.inventory_documents enable row level security;
alter table public.inventory_document_lines enable row level security;
create policy inventory_documents_read on public.inventory_documents for select to authenticated using(public.company_permission(company_id,'read','inventory'));
create policy inventory_document_lines_read on public.inventory_document_lines for select to authenticated using(public.company_permission(company_id,'read','inventory'));
revoke all on public.inventory_documents,public.inventory_document_lines from public,anon,authenticated;
grant select on public.inventory_documents,public.inventory_document_lines to authenticated;
alter table public.inventory_lots add column label text not null default '';
alter table public.inventory_units add column external_code text;
create unique index inventory_individual_code on public.inventory_units(company_id,lower(btrim(external_code))) where external_code is not null;
alter table public.inventory_movements add column effective_on date,add column unit_cost numeric,add column total_value numeric,add column currency text,add column snapshot jsonb,add column document_id uuid,add column document_line_id uuid,add column captured boolean not null default false;
alter table public.inventory_movements add foreign key(company_id,document_id) references public.inventory_documents(company_id,id),add foreign key(company_id,document_line_id) references public.inventory_document_lines(company_id,id);
create index inventory_ledger_item_date on public.inventory_movements(company_id,item_kind,item_id,created_at,id);

create function access_private.inventory_immutable() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_table_name='inventory_movements' and tg_op='UPDATE' then
  if not old.captured and new.captured and (to_jsonb(new)-array['captured','effective_on','unit_cost','total_value','currency','snapshot','document_id','document_line_id'])=(to_jsonb(old)-array['captured','effective_on','unit_cost','total_value','currency','snapshot','document_id','document_line_id']) then return new;end if;
 elsif tg_table_name='inventory_documents' and tg_op='UPDATE' then
  if old.state='posting' and new.state='confirmed' and (to_jsonb(new)-'state')=(to_jsonb(old)-'state') then return new;end if;
 elsif tg_table_name='inventory_document_lines' and tg_op='UPDATE' then
  if exists(select 1 from public.inventory_documents d where d.company_id=old.company_id and d.id=old.document_id and d.state='posting') then return new;end if;
 end if;
 raise exception 'Un documento o movimiento confirmado no se edita ni elimina. Utiliza una corrección o reversión';
end $$;
revoke all on function access_private.inventory_immutable() from public,anon,authenticated;
create trigger inventory_movements_immutable before update or delete on public.inventory_movements for each row execute function access_private.inventory_immutable();
create trigger inventory_documents_immutable before update or delete on public.inventory_documents for each row execute function access_private.inventory_immutable();
create trigger inventory_document_lines_immutable before update or delete on public.inventory_document_lines for each row execute function access_private.inventory_immutable();

create function access_private.inventory_context(c uuid,k text,item uuid,source text,sid uuid,stamp timestamptz) returns jsonb language plpgsql stable set search_path='' as $$
declare answer jsonb;doc jsonb;did uuid;num text;dt date;typ text;movement_type text;
begin
 if k='material' then
  select jsonb_build_object('sku',m.sku,'name',m.name,'unit',u.symbol,'unit_id',u.id,'classification',m.classification) into answer from public.raw_materials m join public.units u on u.company_id=m.company_id and u.id=m.unit_id where m.company_id=c and m.id=item;
 else
  select jsonb_build_object('sku',v.sku,'name',p.name,'variant',access_private.variant_label(to_jsonb(v)),'product_id',p.id,'product_sku',p.sku,'unit','ud') into answer from public.product_variants v join public.products p on p.company_id=v.company_id and p.id=v.product_id where v.company_id=c and v.id=item;
 end if;
 dt:=(stamp at time zone 'America/Guatemala')::date;did:=sid;typ:=source;movement_type:=case source when 'receipt' then 'entry' when 'production_consumption' then 'production' when 'production_output' then 'production' when 'order_dispatch' then 'sale' when 'adjustment' then 'adjustment' when 'release' then 'release' else source end;
 if source='inventory_document' then
  select to_jsonb(d),l.snapshot into doc,answer from public.inventory_document_lines l join public.inventory_documents d on d.company_id=l.company_id and d.id=l.document_id where l.company_id=c and l.id=sid;
  did:=(doc->>'id')::uuid;num:='INV-'||lpad(doc->>'number',6,'0');dt:=(doc->>'effective_on')::date;typ:='inventory_document';movement_type:=doc->>'kind';
 elsif source='receipt' then
  select to_jsonb(r) into doc from public.purchase_receipts r where r.company_id=c and r.id=sid;dt:=coalesce((doc->>'received_on')::date,dt);num:='REC-'||left(sid::text,8);
 elsif source in('production_consumption','production_output','release') then
  if source='production_consumption' then select b.id,to_jsonb(b) into did,doc from public.batch_consumptions l join public.production_batches b on b.company_id=l.company_id and b.id=l.batch_id where l.company_id=c and l.id=sid;
  else select b.id,to_jsonb(b) into did,doc from public.batch_outputs l join public.production_batches b on b.company_id=l.company_id and b.id=l.batch_id where l.company_id=c and l.id=sid;end if;
  num:='PROD-'||coalesce(doc->>'batch_number',left(did::text,8));if source<>'release' then dt:=coalesce((doc->>'production_date')::date,dt);end if;
 elsif source like 'order_%' then
  select o.id,to_jsonb(o) into did,doc from public.order_lines l join public.sales_orders o on o.company_id=l.company_id and o.id=l.order_id where l.company_id=c and l.id=sid;
  num:='PED-'||coalesce(doc->>'number',doc->>'order_number',left(did::text,8));
  if source='order_dispatch' and (doc->>'gift')::boolean then movement_type:='gift';end if;
 else num:='MOV-'||left(sid::text,8);
 end if;
 return coalesce(answer,'{}')||jsonb_build_object('source_document_id',coalesce(did,sid),'source_line_id',sid,'document_number',coalesce(num,left(sid::text,8)),'document_type',typ,'movement_type',movement_type,'effective_on',dt);
end $$;
revoke all on function access_private.inventory_context(uuid,text,uuid,text,uuid,timestamptz) from public,anon,authenticated;
CREATE OR REPLACE FUNCTION access_private.post_stock_selected(c uuid, k text, item uuid, q numeric, block_delta numeric, reserve_delta numeric, source text, source_uuid uuid, cost numeric, note text, selected_lot uuid, selected_unit uuid)
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
  if selected_lot is not null then
   update public.inventory_lots set remaining=remaining+q where company_id=c and id=selected_lot and item_kind=k and item_id=item returning id into created_lot;
   if not found then raise exception 'Lote de reversión no disponible';end if;
  else
  insert into public.inventory_lots(company_id,item_kind,item_id,remaining,currency,unit_cost,blocked,source_kind,source_id) values(c,k,item,q,valuation,cost,block_delta>0,source,source_uuid) returning id into created_lot;
  end if;
  total:=q*cost;known:=cost is not null;
 elsif q<0 then
  needed:=-q;
  for lot in select il.* from public.inventory_lots il where il.company_id=c and il.item_kind=k and il.item_id=item and not il.blocked and il.remaining>0 and (selected_lot is null or il.id=selected_lot)
   order by case when source='order_dispatch' and exists(select 1 from public.inventory_units u where u.company_id=c and u.lot_id=il.id and u.status='reserved' and u.order_line_id=source_uuid) then 0 else 1 end,il.created_at,il.id for update loop
   select exists(select 1 from public.inventory_units u where u.company_id=c and u.lot_id=lot.id) into tracked;
   available_lot:=lot.remaining;
   if tracked then
    select count(*) into available_lot from public.inventory_units u where u.company_id=c and u.lot_id=lot.id and (selected_unit is null or u.id=selected_unit) and (u.status='available' or(source='order_dispatch' and u.status='reserved' and u.order_line_id=source_uuid));
   end if;
   take:=least(needed,available_lot);if take<=0 then continue;end if;
   update public.inventory_lots set remaining=remaining-take where company_id=c and id=lot.id;
   assigned_cost:=take*lot.unit_cost;assigned_known:=lot.unit_cost is not null;
   if source='inventory_document' and k='material' and cost is not null then assigned_cost:=take*cost;assigned_known:=true;end if;
   if tracked then
    with picked as(select u.id from public.inventory_units u where u.company_id=c and u.lot_id=lot.id and (selected_unit is null or u.id=selected_unit) and (u.status='available' or(source='order_dispatch' and u.status='reserved' and u.order_line_id=source_uuid))
     order by (u.status='reserved') desc,u.created_at,u.id limit take::integer for update),
    changed_units as(
     update public.inventory_units u set status=case when source='order_dispatch' then 'sold' else 'retired' end,order_line_id=case when source='order_dispatch' then source_uuid end,last_movement_id=movement
     from picked where u.company_id=c and u.id=picked.id
     returning case when u.cost_snapshot is not null then (u.cost_snapshot->>'manufacturing_cost')::numeric else lot.unit_cost end applied_cost)
    select count(*),sum(applied_cost),bool_and(applied_cost is not null) into changed,assigned_cost,assigned_known from changed_units;
    if changed<>take then raise exception 'No se pudo conservar la asignación individual del inventario';end if;
    if lot.remaining>take and exists(select 1 from public.inventory_units un where un.company_id=c and un.lot_id=lot.id and un.cost_snapshot is not null) then
     update public.inventory_lots il set unit_cost=(
      select case when bool_and(case when un.cost_snapshot is null then lot.unit_cost else (un.cost_snapshot->>'manufacturing_cost')::numeric end is not null)
       then sum(case when un.cost_snapshot is null then lot.unit_cost else (un.cost_snapshot->>'manufacturing_cost')::numeric end)/count(*) end
      from public.inventory_units un where un.company_id=c and un.lot_id=lot.id and un.status not in('sold','retired'))
     where il.company_id=c and il.id=lot.id;
    end if;
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
 update public.inventory_movements im set effective_on=(ctx.data->>'effective_on')::date,unit_cost=case when known and q<>0 then total/abs(q) end,total_value=case when q=0 then 0 when known then sign(q)*total end,currency=valuation,snapshot=ctx.data,captured=true,
 document_id=case when source='inventory_document' then (select l.document_id from public.inventory_document_lines l where l.company_id=c and l.id=source_uuid) end,
 document_line_id=case when source='inventory_document' then source_uuid end
 from (select access_private.inventory_context(c,k,item,source,source_uuid,clock_timestamp()) data)ctx where im.company_id=c and im.id=movement;
 return jsonb_build_object('movement',movement,'lot',created_lot,'cost',case when known then total else null end);
end $function$
;
revoke all on function access_private.post_stock_selected(uuid,text,uuid,numeric,numeric,numeric,text,uuid,numeric,text,uuid,uuid) from public,anon,authenticated;
CREATE OR REPLACE FUNCTION access_private.post_stock(c uuid,k text,item uuid,q numeric,block_delta numeric,reserve_delta numeric,source text,source_uuid uuid,cost numeric default null,note text default '') returns jsonb language sql set search_path='' as $$ select access_private.post_stock_selected(c,k,item,q,block_delta,reserve_delta,source,source_uuid,cost,note,null,null) $$;
CREATE OR REPLACE FUNCTION access_private.physical_unit_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$begin
 if tg_op='UPDATE' then
  if (new.id,new.company_id,new.lot_id,new.batch_id,new.output_id,new.variant_id,new.weight,new.variant_snapshot,new.created_at,new.cost_snapshot,new.external_code) is distinct from (old.id,old.company_id,old.lot_id,old.batch_id,old.output_id,old.variant_id,old.weight,old.variant_snapshot,old.created_at,old.cost_snapshot,old.external_code) then raise exception 'La identidad, peso y variante histórica de una unidad no cambian';end if;
  if old.status in('sold','retired') and not(old.status='retired' and new.status='available' and exists(
 select 1 from public.inventory_document_lines nl join public.inventory_documents nd on nd.company_id=nl.company_id and nd.id=nl.document_id
 join public.inventory_document_lines ol on ol.company_id=nd.company_id and ol.document_id=nd.reverses_id
 where nl.company_id=new.company_id and nl.movement_id=new.last_movement_id and nd.kind='reversal' and ol.individual_unit_id=old.id and ol.movement_id=old.last_movement_id
 )) then raise exception 'La unidad ya salió del inventario';end if;
  if new.last_movement_id=old.last_movement_id then raise exception 'Cada cambio de estado requiere un movimiento';end if;
 end if;
 if not exists(select 1 from public.inventory_movements m where m.company_id=new.company_id and m.id=new.last_movement_id and m.item_kind='variant' and m.item_id=new.variant_id) then raise exception 'Movimiento no válido para esta unidad';end if;
 if new.batch_id is null then
  if not exists(select 1 from public.inventory_lots l where l.company_id=new.company_id and l.id=new.lot_id and l.item_kind='variant' and l.item_id=new.variant_id and l.source_kind in('adjustment','inventory_document')) then raise exception 'La unidad no corresponde al lote de ajuste';end if;
  if tg_op='INSERT' and new.status<>'available' then raise exception 'Una entrada por ajuste debe estar disponible';end if;
 else
  if not exists(select 1 from public.inventory_lots l join public.batch_outputs o on o.company_id=l.company_id and o.id=new.output_id where l.company_id=new.company_id and l.id=new.lot_id and l.item_kind='variant' and l.item_id=new.variant_id and o.variant_id=new.variant_id and o.batch_id=new.batch_id and l.source_kind='production_output' and l.source_id=o.id) then raise exception 'La unidad no corresponde al lote y variante';end if;
  if tg_op='INSERT' and new.status<>'curing' then raise exception 'La producción inicia en curación';end if;
 end if;return new;end $function$
;
create function access_private.inventory_ledger_rows(c uuid) returns setof jsonb language sql stable set search_path='' as $$
 with raw as(
 select m.*,coalesce(m.snapshot,access_private.inventory_context(c,m.item_kind,m.item_id,m.source_kind,m.source_id,m.created_at)) ctx,
  coalesce(m.effective_on,(access_private.inventory_context(c,m.item_kind,m.item_id,m.source_kind,m.source_id,m.created_at)->>'effective_on')::date,(m.created_at at time zone 'America/Guatemala')::date) sort_date,
  case when m.captured then m.unit_cost when m.quantity>0 then
   coalesce((select r.amount*r.exchange_rate/nullif(r.base_quantity,0) from public.purchase_receipts r where r.company_id=c and r.id=m.source_id and m.source_kind='receipt'),
    (select o.unit_cost from public.batch_outputs o where o.company_id=c and o.id=m.source_id and m.source_kind='production_output'),
    (select l.unit_cost from public.inventory_lots l where l.company_id=c and l.source_kind=m.source_kind and l.source_id=m.source_id))
   when m.quantity<0 then(select case when bool_and(a.unit_cost is not null) then sum(a.quantity*a.unit_cost)/sum(a.quantity) end from public.inventory_allocations a where a.company_id=c and a.movement_id=m.id)end frozen_cost,
  (select coalesce(jsonb_agg(distinct z.lot_id),'[]') from(select l.id lot_id from public.inventory_lots l where l.company_id=c and l.source_kind=m.source_kind and l.source_id=m.source_id union select a.lot_id from public.inventory_allocations a where a.company_id=c and a.movement_id=m.id)z) lots,
  (select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'code',coalesce(u.external_code,'U-'||upper(u.id::text)),'weight',u.weight)),'[]') from public.inventory_unit_movements um join public.inventory_units u on u.company_id=um.company_id and u.id=um.unit_id where um.company_id=c and um.movement_id=m.id) individual_units
 from public.inventory_movements m where m.company_id=c
 ),calculated as(
 select raw.*,sum(quantity) over(partition by item_kind,item_id order by sort_date,created_at,id) running_balance from raw
 )
 select jsonb_build_object('id',id,'company_id',company_id,'date',coalesce(effective_on,(ctx->>'effective_on')::date,sort_date),'created_at',created_at,'created_by',created_by,
  'document_id',document_id,'document_line_id',document_line_id,'source_kind',source_kind,'source_id',source_id,'source_document_id',ctx->>'source_document_id','source_line_id',ctx->>'source_line_id',
  'document_number',ctx->>'document_number','document_type',ctx->>'document_type','movement_type',ctx->>'movement_type',
  'item_kind',item_kind,'item_id',item_id,'sku',ctx->>'sku','name',ctx->>'name','variant',ctx->>'variant','product_id',ctx->>'product_id','unit',ctx->>'unit','cost_basis',ctx->>'cost_basis',
  'entry',greatest(quantity,0),'exit',greatest(-quantity,0),'quantity',quantity,'balance',running_balance,'unit_cost',frozen_cost,
  'value',case when captured then total_value when quantity=0 then 0 else quantity*frozen_cost end,
  'currency',coalesce(currency,(select a.currency from public.inventory_allocations a where a.company_id=c and a.movement_id=calculated.id limit 1),(select l.currency from public.inventory_lots l where l.company_id=c and l.source_kind=calculated.source_kind and l.source_id=calculated.source_id),(select cp.currency from public.companies cp where cp.id=c)),
  'lots',lots,'units',individual_units,'notes',notes,'legacy',coalesce((ctx->>'legacy_reference')::boolean,not captured))
 from calculated
$$;
revoke all on function access_private.inventory_ledger_rows(uuid) from public,anon,authenticated;

create function access_private.inventory_document_review(c uuid,data jsonb) returns jsonb language plpgsql stable set search_path='' as $$
declare r jsonb;rows jsonb:='[]';warnings jsonb:='[]';errors jsonb:='[]';signum integer;typ text;docdate date;item uuid;lotid uuid;unitid uuid;unitrow public.inventory_units%rowtype;lot public.inventory_lots%rowtype;
 mat public.raw_materials%rowtype;var public.product_variants%rowtype;un public.units%rowtype;bu public.units%rowtype;prod uuid;qty numeric;bqty numeric;unitcost numeric;bcost numeric;factor numeric;snap jsonb;ordinal integer:=0;sig text;seen text[]:='{}';available numeric;matches uuid[];lineid uuid;reason text;ccy text;rev uuid;original public.inventory_documents%rowtype;inputrows jsonb;parentline public.inventory_document_lines%rowtype;
begin
 typ:=data->>'kind';rev:=nullif(data->>'reverses_id','')::uuid;reason:=btrim(data->>'reason');
 if typ not in('opening','adjust_in','adjust_out','reversal') or typ is null then raise exception 'Selecciona el tipo de movimiento';end if;
 if length(coalesce(reason,'')) not between 3 and 500 then raise exception 'Indica un motivo de 3 a 500 caracteres';end if;
 docdate:=(data->>'date')::date;if docdate is null or docdate>(clock_timestamp() at time zone 'America/Guatemala')::date then raise exception 'Indica una fecha válida, no futura';end if;
 if length(coalesce(data->>'notes',''))>2000 then raise exception 'Observaciones: máximo 2000 caracteres';end if;
 select currency into strict ccy from public.companies where id=c;
 if nullif(data->>'corrects_id','') is not null and (typ not in('adjust_in','adjust_out') or not exists(select 1 from public.inventory_documents d where d.company_id=c and d.id=(data->>'corrects_id')::uuid and d.state='confirmed')) then raise exception 'Documento original de corrección no válido';end if;
 if typ='reversal' then
  select * into strict original from public.inventory_documents where company_id=c and id=rev and state='confirmed' and kind<>'reversal';
  if exists(select 1 from public.inventory_documents d where d.company_id=c and d.reverses_id=rev) then raise exception 'Este documento ya tiene una reversión';end if;
  signum:=case when original.kind in('opening','adjust_in') then -1 else 1 end;
  select jsonb_agg(jsonb_build_object('line_key',l.id,'item_kind',l.item_kind,'item_id',l.item_id,'unit_id',l.input_unit_id,'quantity',l.quantity,'unit_cost',l.unit_cost,'lot_id',l.lot_id,'individual_unit_id',l.individual_unit_id,'weight',l.weight,'notes',l.notes,'external_code',l.external_code,'original_line',l.id) order by l.line_number) into inputrows from public.inventory_document_lines l where l.company_id=c and l.document_id=rev;
 else
  if rev is not null then raise exception 'La referencia de reversión no corresponde al tipo';end if;
  signum:=case when typ='adjust_out' then -1 else 1 end;inputrows:=data->'lines';
 end if;
 if jsonb_typeof(inputrows) is distinct from 'array' or jsonb_array_length(inputrows) not between 1 and 500 then raise exception 'Agrega entre 1 y 500 líneas';end if;
 for r in select value from jsonb_array_elements(inputrows) loop
  ordinal:=ordinal+1;lotid:=null;unitid:=null;unitrow:=null;lot:=null;mat:=null;var:=null;prod:=null;
  lineid:=coalesce(nullif(r->>'line_key','')::uuid,gen_random_uuid());item:=nullif(r->>'item_id','')::uuid;
  qty:=nullif(r->>'quantity','')::numeric;
  if nullif(r->>'weight','') is not null and ((r->>'weight')::numeric<=0 or (r->>'weight')::numeric>=1e12 or (r->>'weight')::numeric<>round((r->>'weight')::numeric,4)) then raise exception 'Fila %: peso positivo, máximo 4 decimales',ordinal;end if;
  if qty is null or qty<=0 or qty>=1e12 or qty<>round(qty,8) then raise exception 'Fila %: cantidad positiva, máximo 8 decimales',ordinal;end if;
  if r->>'item_kind'='material' then
   select * into strict mat from public.raw_materials where company_id=c and id=item;
   select * into strict bu from public.units where company_id=c and id=mat.unit_id;
   select * into strict un from public.units where company_id=c and id=coalesce(nullif(r->>'unit_id','')::uuid,bu.id);
   if un.dimension<>bu.dimension or (not un.active and typ<>'reversal') then raise exception 'Fila %: unidad incompatible',ordinal;end if;
   factor:=un.base_factor/bu.base_factor;bqty:=round(qty*factor,8);
   snap:=jsonb_build_object('sku',mat.sku,'name',mat.name,'unit',bu.symbol,'input_unit',un.symbol,'unit_id',bu.id,'classification',mat.classification);
  elsif r->>'item_kind'='variant' then
   if item is not null then select * into strict var from public.product_variants where company_id=c and id=item;prod:=var.product_id;else prod:=nullif(r->>'product_id','')::uuid;end if;
   if signum=1 and typ<>'reversal' and nullif(r->>'weight','') is not null then
    select array_agg(v.id) into matches from public.product_variants v where v.company_id=c and v.product_id=prod and v.active and v.weight_min<=(r->>'weight')::numeric and (r->>'weight')::numeric<v.weight_max and (var.id is null or v.attributes=var.attributes);
    if coalesce(cardinality(matches),0)<>1 then raise exception 'Fila %: el peso no identifica una sola variante. Selecciona sus atributos o corrige el peso',ordinal;end if;
    select * into strict var from public.product_variants where company_id=c and id=matches[1];item:=var.id;
   end if;
   if var.id is null then raise exception 'Fila %: selecciona una variante',ordinal;end if;
   if qty<>trunc(qty) then raise exception 'Fila %: los productos requieren cantidades enteras',ordinal;end if;
   if var.weight_min is not null and (qty<>1 or nullif(r->>'weight','') is null) and signum=1 and typ<>'reversal' then raise exception 'Fila %: registra una fila por unidad con su peso real',ordinal;end if;
   if signum=1 and typ<>'reversal' and (not var.active or not exists(select 1 from public.products p where p.company_id=c and p.id=var.product_id and p.active)) then raise exception 'Fila %: producto o variante archivados',ordinal;end if;
   select * into un from public.units where company_id=c and dimension='count' and base_factor=1 and active order by (symbol='ud') desc,id limit 1;bu:=un;factor:=1;bqty:=qty;
   if nullif(r->>'unit_id','') is not null and (r->>'unit_id')::uuid is distinct from un.id then raise exception 'Fila %: producto terminado se registra en unidades',ordinal;end if;
   snap:=access_private.inventory_context(c,'variant',item,'adjustment',lineid,clock_timestamp());snap:=snap||jsonb_build_object('input_unit','ud','unit_id',un.id);
  else raise exception 'Fila %: tipo de artículo inválido',ordinal;end if;
  if bqty<=0 then raise exception 'Fila %: cantidad insuficiente en unidad base',ordinal;end if;
  if typ<>'reversal' and nullif(r->>'external_code','') is not null and signum=1 and (var.id is null or nullif(r->>'weight','') is null) then raise exception 'Fila %: el identificador individual requiere un producto con peso real',ordinal;end if;
  if typ='reversal' then select l.snapshot into snap from public.inventory_document_lines l where l.company_id=c and l.id=(r->>'original_line')::uuid;end if;
  if signum=1 and typ<>'reversal' and mat.id is not null and not mat.active then raise exception 'Fila %: el material está archivado',ordinal;end if;
  lotid:=nullif(r->>'lot_id','')::uuid;unitid:=nullif(r->>'individual_unit_id','')::uuid;
  if signum=-1 then
   if unitid is null and nullif(r->>'external_code','') is not null then select id into unitid from public.inventory_units where company_id=c and lower(coalesce(external_code,'U-'||id::text))=lower(r->>'external_code');end if;
   if unitid is not null then
    select * into strict unitrow from public.inventory_units where company_id=c and id=unitid and variant_id=item and status='available';
    if qty<>1 then raise exception 'Fila %: una unidad individual requiere cantidad 1',ordinal;end if;
    lotid:=unitrow.lot_id;snap:=snap||jsonb_build_object('variant',unitrow.variant_snapshot->>'name','sku',unitrow.variant_snapshot->>'sku','weight',unitrow.weight);
   elsif var.weight_min is not null then raise exception 'Fila %: selecciona el identificador de la unidad que retiras',ordinal;end if;
   if lotid is null then
    select array_agg(il.id) into matches from public.inventory_lots il where il.company_id=c and il.item_kind=r->>'item_kind' and il.item_id=item and not il.blocked and il.remaining>0;
    if coalesce(cardinality(matches),0)=1 then lotid:=matches[1];else raise exception 'Fila %: selecciona un lote disponible para conservar su costo histórico',ordinal;end if;
   end if;
   select * into strict lot from public.inventory_lots where company_id=c and id=lotid and item_kind=r->>'item_kind' and item_id=item and not blocked and remaining>=bqty;
   if lot.currency<>ccy then raise exception 'Fila %: la moneda histórica del lote es distinta. No se aplica una conversión ficticia',ordinal;end if;
   select on_hand-blocked-reserved into available from public.inventory_balances where company_id=c and item_kind=r->>'item_kind' and item_id=item;
   if coalesce(available,0)<bqty then raise exception 'Fila %: salida superior a las existencias disponibles',ordinal;end if;
   if typ='reversal' then bcost:=nullif(r->>'unit_cost','')::numeric/factor;
   else
    bcost:=case when unitrow.id is not null and unitrow.cost_snapshot is not null then (unitrow.cost_snapshot->>'manufacturing_cost')::numeric else lot.unit_cost end;
    snap:=snap||jsonb_build_object('cost_basis',case when unitrow.id is not null then 'individual' else 'lot' end);
    if bcost is null and mat.id is not null then select il.unit_cost into bcost from public.inventory_lots il where il.company_id=c and il.item_kind='material' and il.item_id=item and il.unit_cost is not null order by il.created_at desc,il.id desc limit 1;snap:=snap||jsonb_build_object('cost_basis','historical_reference');end if;
   end if;
   unitcost:=bcost*factor;
  else
   unitcost:=nullif(r->>'unit_cost','')::numeric;bcost:=unitcost/factor;
   if typ<>'reversal' then snap:=snap||jsonb_build_object('cost_basis','entry_confirmed');end if;
   if typ<>'reversal' and lotid is not null then raise exception 'Fila %: en entradas utiliza un nombre de lote, no un lote de existencias',ordinal;end if;
   if typ='reversal' and unitid is not null then
    select * into strict unitrow from public.inventory_units where company_id=c and id=unitid and status='retired' and last_movement_id=(select l.movement_id from public.inventory_document_lines l where l.company_id=c and l.id=(r->>'original_line')::uuid);
   end if;
   if typ<>'reversal' and nullif(btrim(r->>'external_code'),'') is not null and exists(select 1 from public.inventory_units u where u.company_id=c and lower(u.external_code)=lower(btrim(r->>'external_code'))) then raise exception 'Fila %: identificador individual repetido',ordinal;end if;
  end if;
  if unitcost is not null and (unitcost<0 or unitcost>=1e12) then raise exception 'Fila %: costo unitario inválido',ordinal;end if;
  if bcost is not null and (bcost<0 or bcost>=1e12) then raise exception 'Fila %: costo en unidad base fuera de rango',ordinal;end if;
  if unitcost is null then warnings:=warnings||jsonb_build_array('Fila '||ordinal||': costo pendiente para '||coalesce(snap->>'sku',snap->>'name'));end if;
  if typ='opening' and exists(select 1 from public.inventory_balances b where b.company_id=c and b.item_kind=r->>'item_kind' and b.item_id=item and b.on_hand<>0) then warnings:=warnings||jsonb_build_array('Fila '||ordinal||': '||coalesce(snap->>'sku',snap->>'name')||' ya tiene existencias; esta apertura será complementaria');end if;
  if signum=1 and typ<>'reversal' and nullif(btrim(r->>'external_code'),'') is not null and exists(select 1 from jsonb_array_elements(rows) x where lower(x->>'external_code')=lower(btrim(r->>'external_code'))) then raise exception 'Fila %: identificador individual repetido en el documento',ordinal;end if;
  sig:=(r->>'item_kind')||':'||item::text||':'||coalesce(lotid::text,r->>'lot_label','')||':'||case when unitid is not null then unitid::text when var.weight_min is not null then coalesce(nullif(lower(btrim(r->>'external_code')),''),lineid::text) else '' end;
  if sig=any(seen) then raise exception 'Fila %: artículo, variante, lote o unidad repetidos',ordinal;end if;seen:=array_append(seen,sig);
  if length(coalesce(r->>'notes',''))>1000 or length(coalesce(r->>'lot_label',''))>120 or length(coalesce(r->>'external_code',''))>80 then raise exception 'Fila %: texto demasiado largo',ordinal;end if;
  rows:=rows||jsonb_build_array(jsonb_build_object('line_key',lineid,'line_number',ordinal,'item_kind',r->>'item_kind','item_id',item,'material_id',mat.id,'variant_id',var.id,'input_unit_id',un.id,'quantity',qty,'base_quantity',bqty,'unit_cost',unitcost,'base_unit_cost',bcost,'total_value',qty*unitcost,'currency',ccy,'lot_id',lotid,'lot_label',coalesce(r->>'lot_label',''),'individual_unit_id',unitid,'external_code',nullif(btrim(r->>'external_code'),''),'weight',case when unitrow.id is not null then unitrow.weight else nullif(r->>'weight','')::numeric end,'notes',coalesce(r->>'notes',''),'snapshot',snap,'direction',signum,'original_line',r->>'original_line'));
 end loop;
 return jsonb_build_object('kind',typ,'date',docdate,'reverses_id',rev,'corrects_id',nullif(data->>'corrects_id','')::uuid,'reason',reason,'notes',coalesce(data->>'notes',''),'lines',rows,'warnings',warnings,'currency',ccy,'line_count',ordinal,
 'quantity_totals',(select jsonb_agg(jsonb_build_object('unit',g.symbol,'quantity',g.qty)) from(select l#>>'{snapshot,input_unit}' symbol,sum((l->>'quantity')::numeric) qty from jsonb_array_elements(rows)l group by 1)g),
 'known_total',(select coalesce(sum((l->>'total_value')::numeric),0) from jsonb_array_elements(rows)l),'pending_costs',(select count(*) from jsonb_array_elements(rows)l where l->>'unit_cost' is null));
end $$;
revoke all on function access_private.inventory_document_review(uuid,jsonb) from public,anon,authenticated;

create function access_private.inventory_command(c uuid,action text,data jsonb,k uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare review jsonb;r jsonb;answer jsonb;cached access_private.operation_requests%rowtype;docid uuid;lineid uuid;move jsonb;lotid uuid;unitid uuid;n bigint;sgn numeric;items jsonb;total bigint;page integer;
begin
 if auth.uid() is null or not public.company_permission(c,case when action in('review','confirm') then 'write' else 'read' end,'inventory') then raise exception 'No tienes permiso para esta empresa';end if;
 if action='catalog' then
  return jsonb_build_object(
   'materials',(select coalesce(jsonb_agg(to_jsonb(m)||jsonb_build_object('suggested_cost',(select s.unit_price*bu.base_factor/s.base_factor from public.material_sheet s join public.units bu on bu.company_id=c and bu.id=m.unit_id where s.company_id=c and s.raw_material_id=m.id and s.active and s.effective_on<=current_date and s.currency=cp.currency and s.unit_price is not null order by s.effective_on desc,s.price_created_at desc limit 1)) order by m.name),'[]') from public.raw_materials m join public.companies cp on cp.id=c where m.company_id=c),
   'variants',(select coalesce(jsonb_agg(to_jsonb(v)||jsonb_build_object('product_name',p.name,'label',access_private.variant_label(to_jsonb(v)),'suggested_cost',(select l.unit_cost from public.inventory_lots l where l.company_id=c and l.item_kind='variant' and l.item_id=v.id and l.unit_cost is not null order by l.created_at desc limit 1)) order by p.name),'[]') from public.product_variants v join public.products p on p.company_id=v.company_id and p.id=v.product_id where v.company_id=c),
   'units',(select coalesce(jsonb_agg(to_jsonb(u) order by u.name),'[]') from public.units u where u.company_id=c and u.active),
   'lots',(select coalesce(jsonb_agg(to_jsonb(l) order by l.created_at),'[]') from public.inventory_lots l where l.company_id=c),
   'physical',(select coalesce(jsonb_agg(to_jsonb(u) order by u.created_at),'[]') from public.inventory_units u where u.company_id=c and u.status='available'));
 elsif action='review' then
  review:=access_private.inventory_document_review(c,data);return review||jsonb_build_object('proof',md5(review::text));
 elsif action='confirm' then
  if k is null then raise exception 'Falta identificador de operación';end if;
  perform pg_advisory_xact_lock(hashtextextended(c::text,0));
  if not public.company_permission(c,'write','inventory') then raise exception 'Permiso revocado';end if;
  select * into cached from access_private.operation_requests where company_id=c and key=k;
  if found then if cached.action<>'inventory_confirm' or cached.payload<>data then raise exception 'Identificador de operación utilizado con otros datos';end if;return cached.result;end if;
  review:=access_private.inventory_document_review(c,data);
  if data->>'proof' is distinct from md5(review::text) then raise exception 'Los datos o las existencias cambiaron. Revisa nuevamente antes de confirmar';end if;
  if jsonb_array_length(review->'warnings')>0 and coalesce((data->>'acknowledged')::boolean,false)=false then raise exception 'Confirma las advertencias antes de continuar';end if;
  insert into access_private.inventory_document_counters(company_id,last_value) values(c,1) on conflict(company_id) do update set last_value=inventory_document_counters.last_value+1 returning last_value into n;
  insert into public.inventory_documents(company_id,number,kind,effective_on,reason,notes,reverses_id,corrects_id,created_by) values(c,n,review->>'kind',(review->>'date')::date,review->>'reason',review->>'notes',(review->>'reverses_id')::uuid,(review->>'corrects_id')::uuid,auth.uid()) returning id into docid;
  for r in select value from jsonb_array_elements(review->'lines') loop
   lineid:=case when review->>'kind'='reversal' then gen_random_uuid() else (r->>'line_key')::uuid end;sgn:=(r->>'direction')::numeric;
   insert into public.inventory_document_lines(id,company_id,document_id,line_number,item_kind,item_id,material_id,variant_id,input_unit_id,quantity,base_quantity,unit_cost,base_unit_cost,total_value,currency,lot_id,individual_unit_id,weight,external_code,notes,snapshot)
   values(lineid,c,docid,(r->>'line_number')::integer,r->>'item_kind',(r->>'item_id')::uuid,(r->>'material_id')::uuid,(r->>'variant_id')::uuid,(r->>'input_unit_id')::uuid,(r->>'quantity')::numeric,(r->>'base_quantity')::numeric,(r->>'unit_cost')::numeric,(r->>'base_unit_cost')::numeric,(r->>'total_value')::numeric,r->>'currency',(r->>'lot_id')::uuid,(r->>'individual_unit_id')::uuid,(r->>'weight')::numeric,r->>'external_code',r->>'notes',r->'snapshot');
   move:=access_private.post_stock_selected(c,r->>'item_kind',(r->>'item_id')::uuid,sgn*(r->>'base_quantity')::numeric,0,0,'inventory_document',lineid,(r->>'base_unit_cost')::numeric,r->>'notes',(r->>'lot_id')::uuid,(r->>'individual_unit_id')::uuid);
   lotid:=coalesce((move->>'lot')::uuid,(r->>'lot_id')::uuid);unitid:=(r->>'individual_unit_id')::uuid;
   update public.inventory_document_lines set movement_id=(move->>'movement')::uuid,lot_id=lotid where company_id=c and id=lineid;
   if sgn=1 then
    if review->>'kind'<>'reversal' then update public.inventory_lots set label=r->>'lot_label' where company_id=c and id=lotid;end if;
    if unitid is not null then
     update public.inventory_units set status='available',last_movement_id=(move->>'movement')::uuid where company_id=c and id=unitid;
    elsif r->>'item_kind'='variant' and r->>'weight' is not null then
     insert into public.inventory_units(company_id,lot_id,variant_id,weight,variant_snapshot,cost_snapshot,status,last_movement_id,external_code)
     select c,lotid,v.id,(r->>'weight')::numeric,to_jsonb(v)||jsonb_build_object('name',access_private.variant_label(to_jsonb(v)),'product_name',p.name,'origin_document',docid),jsonb_build_object('manufacturing_cost',(r->>'base_unit_cost')::numeric,'currency',r->>'currency','cost_basis','inventory_document'),'available',(move->>'movement')::uuid,r->>'external_code' from public.product_variants v join public.products p on p.company_id=v.company_id and p.id=v.product_id where v.company_id=c and v.id=(r->>'item_id')::uuid returning id into unitid;
     update public.inventory_document_lines set individual_unit_id=unitid where company_id=c and id=lineid;
    end if;
   end if;
  end loop;
  update public.inventory_documents set state='confirmed' where company_id=c and id=docid;
  answer:=jsonb_build_object('id',docid,'number',n,'state','confirmed');
  insert into access_private.operation_requests(company_id,key,action,payload,result) values(c,k,'inventory_confirm',data,answer);return answer;
 elsif action='source' then
  select x into r from access_private.inventory_ledger_rows(c)x where x->>'id'=data->>'id';
  if r is null then raise exception 'Movimiento no disponible';end if;
  return jsonb_build_object('movement',r,'lines',(select jsonb_agg(x order by x->>'created_at') from access_private.inventory_ledger_rows(c)x where x->>'source_document_id'=r->>'source_document_id'),
  'reference',case when r->>'source_kind'='receipt' then(select pr.reference from public.purchase_receipts pr where pr.company_id=c and pr.id=(r->>'source_id')::uuid) else r->>'document_number' end);
 elsif action='detail' then
  return jsonb_build_object('header',(select to_jsonb(d) from public.inventory_documents d where d.company_id=c and d.id=(data->>'id')::uuid),'lines',(select coalesce(jsonb_agg(to_jsonb(l) order by l.line_number),'[]') from public.inventory_document_lines l where l.company_id=c and l.document_id=(data->>'id')::uuid),'reversal',(select id from public.inventory_documents where company_id=c and reverses_id=(data->>'id')::uuid));
 elsif action='ledger' then
  page:=greatest(coalesce((data->>'page')::integer,0),0);
  with ledger as materialized(select x from access_private.inventory_ledger_rows(c)x),filtered as(
   select x from ledger where (nullif(data->>'from','') is null or (x->>'date')::date>=(data->>'from')::date) and (nullif(data->>'to','') is null or (x->>'date')::date<=(data->>'to')::date)
   and(nullif(data->>'kind','') is null or x->>'item_kind'=data->>'kind') and(nullif(data->>'item','') is null or x->>'item_id'=data->>'item')
   and(nullif(data->>'lot','') is null or x->'lots' ? (data->>'lot')) and(nullif(data->>'source','') is null or x->>'source_kind'=data->>'source')
   and(nullif(data->>'type','') is null or x->>'movement_type'=data->>'type')
   and(nullif(data->>'query','') is null or concat_ws(' ',x->>'sku',x->>'name',x->>'variant',x->>'document_number',x->'units') ilike '%'||(data->>'query')||'%'))
  select jsonb_build_object('total',(select count(*) from filtered),'rows',(select coalesce(jsonb_agg(x order by x->>'date' desc,x->>'created_at' desc,x->>'id' desc),'[]') from(select x from filtered order by x->>'date' desc,x->>'created_at' desc,x->>'id' desc limit 100 offset page*100)s),
  'stock',(select coalesce(jsonb_agg(jsonb_build_object('item_kind',b.item_kind,'item_id',b.item_id,'on_hand',b.on_hand,'blocked',b.blocked,'reserved',b.reserved,'available',b.on_hand-b.blocked-b.reserved,'known_value',(select sum(l.remaining*l.unit_cost) from public.inventory_lots l where l.company_id=c and l.item_kind=b.item_kind and l.item_id=b.item_id),'pending_cost',(select coalesce(sum(l.remaining),0) from public.inventory_lots l where l.company_id=c and l.item_kind=b.item_kind and l.item_id=b.item_id and l.unit_cost is null))),'[]') from public.inventory_balances b where b.company_id=c)) into answer;return answer;
 end if;
 raise exception 'Acción no válida';
end $$;
revoke all on function access_private.inventory_command(uuid,text,jsonb,uuid) from public,anon,authenticated;
create function public.inventory_command(p_company uuid,p_action text,p_data jsonb default '{}',p_key uuid default null) returns jsonb language sql set search_path='' as $$ select access_private.inventory_command(p_company,p_action,p_data,p_key) $$;
revoke all on function public.inventory_command(uuid,text,jsonb,uuid) from public,anon;
grant execute on function public.inventory_command(uuid,text,jsonb,uuid) to authenticated;

-- Freeze only newly added metadata for pre-existing rows. Original quantities,
-- sources, dates, balances and stored costs in originating documents are unchanged.
-- Missing historical valuation remains NULL; it is never filled with a live price.
do $$ declare c uuid;begin
 for c in select id from public.companies loop
  with historic as materialized(select x from access_private.inventory_ledger_rows(c)x)
  update public.inventory_movements m set effective_on=(h.x->>'date')::date,unit_cost=(h.x->>'unit_cost')::numeric,total_value=(h.x->>'value')::numeric,currency=h.x->>'currency',
   snapshot=(h.x-array['entry','exit','quantity','balance','unit_cost','value','lots','units'])||jsonb_build_object('legacy_reference',true),captured=true
  from historic h where m.company_id=c and m.id=(h.x->>'id')::uuid and not m.captured;
 end loop;
end $$;
