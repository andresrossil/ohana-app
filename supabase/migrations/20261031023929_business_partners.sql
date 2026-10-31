-- Promote existing suppliers without changing their UUIDs or catalog references.
create temporary table partner_migration_check on commit drop as
select (select count(*) from public.suppliers) suppliers,
       (select count(*) from public.customers) customers,
       (select md5(coalesce(string_agg(id::text||coalesce(supplier_id::text,''),',' order by id),'')) from public.presentations) links;
do $$begin
 if exists(select 1 from public.suppliers s join public.customers c on c.id=s.id) then raise exception 'Identificadores de socios en conflicto; migración cancelada';end if;
end $$;
alter table public.suppliers rename to business_partners;
alter table public.business_partners
 add column partner_type text not null default 'supplier' check(partner_type in('supplier','customer')),
 add column code text,
 add column legal_name text not null default '',
 add column tax_id text not null default '',
 add column phone text not null default '',
 add column whatsapp text not null default '',
 add column email text not null default '',
 add column address text not null default '',
 add column commercial_notes text not null default '',
 add column purchase_terms text not null default '',
 add column delivery_instructions text not null default '',
 add column updated_at timestamptz not null default now();
drop index public.suppliers_catalog_key_idx;
create unique index partners_supplier_name on public.business_partners(company_id,public.catalog_key(name)) where partner_type='supplier';
alter table public.sales_orders drop constraint sales_orders_company_id_customer_id_fkey;
insert into public.business_partners(id,company_id,name,phone,email,address,created_at,partner_type)
select id,company_id,name,phone,email,address,created_at,'customer' from public.customers;
-- No rows are discarded: the original customer UUIDs now live in the main entity.
drop table public.customers;
alter table public.sales_orders add constraint sales_orders_company_id_customer_id_fkey foreign key(company_id,customer_id) references public.business_partners(company_id,id);
with numbered as(select id,case when partner_type='supplier' then 'PR' else 'C' end prefix,row_number() over(partition by company_id,partner_type order by created_at,id) n from public.business_partners)
update public.business_partners b set code=n.prefix||lpad(n.n::text,greatest(4,length(n.n::text)), '0') from numbered n where b.id=n.id;
alter table public.business_partners alter column code set not null;
alter table public.business_partners add constraint partner_code_valid check(code ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$');
alter table public.business_partners add constraint partner_contact_valid check(length(email)<=254 and(email='' or email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'));
create unique index partners_company_code on public.business_partners(company_id,lower(code));
create index partners_company_type_active on public.business_partners(company_id,partner_type,active);
create index partners_company_phone on public.business_partners(company_id,phone);
create index partners_customer_contact on public.business_partners(company_id,regexp_replace(phone,'[^0-9+]','','g'),public.catalog_key(name)) where partner_type='customer';
create index receipts_partner on public.purchase_receipts(company_id,supplier_id);
create index orders_partner on public.sales_orders(company_id,customer_id);

create function access_private.partner_read(c uuid,t text) returns boolean language sql stable security invoker set search_path='' as $$
 select auth.uid() is not null and (public.company_permission(c,'manage') or
 (t='customer' and public.company_permission(c,'read','sales')) or
 (t='supplier' and(public.company_permission(c,'read','catalog') or public.company_permission(c,'read','inventory'))))
$$;
revoke all on function access_private.partner_read(uuid,text) from public,anon;
grant execute on function access_private.partner_read(uuid,text) to authenticated;
drop policy scoped_read on public.business_partners;
drop policy scoped_insert on public.business_partners;
drop policy scoped_update on public.business_partners;
create policy partners_read on public.business_partners for select to authenticated using(access_private.partner_read(company_id,partner_type));
create policy partners_insert on public.business_partners for insert to authenticated with check(public.company_permission(company_id,'manage'));
create policy partners_update on public.business_partners for update to authenticated using(public.company_permission(company_id,'manage')) with check(public.company_permission(company_id,'manage'));
revoke all on public.business_partners from public,anon,authenticated;
grant select,insert,update on public.business_partners to authenticated;

-- Compatibility views retain existing queries, material relationships and checkout APIs.
create view public.suppliers with(security_invoker=true) as select * from public.business_partners where partner_type='supplier' with local check option;
create view public.customers with(security_invoker=true) as select * from public.business_partners where partner_type='customer' with local check option;
alter view public.suppliers alter column partner_type set default 'supplier';
alter view public.customers alter column partner_type set default 'customer';
revoke all on public.suppliers,public.customers from public,anon,authenticated;
grant select,insert,update on public.suppliers to authenticated;
grant select on public.customers to authenticated;

create table public.partner_addresses(
 id uuid primary key default gen_random_uuid(),company_id uuid not null,partner_id uuid not null,
 label text not null check(length(trim(label)) between 1 and 100),
 address text not null check(length(trim(address)) between 1 and 1000),
 instructions text not null default '' check(length(instructions)<=1000),
 phone text not null default '' check(length(phone)<=40),is_primary boolean not null default false,
 unique(company_id,partner_id,id),foreign key(company_id,partner_id) references public.business_partners(company_id,id)
);
create unique index partner_one_primary_address on public.partner_addresses(company_id,partner_id) where is_primary;
alter table public.partner_addresses enable row level security;
create policy addresses_read on public.partner_addresses for select to authenticated using(exists(select 1 from public.business_partners p where p.company_id=partner_addresses.company_id and p.id=partner_addresses.partner_id));
revoke all on public.partner_addresses from public,anon,authenticated;
grant select on public.partner_addresses to authenticated;
insert into public.partner_addresses(company_id,partner_id,label,address,is_primary)
select company_id,id,'Principal',address,true from public.business_partners where trim(address)<>'';

create function access_private.next_partner_code(c uuid,t text) returns text language sql stable security definer set search_path='' as $$
 select (case when t='supplier' then 'PR' else 'C' end)||lpad((coalesce(max(substring(code from '[0-9]+$')::bigint),0)+1)::text,
 greatest(4,length((coalesce(max(substring(code from '[0-9]+$')::bigint),0)+1)::text)),'0')
 from public.business_partners where company_id=c and code ~ (case when t='supplier' then '^PR[0-9]{1,12}$' else '^C[0-9]{1,12}$' end)
$$;
revoke all on function access_private.next_partner_code(uuid,text) from public,anon,authenticated;

create function access_private.guard_partner() returns trigger language plpgsql security definer set search_path='' as $$begin
 perform pg_advisory_xact_lock(hashtextextended(new.company_id::text,0));
 if tg_op='UPDATE' then
  if new.id<>old.id or new.company_id<>old.company_id then raise exception 'La identidad del socio no se puede cambiar';end if;
  if new.partner_type<>old.partner_type and (
   exists(select 1 from public.presentations where company_id=old.company_id and supplier_id=old.id) or
   exists(select 1 from public.purchase_receipts where company_id=old.company_id and supplier_id=old.id) or
   exists(select 1 from public.sales_orders where company_id=old.company_id and customer_id=old.id)) then
   raise exception 'No puedes cambiar el tipo: el socio tiene presentaciones, compras o ventas relacionadas';
  end if;
 elsif new.partner_type='supplier' and auth.uid() is not null and not public.company_permission(new.company_id,'manage') then
  raise exception 'Solo administradores pueden crear proveedores; selecciona un proveedor existente' using errcode='42501';
 end if;
 new.name:=trim(new.name);new.code:=nullif(trim(new.code),'');
 if new.code is null then new.code:=access_private.next_partner_code(new.company_id,new.partner_type);end if;
 new.updated_at:=now();return new;
end $$;
revoke all on function access_private.guard_partner() from public,anon,authenticated;
create trigger partner_guard before insert or update on public.business_partners for each row execute function access_private.guard_partner();

create function access_private.guard_partner_use() returns trigger language plpgsql security definer set search_path='' as $$
declare pid uuid;kind text;linked uuid;begin
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
end $$;
revoke all on function access_private.guard_partner_use() from public,anon,authenticated;
create trigger presentation_partner before insert or update on public.presentations for each row execute function access_private.guard_partner_use();
create trigger receipt_partner before insert or update on public.purchase_receipts for each row execute function access_private.guard_partner_use();
create trigger order_partner before insert or update on public.sales_orders for each row execute function access_private.guard_partner_use();

create function access_private.guard_quote_partner() returns trigger language plpgsql security definer set search_path='' as $$declare sid uuid;begin
 perform pg_advisory_xact_lock(hashtextextended(new.company_id::text,0));
 select supplier_id into sid from public.presentations where company_id=new.company_id and id=new.presentation_id;
 if sid is not null and not exists(select 1 from public.business_partners where company_id=new.company_id and id=sid and partner_type='supplier' and active) then raise exception 'No puedes registrar precios nuevos de un proveedor inactivo';end if;
 return new;
end $$;
revoke all on function access_private.guard_quote_partner() from public,anon,authenticated;
create trigger quote_partner before insert on public.price_history for each row execute function access_private.guard_quote_partner();

create function access_private.partners(c uuid,action text,data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.business_partners%rowtype;pid uuid; a jsonb;aid uuid;used uuid[]:='{}';n integer;pg integer;cnt bigint;q text;typ text;st text;sort text;dir text;res jsonb;begin
 if auth.uid() is null or not(access_private.partner_read(c,'supplier') or access_private.partner_read(c,'customer')) then raise exception 'Socios no autorizados' using errcode='42501';end if;
 if action='list' then
  q:=left(coalesce(data->>'query',''),120);typ:=coalesce(data->>'type','');st:=coalesce(data->>'status','');pg:=greatest(1,least(coalesce((data->>'page')::int,1),100000));
  sort:=case when data->>'sort' in('code','name','partner_type','phone','active') then data->>'sort' else 'name' end;dir:=case when data->>'direction'='desc' then 'desc' else 'asc' end;
  select count(*) into cnt from public.business_partners b where b.company_id=c and access_private.partner_read(c,b.partner_type) and(typ='' or b.partner_type=typ) and(st='' or b.active=(st='active')) and (q='' or concat_ws(' ',b.code,b.name,b.phone,b.tax_id) ilike '%'||q||'%');
  execute format('select coalesce(jsonb_agg(to_jsonb(z)),''[]'') from(select * from public.business_partners b where b.company_id=$1 and access_private.partner_read($1,b.partner_type) and($2='''' or b.partner_type=$2) and($3='''' or b.active=($3=''active'')) and($4='''' or concat_ws('' '',b.code,b.name,b.phone,b.tax_id) ilike ''%%''||$4||''%%'') order by %I %s,id limit 25 offset $5)z',sort,dir) into res using c,typ,st,q,(pg-1)*25;
  return jsonb_build_object('rows',res,'total',cnt,'canManage',public.company_permission(c,'manage'),'supplierRead',access_private.partner_read(c,'supplier'),'customerRead',access_private.partner_read(c,'customer'));
 end if;
 pid:=nullif(data->>'id','')::uuid;
 if action in('get','save','active') and pid is not null then
  select * into strict p from public.business_partners where company_id=c and id=pid;
  if not access_private.partner_read(c,p.partner_type) then raise exception 'Socio no autorizado' using errcode='42501';end if;
 end if;
 if action='get' then
  return jsonb_build_object('partner',to_jsonb(p),'canChangeType',not(exists(select 1 from public.presentations where company_id=c and supplier_id=pid) or exists(select 1 from public.purchase_receipts where company_id=c and supplier_id=pid) or exists(select 1 from public.sales_orders where company_id=c and customer_id=pid)), 'addresses',coalesce((select jsonb_agg(to_jsonb(d) order by is_primary desc,label,id) from public.partner_addresses d where d.company_id=c and d.partner_id=pid),'[]'),
   'related',case when p.partner_type='supplier' and(public.company_permission(c,'read','catalog') or public.company_permission(c,'manage')) then
     jsonb_build_object('presentations',coalesce((select jsonb_agg(to_jsonb(z)) from(select pp.id,rm.name material,pp.quantity,u.symbol unit,pp.active from public.presentations pp join public.raw_materials rm on rm.company_id=pp.company_id and rm.id=pp.raw_material_id join public.units u on u.company_id=pp.company_id and u.id=pp.unit_id where pp.company_id=c and pp.supplier_id=pid order by rm.name limit 100)z),'[]'),
     'prices',coalesce((select jsonb_agg(to_jsonb(z)) from(select h.effective_on,h.amount,h.currency,rm.name material from public.price_history h join public.presentations pp on pp.company_id=h.company_id and pp.id=h.presentation_id join public.raw_materials rm on rm.company_id=pp.company_id and rm.id=pp.raw_material_id where pp.company_id=c and pp.supplier_id=pid order by h.effective_on desc nulls last,h.created_at desc limit 100)z),'[]')) else '{}'::jsonb end ||
    case when p.partner_type='supplier' and(public.company_permission(c,'read','inventory') or public.company_permission(c,'manage')) then jsonb_build_object('purchases',coalesce((select jsonb_agg(to_jsonb(z)) from(select received_on,reference,quantity,amount,currency from public.purchase_receipts where company_id=c and supplier_id=pid order by created_at desc limit 100)z),'[]')) else '{}'::jsonb end ||
    case when p.partner_type='customer' then jsonb_build_object('orders',coalesce((select jsonb_agg(to_jsonb(z)) from(select number,status,total,currency,created_at from public.sales_orders where company_id=c and customer_id=pid order by created_at desc limit 100)z),'[]')) else '{}'::jsonb end);
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
  insert into public.business_partners(company_id,name,partner_type,code) values(c,trim(data->>'name'),data->>'type',nullif(trim(data->>'code'),'')) returning id into pid;
 end if;
 update public.business_partners set name=trim(data->>'name'),partner_type=data->>'type',code=coalesce(nullif(trim(data->>'code'),''),code),legal_name=coalesce(data->>'legal_name',''),tax_id=coalesce(data->>'tax_id',''),phone=coalesce(data->>'phone',''),whatsapp=coalesce(data->>'whatsapp',''),email=trim(coalesce(data->>'email','')),active=coalesce((data->>'active')::boolean,true),notes=coalesce(data->>'notes',''),commercial_notes=coalesce(data->>'commercial_notes',''),purchase_terms=coalesce(data->>'purchase_terms',''),delivery_instructions=coalesce(data->>'delivery_instructions','') where company_id=c and id=pid;
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
end $$;
create function public.partners(p_company uuid,p_action text,p_data jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select access_private.partners(p_company,p_action,p_data)$$;
revoke all on function access_private.partners(uuid,text,jsonb),public.partners(uuid,text,jsonb) from public,anon;
grant execute on function access_private.partners(uuid,text,jsonb),public.partners(uuid,text,jsonb) to authenticated;

-- Reuse an explicitly selected active customer (or a matching existing contact at checkout).
do $migration$declare def text;old_source text:=$old$insert into public.customers(company_id,name,phone,email,address) values(c,customer->>'name',phone,customer->>'email',customer->>'address') returning id into cid;$old$;
begin
 def:=pg_get_functiondef('access_private.place_order(uuid,uuid,jsonb,boolean)'::regprocedure);
 if strpos(def,old_source)=0 then raise exception 'No se encontró la integración de clientes';end if;
 def:=replace(def,'answer jsonb;begin','answer jsonb;request_data jsonb:=data;matched_phone text;begin');
 def:=replace(def,'cached.payload<>data','cached.payload<>request_data');
 def:=replace(def,'end,data,answer);return answer;','end,request_data,answer);return answer;');
 def:=replace(def,'phone:=regexp_replace', $new$
 if staff and nullif(data->>'customer_id','') is not null then
  if auth.uid() is null or not public.company_permission(c,'write','sales') then raise exception 'Venta no autorizada' using errcode='42501';end if;
  select jsonb_build_object('name',bp.name,'phone',bp.phone,'email',bp.email,'address',bp.address) into customer from public.business_partners bp where bp.company_id=c and bp.id=(data->>'customer_id')::uuid and bp.partner_type='customer' and bp.active;
  if customer is null then raise exception 'Selecciona un cliente activo de esta empresa';end if;
  data:=data||jsonb_build_object('customer',customer);
 end if;
 phone:=regexp_replace$new$);
 def:=replace(def,old_source,$new$
 if staff and nullif(data->>'customer_id','') is not null then cid:=(data->>'customer_id')::uuid;
 else
  matched_phone:=phone;
  if exists(select 1 from public.business_partners bp where bp.company_id=c and bp.partner_type='customer' and not bp.active and regexp_replace(bp.phone,'[^0-9+]','','g')=matched_phone and public.catalog_key(bp.name)=public.catalog_key(customer->>'name')) then raise exception 'Este contacto está inactivo; contacta al negocio';end if;
  select bp.id into cid from public.business_partners bp where bp.company_id=c and bp.partner_type='customer' and bp.active and regexp_replace(bp.phone,'[^0-9+]','','g')=matched_phone and public.catalog_key(bp.name)=public.catalog_key(customer->>'name') order by bp.created_at,bp.id limit 1;
  if cid is null then
   insert into public.customers(company_id,name,phone,email,address) values(c,customer->>'name',phone,customer->>'email',customer->>'address') returning id into cid;
   if trim(coalesce(customer->>'address',''))<>'' then insert into public.partner_addresses(company_id,partner_id,label,address,is_primary) values(c,cid,'Principal',customer->>'address',true);end if;
  end if;
 end if;
 $new$);execute def;
end $migration$;
-- List only active customers in sales selectors; history is fetched independently.
do $$declare def text;begin
 def:=pg_get_functiondef('access_private.sales(uuid,text,uuid,jsonb)'::regprocedure);
 def:=replace(def,'select * from public.customers where company_id=c order by created_at desc limit 200','select * from public.customers where company_id=c and active order by name,id limit 200');execute def;
end $$;
do $$begin
 if (select count(*) from public.suppliers)<>(select suppliers from partner_migration_check) or (select count(*) from public.customers)<>(select customers from partner_migration_check) or (select md5(coalesce(string_agg(id::text||coalesce(supplier_id::text,''),',' order by id),'')) from public.presentations)<>(select links from partner_migration_check) then raise exception 'Las relaciones originales no coinciden; migración cancelada';end if;
end $$;
notify pgrst,'reload schema';
