create temporary table partner_integrity_before on commit drop as
select (select count(*) from public.business_partners) partners,
 (select md5(coalesce(string_agg((to_jsonb(b)-'updated_at')::text,',' order by b.id),'')) from public.business_partners b) identity_hash,
 (select md5(coalesce(string_agg(id::text||coalesce(supplier_id::text,''),',' order by id),'')) from public.presentations) presentation_links,
 (select md5(coalesce(string_agg(id::text||coalesce(customer_id::text,''),',' order by id),'')) from public.sales_orders) order_links;
alter table public.business_partners
 add column is_customer boolean not null default false,
 add column is_supplier boolean not null default false,
 add column alternate_code text,
 add column instagram text not null default '',
 add column facebook text not null default '',
 add column phone_secondary text not null default '',
 add column whatsapp_same boolean not null default false,
 add column payment_preference text;
update public.business_partners set is_customer=(partner_type='customer'),is_supplier=(partner_type='supplier');
alter table public.business_partners add constraint partner_roles_present check(is_customer or is_supplier),
 add constraint partner_alternate_valid check(alternate_code is null or alternate_code ~ '^[A-Za-z0-9-]{1,40}$'),
 add constraint partner_extra_contact_valid check(length(instagram)<=200 and length(facebook)<=200 and length(phone_secondary)<=40),
 add constraint partner_payment_valid check(payment_preference is null or payment_preference in('cash','transfer','cod'));
create unique index partners_alternate_unique on public.business_partners(company_id,lower(alternate_code)) where alternate_code is not null;
drop index public.partners_supplier_name;
create unique index partners_supplier_name on public.business_partners(company_id,public.catalog_key(name)) where is_supplier;

create or replace function access_private.guard_partner() returns trigger language plpgsql security definer set search_path='' as $guard$
begin
 perform pg_advisory_xact_lock(hashtextextended(new.company_id::text,0));
 if tg_op='UPDATE' then
  if new.id<>old.id or new.company_id<>old.company_id then raise exception 'La identidad del socio no se puede cambiar';end if;
  new.partner_type:=old.partner_type;new.code:=old.code;
  if (new.is_customer,new.is_supplier) is distinct from (old.is_customer,old.is_supplier) and auth.uid() is not null and not public.company_permission(new.company_id,'manage') then raise exception 'Solo administradores pueden cambiar los tipos de socio' using errcode='42501';end if;
  if not new.is_supplier and (exists(select 1 from public.presentations where company_id=old.company_id and supplier_id=old.id) or exists(select 1 from public.purchase_receipts where company_id=old.company_id and supplier_id=old.id)) then raise exception 'El proveedor tiene relaciones existentes; conserva su tipo';end if;
  if not new.is_customer and exists(select 1 from public.sales_orders where company_id=old.company_id and customer_id=old.id) then raise exception 'El cliente tiene pedidos; conserva su tipo';end if;
 else
  if (new.partner_type='supplier' or new.is_supplier) and auth.uid() is not null and not public.company_permission(new.company_id,'manage') then raise exception 'Solo administradores pueden crear proveedores' using errcode='42501';end if;
  new.code:=access_private.next_partner_code(new.company_id,new.partner_type);
 end if;
 -- Keep the original role for compatibility; adding the other role never changes identity.
 if new.partner_type='customer' then new.is_customer:=true;else new.is_supplier:=true;end if;
 new.name:=trim(new.name);new.alternate_code:=nullif(trim(new.alternate_code),'');
 if new.whatsapp_same then new.whatsapp:=new.phone;end if;
 new.updated_at:=now();return new;
