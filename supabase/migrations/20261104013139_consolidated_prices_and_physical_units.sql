-- Central prices: retain one master per list/variant and protect JSON historical references.
create function access_private.price_entry_used(c uuid,e uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.order_lines where company_id=c and price_reference->>'entry_id'=e::text)
 or exists(select 1 from public.production_batches where company_id=c and confirmed and recipe_snapshot#>>'{additional_costs,price_reference,entry_id}'=e::text)
$$;
create function access_private.price_list_used(c uuid,l uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.order_lines where company_id=c and price_reference->>'list_id'=l::text)
 or exists(select 1 from public.production_batches where company_id=c and confirmed and recipe_snapshot#>>'{additional_costs,price_reference,list_id}'=l::text)
$$;
revoke all on function access_private.price_entry_used(uuid,uuid),access_private.price_list_used(uuid,uuid) from public,anon,authenticated;
create function access_private.price_entry_guard() returns trigger language plpgsql set search_path='' as $$begin
 if tg_op='DELETE' then
  if access_private.price_entry_used(old.company_id,old.id) then raise exception 'El precio tiene referencias históricas. Puedes desactivarlo, pero no eliminarlo';end if;return old;
 end if;
 if (new.id,new.company_id,new.list_id,new.variant_id) is distinct from (old.id,old.company_id,old.list_id,old.variant_id) then raise exception 'La identidad de un precio no cambia. Crea un registro para la otra variante';end if;return new;
end $$;
create trigger price_entry_guard before update or delete on public.price_list_entries for each row execute function access_private.price_entry_guard();
revoke all on function access_private.price_entry_guard() from public,anon,authenticated;
create function public.base_price_list(p_company uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',id,'name',name) from public.price_lists where company_id=p_company and is_base and active
 and auth.uid() is not null and (public.company_permission(p_company,'read','catalog') or public.company_permission(p_company,'read','production') or public.company_permission(p_company,'read','sales'))
$$;
revoke all on function public.base_price_list(uuid) from public,anon;grant execute on function public.base_price_list(uuid) to authenticated;
do $patch$declare d text;begin
 d:=pg_get_functiondef('access_private.price_list_command(uuid,text,jsonb)'::regprocedure);
 d:=replace(d,'target uuid;begin','target uuid;line jsonb;batch uuid;cached access_private.operation_requests%rowtype;result jsonb;begin');
 d:=replace(d,$s$'active',active) order by name) from public.product_variants$s$,$s$'active',active,'weight_min',weight_min,'weight_max',weight_max,'attributes',attributes) order by product_id,weight_min nulls last,name) from public.product_variants$s$);
 d:=replace(d,$s$if action='save_list' then$s$,$new$
 if action='save_grid' then
  batch:=nullif(data->>'batch_id','')::uuid;
  if batch is null then raise exception 'Falta identificador de guardado';end if;
  select * into cached from access_private.operation_requests where company_id=c and key=batch;
  if found then if cached.action<>'price_grid' or cached.payload<>data then raise exception 'Identificador utilizado con otros datos';end if;return cached.result;end if;
  select * into strict l from public.price_lists where company_id=c and id=(data->>'list_id')::uuid and active for update;
  if jsonb_typeof(data->'rows')<>'array' or jsonb_array_length(data->'rows') not between 1 and 500 then raise exception 'Guarda entre 1 y 500 precios';end if;
  if exists(select 1 from jsonb_array_elements(data->'rows')r group by r->>'variant_id' having count(*)>1) then raise exception 'Una variante solo puede aparecer una vez en la lista';end if;
  for line in select value from jsonb_array_elements(data->'rows') loop
   e:=null;
   select * into e from public.price_list_entries where company_id=c and list_id=l.id and variant_id=(line->>'variant_id')::uuid for update;
   if e.id is distinct from nullif(line->>'id','')::uuid or coalesce(e.revision,0) is distinct from coalesce((line->>'revision')::integer,0) then raise exception 'Un precio cambió en otra sesión. Actualiza antes de guardar';end if;
   if coalesce((line->>'delete')::boolean,false) then
    if e.id is not null then delete from public.price_list_entries where company_id=c and id=e.id;end if;
   else
    if nullif(line->>'price','') is null then raise exception 'Indica un precio. Para quitar un registro usa Eliminar';end if;
    perform 1 from public.product_variants where company_id=c and id=(line->>'variant_id')::uuid;
    if not found then raise exception 'La variante no pertenece a esta empresa';end if;
    if e.id is null then
     insert into public.price_list_entries(company_id,list_id,variant_id,price,currency,active) values(c,l.id,(line->>'variant_id')::uuid,(line->>'price')::numeric,(select currency from public.companies where id=c),coalesce((line->>'active')::boolean,true));
    else update public.price_list_entries set price=(line->>'price')::numeric,currency=(select currency from public.companies where id=c),active=coalesce((line->>'active')::boolean,true),revision=revision+1 where company_id=c and id=e.id;
    end if;
   end if;
  end loop;
  result:=jsonb_build_object('saved',jsonb_array_length(data->'rows'));
  insert into access_private.operation_requests(company_id,key,action,payload,result) values(c,batch,'price_grid',data,result);return result;
 elsif action='delete_list' then
  select * into strict l from public.price_lists where company_id=c and id=(data->>'id')::uuid for update;
  if l.is_base then raise exception 'Asigna otra lista base antes de eliminar esta lista';end if;
  if l.revision is distinct from (data->>'revision')::integer then raise exception 'La lista cambió. Actualiza antes de eliminar';end if;
  if access_private.price_list_used(c,l.id) or exists(select 1 from public.price_list_entries pe where pe.company_id=c and pe.list_id=l.id and access_private.price_entry_used(c,pe.id)) then raise exception 'La lista tiene referencias históricas. Puedes desactivarla, pero no eliminarla';end if;
  delete from public.price_list_entries where company_id=c and list_id=l.id;
  delete from public.price_lists where company_id=c and id=l.id;return jsonb_build_object('id',l.id);
 elsif action='save_list' then$new$);
 if strpos(d,'price_grid')=0 or strpos(d,'''weight_min'',weight_min')=0 then raise exception 'Comando de listas no reconocido';end if;execute d;
 d:=pg_get_functiondef('access_private.price_list_guard()'::regprocedure);
 d:=replace(d,'if old.is_base then', $s$if access_private.price_list_used(old.company_id,old.id) then raise exception 'La lista tiene historial; puedes desactivarla, no eliminarla';end if;if old.is_base then$s$);execute d;
 -- The public quote must agree with storefront and the final transaction.
 d:=pg_get_functiondef('access_private.checkout_quote(uuid,jsonb)'::regprocedure);
 d:=replace(d,'sub:=sub+q*v.price;',$s$if access_private.base_sale_price(c,v.id) is null then raise exception 'Pendiente de precio de lista base';end if;sub:=sub+q*access_private.base_sale_price(c,v.id);$s$);
 d:=replace(d,'and pv.currency=ccy','and access_private.base_sale_price(c,pv.id) is not null');execute d;
end $patch$;
-- Normalize only future inserts and actual field changes; never rewrite existing catalogs/history.
create function access_private.admin_text() returns trigger language plpgsql set search_path='' as $$begin
 if tg_table_name<>'business_partners' or new.partner_type='supplier' then
  if tg_op='INSERT' then new.name:=upper(btrim(new.name));
  elsif new.name is distinct from old.name then new.name:=upper(btrim(new.name));end if;
 end if;
 if tg_table_name in('raw_materials','products','product_variants') then
  if tg_op='INSERT' then new.sku:=upper(nullif(btrim(new.sku),''));
  elsif new.sku is distinct from old.sku then new.sku:=upper(nullif(btrim(new.sku),''));end if;
 end if;
 if tg_table_name='business_partners' then
  if tg_op='INSERT' then new.email:=lower(btrim(new.email));
  elsif new.email is distinct from old.email then new.email:=lower(btrim(new.email));end if;
 end if;
 if tg_table_name='products' and (tg_op='INSERT' or new.name is distinct from old.name) then
  perform pg_advisory_xact_lock(hashtextextended(new.company_id::text,0));
  if exists(select 1 from public.products p where p.company_id=new.company_id and p.id<>new.id and public.catalog_key(p.name)=public.catalog_key(new.name)) then raise exception 'Ya existe un producto con ese nombre en esta empresa';end if;
 end if;
 if tg_table_name='product_variants' then
  perform pg_advisory_xact_lock(hashtextextended(new.company_id::text,0));
  if exists(select 1 from public.product_variants p where p.company_id=new.company_id and p.product_id=new.product_id and p.id<>new.id and public.catalog_key(p.name)=public.catalog_key(new.name) and access_private.normalize_attributes(p.attributes)=access_private.normalize_attributes(new.attributes) and p.weight_min is not distinct from new.weight_min and p.weight_max is not distinct from new.weight_max) then raise exception 'Ya existe esa variante con el mismo nombre, atributos y rango';end if;
 end if;
 return new;end $$;
revoke all on function access_private.admin_text() from public,anon,authenticated;
do $$declare t text;begin foreach t in array array['raw_materials','products','product_variants','business_partners','catalog_origins','additional_cost_catalog'] loop
 execute format('create trigger aa_admin_text before insert or update on public.%I for each row execute function access_private.admin_text()',t);
end loop;end $$;
notify pgrst,'reload schema';

-- Physical-unit detail extends existing lots/movements; it is not a second stock ledger.
alter table public.order_lines add constraint order_lines_company_identity unique(company_id,id);
create table public.inventory_units(
 id uuid primary key default gen_random_uuid(),company_id uuid not null,lot_id uuid not null,batch_id uuid not null,output_id uuid not null,variant_id uuid not null,
 weight numeric(16,4) not null check(weight>0 and weight<1e12),variant_snapshot jsonb not null,
 status text not null check(status in('curing','available','reserved','sold','retired')),order_line_id uuid,last_movement_id uuid not null,created_at timestamptz not null default now(),
 unique(company_id,id),
 foreign key(company_id,lot_id) references public.inventory_lots(company_id,id),
 foreign key(company_id,batch_id) references public.production_batches(company_id,id),
 foreign key(company_id,output_id) references public.batch_outputs(company_id,id),
 foreign key(company_id,variant_id) references public.product_variants(company_id,id),
 foreign key(company_id,order_line_id) references public.order_lines(company_id,id),
 foreign key(company_id,last_movement_id) references public.inventory_movements(company_id,id),
 check((status in('reserved','sold'))=(order_line_id is not null))
);
create index physical_unit_lot on public.inventory_units(company_id,lot_id,status);
create index physical_unit_batch on public.inventory_units(company_id,batch_id);
create index physical_unit_output on public.inventory_units(company_id,output_id);
create index physical_unit_variant on public.inventory_units(company_id,variant_id,status);
create index physical_unit_order on public.inventory_units(company_id,order_line_id);
create index physical_unit_movement on public.inventory_units(company_id,last_movement_id);
create table public.inventory_unit_movements(
 company_id uuid not null,unit_id uuid not null,movement_id uuid not null,status_before text,status_after text not null,
 order_line_before uuid,order_line_after uuid,created_at timestamptz not null default now(),
 primary key(company_id,movement_id,unit_id),
 foreign key(company_id,unit_id) references public.inventory_units(company_id,id),
 foreign key(company_id,movement_id) references public.inventory_movements(company_id,id),
 foreign key(company_id,order_line_before) references public.order_lines(company_id,id),
 foreign key(company_id,order_line_after) references public.order_lines(company_id,id)
);
create index physical_history_unit on public.inventory_unit_movements(company_id,unit_id,created_at);
create index physical_history_order_before on public.inventory_unit_movements(company_id,order_line_before);
create index physical_history_order_after on public.inventory_unit_movements(company_id,order_line_after);
alter table public.inventory_units enable row level security;alter table public.inventory_unit_movements enable row level security;
revoke all on public.inventory_units,public.inventory_unit_movements from public,anon,authenticated;
grant select on public.inventory_units,public.inventory_unit_movements to authenticated;
create policy physical_units_read on public.inventory_units for select to authenticated using(public.company_permission(company_id,'read','inventory') or public.company_permission(company_id,'read','production') or public.company_permission(company_id,'read','sales'));
create policy physical_history_read on public.inventory_unit_movements for select to authenticated using(public.company_permission(company_id,'read','inventory') or public.company_permission(company_id,'read','production') or public.company_permission(company_id,'read','sales'));
create function access_private.physical_unit_guard() returns trigger language plpgsql set search_path='' as $$begin
 if tg_op='UPDATE' then
  if (new.id,new.company_id,new.lot_id,new.batch_id,new.output_id,new.variant_id,new.weight,new.variant_snapshot,new.created_at) is distinct from (old.id,old.company_id,old.lot_id,old.batch_id,old.output_id,old.variant_id,old.weight,old.variant_snapshot,old.created_at) then raise exception 'La identidad, peso y variante histórica de una unidad no cambian';end if;
  if old.status in('sold','retired') then raise exception 'La unidad ya salió del inventario';end if;
 end if;
 if not exists(select 1 from public.inventory_movements m where m.company_id=new.company_id and m.id=new.last_movement_id and m.item_kind='variant' and m.item_id=new.variant_id) then raise exception 'Movimiento no válido para esta unidad';end if;
 if not exists(select 1 from public.inventory_lots l join public.batch_outputs o on o.company_id=l.company_id and o.id=new.output_id where l.company_id=new.company_id and l.id=new.lot_id and l.item_kind='variant' and l.item_id=new.variant_id and o.variant_id=new.variant_id and o.batch_id=new.batch_id and l.source_kind='production_output' and l.source_id=o.id) then raise exception 'La unidad no corresponde al lote y variante';end if;
 if tg_op='UPDATE' and new.last_movement_id=old.last_movement_id then raise exception 'Cada cambio de estado requiere un movimiento';end if;
 return new;end $$;
create function access_private.physical_unit_history() returns trigger language plpgsql set search_path='' as $$begin
 insert into public.inventory_unit_movements(company_id,unit_id,movement_id,status_before,status_after,order_line_before,order_line_after)
 values(new.company_id,new.id,new.last_movement_id,case when tg_op='UPDATE' then old.status end,new.status,case when tg_op='UPDATE' then old.order_line_id end,new.order_line_id);
 return new;end $$;
revoke all on function access_private.physical_unit_guard(),access_private.physical_unit_history() from public,anon,authenticated;
create trigger physical_unit_guard before insert or update on public.inventory_units for each row execute function access_private.physical_unit_guard();
create trigger physical_unit_history after insert or update on public.inventory_units for each row execute function access_private.physical_unit_history();

-- Keep FIFO valuation, now choosing the physical units actually available to this operation.
create or replace function access_private.post_stock(c uuid,k text,item uuid,q numeric,block_delta numeric,reserve_delta numeric,source text,source_uuid uuid,cost numeric default null,note text default '') returns jsonb
 language plpgsql security invoker set search_path='' as $$
declare movement uuid;lot public.inventory_lots%rowtype;take numeric;needed numeric;total numeric:=0;known boolean:=true;created_lot uuid;valuation text;available_lot numeric;tracked boolean;changed integer;begin
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
   insert into public.inventory_allocations(company_id,movement_id,lot_id,quantity,unit_cost,currency) values(c,movement,lot.id,take,lot.unit_cost,lot.currency);
   if tracked then
    with picked as(select u.id from public.inventory_units u where u.company_id=c and u.lot_id=lot.id and (u.status='available' or(source='order_dispatch' and u.status='reserved' and u.order_line_id=source_uuid))
     order by (u.status='reserved') desc,u.created_at,u.id limit take::integer for update)
    update public.inventory_units u set status=case when source='order_dispatch' then 'sold' else 'retired' end,order_line_id=case when source='order_dispatch' then source_uuid end,last_movement_id=movement
    from picked where u.company_id=c and u.id=picked.id;
    get diagnostics changed=row_count;if changed<>take then raise exception 'No se pudo conservar la asignación individual del inventario';end if;
   end if;
   if lot.unit_cost is null or lot.currency<>valuation then known:=false;else total:=total+take*lot.unit_cost;end if;
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
end $$;
revoke all on function access_private.post_stock(uuid,text,uuid,numeric,numeric,numeric,text,uuid,numeric,text) from public,anon,authenticated;

do $patch$declare d text;oldpart text;begin
 d:=pg_get_functiondef('access_private.operations(uuid,text,uuid,jsonb)'::regprocedure);
 -- Weight-range production now requires an actual weight for every unit.
 d:=replace(d,$s$q:=(r->>'quantity')::integer;
   if r ? 'unit_weights' then$s$,$s$q:=(r->>'quantity')::integer;
   if v.weight_min is not null and not(r ? 'unit_weights') then raise exception 'Esta variante requiere registrar cada unidad por su peso real';end if;
   if r ? 'unit_weights' then$s$);
 oldpart:=$s$perform access_private.post_stock(p_company,'variant',x.variant_id,x.quantity,x.quantity,0,'production_output',x.id,amount,'Lote '||b.id);$s$;
 if strpos(d,oldpart)=0 then raise exception 'Salida de producción no reconocida';end if;
 d:=replace(d,oldpart,$new$
   v_result:=access_private.post_stock(p_company,'variant',x.variant_id,x.quantity,x.quantity,0,'production_output',x.id,amount,'Lote '||b.id);
   insert into public.inventory_units(company_id,lot_id,batch_id,output_id,variant_id,weight,variant_snapshot,status,last_movement_id)
   select p_company,(v_result->>'lot')::uuid,b.id,x.id,x.variant_id,(w.value#>>'{}')::numeric,
    jsonb_build_object('name',pv.name,'sku',pv.sku,'attributes',pv.attributes,'weight_min',pv.weight_min,'weight_max',pv.weight_max,'product_name',pr.name,'product_sku',pr.sku),
    'curing',(v_result->>'movement')::uuid
   from jsonb_array_elements(p_data->'outputs') output_line
   cross join lateral jsonb_array_elements(coalesce(output_line->'unit_weights','[]'::jsonb)) w(value)
   join public.product_variants pv on pv.company_id=p_company and pv.id=x.variant_id
   join public.products pr on pr.company_id=pv.company_id and pr.id=pv.product_id
   where output_line->>'variant'=x.variant_id::text;
$new$);
 execute d;
 -- Associate existing Kardex rows and authenticated sales with physical-unit detail.
 d:=pg_get_functiondef('access_private.sales(uuid,text,uuid,jsonb)'::regprocedure);
 d:=replace(d,$s$to_jsonb(ol)) from public.order_lines$s$,$s$to_jsonb(ol)||jsonb_build_object('physical_units',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'weight',u.weight,'variant_snapshot',u.variant_snapshot,'status',case when u.order_line_id=ol.id then u.status else 'released' end)) from public.inventory_units u where u.company_id=c and (u.order_line_id=ol.id or exists(select 1 from public.inventory_unit_movements h where h.company_id=c and h.unit_id=u.id and (h.order_line_before=ol.id or h.order_line_after=ol.id)))),'[]'))) from public.order_lines$s$);
 execute d;
end $patch$;
create function public.physical_unit_catalog(p_company uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$begin
 if auth.uid() is null or not(public.company_permission(p_company,'read','inventory') or public.company_permission(p_company,'read','production') or public.company_permission(p_company,'read','sales')) then raise exception 'Unidades físicas no autorizadas' using errcode='42501';end if;
 return jsonb_build_object('units',coalesce((select jsonb_agg(to_jsonb(u)) from public.inventory_units u where company_id=p_company),'[]'),
 'history',coalesce((select jsonb_agg(to_jsonb(h)) from public.inventory_unit_movements h where company_id=p_company),'[]'));
end $$;
revoke all on function public.physical_unit_catalog(uuid) from public,anon;grant execute on function public.physical_unit_catalog(uuid) to authenticated;
notify pgrst,'reload schema';
