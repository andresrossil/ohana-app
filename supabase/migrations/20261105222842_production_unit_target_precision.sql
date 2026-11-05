-- Preserve partial-preparation ratios and ignore only numeric representation noise.
alter table public.production_batches alter column formula_scale type numeric(36,24);
create or replace function access_private.planned_production_units(units numeric,lots numeric) returns integer language plpgsql immutable set search_path='' as $$
declare n numeric;
begin
 if units is null or units<=0 or units>=1e12 or lots is null or lots<=0 or lots>=1e12 then raise exception 'Define las unidades estimadas de la fórmula y una cantidad válida a producir';end if;
 n:=units*lots;
 if abs(n-round(n))>greatest(0.00000001,abs(n)*0.000000000000001) or round(n)<1 or round(n)>2147483647 then raise exception 'La cantidad a producir debe dar un número entero válido de unidades';end if;
 return round(n)::integer;
end $$;
