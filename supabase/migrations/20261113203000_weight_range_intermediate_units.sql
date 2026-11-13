do $$
declare
  d text;
  updated text;
  signature text;
begin
  foreach signature in array array[
    'access_private.save_formula_intermediates(uuid,uuid,jsonb)',
    'access_private.consume_intermediates(uuid,uuid,uuid,jsonb)',
    'access_private.production_requirements(uuid,uuid,numeric,numeric)',
    'access_private.formula_catalog(uuid)'
  ] loop
    d := pg_get_functiondef(signature::regprocedure);
    updated := replace(d, 'base.id=p.unit_id', 'base.id=case when v.weight_min is not null then (select cu.id from public.units cu where cu.company_id=c and cu.symbol=''ud'' and cu.dimension=''count'' and cu.base_factor=1) else p.unit_id end');
    updated := replace(updated, 'bu.id=p.unit_id', 'bu.id=case when v.weight_min is not null then (select cu.id from public.units cu where cu.company_id=c and cu.symbol=''ud'' and cu.dimension=''count'' and cu.base_factor=1) else p.unit_id end');
    if signature like '%formula_catalog%' then
      updated := replace(updated, 'u.id=p.unit_id', 'u.id=case when v.weight_min is not null then (select cu.id from public.units cu where cu.company_id=c and cu.symbol=''ud'' and cu.dimension=''count'' and cu.base_factor=1) else p.unit_id end');
      updated := replace(updated, '''unit_id'',p.unit_id,''dimension'',u.dimension', '''unit_id'',u.id,''dimension'',u.dimension,''whole_units'',v.weight_min is not null');
    elsif signature like '%consume_intermediates%' then
      updated := replace(updated,'select i.variant_id,p.name,u.base_factor','select i.variant_id,p.name,v.weight_min is not null as whole_units,u.base_factor');
      updated := replace(updated,'and exists(
    select 1 from public.inventory_units','and (r.whole_units or exists(
    select 1 from public.inventory_units');
      updated := replace(updated,'status=''available''
  )) then','status=''available''
  ))) then');
    elsif signature like '%save_formula_intermediates%' then
      updated := replace(updated, 'and (v.weight_min is null or base.dimension=''count'')',
        'and (v.weight_min is null or ((item->>''quantity'')::numeric*u.base_factor=trunc((item->>''quantity'')::numeric*u.base_factor)))');
    end if;
    if updated = d then raise exception 'Cambió la definición de %', signature; end if;
    execute updated;
  end loop;
end $$;
