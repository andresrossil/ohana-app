alter table public.business_partners add column price_list_id uuid;
alter table public.business_partners add constraint partner_price_list_company_fk foreign key(company_id,price_list_id) references public.price_lists(company_id,id);
create index partner_price_list on public.business_partners(company_id,price_list_id) where price_list_id is not null;
alter table public.sales_orders add column price_list_id uuid;
alter table public.sales_orders add constraint order_price_list_company_fk foreign key(company_id,price_list_id) references public.price_lists(company_id,id);
create index order_price_list on public.sales_orders(company_id,price_list_id) where price_list_id is not null;
alter table public.order_lines add column is_gift boolean not null default false;
alter table public.order_lines add constraint gift_price_zero check(not is_gift or unit_price=0);
drop index public.order_active_variant_unique;
create unique index order_active_variant_unique on public.order_lines(company_id,order_id,variant_id,is_gift) where quantity>0;
create function access_private.default_customer_price_list(c uuid) returns uuid language sql stable set search_path='' as $$
 select id from public.price_lists where company_id=c and active order by (public.catalog_key(name)='general') desc,is_base desc,name,id limit 1
$$;
revoke all on function access_private.default_customer_price_list(uuid) from public,anon,authenticated;
create function access_private.customer_price_list_defaults() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (new.is_customer or new.partner_type='customer') and new.price_list_id is null and (tg_op='INSERT' or not old.is_customer) then new.price_list_id:=access_private.default_customer_price_list(new.company_id);end if;
 if new.price_list_id is not null and (tg_op='INSERT' or new.price_list_id is distinct from old.price_list_id) and not exists(select 1 from public.price_lists where company_id=new.company_id and id=new.price_list_id and active) then raise exception 'Selecciona una lista de precios activa de esta empresa';end if;
 return new;
