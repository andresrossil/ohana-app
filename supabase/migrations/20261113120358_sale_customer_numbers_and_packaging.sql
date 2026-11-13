alter table public.sales_orders add column customer_sequence bigint, add column invoice_number text;
create unique index sales_customer_sequence_unique on public.sales_orders(company_id,customer_id,customer_sequence) where customer_sequence is not null;
create unique index sales_invoice_number_unique on public.sales_orders(company_id,invoice_number) where invoice_number is not null;

create function access_private.assign_customer_invoice_number()
returns trigger language plpgsql security definer set search_path='' as $$
declare prefix text; seq bigint; candidate text;
begin
  if old.invoice_number is not null then
    if new.customer_id is distinct from old.customer_id or new.invoice_number is distinct from old.invoice_number
       or new.customer_sequence is distinct from old.customer_sequence then
      raise exception 'Una factura numerada conserva su cliente y número';
    end if;
    return new;
  end if;
  if old.fulfillment_stage<>'draft' or new.fulfillment_stage<>'invoiced' then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('invoice-number:'||new.company_id::text,0));
  select code into prefix from public.business_partners where company_id=new.company_id and id=new.customer_id;
  if nullif(trim(prefix),'') is null then raise exception 'El cliente necesita un código para numerar el pedido'; end if;
  select coalesce(max(customer_sequence),0)+1 into seq from public.sales_orders
    where company_id=new.company_id and customer_id=new.customer_id and customer_sequence is not null;
  loop
    candidate:=prefix||'-'||lpad(seq::text,greatest(4,length(seq::text)),'0');
    exit when not exists(select 1 from public.sales_orders where company_id=new.company_id and invoice_number=candidate);
    seq:=seq+1;
  end loop;
  new.customer_sequence:=seq;
  new.invoice_number:=candidate;
  return new;
end $$;
revoke all on function access_private.assign_customer_invoice_number() from public,anon,authenticated;
create trigger sale_customer_invoice_number before update of fulfillment_stage,customer_id,invoice_number,customer_sequence
  on public.sales_orders for each row execute function access_private.assign_customer_invoice_number();

create table access_private.order_packaging (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  order_id uuid not null,
  material_id uuid not null,
  quantity numeric(20,8) not null check(quantity>0),
  returned_at timestamptz,
  foreign key(company_id,order_id) references public.sales_orders(company_id,id),
  foreign key(company_id,material_id) references public.raw_materials(company_id,id)
);
create unique index order_packaging_active on access_private.order_packaging(company_id,order_id,material_id) where returned_at is null;

create function access_private.return_order_packaging()
returns trigger language plpgsql security definer set search_path='' as $$
declare package_row record; allocation record; move_id uuid; restored numeric;
begin
  if old.status<>'dispatched' or new.status not in ('pending','cancelled') then return null; end if;
  perform set_config('ohana.return_packaging_order',new.id::text,true);
  for package_row in select * from access_private.order_packaging
    where company_id=new.company_id and order_id=new.id and returned_at is null order by material_id for update
  loop
    select id into strict move_id from public.inventory_movements
      where company_id=new.company_id and source_kind='order_packaging' and source_id=package_row.id;
    restored:=0;
    for allocation in select * from public.inventory_allocations
      where company_id=new.company_id and movement_id=move_id order by lot_id
    loop
      -- The return source resolves to the order through the original movement ID.
      perform access_private.post_stock_selected(new.company_id,'material',package_row.material_id,
        allocation.quantity,0,0,'order_packaging_return',gen_random_uuid(),allocation.unit_cost,
        'Devolución de empaque adicional del pedido',allocation.lot_id,null);
      restored:=restored+allocation.quantity;
    end loop;
    if restored<>package_row.quantity then raise exception 'No se pudo devolver todo el empaque del pedido'; end if;
    update access_private.order_packaging set returned_at=now() where id=package_row.id;
  end loop;
  perform set_config('ohana.return_packaging_order','',true);
  return null;
end $$;
revoke all on function access_private.return_order_packaging() from public,anon,authenticated;
create trigger sale_return_packaging after update of status on public.sales_orders
  for each row execute function access_private.return_order_packaging();

