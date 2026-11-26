-- Preparation gifts use the existing zero-price sale lines, cost allocations,
-- physical unit dispatch and cancellation paths.
do $migration$
declare
  definition text := pg_get_functiondef('access_private.sales_fulfillment(uuid,text,uuid,jsonb)'::regprocedure);
  dispatch_marker text := $marker$ elsif action='finish' and so.status='pending' and so.fulfillment_stage='preparing' then$marker$;
  detail_marker text := $marker$'packaging_options',case when$marker$;
  reopen_marker text := $marker$   insert into public.order_lines select (jsonb_populate_record(null::public.order_lines,to_jsonb(line)||jsonb_build_object('id',gen_random_uuid(),'reserved_quantity',0))).*;$marker$;
begin
  if strpos(definition,dispatch_marker)=0 or strpos(definition,detail_marker)=0 or strpos(definition,reopen_marker)=0 then
    raise exception 'La definición instalada de preparación no coincide';
  end if;
  definition := replace(definition,detail_marker,$sql$
    'gift_options',case when so.fulfillment_stage='preparing' then (
      select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'name',p.name||' · '||access_private.variant_label(to_jsonb(v)),
        'sku',v.sku,'barcode',v.barcode,'available',floor(b.on_hand-b.blocked-b.reserved)) order by p.name,v.name,v.id),'[]'::jsonb)
      from public.product_variants v
      join public.products p on p.company_id=v.company_id and p.id=v.product_id
      join public.inventory_balances b on b.company_id=v.company_id and b.item_kind='variant' and b.item_id=v.id
      where v.company_id=c and v.active and p.active and b.on_hand-b.blocked-b.reserved>=1
    ) else '[]'::jsonb end,'packaging_options',case when$sql$);
  definition := replace(definition,reopen_marker,$sql$
   if (line.price_reference->>'preparation_gift') is distinct from 'true' then
$sql$ || reopen_marker || $sql$
   end if;$sql$);
  definition := replace(definition,dispatch_marker,dispatch_marker || $sql$
  declare
    gifts jsonb := coalesce(data->'gifts','[]'::jsonb);
    gift record;
  begin
    if jsonb_typeof(gifts)<>'array' then raise exception 'Regalos inválidos'; end if;
    if jsonb_array_length(gifts)>30 then raise exception 'Máximo 30 variantes de regalo por pedido'; end if;
    if exists(select 1 from jsonb_array_elements(gifts) e group by (e->>'variant')::uuid having count(*)>1) then
      raise exception 'Cada variante de regalo debe aparecer una sola vez';
    end if;
    for gift in
      select v.*,p.name as product_name,(e->>'quantity')::numeric as gift_quantity
      from jsonb_array_elements(gifts) e
      left join public.product_variants v on v.company_id=c and v.id=(e->>'variant')::uuid and v.active
      left join public.products p on p.company_id=c and p.id=v.product_id and p.active
      order by v.id
    loop
      if gift.product_name is null or not coalesce(gift.gift_quantity between 1 and 1000
        and gift.gift_quantity=trunc(gift.gift_quantity),false) then
        raise exception 'Selecciona una variante activa y una cantidad entera positiva';
      end if;
      insert into public.order_lines(company_id,order_id,variant_id,description,attributes,weight_min,
        weight_max,quantity,unit_price,reserved_quantity,price_reference,is_gift,line_discount)
      values(c,so.id,gift.id,gift.product_name||' · '||gift.name,gift.attributes,gift.weight_min,
        gift.weight_max,gift.gift_quantity,0,0,'{"preparation_gift":true}'::jsonb,true,0);
    end loop;
  end;
$sql$);
  execute definition;
end $migration$;
