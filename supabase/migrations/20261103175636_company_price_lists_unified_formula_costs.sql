create table public.price_lists (
 id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id),
 name text not null check(length(btrim(name)) between 1 and 120),is_base boolean not null default false,
 active boolean not null default true,revision integer not null default 1,created_at timestamptz not null default now(),
 unique(company_id,id),check(not is_base or active)
);
create unique index price_list_name on public.price_lists(company_id,public.catalog_key(name));
create unique index one_base_price_list on public.price_lists(company_id) where is_base;
create table public.price_list_entries (
 id uuid primary key default gen_random_uuid(),company_id uuid not null,list_id uuid not null,variant_id uuid not null,
 price numeric(20,8) not null check(price>=0 and price<1e12),currency text not null check(currency ~ '^[A-Z]{3}$'),
 active boolean not null default true,revision integer not null default 1,created_at timestamptz not null default now(),
 unique(company_id,id),unique(company_id,list_id,variant_id),
 foreign key(company_id,list_id) references public.price_lists(company_id,id),
 foreign key(company_id,variant_id) references public.product_variants(company_id,id)
);
create index price_entry_variant on public.price_list_entries(company_id,variant_id);
alter table public.price_lists enable row level security;
alter table public.price_list_entries enable row level security;
revoke all on public.price_lists,public.price_list_entries from public,anon,authenticated;
grant select on public.price_lists,public.price_list_entries to authenticated;
create policy price_lists_read on public.price_lists for select to authenticated using(public.company_permission(company_id,'read','catalog') or public.company_permission(company_id,'read','production') or public.company_permission(company_id,'read','sales'));
create policy price_entries_read on public.price_list_entries for select to authenticated using(public.company_permission(company_id,'read','catalog') or public.company_permission(company_id,'read','production') or public.company_permission(company_id,'read','sales'));

-- Preserve existing commercial prices once. Future reads use only the central lists.
insert into public.price_lists(company_id,name,is_base) select id,'Precio base',true from public.companies;
insert into public.price_list_entries(company_id,list_id,variant_id,price,currency,active)
 select pv.company_id,pl.id,pv.id,pv.price,pv.currency,pv.active from public.product_variants pv join public.price_lists pl on pl.company_id=pv.company_id and pl.is_base;
alter table public.product_variants alter column price drop not null;
comment on column public.product_variants.price is 'Read-only legacy migration value; never a price master or fallback. Sale price master is price_list_entries.';

create function access_private.price_list_guard() returns trigger language plpgsql set search_path='' as $$begin
 if tg_op='DELETE' then if old.is_base then raise exception 'Asigna otra lista base antes de eliminar esta lista';end if;return old;end if;
 if tg_op='UPDATE' and (new.id,new.company_id) is distinct from (old.id,old.company_id) then raise exception 'La identidad de la lista no cambia';end if;
 if tg_op='UPDATE' and old.is_base and not new.active then raise exception 'Asigna otra lista base antes de desactivar esta lista';end if;
 return new;end $$;
create trigger price_list_guard before update or delete on public.price_lists for each row execute function access_private.price_list_guard();
revoke all on function access_private.price_list_guard() from public,anon,authenticated;

