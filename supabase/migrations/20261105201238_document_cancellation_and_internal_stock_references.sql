
-- Reversal audit metadata over the existing stock ledger; no second stock system.
create table public.document_cancellations(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
 number bigint not null,source_kind text not null check(source_kind in('purchase','production','sale','movement')),
 source_id uuid not null,reason text not null check(length(btrim(reason)) between 5 and 500),
 state text not null default 'posting' check(state in('posting','confirmed')),created_by uuid references auth.users(id),
 created_at timestamptz not null default clock_timestamp(),snapshot jsonb not null default '{"effects":[]}',
 unique(company_id,id),unique(company_id,number),unique(company_id,source_kind,source_id)
);
alter table public.document_cancellations enable row level security;
revoke all on public.document_cancellations from public,anon,authenticated;
grant select on public.document_cancellations to authenticated;
create policy document_cancellations_read on public.document_cancellations for select to authenticated using(public.company_permission(company_id,'read','inventory'));
alter table public.purchase_receipts add column cancelled_at timestamptz,add column cancelled_by uuid references auth.users(id),add column cancellation_id uuid,
 add foreign key(company_id,cancellation_id) references public.document_cancellations(company_id,id);
create function access_private.cancellation_audit_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='UPDATE' and old.state='posting' and new.state in('posting','confirmed') and
 (to_jsonb(new)-array['state','snapshot'])=(to_jsonb(old)-array['state','snapshot']) then return new;end if;
 raise exception 'Una reversión confirmada no se modifica ni elimina';
end $$;
revoke all on function access_private.cancellation_audit_guard() from public,anon,authenticated;
create trigger cancellation_audit_immutable before update or delete on public.document_cancellations for each row execute function access_private.cancellation_audit_guard();

create function access_private.cancellation_effect(c uuid,audit uuid,original uuid,q numeric,bd numeric,rd numeric,lot uuid,individual uuid,cost numeric) returns jsonb language plpgsql set search_path='' as $$
declare m public.inventory_movements%rowtype;effect uuid:=gen_random_uuid();answer jsonb;idx integer;begin
 select * into strict m from public.inventory_movements where company_id=c and id=original;
 if m.currency is not null and m.currency<>(select currency from public.companies where id=c) then raise exception 'La moneda del documento cambió. No se convierte el costo histórico automáticamente';end if;
 update public.document_cancellations set snapshot=jsonb_set(snapshot,'{effects}',(snapshot->'effects')||jsonb_build_array(jsonb_build_object('effect_id',effect,'original_movement_id',original,'origin_snapshot',m.snapshot)))
 where company_id=c and id=audit and state='posting' returning jsonb_array_length(snapshot->'effects')-1 into idx;
 if idx is null then raise exception 'Reversión no disponible';end if;
 answer:=access_private.post_stock_selected(c,m.item_kind,m.item_id,q,bd,rd,'document_reversal',effect,cost,(select reason from public.document_cancellations where company_id=c and id=audit),lot,individual);
 update public.document_cancellations set snapshot=jsonb_set(snapshot,array['effects',idx::text,'movement_id'],to_jsonb(answer->>'movement')) where company_id=c and id=audit;
 return answer;
end $$;
revoke all on function access_private.cancellation_effect(uuid,uuid,uuid,numeric,numeric,numeric,uuid,uuid,numeric) from public,anon,authenticated;

create function access_private.cancellation_restore(c uuid,audit uuid,original uuid) returns void language plpgsql set search_path='' as $$
declare m public.inventory_movements%rowtype;a record;result jsonb;qty numeric;valid boolean;restored numeric:=0;changed bigint;begin
 select * into strict m from public.inventory_movements where company_id=c and id=original and quantity<0;
 for a in select * from public.inventory_allocations where company_id=c and movement_id=m.id order by lot_id loop
  select count(*),coalesce(bool_and(un.last_movement_id=m.id and un.status in('sold','retired')),true) into qty,valid
  from public.inventory_units un join public.inventory_unit_movements h on h.company_id=un.company_id and h.unit_id=un.id
  where h.company_id=c and h.movement_id=m.id and h.status_after in('sold','retired') and un.lot_id=a.lot_id;
  if not valid or(qty>0 and qty<>a.quantity) then raise exception 'Existen unidades con movimientos posteriores. Revierte primero sus documentos';end if;
  result:=access_private.cancellation_effect(c,audit,m.id,a.quantity,0,0,a.lot_id,null,a.unit_cost);
  if qty>0 then
   update public.inventory_units un set status='available',order_line_id=null,last_movement_id=(result->>'movement')::uuid
   from public.inventory_unit_movements h where h.company_id=c and h.movement_id=m.id and h.unit_id=un.id and h.status_after in('sold','retired')
   and un.company_id=c and un.lot_id=a.lot_id and un.last_movement_id=m.id;
   get diagnostics changed=row_count;if changed<>qty then raise exception 'No se restauraron todas las unidades';end if;
  end if;
  restored:=restored+a.quantity;
 end loop;
 if restored<>-m.quantity then raise exception 'No existe el detalle completo para revertir este consumo';end if;
end $$;
revoke all on function access_private.cancellation_restore(uuid,uuid,uuid) from public,anon,authenticated;

