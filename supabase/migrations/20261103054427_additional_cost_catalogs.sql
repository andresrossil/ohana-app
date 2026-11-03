-- Company-scoped cost catalogs. Stock valuation and stock movements remain unchanged.
create table public.additional_cost_catalog (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id),
 kind text not null check(kind in ('overhead','labor','advertising')),
 name text not null check(length(btrim(name)) between 1 and 120),
 quantity numeric(20,8) not null default 1 check(quantity>=0 and quantity<1e12),
 unit_price numeric(20,8) not null default 0 check(unit_price>=0 and unit_price<1e12),
 currency text not null default 'GTQ' references public.currencies(code),
 percent numeric(10,6) not null default 0 check(percent>=0 and percent<=100),
 active boolean not null default true,
 used_in_history boolean not null default false,
 revision integer not null default 1,
 created_at timestamptz not null default now(),
 unique(company_id,id)
);
create unique index additional_cost_name on public.additional_cost_catalog(company_id,kind,lower(btrim(name)));
alter table public.additional_cost_catalog enable row level security;
revoke all on public.additional_cost_catalog from public,anon,authenticated;
grant select on public.additional_cost_catalog to authenticated;
create policy scoped_cost_read on public.additional_cost_catalog for select to authenticated
 using(public.company_permission(company_id,'manage') or public.company_permission(company_id,'read','production'));

alter table public.formulas add column labor_level_id uuid,add column advertising_level_id uuid,
 add foreign key(company_id,labor_level_id) references public.additional_cost_catalog(company_id,id),
 add foreign key(company_id,advertising_level_id) references public.additional_cost_catalog(company_id,id);
create index formula_labor_level on public.formulas(company_id,labor_level_id);
create index formula_advertising_level on public.formulas(company_id,advertising_level_id);

create function access_private.seed_additional_costs(c uuid) returns void language sql security definer set search_path='' as $$
 insert into public.additional_cost_catalog(company_id,kind,name,quantity,unit_price,currency,percent)
 select c,'overhead',name,1,price,'GTQ',0 from(values('Papel burbuja',.25),('Yute',.25),('Gas',.50),('Bolsa',.50),('Papel',.50),('Luz',.25))v(name,price);
 insert into public.additional_cost_catalog(company_id,kind,name,percent)
 select c,kind,name,pct from(values('labor','A1',5),('labor','A2',7),('labor','A3',9),('advertising','A1',3),('advertising','A2',5),('advertising','A3',7))v(kind,name,pct)
$$;
create function access_private.seed_company_costs() returns trigger language plpgsql security definer set search_path='' as $$begin
 perform access_private.seed_additional_costs(new.id);return new;end $$;
revoke all on function access_private.seed_additional_costs(uuid),access_private.seed_company_costs() from public,anon,authenticated;
do $$declare c uuid;begin for c in select id from public.companies loop perform access_private.seed_additional_costs(c);end loop;end $$;
create trigger seed_company_costs after insert on public.companies for each row execute function access_private.seed_company_costs();

create function access_private.additional_cost_command(c uuid,action text,data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.additional_cost_catalog%rowtype;answer jsonb;begin
 if auth.uid() is null or not (public.company_permission(c,'manage') or (action='list' and public.company_permission(c,'read','production'))) then raise exception 'Costos adicionales no autorizados' using errcode='42501';end if;
 if action='list' then
  return jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(x)||jsonb_build_object('associated',x.used_in_history or exists(select 1 from public.formulas f where f.company_id=c and (f.labor_level_id=x.id or f.advertising_level_id=x.id))) order by kind,name) from public.additional_cost_catalog x where x.company_id=c),'[]'),'currency',(select currency from public.companies where id=c),'can_manage',public.company_permission(c,'manage'));
 end if;
 if action not in('save','delete') then raise exception 'Acción inválida';end if;
 perform pg_advisory_xact_lock(hashtextextended(c::text,0));
 if nullif(data->>'id','') is not null then
  select * into strict r from public.additional_cost_catalog where company_id=c and id=(data->>'id')::uuid for update;
  if r.revision is distinct from (data->>'revision')::integer then raise exception 'Este registro cambió. Actualiza antes de guardar' using errcode='40001';end if;
 end if;
 if action='delete' then
  if r.id is null then raise exception 'Selecciona un registro';end if;
  if r.used_in_history or exists(select 1 from public.formulas f where f.company_id=c and (f.labor_level_id=r.id or f.advertising_level_id=r.id)) then raise exception 'Tiene asociaciones. Puedes desactivarlo, pero no eliminarlo';end if;
  delete from public.additional_cost_catalog where company_id=c and id=r.id;return jsonb_build_object('id',r.id);
 end if;
 if r.id is null then
  insert into public.additional_cost_catalog(company_id,kind,name,quantity,unit_price,currency,percent,active)
  values(c,data->>'kind',btrim(data->>'name'),coalesce(nullif(data->>'quantity','')::numeric,1),coalesce(nullif(data->>'unit_price','')::numeric,0),coalesce(nullif(data->>'currency',''),(select currency from public.companies where id=c)),coalesce(nullif(data->>'percent','')::numeric,0),coalesce((data->>'active')::boolean,true)) returning id into r.id;
 else
  if r.kind is distinct from data->>'kind' then raise exception 'El catálogo del registro no cambia';end if;
  update public.additional_cost_catalog set name=btrim(data->>'name'),quantity=coalesce(nullif(data->>'quantity','')::numeric,1),unit_price=coalesce(nullif(data->>'unit_price','')::numeric,0),currency=coalesce(nullif(data->>'currency',''),r.currency),percent=coalesce(nullif(data->>'percent','')::numeric,0),active=coalesce((data->>'active')::boolean,true),revision=revision+1 where company_id=c and id=r.id;
 end if;
 return jsonb_build_object('id',r.id);
