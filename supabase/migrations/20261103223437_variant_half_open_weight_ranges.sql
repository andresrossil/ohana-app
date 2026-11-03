-- Only constraints and validation change; existing weights, codes and history stay intact.
lock table public.product_variants in access exclusive mode;
do $$begin
 if exists(select 1 from public.product_variants where weight_min is not null and (weight_min<=0 or weight_max<=weight_min or weight_min='NaN'::numeric or weight_max='NaN'::numeric)) then
  raise exception 'Hay rangos existentes inválidos. Revísalos antes de cambiar la validación; no se modificaron datos';
 end if;
 if exists(select 1 from public.product_variants a join public.product_variants b on b.company_id=a.company_id and b.product_id=a.product_id and b.id>a.id
  and access_private.normalize_attributes(b.attributes)=access_private.normalize_attributes(a.attributes)
  where a.active and b.active and a.weight_min is not null and b.weight_min is not null and numrange(a.weight_min,a.weight_max,'[)') && numrange(b.weight_min,b.weight_max,'[)')) then
  raise exception 'Hay rangos activos superpuestos. Revísalos antes de continuar; no se modificaron datos';
 end if;
end $$;
alter table public.product_variants drop constraint product_variants_check1;
alter table public.product_variants add constraint product_variant_weight_bounds check(
 (weight_min is null and weight_max is null) or
 (weight_min>0 and weight_max>weight_min and weight_min<>'NaN'::numeric and weight_max<>'NaN'::numeric));
alter table public.product_variants drop constraint product_variants_company_id_product_id_attributes_numrange_excl;
alter table public.product_variants add constraint product_variant_weight_no_overlap exclude using gist(
 company_id extensions.gist_uuid_ops with =,product_id extensions.gist_uuid_ops with =,
 (access_private.normalize_attributes(attributes)::text) extensions.gist_text_ops with =,
 numrange(weight_min,weight_max,'[)') with &&)
 where(active and weight_min is not null and weight_max is not null);

create function access_private.match_weight_variant(c uuid,pid uuid,a jsonb,w numeric) returns uuid
 language plpgsql stable security invoker set search_path='' as $$
declare matches uuid[];begin
 if auth.uid() is null or not(public.company_permission(c,'read','production') or public.company_permission(c,'write','production') or public.company_permission(c,'read','catalog')) then raise exception 'No tienes acceso a las variantes de esta empresa' using errcode='42501';end if;
 if w is null or not(w>0 and w<1e12) or w<>round(w,4) then raise exception 'Indica un peso válido en gramos, con hasta cuatro decimales';end if;
 select array_agg(pv.id) into matches from public.product_variants pv where pv.company_id=c and pv.product_id=pid and pv.active
 and access_private.normalize_attributes(pv.attributes)=access_private.normalize_attributes(a)
 and pv.weight_min<=w and w<pv.weight_max;
 if coalesce(cardinality(matches),0)=0 then raise exception 'Sin rango válido para % g y los atributos seleccionados. No se asignó una variante',w;end if;
 if cardinality(matches)>1 then raise exception 'Hay ambigüedad entre variantes para % g. Revisa sus rangos; no se asignó una variante',w;end if;
 return matches[1];
end $$;
revoke all on function access_private.match_weight_variant(uuid,uuid,jsonb,numeric) from public,anon,authenticated;

-- Revalidate every individually weighed unit at confirmation, under the existing company lock.
-- Individual weights remain part of finish_payload; existing confirmed batches are untouched.
do $patch$declare def text;needle text;begin
 def:=pg_get_functiondef('access_private.operations(uuid,text,uuid,jsonb)'::regprocedure);
 def:=replace(def,'price_currency text;','price_currency text; weighed_item jsonb; weighed_sum numeric; weighed_value numeric;');
 needle:=$s$q:=(r->>'quantity')::integer;
   converted:=coalesce(nullif(r->>'weight','')::numeric,(v.weight_min+v.weight_max)/2*q);$s$;
 if strpos(def,needle)=0 then raise exception 'No se encontró la validación de salidas esperada';end if;
 def:=replace(def,needle,$new$q:=(r->>'quantity')::integer;
   if r ? 'unit_weights' then
    if jsonb_typeof(r->'unit_weights')<>'array' or jsonb_array_length(r->'unit_weights')<>q or q not between 1 and 10000 then raise exception 'Revisa la cantidad y los pesos individuales de la variante';end if;
    weighed_sum:=0;
    for weighed_item in select value from jsonb_array_elements(r->'unit_weights') loop
     weighed_value:=(weighed_item#>>'{}')::numeric;
     if access_private.match_weight_variant(p_company,b.product_id,v.attributes,weighed_value)<>v.id then raise exception 'El peso % g corresponde a otra variante. Revisa los rangos y vuelve a registrar la unidad',weighed_value;end if;
     weighed_sum:=weighed_sum+weighed_value;
    end loop;
    if nullif(r->>'weight','')::numeric is distinct from weighed_sum then raise exception 'El peso total no coincide con los pesos individuales';end if;
   elsif q=1 and nullif(r->>'weight','') is not null then
    if access_private.match_weight_variant(p_company,b.product_id,v.attributes,(r->>'weight')::numeric)<>v.id then raise exception 'Ese peso corresponde a otra variante. Usa Registrar por peso unitario';end if;
   end if;
   converted:=coalesce(nullif(r->>'weight','')::numeric,(v.weight_min+v.weight_max)/2*q);$new$);
 execute def;
end $patch$;
notify pgrst,'reload schema';