create function access_private.cancellation_withdraw(c uuid,audit uuid,original uuid,origin_lot uuid) returns void language plpgsql set search_path='' as $$
declare m public.inventory_movements%rowtype;l public.inventory_lots%rowtype;result jsonb;begin
 select * into strict m from public.inventory_movements where company_id=c and id=original and quantity>0;
 if m.item_kind='variant' then
  select * into strict l from public.inventory_lots where company_id=c and id=origin_lot and item_id=m.item_id and remaining>=m.quantity;
  if exists(select 1 from public.inventory_units where company_id=c and lot_id=l.id and status not in('available','curing')) then raise exception 'Existen unidades vendidas, reservadas o retiradas. Revierte primero sus documentos';end if;
  if l.blocked then
   result:=access_private.cancellation_effect(c,audit,m.id,0,-m.quantity,0,null,null,null);
   update public.inventory_units set status='available',last_movement_id=(result->>'movement')::uuid where company_id=c and lot_id=l.id and status='curing';
   update public.inventory_lots set blocked=false where company_id=c and id=l.id;
  end if;
 else origin_lot:=null;if coalesce((select on_hand-blocked-reserved from public.inventory_balances where company_id=c and item_kind='material' and item_id=m.item_id),0)<m.quantity then raise exception 'Los materiales de esta compra ya se utilizaron. Revierte primero los consumos o documentos dependientes';end if;end if;
 perform access_private.cancellation_effect(c,audit,m.id,-m.quantity,0,0,origin_lot,null,m.unit_cost);
exception when no_data_found then raise exception 'Las existencias de este documento ya se utilizaron. Revierte primero los documentos dependientes';
end $$;
revoke all on function access_private.cancellation_withdraw(uuid,uuid,uuid,uuid) from public,anon,authenticated;

create function access_private.document_cancellation(c uuid,action text,k uuid,data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.inventory_movements%rowtype;kind text;sid uuid;module text;state text;can_cancel boolean;existing public.document_cancellations%rowtype;cached access_private.operation_requests%rowtype;aid uuid;n bigint;r record;reason text;answer jsonb;begin
 if auth.uid() is null then raise exception 'Sesión requerida' using errcode='42501';end if;
 if nullif(data->>'movement_id','') is not null then
  select * into strict m from public.inventory_movements where company_id=c and id=(data->>'movement_id')::uuid;
  if m.document_id is not null then return jsonb_build_object('can_cancel',false,'message','Utiliza Revertir documento en el ajuste original');end if;
  if m.source_kind='receipt' then kind:='purchase';sid:=m.source_id;
  elsif m.source_kind in('production_consumption','production_output','release') then kind:='production';sid:=(access_private.inventory_context(c,m.item_kind,m.item_id,m.source_kind,m.source_id,m.created_at)->>'source_document_id')::uuid;
  elsif m.source_kind like 'order_%' then kind:='sale';sid:=(select order_id from public.order_lines where company_id=c and id=m.source_id);
  elsif m.source_kind='adjustment' then kind:='movement';sid:=m.id;
  else return jsonb_build_object('can_cancel',false,'message','Este movimiento es una reversión o no admite cancelación independiente');end if;
 else kind:=data->>'source_kind';sid:=(data->>'source_id')::uuid;end if;
 module:=case kind when 'purchase' then 'inventory' when 'movement' then 'inventory' when 'sale' then 'sales' when 'production' then 'production' end;
 if module is null or not public.company_permission(c,'read',module) then if action='info' and public.company_permission(c,'read','inventory') then return jsonb_build_object('can_cancel',false,'message','Sin permiso para cancelar este tipo de documento');end if;raise exception 'Documento no autorizado para esta empresa' using errcode='42501';end if;
 if kind='purchase' then select case when cancelled_at is null then 'active' else 'cancelled' end into strict state from public.purchase_receipts where company_id=c and id=sid;
 elsif kind='production' then select pb.state into strict state from public.production_batches pb where pb.company_id=c and pb.id=sid;
 elsif kind='sale' then select so.status into strict state from public.sales_orders so where so.company_id=c and so.id=sid;
 else perform 1 from public.inventory_movements where company_id=c and id=sid and source_kind='adjustment';if not found then raise exception 'Movimiento no disponible';end if;state:='active';end if;
 select * into existing from public.document_cancellations where company_id=c and source_kind=kind and source_id=sid;
 can_cancel:=public.company_permission(c,'write',module) and existing.id is null and state not in('cancelled','expired');
 if action='info' then return jsonb_build_object('can_cancel',can_cancel,'source_kind',kind,'source_id',sid,'status',state,'reversal_id',existing.id,'reason',existing.reason);end if;
 if action<>'confirm' or k is null then raise exception 'Operación de reversión no válida';end if;
 if not public.company_permission(c,'write',module) then raise exception 'Sin permiso para cancelar este documento' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(c::text,0));
 select * into cached from access_private.operation_requests where company_id=c and key=k;
 if found then if cached.action<>'document_cancel' or cached.payload<>data then raise exception 'Identificador utilizado con otros datos';end if;return cached.result;end if;
 if exists(select 1 from public.document_cancellations where company_id=c and source_kind=kind and source_id=sid) or state in('cancelled','expired') then raise exception 'El documento ya está cancelado';end if;
 reason:=btrim(data->>'reason');if length(coalesce(reason,'')) not between 5 and 500 then raise exception 'Indica un motivo de 5 a 500 caracteres';end if;
 select coalesce(max(number),0)+1 into n from public.document_cancellations where company_id=c;
 insert into public.document_cancellations(company_id,number,source_kind,source_id,reason,created_by) values(c,n,kind,sid,reason,auth.uid()) returning id into aid;
 if kind='purchase' then
  select * into strict m from public.inventory_movements where company_id=c and source_kind='receipt' and source_id=sid;
  perform access_private.cancellation_withdraw(c,aid,m.id,null);
  update public.purchase_receipts set cancelled_at=clock_timestamp(),cancelled_by=auth.uid(),cancellation_id=aid where company_id=c and id=sid;
 elsif kind='production' then
  for r in select mv.id,l.id lot_id from public.batch_outputs bo join public.inventory_movements mv on mv.company_id=c and mv.source_kind='production_output' and mv.source_id=bo.id join public.inventory_lots l on l.company_id=c and l.source_kind='production_output' and l.source_id=bo.id where bo.company_id=c and bo.batch_id=sid order by bo.id loop
   perform access_private.cancellation_withdraw(c,aid,r.id,r.lot_id);
  end loop;
  for r in select mv.id from public.batch_consumptions bc join public.inventory_movements mv on mv.company_id=c and mv.source_kind='production_consumption' and mv.source_id=bc.id where bc.company_id=c and bc.batch_id=sid order by bc.id loop perform access_private.cancellation_restore(c,aid,r.id);end loop;
  update public.production_batches set state='cancelled',release_note=reason where company_id=c and id=sid;
 elsif kind='sale' then
  if state='dispatched' then
   for r in select mv.id from public.order_lines ol join public.inventory_movements mv on mv.company_id=c and mv.source_kind='order_dispatch' and mv.source_id=ol.id where ol.company_id=c and ol.order_id=sid order by ol.id loop perform access_private.cancellation_restore(c,aid,r.id);end loop;
   update public.sales_orders set status='cancelled',refund_pending=paid_at is not null where company_id=c and id=sid;
  else perform access_private.sales(c,'cancel',gen_random_uuid(),jsonb_build_object('order',sid,'reason',reason));end if;
 else
  select * into strict m from public.inventory_movements where company_id=c and id=sid;
  if m.quantity<0 then perform access_private.cancellation_restore(c,aid,m.id);
  elsif m.quantity>0 then select id into r from public.inventory_lots where company_id=c and source_kind=m.source_kind and source_id=m.source_id;perform access_private.cancellation_withdraw(c,aid,m.id,case when m.item_kind='variant' then r.id else null end);
  else raise exception 'Este movimiento no cambia existencias';end if;
 end if;
 update public.document_cancellations set state='confirmed' where company_id=c and id=aid;
 answer:=jsonb_build_object('id',aid,'number',n,'state','confirmed');
 insert into access_private.operation_requests(company_id,key,action,payload,result) values(c,k,'document_cancel',data,answer);return answer;