exception when unique_violation then raise exception 'Ya existe ese nombre en este catálogo';end $$;
create function public.additional_cost_command(p_company uuid,p_action text,p_data jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select access_private.additional_cost_command(p_company,p_action,p_data)$$;
revoke all on function access_private.additional_cost_command(uuid,text,jsonb),public.additional_cost_command(uuid,text,jsonb) from public,anon;
grant execute on function access_private.additional_cost_command(uuid,text,jsonb),public.additional_cost_command(uuid,text,jsonb) to authenticated;

-- Internal quote is shared by live estimates and the immutable confirmation snapshot.
create function access_private.additional_cost_quote(c uuid,n numeric,vid uuid,lid uuid,aid uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare ccy text;price numeric;vc text;overhead numeric;l public.additional_cost_catalog%rowtype;a public.additional_cost_catalog%rowtype;lu numeric;au numeric;lt numeric;atotal numeric;extra numeric;begin
 select currency into strict ccy from public.companies where id=c;
 if n is not null and not(n>0 and n<1e12) then raise exception 'Unidades estimadas inválidas';end if;
 select case when bool_and(x.currency=ccy) then sum(x.quantity*x.unit_price) else null end into overhead from public.additional_cost_catalog x where x.company_id=c and x.kind='overhead' and x.active;
 if not exists(select 1 from public.additional_cost_catalog x where x.company_id=c and x.kind='overhead' and x.active) then overhead:=0;end if;
 if vid is not null then select pv.price,pv.currency into price,vc from public.product_variants pv where pv.company_id=c and pv.id=vid;if vc is distinct from ccy then price:=null;end if;end if;
 if lid is not null then select * into strict l from public.additional_cost_catalog x where x.company_id=c and x.id=lid and x.kind='labor';end if;
 if aid is not null then select * into strict a from public.additional_cost_catalog x where x.company_id=c and x.id=aid and x.kind='advertising';end if;
 lu:=case when lid is null then 0 else price*l.percent/100 end;au:=case when aid is null then 0 else price*a.percent/100 end;
 lt:=case when lid is null then 0 else lu*n end;atotal:=case when aid is null then 0 else au*n end;extra:=overhead+lt+atotal;
 return jsonb_build_object('currency',ccy,'estimated_units',n,'variant_id',vid,'sale_price',price,'overhead_total',overhead,'overhead_unit',overhead/n,
 'labor',jsonb_build_object('id',lid,'name',l.name,'percent',l.percent,'unit',lu,'total',lt),
 'advertising',jsonb_build_object('id',aid,'name',a.name,'percent',a.percent,'unit',au,'total',atotal),'additional_total',extra,'additional_unit',extra/n);
end $$;
revoke all on function access_private.additional_cost_quote(uuid,numeric,uuid,uuid,uuid) from public,anon,authenticated;

-- Extend existing formula and catalog commands, keeping authorization/retries/versions intact.
do $patch$declare def text;before_def text;begin
 def:=pg_get_functiondef('access_private.formula_command(uuid,text,uuid,jsonb)'::regprocedure);before_def:=def;
 def:=replace(def,'product:=(data->>''product'')::uuid;', $new$product:=(data->>'product')::uuid;
  perform 1 from public.additional_cost_catalog x where x.company_id=c and (
   (x.id=nullif(data->>'labor_level_id','')::uuid and (x.kind<>'labor' or (not x.active and not(action='edit' and x.id is not distinct from src.labor_level_id)))) or
   (x.id=nullif(data->>'advertising_level_id','')::uuid and (x.kind<>'advertising' or (not x.active and not(action='edit' and x.id is not distinct from src.advertising_level_id)))));
  if found then raise exception 'Selecciona niveles activos del catálogo correspondiente';end if;
 $new$);
 def:=replace(def,'set estimate_variant_id=nullif', 'set labor_level_id=nullif(data->>''labor_level_id'','''')::uuid,advertising_level_id=nullif(data->>''advertising_level_id'','''')::uuid,estimate_variant_id=nullif');
 if def=before_def or strpos(def,'set labor_level_id=')=0 then raise exception 'Comando de fórmulas no reconocido';end if;execute def;
 def:=pg_get_functiondef('access_private.formula_catalog(uuid)'::regprocedure);before_def:=def;
 def:=replace(def,'''weight_min'',pv.weight_min', '''price'',pv.price,''currency'',pv.currency,''weight_min'',pv.weight_min');
 def:=replace(def,'''currency'',ccy,''next_code''','''additional_costs'',coalesce((select jsonb_agg(to_jsonb(ac) order by ac.kind,ac.name) from public.additional_cost_catalog ac where ac.company_id=c),''[]''),''currency'',ccy,''next_code''');
 if def=before_def or strpos(def,'''additional_costs''')=0 then raise exception 'Catálogo de fórmulas no reconocido';end if;execute def;
end $patch$;

-- Kind checks also protect future internal callers and preserve cross-company FKs.
create function access_private.formula_cost_guard() returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.labor_level_id is not null and not exists(select 1 from public.additional_cost_catalog x where x.company_id=new.company_id and x.id=new.labor_level_id and x.kind='labor') then raise exception 'Nivel de mano de obra inválido';end if;
 if new.advertising_level_id is not null and not exists(select 1 from public.additional_cost_catalog x where x.company_id=new.company_id and x.id=new.advertising_level_id and x.kind='advertising') then raise exception 'Nivel de publicidad inválido';end if;
 return new;end $$;
revoke all on function access_private.formula_cost_guard() from public,anon,authenticated;
create trigger formula_cost_guard before insert or update on public.formulas for each row execute function access_private.formula_cost_guard();

do $patch$declare def text;begin
 def:=pg_get_functiondef('access_private.batch_trace_guard()'::regprocedure);
 def:=replace(def,'new.confirmed:=true;new.confirmed_at:=now();', $new$
   new.recipe_snapshot:=new.recipe_snapshot||jsonb_build_object('additional_costs',access_private.additional_cost_quote(new.company_id,(select f.estimated_units*new.formula_scale from public.formulas f where f.company_id=new.company_id and f.id=new.formula_id),(select f.estimate_variant_id from public.formulas f where f.company_id=new.company_id and f.id=new.formula_id),(select f.labor_level_id from public.formulas f where f.company_id=new.company_id and f.id=new.formula_id),(select f.advertising_level_id from public.formulas f where f.company_id=new.company_id and f.id=new.formula_id)));
   new.recipe_snapshot:=new.recipe_snapshot||jsonb_build_object('estimated_total_cost',new.total_cost+(new.recipe_snapshot#>>'{additional_costs,additional_total}')::numeric,'estimated_unit_cost',(new.total_cost+(new.recipe_snapshot#>>'{additional_costs,additional_total}')::numeric)/nullif((new.recipe_snapshot#>>'{additional_costs,estimated_units}')::numeric,0));
   update public.additional_cost_catalog x set used_in_history=true where x.company_id=new.company_id and not x.used_in_history and ((x.kind='overhead' and x.active) or x.id in(select f.labor_level_id from public.formulas f where f.company_id=new.company_id and f.id=new.formula_id union all select f.advertising_level_id from public.formulas f where f.company_id=new.company_id and f.id=new.formula_id));
   new.confirmed:=true;new.confirmed_at:=now();$new$);
 if strpos(def,'''additional_costs''')=0 then raise exception 'Confirmación de lote no reconocida';end if;execute def;
end $patch$;
notify pgrst,'reload schema';
