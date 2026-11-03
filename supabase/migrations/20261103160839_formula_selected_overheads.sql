-- No backfill: future estimates start with no selected general expenses.
-- Previously confirmed JSON snapshots remain untouched.
create table public.formula_overhead_lines (
 company_id uuid not null,
 formula_id uuid not null,
 cost_id uuid not null,
 quantity numeric(20,8) not null check(quantity>0 and quantity<1e12),
 primary key(company_id,formula_id,cost_id),
 foreign key(company_id,formula_id) references public.formulas(company_id,id),
 foreign key(company_id,cost_id) references public.additional_cost_catalog(company_id,id)
);
create index formula_overhead_cost on public.formula_overhead_lines(company_id,cost_id);
alter table public.formula_overhead_lines enable row level security;
revoke all on public.formula_overhead_lines from public,anon,authenticated;
grant select on public.formula_overhead_lines to authenticated;
create policy scoped_overhead_read on public.formula_overhead_lines for select to authenticated using(public.company_permission(company_id,'read','production'));
create function access_private.formula_overhead_guard() returns trigger language plpgsql security definer set search_path='' as $$begin
 perform pg_advisory_xact_lock(hashtextextended(new.company_id::text,0));
 if access_private.formula_locked(new.company_id,new.formula_id) then raise exception 'La versión ya tiene producción confirmada. Crea otra versión' using errcode='55000';end if;
 if not exists(select 1 from public.additional_cost_catalog ac where ac.company_id=new.company_id and ac.id=new.cost_id and ac.kind='overhead') then raise exception 'Concepto de Otros gastos inválido';end if;
 return new;end $$;
revoke all on function access_private.formula_overhead_guard() from public,anon,authenticated;
create trigger formula_overhead_guard before insert or update on public.formula_overhead_lines for each row execute function access_private.formula_overhead_guard();
create trigger formula_overhead_lock before update or delete on public.formula_overhead_lines for each row execute function access_private.formula_line_guard();

do $patch$declare def text;old_part text;new_part text;begin
 def:=pg_get_functiondef('access_private.formula_command(uuid,text,uuid,jsonb)'::regprocedure);
 def:=replace(def,$s$'own_reference',ff.own_reference,$s$,$s$'overhead_lines',coalesce((select jsonb_agg(jsonb_build_object('cost_id',ol.cost_id,'quantity',ol.quantity) order by ol.cost_id) from public.formula_overhead_lines ol where ol.company_id=c and ol.formula_id=fm.id),'[]'),'own_reference',ff.own_reference,$s$);
 def:=replace(def,$s$product:=(data->>'product')::uuid;$s$,$new$
 if coalesce(jsonb_typeof(data->'overhead_lines'),'array')<>'array' or jsonb_array_length(coalesce(data->'overhead_lines','[]'))>100 then raise exception 'Añade hasta 100 conceptos de Otros gastos';end if;
 if exists(select 1 from jsonb_array_elements(coalesce(data->'overhead_lines','[]')) e group by e->>'cost_id' having count(*)>1) then raise exception 'Un concepto de Otros gastos solo puede aparecer una vez';end if;
 if exists(select 1 from jsonb_array_elements(coalesce(data->'overhead_lines','[]')) e left join public.additional_cost_catalog ac on ac.company_id=c and ac.id=(e->>'cost_id')::uuid and ac.kind='overhead'
 where ac.id is null or not coalesce((e->>'quantity')::numeric>0 and (e->>'quantity')::numeric<1e12,false)
 or (not ac.active and not(action='edit' and exists(select 1 from public.formula_overhead_lines old_line where old_line.company_id=c and old_line.formula_id=src.id and old_line.cost_id=ac.id)))) then raise exception 'Revisa los conceptos activos y las cantidades de Otros gastos';end if;
 product:=(data->>'product')::uuid;$new$);
 def:=replace(def,$s$end loop;answer:=jsonb_build_object('id',fid,'version',ver);$s$,$new$end loop;
 delete from public.formula_overhead_lines where company_id=c and formula_id=fid;
 insert into public.formula_overhead_lines(company_id,formula_id,cost_id,quantity) select c,fid,(e->>'cost_id')::uuid,(e->>'quantity')::numeric from jsonb_array_elements(coalesce(data->'overhead_lines','[]')) e;
 answer:=jsonb_build_object('id',fid,'version',ver);$new$);
 if strpos(def,'insert into public.formula_overhead_lines')=0 or strpos(def,$s$'overhead_lines',coalesce$s$)=0 then raise exception 'Comando de fórmula no reconocido';end if;execute def;
 def:=pg_get_functiondef('access_private.formula_catalog(uuid)'::regprocedure);
 def:=replace(def,'select id,name,sku,unit_id,active from public.products','select id,name,sku,unit_id,active,photo_path from public.products');execute def;

 -- Keep labor/advertising calculations unchanged; replace only the expense source.
 def:=pg_get_functiondef('access_private.additional_cost_quote(uuid,numeric,uuid,uuid,uuid)'::regprocedure);
 def:=replace(def,'aid uuid)','aid uuid, selected jsonb)');
 old_part:=$old$select case when bool_and(x.currency=ccy) then sum(x.quantity*x.unit_price) else null end into overhead from public.additional_cost_catalog x where x.company_id=c and x.kind='overhead' and x.active;
 if not exists(select 1 from public.additional_cost_catalog x where x.company_id=c and x.kind='overhead' and x.active) then overhead:=0;end if;$old$;
 new_part:=$new$
 if jsonb_typeof(selected)<>'array' then raise exception 'Selección de gastos inválida';end if;
 if exists(select 1 from jsonb_array_elements(selected)e left join public.additional_cost_catalog ac on ac.company_id=c and ac.id=(e->>'cost_id')::uuid and ac.kind='overhead' where ac.id is null or not coalesce((e->>'quantity')::numeric>0 and (e->>'quantity')::numeric<1e12,false)) then raise exception 'Gastos no disponibles en la empresa';end if;
 select case when bool_and(ac.currency=ccy) then sum((e->>'quantity')::numeric*ac.unit_price) else null end into overhead from jsonb_array_elements(selected)e join public.additional_cost_catalog ac on ac.company_id=c and ac.id=(e->>'cost_id')::uuid;
 if jsonb_array_length(selected)=0 then overhead:=0;end if;$new$;
 if strpos(def,old_part)=0 then raise exception 'Cálculo de Otros gastos no reconocido';end if;
 def:=replace(def,old_part,new_part);
 def:=replace(def,$s$'overhead_total',overhead$s$,$s$'unit_basis_count',n,'overhead_lines',coalesce((select jsonb_agg(jsonb_build_object('cost_id',ac.id,'name',ac.name,'quantity',(e->>'quantity')::numeric,'unit_price',ac.unit_price,'currency',ac.currency,'total',(e->>'quantity')::numeric*ac.unit_price) order by ac.name) from jsonb_array_elements(selected)e join public.additional_cost_catalog ac on ac.company_id=c and ac.id=(e->>'cost_id')::uuid),'[]'),'overhead_total',overhead$s$);
 execute def;
