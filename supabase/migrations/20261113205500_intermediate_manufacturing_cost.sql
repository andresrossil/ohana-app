create function access_private.intermediate_manufacturing_cost(c uuid, entry_id uuid)
returns jsonb language sql stable set search_path='' as $$
  select case when snapshot.cost is not null then
    snapshot.cost || jsonb_build_object(
      'total', coalesce(
        (snapshot.cost->>'total')::numeric - amounts.commercial,
        il.unit_cost
      ),
      'lines', amounts.manufacturing
    )
  end
  from public.inventory_lots il
  cross join lateral (select access_private.intermediate_entry_cost(c,il.id) as cost) snapshot
  cross join lateral (
    select coalesce(sum((line->>'amount')::numeric)
             filter (where line->>'kind' in ('labor','advertising')),0) as commercial,
           coalesce(jsonb_agg(line)
             filter (where line->>'kind' not in ('labor','advertising')),'[]') as manufacturing
    from jsonb_array_elements(snapshot.cost->'lines') line
  ) amounts
  where il.company_id=c and il.id=entry_id
$$;

revoke all on function access_private.intermediate_manufacturing_cost(uuid,uuid) from public,anon,authenticated;

do $$
declare
  signature text;
  definition text;
begin
  foreach signature in array array[
    'access_private.consume_intermediates(uuid,uuid,uuid,jsonb)',
    'access_private.formula_catalog(uuid)'
  ] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    if strpos(definition,'access_private.intermediate_entry_cost(')=0 then
      raise exception 'Cambió la definición de %',signature;
    end if;
    execute replace(definition,'access_private.intermediate_entry_cost(','access_private.intermediate_manufacturing_cost(');
  end loop;
end $$;