do $migration$
declare definition text; marker text;
begin
  definition:=pg_get_functiondef('access_private.sales_fulfillment(uuid,text,uuid,jsonb)'::regprocedure);
  marker:='return jsonb_build_object(''order'',to_jsonb(so),';
  if strpos(definition,marker)=0 or strpos(definition,'target:=''finished'';')=0 then
    raise exception 'La función de preparación cambió';
  end if;
  definition:=replace(definition,'rev uuid;', 'rev uuid; supply record; packaging_id uuid;');
  definition:=replace(definition,marker,
    $sql$return jsonb_build_object('order',to_jsonb(so),'packaging_options',case when so.fulfillment_stage='preparing' then
      (select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'sku',m.sku,'unit',u.symbol,
        'available',coalesce(b.on_hand-b.blocked-b.reserved,0)) order by m.name),'[]')
       from public.raw_materials m join public.units u on u.company_id=c and u.id=m.unit_id
       left join public.inventory_balances b on b.company_id=c and b.item_kind='material' and b.item_id=m.id
       where m.company_id=c and m.active and m.classification in ('Material de empaque','Insumos')) else '[]'::jsonb end,$sql$);
  definition:=replace(definition,'target:=''finished'';',
    $sql$
    if jsonb_typeof(coalesce(data->'packaging','[]'))<>'array' then raise exception 'Empaque inválido'; end if;
    if jsonb_array_length(coalesce(data->'packaging','[]'))>100 then raise exception 'Máximo 100 insumos por pedido'; end if;
    if exists(select 1 from jsonb_array_elements(coalesce(data->'packaging','[]')) e group by (e->>'material')::uuid having count(*)>1)
      then raise exception 'Cada insumo debe aparecer una sola vez'; end if;
    for supply in select m.id,m.name,m.active,m.classification,(e->>'quantity')::numeric quantity
      from jsonb_array_elements(coalesce(data->'packaging','[]')) e
      left join public.raw_materials m on m.company_id=c and m.id=(e->>'material')::uuid order by m.id
    loop
      if supply.id is null or not supply.active or supply.classification not in ('Material de empaque','Insumos')
        or not coalesce(supply.quantity>0 and supply.quantity<1e12 and supply.quantity=round(supply.quantity,8),false)
      then raise exception 'Selecciona un empaque o insumo activo y una cantidad positiva'; end if;
      if supply.quantity>coalesce((select b.on_hand-b.blocked-b.reserved from public.inventory_balances b
          where b.company_id=c and b.item_kind='material' and b.item_id=supply.id),0)
      then raise exception 'Existencias insuficientes de %',supply.name; end if;
      insert into access_private.order_packaging(company_id,order_id,material_id,quantity)
        values(c,so.id,supply.id,supply.quantity) returning id into packaging_id;
      perform access_private.post_stock(c,'material',supply.id,-supply.quantity,0,0,'order_packaging',packaging_id,null,'Empaque adicional del pedido');
    end loop;
    target:='finished';$sql$);
  execute definition;

  definition:=pg_get_functiondef('access_private.sales_worklist(uuid,text,jsonb)'::regprocedure);
  execute replace(replace(definition,'o.id,o.number,o.created_at','o.id,o.number,o.invoice_number,o.created_at'),
    '''number'',o.number,''customer_id''','''number'',o.number,''invoice_number'',o.invoice_number,''customer_id''');

  definition:=pg_get_functiondef('access_private.inventory_context(uuid,text,uuid,text,uuid,timestamptz)'::regprocedure);
  marker:='elsif source like ''order_%'' then';
  if strpos(definition,marker)=0 then raise exception 'Falta la referencia de inventario del pedido'; end if;
  definition:=replace(definition,marker,$sql$
  elsif source in ('order_packaging','order_packaging_return') then
    if source='order_packaging' then
      select o.id,to_jsonb(o) into did,doc from access_private.order_packaging p
      join public.sales_orders o on o.company_id=p.company_id and o.id=p.order_id
      where p.company_id=c and p.id=sid;
    else
      -- The return's source UUID is unique per allocation. Resolve the order
      -- through the caller's transaction-local reference.
      select o.id,to_jsonb(o) into did,doc from public.sales_orders o
      where o.company_id=c and o.id=nullif(current_setting('ohana.return_packaging_order',true),'')::uuid;
    end if;
    num:=coalesce(doc->>'invoice_number','PED-'||coalesce(doc->>'number',left(did::text,8)));
    movement_type:=case when source='order_packaging' then 'sale' else 'reversal' end;
  elsif source like 'order_%' then$sql$);
  execute replace(definition,$old$num:='PED-'||coalesce(doc->>'number',doc->>'order_number',left(did::text,8));$old$,
    $new$num:=coalesce(doc->>'invoice_number','PED-'||coalesce(doc->>'number',doc->>'order_number',left(did::text,8)));$new$);

  definition:=pg_get_functiondef('access_private.document_cancellation(uuid,text,uuid,jsonb)'::regprocedure);
  execute replace(definition,$old$elsif m.source_kind like 'order_%' then$old$,$new$
  elsif m.source_kind='order_packaging_return' then
    return jsonb_build_object('can_cancel',false,'message','Este movimiento ya es una devolución de empaque');
  elsif m.source_kind='order_packaging' then
    kind:='sale';sid:=(select order_id from access_private.order_packaging where company_id=c and id=m.source_id);
  elsif m.source_kind like 'order_%' then$new$);
end $migration$;
