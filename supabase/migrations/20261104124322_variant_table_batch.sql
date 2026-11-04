-- Atomic table editing reuses the existing variant command and authorization.
create function access_private.variant_table_save(p_company uuid, p_key uuid, p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare cached access_private.operation_requests%rowtype; line jsonb; current_row public.product_variants%rowtype;
 payload jsonb; saved jsonb; results jsonb:='[]'; parent uuid; position integer:=0; field text;
begin
 if auth.uid() is null or not access_private.company_permission(p_company,'write','catalog') then
  raise exception 'Operación no autorizada para esta empresa' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_company::text,0));
 if not access_private.company_permission(p_company,'write','catalog') then raise exception 'Permiso revocado' using errcode='42501'; end if;
 if p_key is null then raise exception 'Falta identificador de operación'; end if;
 select * into cached from access_private.operation_requests where company_id=p_company and key=p_key;
 if found then
  if cached.action<>'variant_table' or cached.payload<>p_data then raise exception 'Identificador utilizado con otros datos'; end if;
  return cached.result;
 end if;
 parent:=(p_data->>'product')::uuid;
 perform 1 from public.products where company_id=p_company and id=parent and active;
 if not found then raise exception 'Producto no disponible'; end if;
 if coalesce(jsonb_typeof(p_data->'rows'),'')<>'array' then raise exception 'Indica las filas de la tabla'; end if;
 if jsonb_array_length(p_data->'rows') not between 1 and 500 then raise exception 'Guarda entre 1 y 500 filas'; end if;
 if exists(select 1 from jsonb_array_elements(p_data->'rows') x where nullif(x->>'id','') is not null group by x->>'id' having count(*)>1) then raise exception 'Hay variantes repetidas en la carga'; end if;
 -- Check all original values before any writes to prevent overwriting another editor.
 for line in select value from jsonb_array_elements(p_data->'rows') loop
  position:=position+1;
  if nullif(line->>'id','') is not null then
   select * into current_row from public.product_variants where company_id=p_company and product_id=parent and id=(line->>'id')::uuid for update;
   if not found then raise exception 'Fila %: variante no disponible',position; end if;
   if coalesce(jsonb_typeof(line->'expected'),'')<>'object' then raise exception 'Fila %: falta la referencia original',position; end if;
   foreach field in array array['name','sku','barcode','barcode_custom','weight_min','weight_max','active','published','allow_preorder'] loop
    if coalesce(to_jsonb(current_row)->>field,'') is distinct from coalesce(line->'expected'->>field,'') then
     -- Numeric JSON representations may differ only in trailing zeroes.
     if field in('weight_min','weight_max') and nullif(line->'expected'->>field,'')::numeric is not distinct from nullif(to_jsonb(current_row)->>field,'')::numeric then continue; end if;
     raise exception 'Fila %: la variante cambió. Cierra y vuelve a abrir la tabla antes de guardar',position using errcode='40001';
    end if;
   end loop;
   if current_row.attributes is distinct from line->'expected'->'attributes' then raise exception 'Fila %: los atributos cambiaron. Actualiza la tabla',position using errcode='40001'; end if;
  end if;
 end loop;
 insert into access_private.operation_requests(company_id,key,action,payload) values(p_company,p_key,'variant_table',p_data);
 position:=0;
 for line in select value from jsonb_array_elements(p_data->'rows') loop
  position:=position+1;
  begin
   payload:=(line-'expected')||jsonb_build_object('product',parent);
   if nullif(line->>'id','') is null then
    -- Existing creation defaults to active; defer weight assignment until explicit state is set.
    saved:=access_private.operations(p_company,'variant_save',gen_random_uuid(),payload||jsonb_build_object('weight_min','','weight_max',''));
    payload:=payload||jsonb_build_object('id',saved->>'id');
   end if;
   saved:=access_private.operations(p_company,'variant_save',gen_random_uuid(),payload);
   results:=results||jsonb_build_array(saved);
  exception when others then raise exception 'Fila %: %',position,sqlerrm using errcode=sqlstate;
  end;
 end loop;
 saved:=jsonb_build_object('rows',results,'count',jsonb_array_length(results));
 update access_private.operation_requests set result=saved where company_id=p_company and key=p_key;
 return saved;
end $$;
revoke all on function access_private.variant_table_save(uuid,uuid,jsonb) from public,anon;
grant execute on function access_private.variant_table_save(uuid,uuid,jsonb) to authenticated;
create function public.variant_table_save(p_company uuid,p_key uuid,p_data jsonb)
returns jsonb language sql security invoker set search_path='' as $$
 select access_private.variant_table_save(p_company,p_key,p_data);
$$;
revoke all on function public.variant_table_save(uuid,uuid,jsonb) from public,anon;
grant execute on function public.variant_table_save(uuid,uuid,jsonb) to authenticated;
