grant usage on schema access_private to anon;
create table public.customers(id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),name text not null,phone text not null,email text not null default '',address text not null default '',created_at timestamptz not null default now(),unique(company_id,id));
create index customers_company_phone on public.customers(company_id,phone);
create table public.sales_orders(id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),number bigint not null,customer_id uuid not null,customer_snapshot jsonb not null,currency text not null,subtotal numeric(18,2) not null check(subtotal>=0),discount numeric(18,2) not null default 0 check(discount>=0),shipping numeric(18,2) not null default 0 check(shipping>=0),total numeric(18,2) not null check(total>=0),delivery text not null check(delivery in('pickup','delivery')),payment text not null check(payment in('transfer','cash','cod')),status text not null default 'pending' check(status in('pending','dispatched','cancelled','expired')),paid_at timestamptz,refund_pending boolean not null default false,gift text not null default '',gift_message text not null default '',expires_at timestamptz not null default now()+interval '24 hours',created_at timestamptz not null default now(),unique(company_id,id),unique(company_id,number),foreign key(company_id,customer_id) references public.customers(company_id,id));
create index orders_company_status on public.sales_orders(company_id,status,expires_at);
create table public.order_lines(id uuid primary key default gen_random_uuid(),company_id uuid not null,order_id uuid not null,variant_id uuid not null,description text not null,attributes jsonb not null,weight_min numeric,weight_max numeric,quantity integer not null check(quantity between 1 and 1000),unit_price numeric(18,2) not null check(unit_price>=0),reserved_quantity integer not null check(reserved_quantity>=0 and reserved_quantity<=quantity),unique(company_id,order_id,variant_id),foreign key(company_id,order_id) references public.sales_orders(company_id,id),foreign key(company_id,variant_id) references public.product_variants(company_id,id));
create index order_lines_variant on public.order_lines(company_id,variant_id);
do $$declare tab text;begin foreach tab in array array['customers','sales_orders','order_lines']loop execute format('alter table public.%I enable row level security',tab);execute format('revoke all on public.%I from public,anon,authenticated',tab);execute format('grant select on public.%I to authenticated',tab);execute format('create policy scoped_read on public.%I for select to authenticated using(public.company_permission(company_id,''read'',''sales''))',tab);end loop;end $$;
create index operation_request_rate on access_private.operation_requests(company_id,action,created_at);

create function access_private.expire_orders(c uuid) returns void language plpgsql security invoker set search_path='' as $$declare o record;l record;begin
 for o in select id from public.sales_orders where company_id=c and status='pending' and paid_at is null and expires_at<=now() for update loop
  for l in select * from public.order_lines where company_id=c and order_id=o.id loop
   if l.reserved_quantity>0 then perform access_private.post_stock(c,'variant',l.variant_id,0,0,-l.reserved_quantity,'order_expire',l.id);end if;
  end loop;
  update public.sales_orders set status='expired' where company_id=c and id=o.id;
 end loop;
end $$;
revoke all on function access_private.expire_orders(uuid) from public,anon,authenticated;

create function access_private.store_settings(c uuid,data jsonb default null) returns jsonb language plpgsql security definer set search_path='' as $$declare config jsonb;ccy text;n numeric;begin
 if auth.uid() is null or not public.company_permission(c,'manage') then raise exception 'Configuración no autorizada' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(c::text,0));
 select currency into strict ccy from public.companies where id=c;
 if data is null then return coalesce((select details->'store' from public.company_settings where company_id=c),'{}');end if;
 if jsonb_typeof(data)<>'object' then raise exception 'Configuración inválida';end if;
 if nullif(data->>'shipping_fee','') is not null then n:=(data->>'shipping_fee')::numeric;if n<0 or n='NaN' or n>1000000 then raise exception 'Envío inválido';end if;end if;
 if coalesce((data->>'discount_percent')::numeric,0) not between 0 and 100 then raise exception 'Descuento inválido';end if;
 if coalesce(nullif(data->>'gift_threshold','')::numeric,0)<0 or length(coalesce(data->>'gift',''))>250 or length(coalesce(data->>'payment_note',''))>1000 or length(coalesce(data->>'pickup_note',''))>1000 then raise exception 'Configuración inválida';end if;
 config:=jsonb_build_object('published',coalesce((data->>'published')::boolean,false),'pickup',coalesce((data->>'pickup')::boolean,true),'delivery',coalesce((data->>'delivery')::boolean,false),'shipping_fee',nullif(data->>'shipping_fee','')::numeric,'discount_code',upper(trim(coalesce(data->>'discount_code',''))),'discount_percent',coalesce((data->>'discount_percent')::numeric,0),'gift_threshold',nullif(data->>'gift_threshold','')::numeric,'gift',trim(coalesce(data->>'gift','')),'payment_note',coalesce(data->>'payment_note',''),'pickup_note',coalesce(data->>'pickup_note',''),'currency',ccy);
 insert into public.company_settings(company_id,details) values(c,jsonb_build_object('store',config)) on conflict(company_id) do update set details=jsonb_set(public.company_settings.details,'{store}',config),updated_at=now();return config;