end $patch$;
-- Existing internal callers without a selection also apply no overhead.
create or replace function access_private.additional_cost_quote(c uuid,n numeric,vid uuid,lid uuid,aid uuid) returns jsonb language sql stable security definer set search_path='' as $$select access_private.additional_cost_quote(c,n,vid,lid,aid,'[]'::jsonb)$$;
revoke all on function access_private.additional_cost_quote(uuid,numeric,uuid,uuid,uuid,jsonb),access_private.additional_cost_quote(uuid,numeric,uuid,uuid,uuid) from public,anon,authenticated;

do $patch$declare def text;before_def text;begin
 def:=pg_get_functiondef('access_private.batch_trace_guard()'::regprocedure);
 def:=replace(def,$s$(select f.advertising_level_id from public.formulas f where f.company_id=new.company_id and f.id=new.formula_id)))$s$,$s$(select f.advertising_level_id from public.formulas f where f.company_id=new.company_id and f.id=new.formula_id),coalesce((select jsonb_agg(jsonb_build_object('cost_id',ol.cost_id,'quantity',ol.quantity)) from public.formula_overhead_lines ol where ol.company_id=new.company_id and ol.formula_id=new.formula_id),'[]')))$s$);
 def:=replace(def,$s$new.recipe_snapshot:=new.recipe_snapshot||jsonb_build_object('estimated_total_cost'$s$,$new$
   new.recipe_snapshot:=jsonb_set(new.recipe_snapshot,'{additional_costs}',(new.recipe_snapshot->'additional_costs')||jsonb_build_object('unit_basis_count',coalesce(nullif(new.actual_quantity,0),(new.recipe_snapshot#>>'{additional_costs,estimated_units}')::numeric),'overhead_unit',(new.recipe_snapshot#>>'{additional_costs,overhead_total}')::numeric/coalesce(nullif(new.actual_quantity,0),(new.recipe_snapshot#>>'{additional_costs,estimated_units}')::numeric),'additional_unit',(new.recipe_snapshot#>>'{additional_costs,additional_total}')::numeric/coalesce(nullif(new.actual_quantity,0),(new.recipe_snapshot#>>'{additional_costs,estimated_units}')::numeric)));
   new.recipe_snapshot:=new.recipe_snapshot||jsonb_build_object('estimated_total_cost'$new$);
 def:=replace(def,$s$nullif((new.recipe_snapshot#>>'{additional_costs,estimated_units}')::numeric,0)$s$,$s$nullif((new.recipe_snapshot#>>'{additional_costs,unit_basis_count}')::numeric,0)$s$);
 def:=replace(def,$s$(x.kind='overhead' and x.active)$s$,$s$(x.kind='overhead' and exists(select 1 from public.formula_overhead_lines ol where ol.company_id=new.company_id and ol.formula_id=new.formula_id and ol.cost_id=x.id))$s$);
 if strpos(def,'from public.formula_overhead_lines')=0 or strpos(def,$s$'unit_basis_count'$s$)=0 then raise exception 'Confirmación no reconocida';end if;execute def;
 def:=pg_get_functiondef('access_private.additional_cost_command(uuid,text,jsonb)'::regprocedure);before_def:=def;
 def:=replace(def,'x.used_in_history or exists(', 'x.used_in_history or exists(select 1 from public.formula_overhead_lines ol where ol.company_id=c and ol.cost_id=x.id) or exists(');
 def:=replace(def,'if r.used_in_history or exists(', 'if r.used_in_history or exists(select 1 from public.formula_overhead_lines ol where ol.company_id=c and ol.cost_id=r.id) or exists(');
 if def=before_def then raise exception 'Catálogo de gastos no reconocido';end if;execute def;
end $patch$;
notify pgrst,'reload schema';