end $$;
revoke all on function access_private.document_cancellation(uuid,text,uuid,jsonb) from public,anon,authenticated;

create function access_private.available_stock_cost(c uuid,k text,item uuid,qty numeric) returns numeric language plpgsql stable set search_path='' as $$
declare l record;need numeric:=qty;take numeric;total numeric:=0;known boolean:=true;begin
 for l in select * from public.inventory_lots where company_id=c and item_kind=k and item_id=item and not blocked and remaining>0 order by created_at,id loop
  take:=least(need,l.remaining);
  if l.unit_cost is null then known:=false;else total:=total+take*l.unit_cost;end if;
  need:=need-take;exit when need=0;
 end loop;
 if need>0 then raise exception 'Existencias disponibles insuficientes';end if;
 return case when known then total/qty end;
end $$;
revoke all on function access_private.available_stock_cost(uuid,text,uuid,numeric) from public,anon,authenticated;
CREATE OR REPLACE FUNCTION access_private.guard_partner_use()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare pid uuid;kind text;linked uuid;begin
 if tg_table_name='purchase_receipts' and tg_op='UPDATE' and (to_jsonb(new)-array['cancelled_at','cancelled_by','cancellation_id'])=(to_jsonb(old)-array['cancelled_at','cancelled_by','cancellation_id']) then return new;end if;
 if tg_table_name='sales_orders' then pid:=new.customer_id;kind:='customer';else pid:=new.supplier_id;kind:='supplier';end if;
 if tg_table_name='purchase_receipts' then
  if new.presentation_id is not null then
   select supplier_id into linked from public.presentations where company_id=new.company_id and id=new.presentation_id;
   if linked is not null then
    perform pg_advisory_xact_lock(hashtextextended(new.company_id::text,0));
    if not exists(select 1 from public.business_partners where company_id=new.company_id and id=linked and partner_type='supplier' and active) then raise exception 'La presentación corresponde a un proveedor inactivo';end if;
    if pid is not null and pid<>linked then raise exception 'El proveedor no coincide con la presentación';end if;
   end if;
  end if;
 end if;
 if pid is null then return new;end if;
 -- Existing historical records can still be edited after a partner is deactivated.
 if tg_op='UPDATE' then
  if tg_table_name='sales_orders' then
   if new.customer_id is not distinct from old.customer_id and new.company_id=old.company_id then return new;end if;
  else
   if new.supplier_id is not distinct from old.supplier_id and new.company_id=old.company_id then return new;end if;
  end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(new.company_id::text,0));
 if not exists(select 1 from public.business_partners where company_id=new.company_id and id=pid and partner_type=kind and active) then raise exception 'Selecciona un socio activo del tipo correspondiente';end if;
 return new;
