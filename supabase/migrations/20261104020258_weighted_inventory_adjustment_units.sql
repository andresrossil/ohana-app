alter table public.inventory_units alter column batch_id drop not null,alter column output_id drop not null;
alter table public.inventory_units add constraint physical_unit_origin_pair check((batch_id is null)=(output_id is null));
create or replace function access_private.physical_unit_guard() returns trigger language plpgsql set search_path='' as $$begin
 if tg_op='UPDATE' then
  if (new.id,new.company_id,new.lot_id,new.batch_id,new.output_id,new.variant_id,new.weight,new.variant_snapshot,new.created_at) is distinct from (old.id,old.company_id,old.lot_id,old.batch_id,old.output_id,old.variant_id,old.weight,old.variant_snapshot,old.created_at) then raise exception 'La identidad, peso y variante histórica de una unidad no cambian';end if;
  if old.status in('sold','retired') then raise exception 'La unidad ya salió del inventario';end if;
  if new.last_movement_id=old.last_movement_id then raise exception 'Cada cambio de estado requiere un movimiento';end if;
 end if;
 if not exists(select 1 from public.inventory_movements m where m.company_id=new.company_id and m.id=new.last_movement_id and m.item_kind='variant' and m.item_id=new.variant_id) then raise exception 'Movimiento no válido para esta unidad';end if;
 if new.batch_id is null then
  if not exists(select 1 from public.inventory_lots l where l.company_id=new.company_id and l.id=new.lot_id and l.item_kind='variant' and l.item_id=new.variant_id and l.source_kind='adjustment') then raise exception 'La unidad no corresponde al lote de ajuste';end if;
  if tg_op='INSERT' and new.status<>'available' then raise exception 'Una entrada por ajuste debe estar disponible';end if;
 else
  if not exists(select 1 from public.inventory_lots l join public.batch_outputs o on o.company_id=l.company_id and o.id=new.output_id where l.company_id=new.company_id and l.id=new.lot_id and l.item_kind='variant' and l.item_id=new.variant_id and o.variant_id=new.variant_id and o.batch_id=new.batch_id and l.source_kind='production_output' and l.source_id=o.id) then raise exception 'La unidad no corresponde al lote y variante';end if;
  if tg_op='INSERT' and new.status<>'curing' then raise exception 'La producción inicia en curación';end if;
 end if;return new;end $$;
do $patch$declare d text;needle text;begin
 d:=pg_get_functiondef('access_private.match_weight_variant(uuid,uuid,jsonb,numeric)'::regprocedure);
 d:=replace(d,$s$or public.company_permission(c,'read','catalog')$s$,$s$or public.company_permission(c,'read','catalog') or public.company_permission(c,'read','inventory') or public.company_permission(c,'write','inventory')$s$);execute d;
 d:=pg_get_functiondef('access_private.operations(uuid,text,uuid,jsonb)'::regprocedure);
 d:=replace(d,$s$'name',p.name||' · '||pv.name,'sku',pv.sku)$s$,$s$'name',p.name||' · '||pv.name,'sku',pv.sku,'product_id',pv.product_id,'attributes',pv.attributes,'weight_min',pv.weight_min,'weight_max',pv.weight_max)$s$);
 needle:=$s$v_result:=access_private.post_stock(p_company,v_kind,v_id,q,0,0,'adjustment',p_key,nullif(p_data->>'unit_cost','')::numeric,p_data->>'reason');$s$;
 if strpos(d,needle)=0 then raise exception 'Ajuste no reconocido';end if;
 d:=replace(d,needle,$new$
  if v_kind='variant' and q>0 and exists(select 1 from public.product_variants pv where pv.company_id=p_company and pv.id=v_id and pv.weight_min is not null) then
   select * into strict v from public.product_variants where company_id=p_company and id=v_id;
   if coalesce(jsonb_typeof(p_data->'unit_weights'),'')<>'array' or jsonb_array_length(p_data->'unit_weights')<>q or q>10000 then raise exception 'Registra un peso real por cada unidad que se agrega';end if;
   for x in select resolved.variant_id,jsonb_agg(resolved.w) weights,count(*) qty from(
    select e.value w,access_private.match_weight_variant(p_company,v.product_id,v.attributes,(e.value#>>'{}')::numeric) variant_id from jsonb_array_elements(p_data->'unit_weights')e
   )resolved group by resolved.variant_id loop
    v_result:=access_private.post_stock(p_company,'variant',x.variant_id,x.qty,0,0,'adjustment',case when x.variant_id=v_id then p_key else gen_random_uuid() end,nullif(p_data->>'unit_cost','')::numeric,p_data->>'reason');
    insert into public.inventory_units(company_id,lot_id,variant_id,weight,variant_snapshot,status,last_movement_id)
    select p_company,(v_result->>'lot')::uuid,pv.id,(w.value#>>'{}')::numeric,
     jsonb_build_object('name',pv.name,'sku',pv.sku,'attributes',pv.attributes,'weight_min',pv.weight_min,'weight_max',pv.weight_max,'product_name',pr.name,'product_sku',pr.sku,'origin','adjustment'),
     'available',(v_result->>'movement')::uuid
    from jsonb_array_elements(x.weights)w join public.product_variants pv on pv.company_id=p_company and pv.id=x.variant_id join public.products pr on pr.company_id=pv.company_id and pr.id=pv.product_id;
   end loop;v_result:=jsonb_build_object('units',q);
  else
   v_result:=access_private.post_stock(p_company,v_kind,v_id,q,0,0,'adjustment',p_key,nullif(p_data->>'unit_cost','')::numeric,p_data->>'reason');
  end if;
 $new$);execute d;
end $patch$;
notify pgrst,'reload schema';