end $$;
revoke all on function access_private.customer_price_list_defaults() from public,anon,authenticated;
create trigger customer_price_list_defaults before insert or update on public.business_partners for each row execute function access_private.customer_price_list_defaults();
update public.business_partners set price_list_id=access_private.default_customer_price_list(company_id) where is_customer and price_list_id is null;
create function access_private.list_price_record(c uuid,lid uuid,vid uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('list_id',pl.id,'list_name',pl.name,'entry_id',pe.id,'price',pe.price,'currency',pe.currency,'variant_id',pe.variant_id)
 from public.price_lists pl join public.price_list_entries pe on pe.company_id=pl.company_id and pe.list_id=pl.id join public.companies co on co.id=pl.company_id
 where pl.company_id=c and pl.id=lid and pl.active and pe.active and pe.variant_id=vid and pe.currency=co.currency
$$;
revoke all on function access_private.list_price_record(uuid,uuid,uuid) from public,anon,authenticated;

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
  sort:=case when data->>'sort' in('code','alternate_code','name','partner_type','courier_tariff_mode','phone','active') then data->>'sort' else 'name' end;dir:=case when data->>'direction'='desc' then 'desc' else 'asc' end;
  select count(*) into cnt from public.business_partners b where b.company_id=c and ((b.is_customer and access_private.partner_read(c,'customer')) or (b.is_supplier and access_private.partner_read(c,'supplier')) or (b.is_courier and access_private.partner_read(c,'courier'))) and(typ='' or (typ='customer' and b.is_customer and access_private.partner_read(c,'customer')) or (typ='supplier' and b.is_supplier and access_private.partner_read(c,'supplier')) or (typ='courier' and b.is_courier and access_private.partner_read(c,'courier'))) and(st='' or b.active=(st='active')) and (q='' or concat_ws(' ',b.code,b.alternate_code,b.name,b.phone,b.phone_secondary,b.whatsapp,b.instagram,b.facebook,b.tax_id) ilike '%'||q||'%');
  execute format('select coalesce(jsonb_agg(to_jsonb(z)),''[]'') from(select * from public.business_partners b where b.company_id=$1 and ((b.is_customer and access_private.partner_read($1,''customer'')) or (b.is_supplier and access_private.partner_read($1,''supplier'')) or (b.is_courier and access_private.partner_read($1,''courier''))) and($2='''' or ($2=''customer'' and b.is_customer and access_private.partner_read($1,''customer'')) or ($2=''supplier'' and b.is_supplier and access_private.partner_read($1,''supplier'')) or ($2=''courier'' and b.is_courier and access_private.partner_read($1,''courier''))) and($3='''' or b.active=($3=''active'')) and($4='''' or concat_ws('' '',b.code,b.alternate_code,b.name,b.phone,b.phone_secondary,b.whatsapp,b.instagram,b.facebook,b.tax_id) ilike ''%%''||$4||''%%'') order by %I %s,id limit 25 offset $5)z',sort,dir) into res using c,typ,st,q,(pg-1)*25;
  return jsonb_build_object('rows',res,'total',cnt,'currency',(select currency from public.companies where id=c),'price_lists',coalesce((select jsonb_agg(to_jsonb(pl) order by pl.name) from public.price_lists pl where pl.company_id=c and pl.active),'[]'),'default_price_list',access_private.default_customer_price_list(c),'canManage',public.company_permission(c,'manage'),'supplierRead',access_private.partner_read(c,'supplier'),'customerRead',access_private.partner_read(c,'customer'));
 end if;
 if action='matches' then
  if not public.company_permission(c,'manage') then raise exception 'Socios no autorizados' using errcode='42501';end if;
  return coalesce((select jsonb_agg(to_jsonb(z)) from(
   select b.id,b.code,b.name,b.is_customer,b.is_supplier,b.is_courier from public.business_partners b
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
  if not ((p.is_customer and access_private.partner_read(c,'customer')) or (p.is_supplier and access_private.partner_read(c,'supplier')) or (p.is_courier and access_private.partner_read(c,'courier'))) then raise exception 'Socio no autorizado' using errcode='42501';end if;
 end if;
 if action='get' then
  return jsonb_build_object('account',case when p.is_customer and access_private.partner_read(c,'customer') then access_private.customer_account(c,pid) else '[]'::jsonb end,'partner',to_jsonb(p),'canChangeType',not(exists(select 1 from public.presentations where company_id=c and supplier_id=pid) or exists(select 1 from public.purchase_receipts where company_id=c and supplier_id=pid) or exists(select 1 from public.sales_orders where company_id=c and customer_id=pid)), 'addresses',coalesce((select jsonb_agg(to_jsonb(d) order by is_primary desc,label,id) from public.partner_addresses d where d.company_id=c and d.partner_id=pid),'[]'),
   'related',case when p.is_supplier and(public.company_permission(c,'read','catalog') or public.company_permission(c,'manage')) then
     jsonb_build_object('presentations',coalesce((select jsonb_agg(to_jsonb(z)) from(select pp.id,rm.name material,pp.quantity,u.symbol unit,pp.active from public.presentations pp join public.raw_materials rm on rm.company_id=pp.company_id and rm.id=pp.raw_material_id join public.units u on u.company_id=pp.company_id and u.id=pp.unit_id where pp.company_id=c and pp.supplier_id=pid order by rm.name limit 100)z),'[]'),
     'prices',coalesce((select jsonb_agg(to_jsonb(z)) from(select h.effective_on,h.amount,h.currency,rm.name material from public.price_history h join public.presentations pp on pp.company_id=h.company_id and pp.id=h.presentation_id join public.raw_materials rm on rm.company_id=pp.company_id and rm.id=pp.raw_material_id where pp.company_id=c and pp.supplier_id=pid order by h.effective_on desc nulls last,h.created_at desc limit 100)z),'[]')) else '{}'::jsonb end ||
    case when p.is_supplier and(public.company_permission(c,'read','inventory') or public.company_permission(c,'manage')) then jsonb_build_object('purchases',coalesce((select jsonb_agg(to_jsonb(z)) from(select received_on,reference,quantity,amount,currency from public.purchase_receipts where company_id=c and supplier_id=pid order by created_at desc limit 100)z),'[]')) else '{}'::jsonb end ||
    case when p.is_customer and access_private.partner_read(c,'customer') then jsonb_build_object('orders',coalesce((select jsonb_agg(to_jsonb(z)) from(select number,status,total,currency,created_at,coalesce((select sum(l.quantity) from public.order_lines l where l.company_id=c and l.order_id=sales_orders.id and l.is_gift and l.quantity>0),0) gift_units from public.sales_orders where company_id=c and customer_id=pid order by created_at desc limit 100)z),'[]')) else '{}'::jsonb end);
 end if;
 if not public.company_permission(c,'manage') then raise exception 'Solo administradores autorizados pueden modificar socios' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(c::text,0));
 if action='suggest' then
  if data->>'type' not in('supplier','customer','courier') then raise exception 'Tipo inválido';end if;
  return jsonb_build_object('code',access_private.next_partner_code(c,data->>'type'));
 elsif action='active' then
  update public.business_partners set active=(data->>'active')::boolean where company_id=c and id=pid;
  return jsonb_build_object('id',pid);
 elsif action<>'save' then raise exception 'Acción inválida';end if;
 if length(data::text)>40000 or jsonb_typeof(data->'addresses') is distinct from 'array' or jsonb_array_length(data->'addresses')>20 then raise exception 'Máximo 20 direcciones por socio';end if;
 if coalesce(data->>'type','') not in('supplier','customer','courier') or length(trim(coalesce(data->>'name',''))) not between 1 and 160 then raise exception 'Revisa tipo y nombre';end if;
 if length(coalesce(data->>'phone',''))>40 or length(coalesce(data->>'whatsapp',''))>40 or length(coalesce(data->>'tax_id',''))>80 or length(coalesce(data->>'legal_name',''))>200 or length(coalesce(data->>'notes',''))>4000 or length(coalesce(data->>'commercial_notes',''))>4000 or length(coalesce(data->>'purchase_terms',''))>2000 or length(coalesce(data->>'delivery_instructions',''))>2000 then raise exception 'Uno de los campos es demasiado extenso';end if;
 if (select count(*) from jsonb_array_elements(data->'addresses') x where coalesce((x->>'is_primary')::boolean,false))>1 then raise exception 'Selecciona una sola dirección principal';end if;
 if pid is null then
  insert into public.business_partners(company_id,name,partner_type,code) values(c,trim(data->>'name'),data->>'type',null) returning id into pid;
 end if;
 update public.business_partners set price_list_id=case when data ? 'price_list_id' then coalesce(nullif(data->>'price_list_id','')::uuid,access_private.default_customer_price_list(c)) else price_list_id end,name=trim(data->>'name'),is_customer=coalesce((data->>'is_customer')::boolean,is_customer),is_supplier=coalesce((data->>'is_supplier')::boolean,is_supplier),alternate_code=nullif(trim(data->>'alternate_code'),''),instagram=coalesce(data->>'instagram',''),facebook=coalesce(data->>'facebook',''),phone_secondary=coalesce(data->>'phone_secondary',''),whatsapp_same=coalesce((data->>'whatsapp_same')::boolean,false),payment_preference=nullif(data->>'payment_preference',''),legal_name=coalesce(data->>'legal_name',''),tax_id=coalesce(data->>'tax_id',''),phone=coalesce(data->>'phone',''),whatsapp=coalesce(data->>'whatsapp',''),email=trim(coalesce(data->>'email','')),active=coalesce((data->>'active')::boolean,true),notes=coalesce(data->>'notes',''),commercial_notes=coalesce(data->>'commercial_notes',''),purchase_terms=coalesce(data->>'purchase_terms',''),delivery_instructions=coalesce(data->>'delivery_instructions','') where company_id=c and id=pid;
 update public.partner_addresses set is_primary=false where company_id=c and partner_id=pid;
 for a in select value from jsonb_array_elements(data->'addresses') loop
  aid:=nullif(a->>'id','')::uuid;
  if aid is null then aid:=gen_random_uuid();
   insert into public.partner_addresses(id,company_id,partner_id,label,address,instructions,phone,is_primary,department,zone) values(aid,c,pid,trim(a->>'label'),trim(a->>'address'),coalesce(a->>'instructions',''),coalesce(a->>'phone',''),coalesce((a->>'is_primary')::boolean,false),nullif(trim(a->>'department'),''),nullif(a->>'zone','')::smallint);
  else
   update public.partner_addresses set label=trim(a->>'label'),address=trim(a->>'address'),instructions=coalesce(a->>'instructions',''),phone=coalesce(a->>'phone',''),zone=case when a ? 'zone' then nullif(a->>'zone','')::smallint else public.partner_addresses.zone end,department=case when a ? 'department' then nullif(trim(a->>'department'),'') else public.partner_addresses.department end,is_primary=coalesce((a->>'is_primary')::boolean,false) where company_id=c and partner_id=pid and id=aid;
   if not found then raise exception 'Dirección ajena o inexistente' using errcode='42501';end if;
  end if;
  if aid=any(used) then raise exception 'Dirección repetida';end if;used:=array_append(used,aid);
 end loop;
 delete from public.partner_addresses where company_id=c and partner_id=pid and not(id=any(used));
 update public.business_partners set address=coalesce((select address from public.partner_addresses where company_id=c and partner_id=pid order by is_primary desc,label,id limit 1),'') where company_id=c and id=pid;
 return jsonb_build_object('id',pid);
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
 if action='list' then return jsonb_build_object('orders',coalesce((select jsonb_agg(to_jsonb(so)||jsonb_build_object('settled',exists(select 1 from public.courier_settlement_items where company_id=c and order_id=so.id and active),'delivery_info',(select to_jsonb(d) from public.sales_deliveries d where d.company_id=c and d.order_id=so.id),'payment_summary',access_private.delivery_payment_summary(c,so.id),'lines',(select jsonb_agg(to_jsonb(ol)||jsonb_build_object('physical_units',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'weight',u.weight,'variant_snapshot',u.variant_snapshot,'status',case when u.order_line_id=ol.id then u.status else 'released' end)) from public.inventory_units u where u.company_id=c and (u.order_line_id=ol.id or exists(select 1 from public.inventory_unit_movements h where h.company_id=c and h.unit_id=u.id and (h.order_line_before=ol.id or h.order_line_after=ol.id)))),'[]'))) from public.order_lines ol where ol.company_id=c and ol.order_id=so.id and ol.quantity>0))) from (select * from public.sales_orders where company_id=c order by created_at desc limit 100)so),'[]'),'customers',coalesce((select jsonb_agg(to_jsonb(cs)) from(select * from public.business_partners where company_id=c and is_customer and active order by name,id limit 200)cs),'[]'),'price_lists',coalesce((select jsonb_agg(to_jsonb(pl) order by pl.name) from public.price_lists pl where pl.company_id=c and pl.active),'[]'),'default_price_list',access_private.default_customer_price_list(c),'price_entries',coalesce((select jsonb_agg(to_jsonb(pe)) from public.price_list_entries pe join public.price_lists pl on pl.company_id=pe.company_id and pl.id=pe.list_id where pe.company_id=c and pe.active and pl.active),'[]'),'variants',coalesce((select jsonb_agg(jsonb_build_object('id',pv.id,'name',pr.name||' · '||access_private.variant_label(to_jsonb(pv)),'product_name',pr.name,'size',pv.name,'weight_max',pv.weight_max,'sku',pv.sku,'barcode',pv.barcode,'price',access_private.base_sale_price(pv.company_id,pv.id),'currency',(select currency from public.companies where id=c),'available',coalesce(bal.on_hand-bal.blocked-bal.reserved,0),'allow_preorder',pv.allow_preorder)) from public.product_variants pv join public.products pr on pr.company_id=pv.company_id and pr.id=pv.product_id left join public.inventory_balances bal on bal.company_id=pv.company_id and bal.item_kind='variant' and bal.item_id=pv.id where pv.company_id=c and pv.active and pr.active),'[]'));end if;
 if action='create' then return access_private.place_order(c,k,data,true);end if;
 if action not in('paid','cancel','dispatch') or k is null then raise exception 'Operación no válida';end if;
 select * into cached from access_private.operation_requests where company_id=c and key=k;if found then if cached.action<>'sale_'||action or cached.payload<>data then raise exception 'Identificador ya utilizado';end if;return cached.result;end if;
 select * into strict o from public.sales_orders where company_id=c and id=(data->>'order')::uuid for update;
 if action='paid' then
  perform access_private.add_order_payment(c,o.id,jsonb_build_object('amount',o.total-(access_private.delivery_payment_summary(c,o.id)->>'paid')::numeric,'method',case when o.payment='transfer' then 'transfer' else 'cash' end,'receiver','ohana','confirmed',true,'received_on',current_date,'notes','Confirmación de saldo recibido'));
  if o.status in('cancelled','expired') then raise exception 'El pedido está cancelado o vencido. Registra una nueva venta si corresponde';end if;update public.sales_orders set paid_at=coalesce(paid_at,now()) where company_id=c and id=o.id;
 elsif action='cancel' then
  if o.status='dispatched' then answer:=access_private.document_cancellation(c,'confirm',gen_random_uuid(),jsonb_build_object('source_kind','sale','source_id',o.id,'reason',data->>'reason'));insert into access_private.operation_requests(company_id,key,action,payload,result) values(c,k,'sale_'||action,data,answer);return answer;end if;
  if o.status='pending' then for l in select * from public.order_lines where company_id=c and order_id=o.id and quantity>0 loop if l.reserved_quantity>0 then perform access_private.post_stock(c,'variant',l.variant_id,0,0,-l.reserved_quantity,'order_cancel',l.id);end if;end loop;update public.sales_orders set status='cancelled',refund_pending=paid_at is not null where company_id=c and id=o.id;end if;
 elsif o.status<>'dispatched' then
  if o.status<>'pending' then raise exception 'El pedido no puede entregarse';end if;if o.payment='transfer' and o.paid_at is null and not exists(select 1 from public.sales_deliveries where company_id=c and order_id=o.id and kind='courier' and status<>'cancelled') then raise exception 'Confirma la transferencia recibida antes de entregar';end if;
  for l in select * from public.order_lines where company_id=c and order_id=o.id and quantity>0 loop
   select on_hand-blocked-reserved+l.reserved_quantity into available from public.inventory_balances where company_id=c and item_kind='variant' and item_id=l.variant_id;if coalesce(available,0)<l.quantity then raise exception 'Existencias insuficientes; hay unidades pendientes de producir o liberar';end if;
   perform access_private.post_stock(c,'variant',l.variant_id,-l.quantity,0,-l.reserved_quantity,'order_dispatch',l.id);
  end loop;update public.sales_orders set status='dispatched' where company_id=c and id=o.id;
 end if;
 answer:=jsonb_build_object('id',o.id);insert into access_private.operation_requests(company_id,key,action,payload,result) values(c,k,'sale_'||action,data,answer);return answer;
end $function$
;
CREATE OR REPLACE FUNCTION access_private.place_order(c uuid, k uuid, data jsonb, staff boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cfg jsonb;ccy text;cached access_private.operation_requests%rowtype;r jsonb;v public.product_variants%rowtype;product_name text;stock numeric;qty integer;reserve_qty integer;oid uuid;cid uuid;lid uuid;num bigint;sub numeric:=0;discount_value numeric:=0;shipping_value numeric:=0;phone text;customer jsonb;answer jsonb;request_data jsonb:=data;matched_phone text;price_ref jsonb;selected_list uuid;gift_line boolean;sold_price numeric;begin
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
  insert into public.order_lines(company_id,order_id,variant_id,description,attributes,weight_min,weight_max,quantity,unit_price,reserved_quantity,price_reference,is_gift) values(c,oid,v.id,product_name||' · '||v.name,v.attributes,v.weight_min,v.weight_max,qty,sold_price,reserve_qty,price_ref,gift_line) returning id into lid;
  if reserve_qty>0 then perform access_private.post_stock(c,'variant',v.id,0,0,reserve_qty,'order_reservation',lid);end if;sub:=sub+qty*sold_price;
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
exception when no_data_found then raise exception 'Una variante ya no está disponible. Actualiza el catálogo';end $function$
;
CREATE OR REPLACE FUNCTION access_private.edit_sale(c uuid, k uuid, data jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare sale public.sales_orders%rowtype;cached access_private.operation_requests%rowtype;old_line record;r jsonb;v public.product_variants%rowtype;
 rev uuid;customer uuid;customer_data jsonb;line_id uuid;qty integer;price numeric(18,2);sub numeric:=0;discount_amount numeric;available numeric;reserved_qty integer;seen text[]:='{}';gift_line boolean;selected_list uuid;answer jsonb;
begin
 if auth.uid() is null or not public.company_permission(c,'write','sales') then raise exception 'Venta no autorizada' using errcode='42501';end if;
 if k is null or length(data::text)>100000 then raise exception 'Factura incompleta';end if;
 perform pg_advisory_xact_lock(hashtextextended(c::text,0));
 select * into cached from access_private.operation_requests where company_id=c and key=k;
 if found then if cached.action<>'sale_edit' or cached.payload<>data then raise exception 'Identificador utilizado con otros datos';end if;return cached.result;end if;
 select * into strict sale from public.sales_orders where company_id=c and id=(data->>'order')::uuid for update;
 if sale.status in('cancelled','expired') then raise exception 'No se editan facturas canceladas o vencidas';end if;
 if exists(select 1 from public.courier_settlement_items where company_id=c and order_id=sale.id and active) then raise exception 'La factura está liquidada por mensajería; no se puede editar';end if;
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
  insert into public.order_lines(company_id,order_id,variant_id,description,attributes,weight_min,weight_max,quantity,unit_price,reserved_quantity,price_reference,is_gift)
  values(c,sale.id,v.id,(select name from public.products where company_id=c and id=v.product_id)||' · '||v.name,v.attributes,v.weight_min,v.weight_max,qty,price,reserved_qty,access_private.list_price_record(c,selected_list,v.id),gift_line) returning id into line_id;
  if sale.status='dispatched' then perform access_private.post_stock(c,'variant',v.id,-qty,0,0,'order_dispatch',line_id);
  elsif reserved_qty>0 then perform access_private.post_stock(c,'variant',v.id,0,0,reserved_qty,'order_reservation',line_id);end if;
  sub:=sub+qty*price;
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
end $function$
;
notify pgrst,'reload schema';
