alter table public.company_settings add column margin_ranges jsonb not null default '[{"label":"Bajo","min":null,"max":40,"color":"#B42318","icon":"action.cancel"},{"label":"Atención","min":40,"max":50,"color":"#946200","icon":"status.warning"},{"label":"Esperado","min":50,"max":null,"color":"#18794E","icon":"status.success"}]'::jsonb;
alter table public.company_settings add column margin_revision integer not null default 0;
create function access_private.margin_ranges_valid(ranges jsonb) returns boolean language plpgsql immutable set search_path='' as $$
declare r jsonb;lo numeric;hi numeric;last_hi numeric;i integer:=0;cnt integer;
begin
 if jsonb_typeof(ranges) is distinct from 'array' then return false;end if;
 cnt:=jsonb_array_length(ranges);if cnt not between 1 and 20 then return false;end if;
 for r in select value from jsonb_array_elements(ranges) loop
  i:=i+1;
  if jsonb_typeof(r) is distinct from 'object' or not(r ?& array['label','min','max','color','icon']) then return false;end if;
  if length(btrim(coalesce(r->>'label',''))) not between 1 and 80 or coalesce(r->>'color','')!~'^#[0-9a-fA-F]{6}$'
   or coalesce(r->>'icon','') not in('status.success','status.warning','action.cancel','status.error','status.info','status.active','status.archived','status.purchased','status.manufactured') then return false;end if;
  if r->'min'<>'null'::jsonb and jsonb_typeof(r->'min')<>'number' or r->'max'<>'null'::jsonb and jsonb_typeof(r->'max')<>'number' then return false;end if;
  lo:=(r->>'min')::numeric;hi:=(r->>'max')::numeric;
  if (i=1 and lo is not null) or (i>1 and (lo is null or lo is distinct from last_hi)) or (i=cnt and hi is not null) or (i<cnt and hi is null) or (lo is not null and hi is not null and lo>=hi) then return false;end if;
  last_hi:=hi;
 end loop;
 return true;
exception when others then return false;
end $$;
revoke all on function access_private.margin_ranges_valid(jsonb) from public,anon;
grant execute on function access_private.margin_ranges_valid(jsonb) to authenticated;
alter table public.company_settings add constraint company_margin_ranges_valid check(access_private.margin_ranges_valid(margin_ranges));

create function access_private.margin_settings(c uuid,action text,ranges jsonb,revision integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;old_revision integer;
begin
 if auth.uid() is null or not(public.company_permission(c,'manage') or (action='get' and public.company_permission(c,'read','identity'))) then raise exception 'Configuración de margen no autorizada' using errcode='42501';end if;
 if action not in('get','save') then raise exception 'Acción inválida';end if;
 if action='save' then
  if not access_private.margin_ranges_valid(ranges) then raise exception 'Revisa los rangos: deben ser consecutivos, sin huecos ni solapamientos, con nombre, color e icono válidos';end if;
  perform pg_advisory_xact_lock(hashtextextended(c::text,0));
  select margin_revision into old_revision from public.company_settings where company_id=c for update;
  if coalesce(old_revision,0) is distinct from revision then raise exception 'La configuración cambió. Actualiza antes de guardar' using errcode='40001';end if;
  insert into public.company_settings(company_id,margin_ranges,margin_revision) values(c,ranges,1)
   on conflict(company_id) do update set margin_ranges=excluded.margin_ranges,margin_revision=public.company_settings.margin_revision+1,updated_at=clock_timestamp();
 end if;
 select jsonb_build_object('ranges',margin_ranges,'revision',margin_revision) into result from public.company_settings where company_id=c;
 return coalesce(result,jsonb_build_object('ranges',null,'revision',0));
end $$;
revoke all on function access_private.margin_settings(uuid,text,jsonb,integer) from public,anon;
grant execute on function access_private.margin_settings(uuid,text,jsonb,integer) to authenticated;
create function public.margin_settings(p_company uuid,p_action text default 'get',p_ranges jsonb default null,p_revision integer default null) returns jsonb language sql security invoker set search_path='' as $$ select access_private.margin_settings(p_company,p_action,p_ranges,p_revision) $$;
revoke all on function public.margin_settings(uuid,text,jsonb,integer) from public,anon;
grant execute on function public.margin_settings(uuid,text,jsonb,integer) to authenticated;
CREATE OR REPLACE FUNCTION access_private.additional_cost_quote(c uuid, n numeric, vid uuid, lid uuid, aid uuid, selected jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare ccy text;ref jsonb;price numeric;lines jsonb;extra numeric;overhead numeric;begin
 select currency into strict ccy from public.companies where id=c;
 if n is not null and not(n>0 and n<1e12) then raise exception 'Unidades estimadas inválidas';end if;
 if jsonb_typeof(selected)<>'array' then raise exception 'Selección de costos inválida';end if;
 if exists(select 1 from jsonb_array_elements(selected)e left join public.additional_cost_catalog ac on ac.company_id=c and ac.id=(e->>'cost_id')::uuid where ac.id is null or not coalesce((e->>'quantity')::numeric>0 and (e->>'quantity')::numeric<1e12,false)) then raise exception 'Costos no disponibles en la empresa';end if;
 if exists(select 1 from jsonb_array_elements(selected)e group by e->>'cost_id' having count(*)>1) then raise exception 'Conceptos duplicados';end if;
 ref:=access_private.base_price_record(c,vid);price:=(ref->>'price')::numeric;
 select coalesce(jsonb_agg(jsonb_build_object('cost_id',ac.id,'kind',ac.kind,'name',ac.name,'quantity',case when ac.kind='overhead' then n else (e->>'quantity')::numeric end,'percent',case when ac.kind<>'overhead' then coalesce(nullif(e->>'percent','')::numeric,ac.percent) end,'unit_price',case when ac.kind='overhead' then ac.unit_price end,'currency',case when ac.kind='overhead' then ac.currency else ccy end,
 'total',case when ac.kind='overhead' then case when ac.currency=ccy then n*ac.unit_price end else price*coalesce(nullif(e->>'percent','')::numeric,ac.percent)/100*n end) order by ac.kind,ac.name),'[]') into lines from jsonb_array_elements(selected)e join public.additional_cost_catalog ac on ac.company_id=c and ac.id=(e->>'cost_id')::uuid;
 select case when bool_and(e->>'total' is not null) then sum((e->>'total')::numeric) end into extra from jsonb_array_elements(lines)e;
 if jsonb_array_length(lines)=0 then extra:=0;end if;
 select case when bool_and(e->>'total' is not null) then sum((e->>'total')::numeric) end into overhead from jsonb_array_elements(lines)e where e->>'kind'='overhead';
 if not exists(select 1 from jsonb_array_elements(lines)e where e->>'kind'='overhead') then overhead:=0;end if;
 return jsonb_build_object('currency',ccy,'estimated_units',n,'unit_basis_count',n,'variant_id',vid,'sale_price',price,'price_reference',ref,'cost_lines',lines,'overhead_lines',(select coalesce(jsonb_agg(e),'[]') from jsonb_array_elements(lines)e where e->>'kind'='overhead'),'overhead_total',overhead,'overhead_unit',overhead/nullif(n,0),'additional_total',extra,'additional_unit',extra/nullif(n,0));end $function$
;