create function access_private.base_price_record(c uuid,vid uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('list_id',pl.id,'list_name',pl.name,'entry_id',pe.id,'price',pe.price,'currency',pe.currency,'variant_id',pe.variant_id)
 from public.price_lists pl join public.price_list_entries pe on pe.company_id=pl.company_id and pe.list_id=pl.id
 join public.companies co on co.id=pl.company_id
 where pl.company_id=c and pl.is_base and pl.active and pe.active and pe.variant_id=vid and pe.currency=co.currency
$$;
create function access_private.base_sale_price(c uuid,vid uuid) returns numeric language sql stable security invoker set search_path='' as $$select (access_private.base_price_record(c,vid)->>'price')::numeric$$;
revoke all on function access_private.base_price_record(uuid,uuid),access_private.base_sale_price(uuid,uuid) from public,anon;
grant execute on function access_private.base_price_record(uuid,uuid),access_private.base_sale_price(uuid,uuid) to authenticated;

create function access_private.price_list_command(c uuid,action text,data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare l public.price_lists%rowtype;e public.price_list_entries%rowtype;old_base uuid;target uuid;begin
 if auth.uid() is null or not public.company_permission(c,'manage') then raise exception 'Listas de precios no autorizadas' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(c::text,0));
 if action='list' then return jsonb_build_object('lists',coalesce((select jsonb_agg(to_jsonb(x) order by is_base desc,name) from public.price_lists x where company_id=c),'[]'),
 'entries',coalesce((select jsonb_agg(to_jsonb(x)) from public.price_list_entries x where company_id=c),'[]'),
 'products',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'active',active,'sku',sku) order by name) from public.products where company_id=c),'[]'),
 'variants',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'sku',sku,'product_id',product_id,'active',active) order by name) from public.product_variants where company_id=c),'[]'),
 'currency',(select currency from public.companies where id=c));end if;
 if action='save_list' then
  if nullif(btrim(data->>'name'),'') is null then raise exception 'Indica el nombre de la lista';end if;
  if nullif(data->>'id','') is null then insert into public.price_lists(company_id,name,active) values(c,btrim(data->>'name'),coalesce((data->>'active')::boolean,true)) returning * into l;
  else select * into strict l from public.price_lists where company_id=c and id=(data->>'id')::uuid for update;
   if l.revision is distinct from (data->>'revision')::integer then raise exception 'La lista cambió. Actualiza antes de guardar';end if;
   update public.price_lists set name=btrim(data->>'name'),active=coalesce((data->>'active')::boolean,true),revision=revision+1 where company_id=c and id=l.id returning * into l;
  end if;
  if coalesce((data->>'is_base')::boolean,false) then
   if not l.active then raise exception 'La lista base debe estar activa';end if;
   select id into old_base from public.price_lists where company_id=c and is_base;
   if old_base is distinct from l.id and old_base is distinct from nullif(data->>'expected_base_id','')::uuid then raise exception 'La lista base cambió. Actualiza y vuelve a confirmar';end if;
   update public.price_lists set is_base=false,revision=revision+1 where company_id=c and is_base and id<>l.id;
   update public.price_lists set is_base=true,revision=revision+1 where company_id=c and id=l.id and not is_base;
  elsif l.is_base then raise exception 'Asigna otra lista base antes de quitar esta marca';end if;
  return jsonb_build_object('id',l.id);
 elsif action='save_entry' then
  select * into strict l from public.price_lists where company_id=c and id=(data->>'list_id')::uuid and active;
  perform 1 from public.product_variants pv join public.products p on p.company_id=pv.company_id and p.id=pv.product_id where pv.company_id=c and pv.id=(data->>'variant_id')::uuid and (pv.active or nullif(data->>'id','') is not null);
  if not found then raise exception 'Presentación no disponible en esta empresa';end if;
  if nullif(data->>'id','') is null then insert into public.price_list_entries(company_id,list_id,variant_id,price,currency,active) values(c,l.id,(data->>'variant_id')::uuid,(data->>'price')::numeric,(select currency from public.companies where id=c),coalesce((data->>'active')::boolean,true)) returning id into target;
  else select * into strict e from public.price_list_entries where company_id=c and id=(data->>'id')::uuid and list_id=l.id for update;
   if e.revision is distinct from (data->>'revision')::integer then raise exception 'El precio cambió. Actualiza antes de guardar';end if;
   update public.price_list_entries set variant_id=(data->>'variant_id')::uuid,price=(data->>'price')::numeric,currency=(select currency from public.companies where id=c),active=coalesce((data->>'active')::boolean,true),revision=revision+1 where company_id=c and id=e.id returning id into target;
  end if;return jsonb_build_object('id',target);
 end if;raise exception 'Acción no válida';
exception when unique_violation then raise exception 'Ya existe ese nombre de lista o un precio para esa presentación en la lista';
 when no_data_found then raise exception 'Registro no disponible en esta empresa';end $$;
