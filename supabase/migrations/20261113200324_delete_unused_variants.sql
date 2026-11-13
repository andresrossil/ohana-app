do $migration$
declare
  definition text := pg_get_functiondef('access_private.operations(uuid,text,uuid,jsonb)'::regprocedure);
  marker text := ' elsif p_action=''presentation_codes'' then';
begin
  if strpos(definition,marker)=0 or strpos(definition,'''variants'',''variant_save'',''presentation_codes''')=0 then
    raise exception 'La operación de variantes cambió';
  end if;
  definition:=replace(definition,'''variants'',''variant_save'',''presentation_codes''',
    '''variants'',''variant_save'',''variant_delete'',''presentation_codes''');
  execute replace(definition,marker,$sql$
 elsif p_action='variant_delete' then
  parent:=(p_data->>'product')::uuid;
  v_id:=(p_data->>'id')::uuid;
  perform 1 from public.product_variants pv where pv.company_id=p_company and pv.product_id=parent and pv.id=v_id for update;
  if not found then raise exception 'Variante no disponible';end if;
  if exists(select 1 from public.inventory_balances ib where ib.company_id=p_company and ib.item_kind='variant' and ib.item_id=v_id and (ib.on_hand<>0 or ib.blocked<>0 or ib.reserved<>0))
    or exists(select 1 from public.inventory_movements im where im.company_id=p_company and im.item_kind='variant' and im.item_id=v_id)
    or exists(select 1 from public.inventory_lots il where il.company_id=p_company and il.item_kind='variant' and il.item_id=v_id)
  then raise exception 'Esta variante tiene existencias o movimientos. Puedes archivarla desde Editar';end if;
  begin
   delete from public.product_variants pv where pv.company_id=p_company and pv.product_id=parent and pv.id=v_id;
  exception when foreign_key_violation then
   raise exception 'Esta variante está vinculada a fórmulas, precios, producción o ventas. Puedes archivarla desde Editar';
  end;
  delete from public.inventory_balances ib where ib.company_id=p_company and ib.item_kind='variant' and ib.item_id=v_id;
  v_result:=jsonb_build_object('id',v_id);
$sql$||marker);
end $migration$;
