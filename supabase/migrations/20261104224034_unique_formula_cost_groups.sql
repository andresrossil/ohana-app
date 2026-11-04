CREATE OR REPLACE FUNCTION access_private.formula_overhead_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$begin
 perform pg_advisory_xact_lock(hashtextextended(new.company_id::text,0));
 if access_private.formula_locked(new.company_id,new.formula_id) then raise exception 'La versión ya tiene producción confirmada. Crea otra versión' using errcode='55000';end if;
 if not exists(select 1 from public.additional_cost_catalog ac where ac.company_id=new.company_id and ac.id=new.cost_id) then raise exception 'Costo adicional inválido';end if;

 if exists(select 1 from public.additional_cost_catalog target join public.formula_overhead_lines l on l.company_id=target.company_id and l.formula_id=new.formula_id
 join public.additional_cost_catalog other on other.company_id=l.company_id and other.id=l.cost_id
 where target.company_id=new.company_id and target.id=new.cost_id and target.kind in('labor','advertising') and other.kind=target.kind
 and (tg_op='INSERT' or row(l.company_id,l.formula_id,l.cost_id) is distinct from row(old.company_id,old.formula_id,old.cost_id)))
 then raise exception 'Solo se permite un concepto de Mano de obra y uno de Publicidad por fórmula' using errcode='23505';end if;
 return new;end $function$
;
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

 if exists(select 1 from jsonb_array_elements(selected)e join public.additional_cost_catalog ac on ac.company_id=c and ac.id=(e->>'cost_id')::uuid where ac.kind in('labor','advertising') group by ac.kind having count(*)>1) then raise exception 'Solo se permite un concepto de Mano de obra y uno de Publicidad por fórmula' using errcode='23505';end if;
 ref:=access_private.base_price_record(c,vid);price:=(ref->>'price')::numeric;
 select coalesce(jsonb_agg(jsonb_build_object('cost_id',ac.id,'kind',ac.kind,'name',ac.name,'quantity',case when ac.kind='overhead' then n else (e->>'quantity')::numeric end,'percent',case when ac.kind<>'overhead' then coalesce(nullif(e->>'percent','')::numeric,ac.percent) end,'unit_price',case when ac.kind='overhead' then ac.unit_price end,'currency',case when ac.kind='overhead' then ac.currency else ccy end,
 'total',case when ac.kind='overhead' then case when ac.currency=ccy then n*ac.unit_price end else price*coalesce(nullif(e->>'percent','')::numeric,ac.percent)/100*n end) order by ac.kind,ac.name),'[]') into lines from jsonb_array_elements(selected)e join public.additional_cost_catalog ac on ac.company_id=c and ac.id=(e->>'cost_id')::uuid;
 select case when bool_and(e->>'total' is not null) then sum((e->>'total')::numeric) end into extra from jsonb_array_elements(lines)e;
 if jsonb_array_length(lines)=0 then extra:=0;end if;
 select case when bool_and(e->>'total' is not null) then sum((e->>'total')::numeric) end into overhead from jsonb_array_elements(lines)e where e->>'kind'='overhead';
 if not exists(select 1 from jsonb_array_elements(lines)e where e->>'kind'='overhead') then overhead:=0;end if;
 return jsonb_build_object('currency',ccy,'estimated_units',n,'unit_basis_count',n,'variant_id',vid,'sale_price',price,'price_reference',ref,'cost_lines',lines,'overhead_lines',(select coalesce(jsonb_agg(e),'[]') from jsonb_array_elements(lines)e where e->>'kind'='overhead'),'overhead_total',overhead,'overhead_unit',overhead/nullif(n,0),'additional_total',extra,'additional_unit',extra/nullif(n,0));end $function$
;