end $function$
;

CREATE OR REPLACE FUNCTION access_private.post_stock_selected(c uuid, k text, item uuid, q numeric, block_delta numeric, reserve_delta numeric, source text, source_uuid uuid, cost numeric, note text, selected_lot uuid, selected_unit uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare movement uuid;lot public.inventory_lots%rowtype;take numeric;needed numeric;total numeric:=0;known boolean:=true;created_lot uuid;valuation text;available_lot numeric;tracked boolean;changed integer;assigned_cost numeric;assigned_known boolean;negative_allowed boolean:=false;short_lot uuid;settling numeric;settlement jsonb:='[]';debt record;purchase_quote jsonb;production_price numeric;begin
 select currency into strict valuation from public.companies where id=c;
 if source='production_consumption' and k='material' then select to_jsonb(p) into purchase_quote from access_private.material_purchase_quote(c,item)p;production_price:=(purchase_quote->>'unit_cost')::numeric;end if;
 if k='material' and source='production_consumption' and q<0 then
  select exists(select 1 from public.batch_consumptions bc join public.production_batches pb on pb.company_id=bc.company_id and pb.id=bc.batch_id
   cross join lateral jsonb_array_elements(coalesce(pb.stock_warnings#>'{confirmation,shortages}','[]'))s
   where bc.company_id=c and bc.id=source_uuid and bc.material_id=item and bc.base_quantity=-q
   and not pb.confirmed and pb.state='in_progress' and pb.stock_warnings#>>'{confirmation,user_id}'=auth.uid()::text
   and pb.stock_warnings#>>'{confirmation,acknowledged}'='true' and s->>'material_id'=item::text and (s->>'required')::numeric=-q) into negative_allowed;
 end if;
 if not negative_allowed and (q<0 or block_delta>0 or reserve_delta>0) and exists(select 1 from public.inventory_balances b where b.company_id=c and b.item_kind=k and b.item_id=item and b.on_hand+q<b.blocked+block_delta+b.reserved+reserve_delta) then raise exception 'Existencias disponibles insuficientes';end if;
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
  if k='material' and source<>'document_reversal' then
   settling:=q;
   for debt in select id,remaining,source_id from public.inventory_lots where company_id=c and item_kind='material' and item_id=item and remaining<0 and id<>created_lot order by created_at,id for update loop
    take:=least(settling,-debt.remaining);exit when take<=0;
    update public.inventory_lots set remaining=remaining+take where company_id=c and id=debt.id;
    update public.inventory_lots set remaining=remaining-take where company_id=c and id=created_lot;
    settlement:=settlement||jsonb_build_array(jsonb_build_object('shortfall_lot_id',debt.id,'consumption_id',debt.source_id,'quantity',take));settling:=settling-take;
   end loop;
  end if;
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
  if needed<>0 then
   if not negative_allowed then raise exception 'No hay lotes disponibles suficientes';end if;
   insert into public.inventory_lots(company_id,item_kind,item_id,remaining,currency,unit_cost,blocked,source_kind,source_id,label)
   values(c,'material',item,-needed,valuation,null,false,'production_shortfall',source_uuid,'Faltante de producción confirmado') returning id into short_lot;
   insert into public.inventory_allocations(company_id,movement_id,lot_id,quantity,unit_cost,currency) values(c,movement,short_lot,needed,null,valuation);
   known:=false;needed:=0;
  end if;
 end if;
 if source='production_consumption' and k='material' then
  -- Formula and production consume the exact same current purchase quote.
  -- Stock allocation tracks quantity only; it does not choose the production price.
  total:=abs(q)*production_price;known:=production_price is not null;
  update public.inventory_allocations set unit_cost=production_price where company_id=c and movement_id=movement;
 end if;
 if source='document_reversal' then
  total:=abs(q)*cost;known:=cost is not null;
  update public.inventory_allocations set unit_cost=cost where company_id=c and movement_id=movement;
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
 update public.inventory_movements im set effective_on=(ctx.data->>'effective_on')::date,unit_cost=case when known and q<>0 then total/abs(q) end,total_value=case when q=0 then 0 when known then sign(q)*total end,currency=valuation,snapshot=ctx.data||case when source='production_consumption' and k='material' then jsonb_build_object('cost_basis','catalog_purchase','purchase_price_reference',purchase_quote) else '{}'::jsonb end||jsonb_build_object('negative_stock_acknowledged',negative_allowed,'shortfall_settlements',settlement),captured=true,
 document_id=case when source='inventory_document' then (select l.document_id from public.inventory_document_lines l where l.company_id=c and l.id=source_uuid) end,
 document_line_id=case when source='inventory_document' then source_uuid end
 from (select access_private.inventory_context(c,k,item,source,source_uuid,clock_timestamp()) data)ctx where im.company_id=c and im.id=movement;
 return jsonb_build_object('movement',movement,'lot',created_lot,'cost',case when known then total else null end);
end $function$
;
CREATE OR REPLACE FUNCTION access_private.inventory_context(c uuid, k text, item uuid, source text, sid uuid, stamp timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare answer jsonb;doc jsonb;did uuid;num text;dt date;typ text;movement_type text;
begin
 if k='material' then
  select jsonb_build_object('sku',m.sku,'name',m.name,'unit',u.symbol,'unit_id',u.id,'classification',m.classification) into answer from public.raw_materials m join public.units u on u.company_id=m.company_id and u.id=m.unit_id where m.company_id=c and m.id=item;
 else
  select jsonb_build_object('sku',v.sku,'name',p.name,'variant',access_private.variant_label(to_jsonb(v)),'product_id',p.id,'product_sku',p.sku,'unit','ud') into answer from public.product_variants v join public.products p on p.company_id=v.company_id and p.id=v.product_id where v.company_id=c and v.id=item;
 end if;
 dt:=(stamp at time zone 'America/Guatemala')::date;did:=sid;typ:=source;movement_type:=case source when 'receipt' then 'entry' when 'production_consumption' then 'production' when 'production_output' then 'production' when 'order_dispatch' then 'sale' when 'adjustment' then 'adjustment' when 'release' then 'release' else source end;
 if source='document_reversal' then
  select to_jsonb(d),coalesce(nullif(e->'origin_snapshot','null'::jsonb),answer) into doc,answer
  from public.document_cancellations d cross join lateral jsonb_array_elements(d.snapshot->'effects')e where d.company_id=c and e->>'effect_id'=sid::text;
  did:=(doc->>'id')::uuid;num:='REV-'||lpad(doc->>'number',6,'0');dt:=((doc->>'created_at')::timestamptz at time zone 'America/Guatemala')::date;typ:='document_reversal';movement_type:='reversal';
 elsif source='inventory_document' then
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
  if source='order_dispatch' and coalesce(doc->>'gift','') not in('','false') then movement_type:='gift';end if;
 else num:='MOV-'||left(sid::text,8);
 end if;
 return coalesce(answer,'{}')||jsonb_build_object('source_document_id',coalesce(did,sid),'source_line_id',sid,'document_number',coalesce(num,left(sid::text,8)),'document_type',typ,'movement_type',movement_type,'effective_on',dt);
end $function$
;
CREATE OR REPLACE FUNCTION access_private.physical_unit_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$begin
 if tg_op='UPDATE' then
  if (new.id,new.company_id,new.lot_id,new.batch_id,new.output_id,new.variant_id,new.weight,new.variant_snapshot,new.created_at,new.cost_snapshot,new.external_code) is distinct from (old.id,old.company_id,old.lot_id,old.batch_id,old.output_id,old.variant_id,old.weight,old.variant_snapshot,old.created_at,old.cost_snapshot,old.external_code) then raise exception 'La identidad, peso y variante histórica de una unidad no cambian';end if;
  if old.status in('sold','retired') and not(
   (old.status='retired' and new.status='available' and exists(
    select 1 from public.inventory_document_lines nl join public.inventory_documents nd on nd.company_id=nl.company_id and nd.id=nl.document_id
    join public.inventory_document_lines ol on ol.company_id=nd.company_id and ol.document_id=nd.reverses_id
    where nl.company_id=new.company_id and nl.movement_id=new.last_movement_id and nd.kind='reversal' and ol.individual_unit_id=old.id and ol.movement_id=old.last_movement_id))
   or(new.status='available' and exists(select 1 from public.document_cancellations dc cross join lateral jsonb_array_elements(dc.snapshot->'effects')e
    where dc.company_id=new.company_id and dc.state='posting' and dc.created_by=auth.uid() and e->>'movement_id'=new.last_movement_id::text and e->>'original_movement_id'=old.last_movement_id::text))
   ) then raise exception 'La unidad ya salió del inventario';end if;
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
   if new.state<>old.state and not((old.state='curing' and new.state='released') or(new.state='cancelled' and exists(select 1 from public.document_cancellations dc where dc.company_id=new.company_id and dc.source_kind='production' and dc.source_id=new.id and dc.state='posting' and dc.created_by=auth.uid()))) then raise exception 'Transición no válida para un lote confirmado';end if;
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
   new.recipe_snapshot:=new.recipe_snapshot||jsonb_build_object('curing',jsonb_build_object('required',coalesce(new.requires_curing,true),'days',new.curing_days,'available_on',new.available_on));
   new.recipe_snapshot:=new.recipe_snapshot||jsonb_build_object('stock_warnings',new.stock_warnings);
   new.confirmed:=true;new.confirmed_at:=now();
  elsif new.confirmed or new.recipe_snapshot is not null then raise exception 'La confirmación requiere el registro transaccional de consumos';end if;
 end if;return new;
end $function$
;
CREATE OR REPLACE FUNCTION access_private.inventory_command(c uuid, action text, data jsonb, k uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare review jsonb;r jsonb;answer jsonb;cached access_private.operation_requests%rowtype;docid uuid;lineid uuid;move jsonb;lotid uuid;unitid uuid;n bigint;sgn numeric;items jsonb;total bigint;page integer;
begin
 if auth.uid() is null or not public.company_permission(c,case when action in('review','confirm') then 'write' else 'read' end,'inventory') then raise exception 'No tienes permiso para esta empresa';end if;
 if action in('cancellation_info','cancel_document') then return access_private.document_cancellation(c,case when action='cancellation_info' then 'info' else 'confirm' end,k,data);end if;
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
  return jsonb_build_object('movement',r,'reversal',(select (to_jsonb(dc)-'snapshot')||jsonb_build_object('original_movement_id',dc.snapshot#>>'{effects,0,original_movement_id}') from public.document_cancellations dc where dc.company_id=c and dc.id=nullif(r->>'source_document_id','')::uuid and r->>'source_kind'='document_reversal'),'cancellation',access_private.document_cancellation(c,'info',null,jsonb_build_object('movement_id',r->>'id')),'lines',(select jsonb_agg(x order by x->>'created_at') from access_private.inventory_ledger_rows(c)x where x->>'source_document_id'=r->>'source_document_id'),
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
  'stock',(select coalesce(jsonb_agg(jsonb_build_object('item_kind',b.item_kind,'item_id',b.item_id,'on_hand',b.on_hand,'blocked',b.blocked,'reserved',b.reserved,'available',b.on_hand-b.blocked-b.reserved,'known_value',(select sum(l.remaining*l.unit_cost) from public.inventory_lots l where l.company_id=c and l.item_kind=b.item_kind and l.item_id=b.item_id),'pending_cost',(select coalesce(sum(abs(l.remaining)),0) from public.inventory_lots l where l.company_id=c and l.item_kind=b.item_kind and l.item_id=b.item_id and l.unit_cost is null))),'[]') from public.inventory_balances b where b.company_id=c)) into answer;return answer;
 end if;
 raise exception 'Acción no válida';
end $function$
;
CREATE OR REPLACE FUNCTION access_private.sales(c uuid, action text, k uuid DEFAULT NULL::uuid, data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$declare o public.sales_orders%rowtype;l record;available numeric;answer jsonb;cached access_private.operation_requests%rowtype;begin
 if auth.uid() is null or not public.company_permission(c,case when action='list' then 'read' else 'write' end,'sales') then raise exception 'Ventas no autorizadas' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(c::text,0));perform access_private.expire_orders(c);
 if action='list' then return jsonb_build_object('orders',coalesce((select jsonb_agg(to_jsonb(so)||jsonb_build_object('lines',(select jsonb_agg(to_jsonb(ol)||jsonb_build_object('physical_units',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'weight',u.weight,'variant_snapshot',u.variant_snapshot,'status',case when u.order_line_id=ol.id then u.status else 'released' end)) from public.inventory_units u where u.company_id=c and (u.order_line_id=ol.id or exists(select 1 from public.inventory_unit_movements h where h.company_id=c and h.unit_id=u.id and (h.order_line_before=ol.id or h.order_line_after=ol.id)))),'[]'))) from public.order_lines ol where ol.company_id=c and ol.order_id=so.id))) from (select * from public.sales_orders where company_id=c order by created_at desc limit 100)so),'[]'),'customers',coalesce((select jsonb_agg(to_jsonb(cs)) from(select * from public.customers where company_id=c and active order by name,id limit 200)cs),'[]'),'variants',coalesce((select jsonb_agg(jsonb_build_object('id',pv.id,'name',pr.name||' · '||access_private.variant_label(to_jsonb(pv)),'sku',pv.sku,'barcode',pv.barcode,'price',access_private.base_sale_price(pv.company_id,pv.id),'currency',(select currency from public.companies where id=c),'available',coalesce(bal.on_hand-bal.blocked-bal.reserved,0),'allow_preorder',pv.allow_preorder)) from public.product_variants pv join public.products pr on pr.company_id=pv.company_id and pr.id=pv.product_id left join public.inventory_balances bal on bal.company_id=pv.company_id and bal.item_kind='variant' and bal.item_id=pv.id where pv.company_id=c and pv.active and pr.active),'[]'));end if;
 if action='create' then return access_private.place_order(c,k,data,true);end if;
 if action not in('paid','cancel','dispatch') or k is null then raise exception 'Operación no válida';end if;
 select * into cached from access_private.operation_requests where company_id=c and key=k;if found then if cached.action<>'sale_'||action or cached.payload<>data then raise exception 'Identificador ya utilizado';end if;return cached.result;end if;
 select * into strict o from public.sales_orders where company_id=c and id=(data->>'order')::uuid for update;
 if action='paid' then if o.status in('cancelled','expired') then raise exception 'El pedido está cancelado o vencido. Registra una nueva venta si corresponde';end if;update public.sales_orders set paid_at=coalesce(paid_at,now()) where company_id=c and id=o.id;
 elsif action='cancel' then
  if o.status='dispatched' then answer:=access_private.document_cancellation(c,'confirm',gen_random_uuid(),jsonb_build_object('source_kind','sale','source_id',o.id,'reason',data->>'reason'));insert into access_private.operation_requests(company_id,key,action,payload,result) values(c,k,'sale_'||action,data,answer);return answer;end if;
  if o.status='pending' then for l in select * from public.order_lines where company_id=c and order_id=o.id loop if l.reserved_quantity>0 then perform access_private.post_stock(c,'variant',l.variant_id,0,0,-l.reserved_quantity,'order_cancel',l.id);end if;end loop;update public.sales_orders set status='cancelled',refund_pending=paid_at is not null where company_id=c and id=o.id;end if;
 elsif o.status<>'dispatched' then
  if o.status<>'pending' then raise exception 'El pedido no puede entregarse';end if;if o.payment='transfer' and o.paid_at is null then raise exception 'Confirma la transferencia recibida antes de entregar';end if;
  for l in select * from public.order_lines where company_id=c and order_id=o.id loop
   select on_hand-blocked-reserved+l.reserved_quantity into available from public.inventory_balances where company_id=c and item_kind='variant' and item_id=l.variant_id;if coalesce(available,0)<l.quantity then raise exception 'Existencias insuficientes; hay unidades pendientes de producir o liberar';end if;
   perform access_private.post_stock(c,'variant',l.variant_id,-l.quantity,0,-l.reserved_quantity,'order_dispatch',l.id);
  end loop;update public.sales_orders set status='dispatched' where company_id=c and id=o.id;
 end if;
 answer:=jsonb_build_object('id',o.id);insert into access_private.operation_requests(company_id,key,action,payload,result) values(c,k,'sale_'||action,data,answer);return answer;
end $function$
;
CREATE OR REPLACE FUNCTION access_private.production_command(c uuid, action text, k uuid DEFAULT NULL::uuid, data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b public.production_batches%rowtype;f public.formulas%rowtype;cached access_private.operation_requests%rowtype;bid uuid;pid uuid;fid uuid;answer jsonb;stock_review jsonb;begin
 if auth.uid() is null or not public.company_permission(c,case when action in('list','detail') then 'read' else 'write' end,'production') then raise exception 'Producción no autorizada' using errcode='42501';end if;
 if action='cancel' then return access_private.document_cancellation(c,'confirm',k,jsonb_build_object('source_kind','production','source_id',data->>'id','reason',data->>'reason'));end if;
 if action='stock_review' then return access_private.production_stock_review(c,data->>'stage',data);end if;
 if action='list' then return coalesce((select jsonb_agg(to_jsonb(pb)||jsonb_build_object('product_name',coalesce(pb.recipe_snapshot#>>'{product,name}',p.name),'formula_code',coalesce(pb.recipe_snapshot#>>'{formula,code}',ff.code),'formula_name',coalesce(pb.recipe_snapshot#>>'{formula,name}',revision.name),'formula_version',coalesce((pb.recipe_snapshot#>>'{formula,version}')::integer,revision.version),'outputs',coalesce((select jsonb_agg(to_jsonb(o)||jsonb_build_object('variant_name',pv.name)) from public.batch_outputs o join public.product_variants pv on pv.company_id=o.company_id and pv.id=o.variant_id where o.company_id=c and o.batch_id=pb.id),'[]')) order by pb.batch_number desc) from public.production_batches pb join public.products p on p.company_id=pb.company_id and p.id=pb.product_id left join public.formulas revision on revision.company_id=pb.company_id and revision.id=pb.formula_id left join public.formula_families ff on ff.company_id=revision.company_id and ff.id=revision.family_id where pb.company_id=c),'[]');end if;
 if action='detail' then
  select * into strict b from public.production_batches where company_id=c and id=(data->>'id')::uuid;
  return jsonb_build_object('batch',to_jsonb(b),'snapshot',b.recipe_snapshot,'legacy_consumptions',case when b.confirmed and b.recipe_snapshot is null then coalesce((select jsonb_agg(jsonb_build_object('material_id',material_id,'base_quantity',base_quantity,'cost',cost)) from public.batch_consumptions where company_id=c and batch_id=b.id),'[]') else '[]'::jsonb end);
 end if;
 if action not in('draft_save','start') or k is null then raise exception 'Acción de lote inválida';end if;
 perform pg_advisory_xact_lock(hashtextextended(c::text,0));
 select * into cached from access_private.operation_requests where company_id=c and key=k;
 if found then if cached.action<>'production_'||action or cached.payload<>data then raise exception 'Identificador utilizado con otros datos';end if;return cached.result;end if;
 if action='draft_save' then
  stock_review:=access_private.production_stock_review(c,'draft',data);
  if jsonb_array_length(stock_review->'shortages')>0 and (coalesce((data->>'acknowledge_shortages')::boolean,false)=false or data->>'stock_proof' is distinct from stock_review->>'proof') then raise exception 'Hay materiales insuficientes o cambiaron las existencias. Revisa la advertencia y confirma si deseas guardar el borrador';end if;
 end if;
 bid:=nullif(data->>'id','')::uuid;
 if bid is not null then select * into strict b from public.production_batches where company_id=c and id=bid;end if;
 if action='start' then
  if b.id is null or b.state<>'draft' then raise exception 'Selecciona un lote borrador';end if;
  if b.formula_id is null then raise exception 'Selecciona una versión válida antes de preparar el lote';end if;
  select * into strict f from public.formulas where company_id=c and id=b.formula_id and product_id=b.product_id and state<>'inactive';
  update public.production_batches set state='in_progress',requires_curing=f.requires_curing,curing_days=f.curing_days,available_on=b.production_date+f.curing_days,planned_quantity=access_private.planned_production_units(f.estimated_units,b.formula_scale) where company_id=c and id=bid;
 else
  if b.id is not null and b.state<>'draft' then raise exception 'Solo puedes editar un lote borrador';end if;
  pid:=(data->>'product')::uuid;fid:=nullif(data->>'formula','')::uuid;
  perform 1 from public.products where company_id=c and id=pid and active;if not found then raise exception 'Producto no disponible';end if;
  if fid is null then raise exception 'Selecciona una fórmula con unidades estimadas';end if;
  select * into f from public.formulas where company_id=c and id=fid and product_id=pid and state<>'inactive';if not found then raise exception 'La versión no corresponde al producto o está inactiva';end if;
  if b.id is null then
   insert into public.production_batches(company_id,product_id,formula_id,planned_quantity,formula_scale,production_date,available_on,currency,notes,state,requires_curing,curing_days)
   values(c,pid,fid,access_private.planned_production_units(f.estimated_units,coalesce(nullif(data->>'formula_scale','')::numeric,1)),coalesce((data->>'formula_scale')::numeric,1),(data->>'date')::date,(data->>'date')::date+f.curing_days,(select currency from public.companies where id=c),left(coalesce(data->>'notes',''),1000),'draft',f.requires_curing,f.curing_days) returning id into bid;
  else
   update public.production_batches set product_id=pid,formula_id=fid,requires_curing=f.requires_curing,curing_days=f.curing_days,planned_quantity=access_private.planned_production_units(f.estimated_units,coalesce(nullif(data->>'formula_scale','')::numeric,1)),formula_scale=coalesce((data->>'formula_scale')::numeric,1),production_date=(data->>'date')::date,available_on=(data->>'date')::date+f.curing_days,notes=left(coalesce(data->>'notes',''),1000) where company_id=c and id=bid;
  end if;
 end if;
 if action='draft_save' then update public.production_batches set stock_warnings=jsonb_set(stock_warnings,'{draft}',stock_review||jsonb_build_object('acknowledged',coalesce((data->>'acknowledge_shortages')::boolean,false),'user_id',auth.uid(),'recorded_at',clock_timestamp())) where company_id=c and id=bid;end if;
 answer:=jsonb_build_object('id',bid);
 insert into access_private.operation_requests(company_id,key,action,payload,result) values(c,k,'production_'||action,data,answer);return answer;
end $function$
;
CREATE OR REPLACE FUNCTION access_private.report_summary(c uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$begin
 if auth.uid() is null or not public.company_permission(c,'read','reports') then raise exception 'Reportes no autorizados' using errcode='42501';end if;
 return jsonb_build_object('materials',(select count(*) from public.raw_materials where company_id=c and active),'products',(select count(*) from public.products where company_id=c and active),'variants',(select count(*) from public.product_variants where company_id=c and active),'batches',(select count(*) from public.production_batches where company_id=c),'units_available',coalesce((select sum(on_hand-blocked-reserved) from public.inventory_balances where company_id=c and item_kind='variant'),0),'units_curing',coalesce((select sum(blocked) from public.inventory_balances where company_id=c and item_kind='variant'),0),'units_reserved',coalesce((select sum(reserved) from public.inventory_balances where company_id=c and item_kind='variant'),0),'orders_pending',(select count(*) from public.sales_orders where company_id=c and status='pending'),'sales',coalesce((select jsonb_agg(to_jsonb(z)) from(select currency,count(*) as orders,sum(total) as total,coalesce(sum(total) filter(where paid_at is null),0) as unpaid from public.sales_orders where company_id=c and status='dispatched' group by currency)z),'[]'),'purchases',coalesce((select jsonb_agg(to_jsonb(z)) from(select currency,count(*) as receipts,sum(amount) as total from public.purchase_receipts where company_id=c and cancelled_at is null group by currency)z),'[]'),'stock_value',coalesce((select jsonb_agg(to_jsonb(z)) from(select currency,sum(remaining*unit_cost) as known_value,count(*) filter(where unit_cost is null) as unknown_lots from public.inventory_lots where company_id=c and remaining>0 group by currency)z),'[]'));
end $function$
;
CREATE OR REPLACE FUNCTION access_private.inventory_document_review(c uuid, data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
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
    select * into lot from public.inventory_lots il where il.company_id=c and il.item_kind=r->>'item_kind' and il.item_id=item and not il.blocked and il.remaining>=bqty order by il.created_at,il.id limit 1;
    lotid:=lot.id;
    if lotid is null then lot.currency:=ccy;lot.unit_cost:=access_private.available_stock_cost(c,r->>'item_kind',item,bqty);end if;
   end if;
   if lotid is not null then select * into strict lot from public.inventory_lots where company_id=c and id=lotid and item_kind=r->>'item_kind' and item_id=item and not blocked and remaining>=bqty;end if;
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
end $function$
;