end $guard$;
drop policy partners_read on public.business_partners;
create policy partners_read on public.business_partners for select to authenticated using(
 (is_customer and access_private.partner_read(company_id,'customer')) or (is_supplier and access_private.partner_read(company_id,'supplier'))
);
create or replace view public.suppliers with(security_invoker=true) as select * from public.business_partners where is_supplier with local check option;
create or replace view public.customers with(security_invoker=true) as select * from public.business_partners where is_customer with local check option;
CREATE OR REPLACE FUNCTION access_private.partners(c uuid, action text, data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare p public.business_partners%rowtype;pid uuid; a jsonb;aid uuid;used uuid[]:='{}';n integer;pg integer;cnt bigint;q text;typ text;st text;sort text;dir text;res jsonb;begin
 if auth.uid() is null or not(access_private.partner_read(c,'supplier') or access_private.partner_read(c,'customer')) then raise exception 'Socios no autorizados' using errcode='42501';end if;
 if action='list' then
  q:=left(coalesce(data->>'query',''),120);typ:=coalesce(data->>'type','');st:=coalesce(data->>'status','');pg:=greatest(1,least(coalesce((data->>'page')::int,1),100000));
  sort:=case when data->>'sort' in('code','alternate_code','name','partner_type','phone','active') then data->>'sort' else 'name' end;dir:=case when data->>'direction'='desc' then 'desc' else 'asc' end;
  select count(*) into cnt from public.business_partners b where b.company_id=c and ((b.is_customer and access_private.partner_read(c,'customer')) or (b.is_supplier and access_private.partner_read(c,'supplier'))) and(typ='' or (typ='customer' and b.is_customer and access_private.partner_read(c,'customer')) or (typ='supplier' and b.is_supplier and access_private.partner_read(c,'supplier'))) and(st='' or b.active=(st='active')) and (q='' or concat_ws(' ',b.code,b.alternate_code,b.name,b.phone,b.phone_secondary,b.whatsapp,b.instagram,b.facebook,b.tax_id) ilike '%'||q||'%');
  execute format('select coalesce(jsonb_agg(to_jsonb(z)),''[]'') from(select * from public.business_partners b where b.company_id=$1 and ((b.is_customer and access_private.partner_read($1,''customer'')) or (b.is_supplier and access_private.partner_read($1,''supplier''))) and($2='''' or ($2=''customer'' and b.is_customer and access_private.partner_read($1,''customer'')) or ($2=''supplier'' and b.is_supplier and access_private.partner_read($1,''supplier''))) and($3='''' or b.active=($3=''active'')) and($4='''' or concat_ws('' '',b.code,b.alternate_code,b.name,b.phone,b.phone_secondary,b.whatsapp,b.instagram,b.facebook,b.tax_id) ilike ''%%''||$4||''%%'') order by %I %s,id limit 25 offset $5)z',sort,dir) into res using c,typ,st,q,(pg-1)*25;
  return jsonb_build_object('rows',res,'total',cnt,'canManage',public.company_permission(c,'manage'),'supplierRead',access_private.partner_read(c,'supplier'),'customerRead',access_private.partner_read(c,'customer'));
 end if;
 if action='matches' then
  if not public.company_permission(c,'manage') then raise exception 'Socios no autorizados' using errcode='42501';end if;
  return coalesce((select jsonb_agg(to_jsonb(z)) from(
   select b.id,b.code,b.name,b.is_customer,b.is_supplier from public.business_partners b
   where b.company_id=c and b.id is distinct from nullif(data->>'id','')::uuid and (
    (length(trim(coalesce(data->>'name','')))>=2 and public.catalog_key(b.name) like '%'||public.catalog_key(data->>'name')||'%') or
    (length(trim(coalesce(data->>'instagram','')))>=2 and lower(ltrim(b.instagram,'@'))=lower(ltrim(data->>'instagram','@'))) or
    (length(trim(coalesce(data->>'facebook','')))>=2 and lower(b.facebook)=lower(data->>'facebook')) or
    exists(select 1 from unnest(array[b.phone,b.phone_secondary,b.whatsapp]) v
     cross join unnest(array[data->>'phone',data->>'phone_secondary',data->>'whatsapp']) w
     where length(regexp_replace(w,'[^0-9]','','g'))>=5 and regexp_replace(v,'[^0-9]','','g')=regexp_replace(w,'[^0-9]','','g'))
   ) order by b.name,b.id limit 10)z),'[]'::jsonb);
 end if;
 pid:=nullif(data->>'id','')::uuid;
 if action in('get','save','active') and pid is not null then
  select * into strict p from public.business_partners where company_id=c and id=pid;
  if not ((p.is_customer and access_private.partner_read(c,'customer')) or (p.is_supplier and access_private.partner_read(c,'supplier'))) then raise exception 'Socio no autorizado' using errcode='42501';end if;
 end if;
 if action='get' then
  return jsonb_build_object('partner',to_jsonb(p),'canChangeType',not(exists(select 1 from public.presentations where company_id=c and supplier_id=pid) or exists(select 1 from public.purchase_receipts where company_id=c and supplier_id=pid) or exists(select 1 from public.sales_orders where company_id=c and customer_id=pid)), 'addresses',coalesce((select jsonb_agg(to_jsonb(d) order by is_primary desc,label,id) from public.partner_addresses d where d.company_id=c and d.partner_id=pid),'[]'),
   'related',case when p.is_supplier and(public.company_permission(c,'read','catalog') or public.company_permission(c,'manage')) then
     jsonb_build_object('presentations',coalesce((select jsonb_agg(to_jsonb(z)) from(select pp.id,rm.name material,pp.quantity,u.symbol unit,pp.active from public.presentations pp join public.raw_materials rm on rm.company_id=pp.company_id and rm.id=pp.raw_material_id join public.units u on u.company_id=pp.company_id and u.id=pp.unit_id where pp.company_id=c and pp.supplier_id=pid order by rm.name limit 100)z),'[]'),
     'prices',coalesce((select jsonb_agg(to_jsonb(z)) from(select h.effective_on,h.amount,h.currency,rm.name material from public.price_history h join public.presentations pp on pp.company_id=h.company_id and pp.id=h.presentation_id join public.raw_materials rm on rm.company_id=pp.company_id and rm.id=pp.raw_material_id where pp.company_id=c and pp.supplier_id=pid order by h.effective_on desc nulls last,h.created_at desc limit 100)z),'[]')) else '{}'::jsonb end ||
    case when p.is_supplier and(public.company_permission(c,'read','inventory') or public.company_permission(c,'manage')) then jsonb_build_object('purchases',coalesce((select jsonb_agg(to_jsonb(z)) from(select received_on,reference,quantity,amount,currency from public.purchase_receipts where company_id=c and supplier_id=pid order by created_at desc limit 100)z),'[]')) else '{}'::jsonb end ||
    case when p.is_customer and access_private.partner_read(c,'customer') then jsonb_build_object('orders',coalesce((select jsonb_agg(to_jsonb(z)) from(select number,status,total,currency,created_at from public.sales_orders where company_id=c and customer_id=pid order by created_at desc limit 100)z),'[]')) else '{}'::jsonb end);
 end if;
 if not public.company_permission(c,'manage') then raise exception 'Solo administradores autorizados pueden modificar socios' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(c::text,0));
 if action='suggest' then
  if data->>'type' not in('supplier','customer') then raise exception 'Tipo inválido';end if;
  return jsonb_build_object('code',access_private.next_partner_code(c,data->>'type'));
 elsif action='active' then
  update public.business_partners set active=(data->>'active')::boolean where company_id=c and id=pid;
  return jsonb_build_object('id',pid);
 elsif action<>'save' then raise exception 'Acción inválida';end if;
 if length(data::text)>40000 or jsonb_typeof(data->'addresses') is distinct from 'array' or jsonb_array_length(data->'addresses')>20 then raise exception 'Máximo 20 direcciones por socio';end if;
 if coalesce(data->>'type','') not in('supplier','customer') or length(trim(coalesce(data->>'name',''))) not between 1 and 160 then raise exception 'Revisa tipo y nombre';end if;
 if length(coalesce(data->>'phone',''))>40 or length(coalesce(data->>'whatsapp',''))>40 or length(coalesce(data->>'tax_id',''))>80 or length(coalesce(data->>'legal_name',''))>200 or length(coalesce(data->>'notes',''))>4000 or length(coalesce(data->>'commercial_notes',''))>4000 or length(coalesce(data->>'purchase_terms',''))>2000 or length(coalesce(data->>'delivery_instructions',''))>2000 then raise exception 'Uno de los campos es demasiado extenso';end if;
 if (select count(*) from jsonb_array_elements(data->'addresses') x where coalesce((x->>'is_primary')::boolean,false))>1 then raise exception 'Selecciona una sola dirección principal';end if;
 if pid is null then
  insert into public.business_partners(company_id,name,partner_type,code) values(c,trim(data->>'name'),data->>'type',null) returning id into pid;
 end if;
 update public.business_partners set name=trim(data->>'name'),is_customer=coalesce((data->>'is_customer')::boolean,is_customer),is_supplier=coalesce((data->>'is_supplier')::boolean,is_supplier),alternate_code=nullif(trim(data->>'alternate_code'),''),instagram=coalesce(data->>'instagram',''),facebook=coalesce(data->>'facebook',''),phone_secondary=coalesce(data->>'phone_secondary',''),whatsapp_same=coalesce((data->>'whatsapp_same')::boolean,false),payment_preference=nullif(data->>'payment_preference',''),legal_name=coalesce(data->>'legal_name',''),tax_id=coalesce(data->>'tax_id',''),phone=coalesce(data->>'phone',''),whatsapp=coalesce(data->>'whatsapp',''),email=trim(coalesce(data->>'email','')),active=coalesce((data->>'active')::boolean,true),notes=coalesce(data->>'notes',''),commercial_notes=coalesce(data->>'commercial_notes',''),purchase_terms=coalesce(data->>'purchase_terms',''),delivery_instructions=coalesce(data->>'delivery_instructions','') where company_id=c and id=pid;
 update public.partner_addresses set is_primary=false where company_id=c and partner_id=pid;
 for a in select value from jsonb_array_elements(data->'addresses') loop
  aid:=nullif(a->>'id','')::uuid;
  if aid is null then aid:=gen_random_uuid();
   insert into public.partner_addresses(id,company_id,partner_id,label,address,instructions,phone,is_primary) values(aid,c,pid,trim(a->>'label'),trim(a->>'address'),coalesce(a->>'instructions',''),coalesce(a->>'phone',''),coalesce((a->>'is_primary')::boolean,false));
  else
   update public.partner_addresses set label=trim(a->>'label'),address=trim(a->>'address'),instructions=coalesce(a->>'instructions',''),phone=coalesce(a->>'phone',''),is_primary=coalesce((a->>'is_primary')::boolean,false) where company_id=c and partner_id=pid and id=aid;
   if not found then raise exception 'Dirección ajena o inexistente' using errcode='42501';end if;
  end if;
  if aid=any(used) then raise exception 'Dirección repetida';end if;used:=array_append(used,aid);
 end loop;
 delete from public.partner_addresses where company_id=c and partner_id=pid and not(id=any(used));
 update public.business_partners set address=coalesce((select address from public.partner_addresses where company_id=c and partner_id=pid order by is_primary desc,label,id limit 1),'') where company_id=c and id=pid;
 return jsonb_build_object('id',pid);
end $function$
;
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
    if not exists(select 1 from public.business_partners where company_id=new.company_id and id=linked and is_supplier and active) then raise exception 'La presentación corresponde a un proveedor inactivo';end if;
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
 if not exists(select 1 from public.business_partners where company_id=new.company_id and id=pid and case when kind='customer' then is_customer else is_supplier end and active) then raise exception 'Selecciona un socio activo del tipo correspondiente';end if;
 return new;
end $function$
;
CREATE OR REPLACE FUNCTION access_private.guard_quote_partner()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$declare sid uuid;begin
 perform pg_advisory_xact_lock(hashtextextended(new.company_id::text,0));
 select supplier_id into sid from public.presentations where company_id=new.company_id and id=new.presentation_id;
 if sid is not null and not exists(select 1 from public.business_partners where company_id=new.company_id and id=sid and is_supplier and active) then raise exception 'No puedes registrar precios nuevos de un proveedor inactivo';end if;
 return new;
end $function$
;
CREATE OR REPLACE FUNCTION access_private.place_order(c uuid, k uuid, data jsonb, staff boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cfg jsonb;ccy text;cached access_private.operation_requests%rowtype;r jsonb;v public.product_variants%rowtype;product_name text;stock numeric;qty integer;reserve_qty integer;oid uuid;cid uuid;lid uuid;num bigint;sub numeric:=0;discount_value numeric:=0;shipping_value numeric:=0;phone text;customer jsonb;answer jsonb;request_data jsonb:=data;matched_phone text;price_ref jsonb;sold_price numeric;begin
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
 if data->>'delivery'='delivery' then
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
 
 insert into public.sales_orders(company_id,number,customer_id,customer_snapshot,currency,subtotal,total,shipping,delivery,payment,gift_message) values(c,num,cid,customer,ccy,0,0,shipping_value,data->>'delivery',data->>'payment',left(coalesce(data->>'gift_message',''),500)) returning id into oid;
 for r in select value from jsonb_array_elements(data->'items')loop
  qty:=(r->>'quantity')::integer;if qty not between 1 and 1000 or qty is null then raise exception 'Cantidad inválida';end if;
  select pv.* into strict v from public.product_variants pv join public.products pr on pr.company_id=pv.company_id and pr.id=pv.product_id where pv.company_id=c and pv.id=(r->>'variant')::uuid and pv.active and pr.active and (staff or(pv.published and pr.published)) ;
  price_ref:=access_private.base_price_record(c,v.id);
  sold_price:=case when staff and r->>'unit_price' is not null then (r->>'unit_price')::numeric else (price_ref->>'price')::numeric end;
  if sold_price is null then raise exception 'Pendiente de precio. Configura la lista base o indica el precio realmente vendido';end if;
  if not(sold_price>=0 and sold_price<1e12) then raise exception 'Precio de venta inválido';end if;
  select name into product_name from public.products where company_id=c and id=v.product_id;
  select coalesce(on_hand-blocked-reserved,0) into stock from public.inventory_balances where company_id=c and item_kind='variant' and item_id=v.id;stock:=coalesce(stock,0);
  if qty>stock and (not v.allow_preorder or v.weight_min is not null) then raise exception 'No hay suficientes unidades disponibles de %',v.name;end if;reserve_qty:=least(qty,stock)::integer;
  insert into public.order_lines(company_id,order_id,variant_id,description,attributes,weight_min,weight_max,quantity,unit_price,reserved_quantity,price_reference) values(c,oid,v.id,product_name||' · '||v.name,v.attributes,v.weight_min,v.weight_max,qty,sold_price,reserve_qty,price_ref) returning id into lid;
  if reserve_qty>0 then perform access_private.post_stock(c,'variant',v.id,0,0,reserve_qty,'order_reservation',lid);end if;sub:=sub+qty*sold_price;
 end loop;
 if cfg->>'currency'=ccy and length(coalesce(data->>'discount_code',''))>0 then
  if upper(trim(data->>'discount_code'))<>cfg->>'discount_code' then raise exception 'Código de descuento no válido';end if;discount_value:=round(sub*coalesce((cfg->>'discount_percent')::numeric,0)/100,2);
 elsif length(coalesce(data->>'discount_code',''))>0 then raise exception 'Código de descuento no disponible';end if;
 update public.sales_orders set subtotal=sub,discount=discount_value,total=sub-discount_value+shipping_value,gift=case when cfg->>'currency'=ccy and nullif(cfg->>'gift_threshold','') is not null and sub-discount_value>=(cfg->>'gift_threshold')::numeric then coalesce(cfg->>'gift','') else '' end where company_id=c and id=oid;
 if nullif(data->>'expected_total','') is not null and (data->>'expected_total')::numeric<>sub-discount_value+shipping_value then raise exception 'El precio cambió. Revisa el total actualizado antes de confirmar';end if;answer:=jsonb_build_object('id',oid,'number',num,'subtotal',sub,'discount',discount_value,'shipping',shipping_value,'total',sub-discount_value+shipping_value,'currency',ccy,'expires_at',now()+interval '24 hours');
 insert into access_private.operation_requests(company_id,key,action,payload,result) values(c,k,case when staff then 'sale_create' else 'checkout' end,request_data,answer);return answer;
exception when no_data_found then raise exception 'Una variante ya no está disponible. Actualiza el catálogo';end $function$
;

do $patch$
declare definition text;
begin
 definition:=pg_get_functiondef('access_private.material_purchase_quote(uuid,uuid)'::regprocedure);
 if position('partner.partner_type=''supplier''' in definition)=0 then raise exception 'Material quote integration not found';end if;
 execute replace(definition,'partner.partner_type=''supplier''','partner.is_supplier');
end $patch$;
notify pgrst,'reload schema';
do $verify$
begin
 if (select count(*) from public.business_partners)<>(select partners from partner_integrity_before)
 or (select md5(coalesce(string_agg((to_jsonb(b)-array['updated_at','is_customer','is_supplier','alternate_code','instagram','facebook','phone_secondary','whatsapp_same','payment_preference'])::text,',' order by b.id),'')) from public.business_partners b)<>(select identity_hash from partner_integrity_before)
 or (select md5(coalesce(string_agg(id::text||coalesce(supplier_id::text,''),',' order by id),'')) from public.presentations)<>(select presentation_links from partner_integrity_before)
 or (select md5(coalesce(string_agg(id::text||coalesce(customer_id::text,''),',' order by id),'')) from public.sales_orders)<>(select order_links from partner_integrity_before) then
 raise exception 'Partner migration changed existing records or relations';end if;
end $verify$;