create function public.price_list_command(p_company uuid,p_action text,p_data jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select access_private.price_list_command(p_company,p_action,p_data)$$;
revoke all on function access_private.price_list_command(uuid,text,jsonb),public.price_list_command(uuid,text,jsonb) from public,anon;
grant execute on function access_private.price_list_command(uuid,text,jsonb),public.price_list_command(uuid,text,jsonb) to authenticated;

-- Reuse the version-bound expense lines for every additional-cost kind.
alter table public.formula_overhead_lines add column percent numeric(12,8) check(percent>=0 and percent<=100);
create or replace function access_private.formula_overhead_guard() returns trigger language plpgsql security definer set search_path='' as $$begin
 perform pg_advisory_xact_lock(hashtextextended(new.company_id::text,0));
 if access_private.formula_locked(new.company_id,new.formula_id) then raise exception 'La versión ya tiene producción confirmada. Crea otra versión' using errcode='55000';end if;
 if not exists(select 1 from public.additional_cost_catalog ac where ac.company_id=new.company_id and ac.id=new.cost_id) then raise exception 'Costo adicional inválido';end if;
 return new;end $$;
-- Backfill only selections that already existed; never rewrite confirmed batch snapshots.
alter table public.formula_overhead_lines disable trigger formula_overhead_guard;
insert into public.formula_overhead_lines(company_id,formula_id,cost_id,quantity)
 select company_id,id,labor_level_id,1 from public.formulas where labor_level_id is not null
 union all select company_id,id,advertising_level_id,1 from public.formulas where advertising_level_id is not null;
alter table public.formula_overhead_lines enable trigger formula_overhead_guard;

do $patch$declare def text;begin
 def:=pg_get_functiondef('access_private.formula_command(uuid,text,uuid,jsonb)'::regprocedure);
 def:=replace(def,$s$'quantity',ol.quantity)$s$,$s$'quantity',ol.quantity,'percent',ol.percent)$s$);
 def:=replace(def,$s$and ac.kind='overhead'$s$,'');
 def:=replace(def,$s$or (not ac.active and not(action='edit'$s$,$s$or (ac.kind<>'overhead' and e->>'percent' is not null and not coalesce((e->>'percent')::numeric>=0 and (e->>'percent')::numeric<=100,false)) or (not ac.active and not(action='edit'$s$);
 def:=replace(def,'formula_id,cost_id,quantity) select c,fid,','formula_id,cost_id,quantity,percent) select c,fid,');
 def:=replace(def,$s$(e->>'quantity')::numeric from jsonb_array_elements$s$,$s$(e->>'quantity')::numeric,nullif(e->>'percent','')::numeric from jsonb_array_elements$s$);
 def:=replace(def,'Otros gastos','Costos adicionales');
 if strpos(def,'cost_id,quantity,percent)')=0 then raise exception 'Comando de fórmula no reconocido';end if;execute def;
end $patch$;

create or replace function access_private.additional_cost_quote(c uuid,n numeric,vid uuid,lid uuid,aid uuid,selected jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare ccy text;ref jsonb;price numeric;lines jsonb;extra numeric;overhead numeric;begin
 select currency into strict ccy from public.companies where id=c;
 if n is not null and not(n>0 and n<1e12) then raise exception 'Unidades estimadas inválidas';end if;
 if jsonb_typeof(selected)<>'array' then raise exception 'Selección de costos inválida';end if;
 if exists(select 1 from jsonb_array_elements(selected)e left join public.additional_cost_catalog ac on ac.company_id=c and ac.id=(e->>'cost_id')::uuid where ac.id is null or not coalesce((e->>'quantity')::numeric>0 and (e->>'quantity')::numeric<1e12,false)) then raise exception 'Costos no disponibles en la empresa';end if;
 if exists(select 1 from jsonb_array_elements(selected)e group by e->>'cost_id' having count(*)>1) then raise exception 'Conceptos duplicados';end if;
 ref:=access_private.base_price_record(c,vid);price:=(ref->>'price')::numeric;
 select coalesce(jsonb_agg(jsonb_build_object('cost_id',ac.id,'kind',ac.kind,'name',ac.name,'quantity',(e->>'quantity')::numeric,'percent',case when ac.kind<>'overhead' then coalesce(nullif(e->>'percent','')::numeric,ac.percent) end,'unit_price',case when ac.kind='overhead' then ac.unit_price end,'currency',case when ac.kind='overhead' then ac.currency else ccy end,
 'total',case when ac.kind='overhead' then case when ac.currency=ccy then (e->>'quantity')::numeric*ac.unit_price end else price*coalesce(nullif(e->>'percent','')::numeric,ac.percent)/100*n end) order by ac.kind,ac.name),'[]') into lines from jsonb_array_elements(selected)e join public.additional_cost_catalog ac on ac.company_id=c and ac.id=(e->>'cost_id')::uuid;
 select case when bool_and(e->>'total' is not null) then sum((e->>'total')::numeric) end into extra from jsonb_array_elements(lines)e;
 if jsonb_array_length(lines)=0 then extra:=0;end if;
 select case when bool_and(e->>'total' is not null) then sum((e->>'total')::numeric) end into overhead from jsonb_array_elements(lines)e where e->>'kind'='overhead';
 if not exists(select 1 from jsonb_array_elements(lines)e where e->>'kind'='overhead') then overhead:=0;end if;
 return jsonb_build_object('currency',ccy,'estimated_units',n,'unit_basis_count',n,'variant_id',vid,'sale_price',price,'price_reference',ref,'cost_lines',lines,'overhead_lines',(select coalesce(jsonb_agg(e),'[]') from jsonb_array_elements(lines)e where e->>'kind'='overhead'),'overhead_total',overhead,'overhead_unit',overhead/nullif(n,0),'additional_total',extra,'additional_unit',extra/nullif(n,0));end $$;
revoke all on function access_private.additional_cost_quote(uuid,numeric,uuid,uuid,uuid,jsonb) from public,anon,authenticated;

do $patch$declare def text;begin
 def:=pg_get_functiondef('access_private.batch_trace_guard()'::regprocedure);
 def:=replace(def,$s$'quantity',ol.quantity)$s$,$s$'quantity',ol.quantity,'percent',ol.percent)$s$);
 def:=replace(def,$s$x.kind='overhead' and exists(select 1 from public.formula_overhead_lines$s$,$s$exists(select 1 from public.formula_overhead_lines$s$);
 execute def;
 -- Replace all read paths; compatibility variant.price is never a master again.
 def:=pg_get_functiondef('access_private.formula_catalog(uuid)'::regprocedure);
 def:=replace(def,'pv.price','access_private.base_sale_price(pv.company_id,pv.id)');
 def:=replace(def,$s$'currency',pv.currency$s$,$s$'currency',(select currency from public.companies where id=c)$s$);execute def;
 def:=pg_get_functiondef('access_private.sales(uuid,text,uuid,jsonb)'::regprocedure);
 def:=replace(def,'pv.price','access_private.base_sale_price(pv.company_id,pv.id)');
 def:=replace(def,$s$'currency',pv.currency$s$,$s$'currency',(select currency from public.companies where id=c)$s$);execute def;
 def:=pg_get_functiondef('access_private.operations(uuid,text,uuid,jsonb)'::regprocedure);
 def:=replace(def,$s$(p_data->>'price')::numeric$s$,'null::numeric');
 def:=replace(def,$s$price=null::numeric,$s$,'');
 def:=replace(def,$s$to_jsonb(pv)||jsonb_build_object('available'$s$,$s$to_jsonb(pv)||jsonb_build_object('currency',(select currency from public.companies where id=p_company),'price',access_private.base_sale_price(pv.company_id,pv.id),'available'$s$);
 execute def;
 def:=pg_get_functiondef('access_private.storefront(uuid)'::regprocedure);
 def:=replace(def,'pv.price','access_private.base_sale_price(pv.company_id,pv.id)');
 def:=replace(def,'and pv.currency=co.currency','and access_private.base_sale_price(pv.company_id,pv.id) is not null');execute def;
end $patch$;

-- Sales retain both the actual sold amount and the list reference used at confirmation.
alter table public.order_lines add column price_reference jsonb;
do $patch$declare def text;begin
 def:=pg_get_functiondef('access_private.place_order(uuid,uuid,jsonb,boolean)'::regprocedure);
 def:=replace(def,'matched_phone text;begin','matched_phone text;price_ref jsonb;sold_price numeric;begin');
 def:=replace(def,'and pv.currency=ccy','');
 def:=replace(def,'select name into product_name',$new$price_ref:=access_private.base_price_record(c,v.id);
  sold_price:=case when staff and r->>'unit_price' is not null then (r->>'unit_price')::numeric else (price_ref->>'price')::numeric end;
  if sold_price is null then raise exception 'Pendiente de precio. Configura la lista base o indica el precio realmente vendido';end if;
  if not(sold_price>=0 and sold_price<1e12) then raise exception 'Precio de venta inválido';end if;
  select name into product_name$new$);
 def:=replace(def,'unit_price,reserved_quantity) values','unit_price,reserved_quantity,price_reference) values');
 def:=replace(def,'qty,v.price,reserve_qty)','qty,sold_price,reserve_qty,price_ref)');
 def:=replace(def,'sub:=sub+qty*v.price','sub:=sub+qty*sold_price');
 if strpos(def,'qty,sold_price,reserve_qty,price_ref)')=0 then raise exception 'Venta no reconocida';end if;execute def;
end $patch$;
create function access_private.no_variant_price_master() returns trigger language plpgsql set search_path='' as $$begin
 if (tg_op='INSERT' and new.price is not null) or (tg_op='UPDATE' and new.price is distinct from old.price) then raise exception 'Administra el precio de venta en Lista de precios';end if;return new;end $$;
create trigger no_variant_price_master before insert or update on public.product_variants for each row execute function access_private.no_variant_price_master();
revoke all on function access_private.no_variant_price_master() from public,anon,authenticated;
notify pgrst,'reload schema';