end $$;
create function public.store_settings(p_company uuid,p_data jsonb default null) returns jsonb language sql security invoker set search_path='' as $$select access_private.store_settings(p_company,p_data)$$;
revoke all on function access_private.store_settings(uuid,jsonb),public.store_settings(uuid,jsonb) from public,anon;grant execute on function access_private.store_settings(uuid,jsonb),public.store_settings(uuid,jsonb) to authenticated;
do $$declare def text;begin def:=pg_get_functiondef('access_private.save_company_settings(uuid,text,text,jsonb,jsonb,text)'::regprocedure);def:=replace(def,'declare link jsonb; key text;begin','declare link jsonb; key text;begin p_details:=(p_details-''store'')||coalesce((select jsonb_build_object(''store'',details->''store'') from public.company_settings where company_id=p_company and details?''store''),''{}''::jsonb);');execute def;end $$;

create function access_private.is_public_store(c uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.companies co join public.corporations corp on corp.id=co.corporation_id join public.company_settings st on st.company_id=co.id where co.id=c and co.active and corp.active and st.details#>>'{store,published}'='true')$$;
create function access_private.public_asset(path text,bucket text) returns boolean language sql stable security definer set search_path='' as $$select case when bucket='company-logos' then exists(select 1 from public.companies co where co.logo_path=path and path like co.id::text||'/%' and access_private.is_public_store(co.id)) when bucket='catalog-images' then exists(select 1 from public.products pr where pr.photo_path=path and path like pr.company_id::text||'/%' and pr.active and pr.published and access_private.is_public_store(pr.company_id)) else false end$$;
revoke all on function access_private.is_public_store(uuid),access_private.public_asset(text,text) from public;grant execute on function access_private.is_public_store(uuid),access_private.public_asset(text,text) to anon,authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('catalog-images','catalog-images',false,3145728,array['image/png','image/jpeg','image/webp']);
create policy catalog_image_read on storage.objects for select to authenticated using(bucket_id='catalog-images' and public.company_permission((storage.foldername(name))[1]::uuid,'read'));
create policy catalog_image_write on storage.objects for insert to authenticated with check(bucket_id='catalog-images' and public.company_permission((storage.foldername(name))[1]::uuid,'write'));
create policy catalog_image_delete on storage.objects for delete to authenticated using(bucket_id='catalog-images' and public.company_permission((storage.foldername(name))[1]::uuid,'write'));
create policy published_asset_read on storage.objects for select to anon,authenticated using(bucket_id in('company-logos','catalog-images') and access_private.public_asset(name,bucket_id));

create function access_private.storefront(c uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare info jsonb;cfg jsonb;begin
 if not access_private.is_public_store(c) then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended(c::text,0));perform access_private.expire_orders(c);
 select st.details->'store' into cfg from public.company_settings st where st.company_id=c;
 select jsonb_build_object('id',co.id,'name',co.name,'currency',co.currency,'logo_path',co.logo_path,'appearance',st.appearance,'social',coalesce((select jsonb_object_agg(key,value->>'url') from jsonb_each(coalesce(st.details->'social','{}')) where value->>'visible'='true' and value->>'url'~*'^https?://[^ /]+'),'{}'),'policy',cfg,'products',coalesce((select jsonb_agg(jsonb_build_object('id',pr.id,'name',pr.name,'description',pr.description,'photo_path',pr.photo_path,'variants',coalesce((select jsonb_agg(jsonb_build_object('id',pv.id,'name',pv.name,'attributes',pv.attributes,'weight_min',pv.weight_min,'weight_max',pv.weight_max,'price',pv.price,'available',coalesce(bal.on_hand-bal.blocked-bal.reserved,0),'allow_preorder',pv.allow_preorder)) from public.product_variants pv left join public.inventory_balances bal on bal.company_id=pv.company_id and bal.item_kind='variant' and bal.item_id=pv.id where pv.company_id=pr.company_id and pv.product_id=pr.id and pv.active and pv.published and pv.currency=co.currency),'[]'))) from public.products pr where pr.company_id=co.id and pr.active and pr.published),'[]')) into info from public.companies co join public.company_settings st on st.company_id=co.id where co.id=c;
 return info;
end $$;
create function public.storefront(p_company uuid) returns jsonb language sql security invoker set search_path='' as $$select access_private.storefront(p_company)$$;
revoke all on function access_private.storefront(uuid),public.storefront(uuid) from public;grant execute on function access_private.storefront(uuid),public.storefront(uuid) to anon,authenticated;

create function access_private.place_order(c uuid,k uuid,data jsonb,staff boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg jsonb;ccy text;cached access_private.operation_requests%rowtype;r jsonb;v public.product_variants%rowtype;product_name text;stock numeric;qty integer;reserve_qty integer;oid uuid;cid uuid;lid uuid;num bigint;sub numeric:=0;discount_value numeric:=0;shipping_value numeric:=0;phone text;customer jsonb;answer jsonb;begin
 if k is null or data is null then raise exception 'Pedido incompleto';end if;
 if staff then if auth.uid() is null or not public.company_permission(c,'write','sales') then raise exception 'Venta no autorizada' using errcode='42501';end if;elsif not access_private.is_public_store(c) then raise exception 'Tienda no disponible';end if;
 perform pg_advisory_xact_lock(hashtextextended(c::text,0));
 if not staff and not access_private.is_public_store(c) then raise exception 'Tienda no disponible';end if;
 select * into cached from access_private.operation_requests where company_id=c and key=k;
 if found then if cached.action<>(case when staff then 'sale_create' else 'checkout' end) or cached.payload<>data then raise exception 'Identificador utilizado con otros datos';end if;return cached.result;end if;
 perform access_private.expire_orders(c);
 if (select count(*) from access_private.operation_requests where company_id=c and action='checkout' and created_at>now()-interval '1 minute')>=60 then raise exception 'Demasiados pedidos. Intenta nuevamente en un minuto';end if;
 select currency into strict ccy from public.companies where id=c and active;
 select coalesce(details->'store','{}') into cfg from public.company_settings where company_id=c;cfg:=coalesce(cfg,'{}');
 phone:=regexp_replace(coalesce(data#>>'{customer,phone}',''),'[^0-9+]','','g');
 customer:=jsonb_build_object('name',trim(coalesce(data#>>'{customer,name}','')),'phone',phone,'email',trim(coalesce(data#>>'{customer,email}','')),'address',trim(coalesce(data#>>'{customer,address}','')));
 if length(customer->>'name') not between 2 and 120 or phone!~'^\+?[0-9]{7,15}$' or length(customer->>'address')>500 or length(customer->>'email')>254 or (customer->>'email'<>'' and customer->>'email'!~'^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then raise exception 'Revisa los datos de contacto';end if;
 if not staff and (select count(*) from public.sales_orders where company_id=c and customer_snapshot->>'phone'=phone and status='pending' and paid_at is null)>=3 then raise exception 'Ya tienes tres pedidos pendientes. Contacta al negocio';end if;
 if data->>'payment' not in('cash','transfer','cod') or data->>'delivery' not in('pickup','delivery') or data->>'payment' is null or data->>'delivery' is null then raise exception 'Pago o entrega no válidos';end if;
 if data->>'delivery'='delivery' then
  if cfg->>'delivery'<>'true' or cfg->>'currency'<>ccy or cfg->>'shipping_fee' is null or length(customer->>'address')<5 then raise exception 'Entrega no configurada o dirección incompleta';end if;shipping_value:=(cfg->>'shipping_fee')::numeric;
 elsif not staff and coalesce(cfg->>'pickup','true')<>'true' then raise exception 'Retiro no disponible';end if;
 if coalesce(jsonb_typeof(data->'items'),'')<>'array' or jsonb_array_length(data->'items') not between 1 and 30 then raise exception 'El carrito debe contener entre 1 y 30 variantes';end if;
 insert into access_private.child_code_counters(company_id,kind,parent_id,last_value) values(c,'order',c,1) on conflict(company_id,kind,parent_id) do update set last_value=access_private.child_code_counters.last_value+1 returning last_value into num;
 insert into public.customers(company_id,name,phone,email,address) values(c,customer->>'name',phone,customer->>'email',customer->>'address') returning id into cid;
 insert into public.sales_orders(company_id,number,customer_id,customer_snapshot,currency,subtotal,total,shipping,delivery,payment,gift_message) values(c,num,cid,customer,ccy,0,0,shipping_value,data->>'delivery',data->>'payment',left(coalesce(data->>'gift_message',''),500)) returning id into oid;
 for r in select value from jsonb_array_elements(data->'items')loop
  qty:=(r->>'quantity')::integer;if qty not between 1 and 1000 or qty is null then raise exception 'Cantidad inválida';end if;
  select pv.* into strict v from public.product_variants pv join public.products pr on pr.company_id=pv.company_id and pr.id=pv.product_id where pv.company_id=c and pv.id=(r->>'variant')::uuid and pv.active and pr.active and (staff or(pv.published and pr.published)) and pv.currency=ccy;
  select name into product_name from public.products where company_id=c and id=v.product_id;
  select coalesce(on_hand-blocked-reserved,0) into stock from public.inventory_balances where company_id=c and item_kind='variant' and item_id=v.id;stock:=coalesce(stock,0);
  if qty>stock and not v.allow_preorder then raise exception 'No hay suficientes unidades disponibles de %',v.name;end if;reserve_qty:=least(qty,stock)::integer;
  insert into public.order_lines(company_id,order_id,variant_id,description,attributes,weight_min,weight_max,quantity,unit_price,reserved_quantity) values(c,oid,v.id,product_name||' · '||v.name,v.attributes,v.weight_min,v.weight_max,qty,v.price,reserve_qty) returning id into lid;
  if reserve_qty>0 then perform access_private.post_stock(c,'variant',v.id,0,0,reserve_qty,'order_reservation',lid);end if;sub:=sub+qty*v.price;
 end loop;
 if cfg->>'currency'=ccy and length(coalesce(data->>'discount_code',''))>0 then
  if upper(trim(data->>'discount_code'))<>cfg->>'discount_code' then raise exception 'Código de descuento no válido';end if;discount_value:=round(sub*coalesce((cfg->>'discount_percent')::numeric,0)/100,2);
 elsif length(coalesce(data->>'discount_code',''))>0 then raise exception 'Código de descuento no disponible';end if;
 update public.sales_orders set subtotal=sub,discount=discount_value,total=sub-discount_value+shipping_value,gift=case when cfg->>'currency'=ccy and nullif(cfg->>'gift_threshold','') is not null and sub-discount_value>=(cfg->>'gift_threshold')::numeric then coalesce(cfg->>'gift','') else '' end where company_id=c and id=oid;
 answer:=jsonb_build_object('id',oid,'number',num,'subtotal',sub,'discount',discount_value,'shipping',shipping_value,'total',sub-discount_value+shipping_value,'currency',ccy,'expires_at',now()+interval '24 hours');
 insert into access_private.operation_requests(company_id,key,action,payload,result) values(c,k,case when staff then 'sale_create' else 'checkout' end,data,answer);return answer;
exception when no_data_found then raise exception 'Una variante ya no está disponible. Actualiza el catálogo';end $$;
revoke all on function access_private.place_order(uuid,uuid,jsonb,boolean) from public,anon,authenticated;
create function access_private.checkout(c uuid,k uuid,data jsonb) returns jsonb language sql security definer set search_path='' as $$select access_private.place_order(c,k,data,false)$$;
create function public.checkout(p_company uuid,p_key uuid,p_data jsonb) returns jsonb language sql security invoker set search_path='' as $$select access_private.checkout(p_company,p_key,p_data)$$;
revoke all on function access_private.checkout(uuid,uuid,jsonb),public.checkout(uuid,uuid,jsonb) from public;grant execute on function access_private.checkout(uuid,uuid,jsonb),public.checkout(uuid,uuid,jsonb) to anon,authenticated;

create function access_private.sales(c uuid,action text,k uuid default null,data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$declare o public.sales_orders%rowtype;l record;available numeric;answer jsonb;cached access_private.operation_requests%rowtype;begin
 if auth.uid() is null or not public.company_permission(c,case when action='list' then 'read' else 'write' end,'sales') then raise exception 'Ventas no autorizadas' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(c::text,0));perform access_private.expire_orders(c);
 if action='list' then return jsonb_build_object('orders',coalesce((select jsonb_agg(to_jsonb(so)||jsonb_build_object('lines',(select jsonb_agg(to_jsonb(ol)) from public.order_lines ol where ol.company_id=c and ol.order_id=so.id))) from (select * from public.sales_orders where company_id=c order by created_at desc limit 100)so),'[]'),'customers',coalesce((select jsonb_agg(to_jsonb(cs)) from(select * from public.customers where company_id=c order by created_at desc limit 200)cs),'[]'),'variants',coalesce((select jsonb_agg(jsonb_build_object('id',pv.id,'name',pr.name||' · '||pv.name,'sku',pv.sku,'barcode',pv.barcode,'price',pv.price,'currency',pv.currency,'available',coalesce(bal.on_hand-bal.blocked-bal.reserved,0),'allow_preorder',pv.allow_preorder)) from public.product_variants pv join public.products pr on pr.company_id=pv.company_id and pr.id=pv.product_id left join public.inventory_balances bal on bal.company_id=pv.company_id and bal.item_kind='variant' and bal.item_id=pv.id where pv.company_id=c and pv.active and pr.active),'[]'));end if;
 if action='create' then return access_private.place_order(c,k,data,true);end if;
 if action not in('paid','cancel','dispatch') or k is null then raise exception 'Operación no válida';end if;
 select * into cached from access_private.operation_requests where company_id=c and key=k;if found then if cached.action<>'sale_'||action or cached.payload<>data then raise exception 'Identificador ya utilizado';end if;return cached.result;end if;
 select * into strict o from public.sales_orders where company_id=c and id=(data->>'order')::uuid for update;
 if action='paid' then if o.status in('cancelled','expired') then raise exception 'El pedido está cancelado o vencido. Registra una nueva venta si corresponde';end if;update public.sales_orders set paid_at=coalesce(paid_at,now()) where company_id=c and id=o.id;
 elsif action='cancel' then
  if o.status='dispatched' then raise exception 'Un pedido entregado requiere gestionar una devolución';end if;
  if o.status='pending' then for l in select * from public.order_lines where company_id=c and order_id=o.id loop if l.reserved_quantity>0 then perform access_private.post_stock(c,'variant',l.variant_id,0,0,-l.reserved_quantity,'order_cancel',l.id);end if;end loop;update public.sales_orders set status='cancelled',refund_pending=paid_at is not null where company_id=c and id=o.id;end if;
 elsif o.status<>'dispatched' then
  if o.status<>'pending' then raise exception 'El pedido no puede entregarse';end if;if o.payment='transfer' and o.paid_at is null then raise exception 'Confirma la transferencia recibida antes de entregar';end if;
  for l in select * from public.order_lines where company_id=c and order_id=o.id loop
   select on_hand-blocked-reserved+l.reserved_quantity into available from public.inventory_balances where company_id=c and item_kind='variant' and item_id=l.variant_id;if coalesce(available,0)<l.quantity then raise exception 'Existencias insuficientes; hay unidades pendientes de producir o liberar';end if;
   perform access_private.post_stock(c,'variant',l.variant_id,-l.quantity,0,-l.reserved_quantity,'order_dispatch',l.id);
  end loop;update public.sales_orders set status='dispatched' where company_id=c and id=o.id;
 end if;
 answer:=jsonb_build_object('id',o.id);insert into access_private.operation_requests(company_id,key,action,payload,result) values(c,k,'sale_'||action,data,answer);return answer;
end $$;
create function public.sales(p_company uuid,p_action text,p_key uuid default null,p_data jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select access_private.sales(p_company,p_action,p_key,p_data)$$;
revoke all on function access_private.sales(uuid,text,uuid,jsonb),public.sales(uuid,text,uuid,jsonb) from public,anon;grant execute on function access_private.sales(uuid,text,uuid,jsonb),public.sales(uuid,text,uuid,jsonb) to authenticated;
notify pgrst,'reload schema';

-- Public policy omits the private promotion code. Quotes are recalculated by the server.
do $$declare def text;begin
 def:=pg_get_functiondef('access_private.storefront(uuid)'::regprocedure);def:=replace(def,'''policy'',cfg,','''policy'',cfg-''discount_code''-''discount_percent'',');execute def;
 def:=pg_get_functiondef('access_private.place_order(uuid,uuid,jsonb,boolean)'::regprocedure);
 def:=replace(def,'if k is null or data is null then','if k is null or data is null or length(data::text)>30000 then');
 def:=replace(def,'answer:=jsonb_build_object(', 'if nullif(data->>''expected_total'','''') is not null and (data->>''expected_total'')::numeric<>sub-discount_value+shipping_value then raise exception ''El precio cambió. Revisa el total actualizado antes de confirmar'';end if;answer:=jsonb_build_object(');
 execute def;
end $$;
create function access_private.checkout_quote(c uuid,data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$declare cfg jsonb;ccy text;r jsonb;v public.product_variants%rowtype;q integer;sub numeric:=0;disc numeric:=0;ship numeric:=0;stock numeric;begin
 if not access_private.is_public_store(c) then raise exception 'Tienda no disponible';end if;
 perform pg_advisory_xact_lock(hashtextextended(c::text,0));
 select currency into strict ccy from public.companies where id=c;select details->'store' into cfg from public.company_settings where company_id=c;
 if coalesce(jsonb_typeof(data->'items'),'')<>'array' or jsonb_array_length(data->'items') not between 1 and 30 or length(data::text)>30000 then raise exception 'Revisa el carrito';end if;
 for r in select value from jsonb_array_elements(data->'items') loop
  q:=(r->>'quantity')::integer;if q is null or q not between 1 and 1000 then raise exception 'Cantidad inválida';end if;
  select pv.* into strict v from public.product_variants pv join public.products pr on pr.company_id=pv.company_id and pr.id=pv.product_id where pv.company_id=c and pv.id=(r->>'variant')::uuid and pv.active and pv.published and pr.active and pr.published and pv.currency=ccy;
  select on_hand-blocked-reserved into stock from public.inventory_balances where company_id=c and item_kind='variant' and item_id=v.id;
  if coalesce(stock,0)<q and not v.allow_preorder then raise exception 'No hay suficientes unidades de %',v.name;end if;sub:=sub+q*v.price;
 end loop;
 if data->>'delivery'='delivery' then if cfg->>'delivery'<>'true' or cfg->>'currency'<>ccy or cfg->>'shipping_fee' is null then raise exception 'Entrega no disponible';end if;ship:=(cfg->>'shipping_fee')::numeric;elsif data->>'delivery'<>'pickup' then raise exception 'Selecciona entrega';end if;
 if length(coalesce(data->>'discount_code',''))>0 then if cfg->>'currency'<>ccy or upper(trim(data->>'discount_code'))<>cfg->>'discount_code' then raise exception 'Código de descuento no válido';end if;disc:=round(sub*coalesce((cfg->>'discount_percent')::numeric,0)/100,2);end if;
 return jsonb_build_object('subtotal',sub,'discount',disc,'shipping',ship,'total',sub-disc+ship,'currency',ccy);
exception when no_data_found then raise exception 'Una variante ya no está disponible';end $$;
create function public.checkout_quote(p_company uuid,p_data jsonb) returns jsonb language sql security invoker set search_path='' as $$select access_private.checkout_quote(p_company,p_data)$$;
revoke all on function access_private.checkout_quote(uuid,jsonb),public.checkout_quote(uuid,jsonb) from public;grant execute on function access_private.checkout_quote(uuid,jsonb),public.checkout_quote(uuid,jsonb) to anon,authenticated;
