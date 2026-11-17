do $migration$
declare
  definition text := pg_get_functiondef('public.company_dashboard(uuid)'::regprocedure);
  marker constant text := '  if sales_ok then';
begin
  if strpos(definition,marker)=0 or strpos(definition,'available_products')>0 then
    raise exception 'No se encontró el punto de actualización del inicio';
  end if;
  execute replace(definition,marker,$stock$
  if inventory_ok then
    result := result || jsonb_build_object('available_products',coalesce((
      select jsonb_agg(to_jsonb(item) order by item.product,item.variant,item.id)
      from (
        select v.id,p.name product,access_private.variant_label(to_jsonb(v)) variant,
          b.on_hand-b.blocked-b.reserved available
        from public.inventory_balances b
        join public.product_variants v on v.company_id=b.company_id and v.id=b.item_id and v.active
        join public.products p on p.company_id=v.company_id and p.id=v.product_id and p.active
        where b.company_id=p_company and b.item_kind='variant' and b.on_hand>b.blocked+b.reserved
      ) item
    ),'[]'::jsonb));
  end if;

  if catalog_ok and inventory_ok then
    result := result || jsonb_build_object('reorder_materials',coalesce((
      select jsonb_agg(to_jsonb(item) order by item.name,item.sku,item.id)
      from (
        select m.id,m.sku,m.name,u.symbol unit,m.minimum_stock minimum,
          coalesce(b.on_hand-b.blocked-b.reserved,0) available
        from public.raw_materials m
        left join public.inventory_balances b on b.company_id=m.company_id and b.item_kind='material' and b.item_id=m.id
        left join public.units u on u.company_id=m.company_id and u.id=m.unit_id
        where m.company_id=p_company and m.active and m.minimum_stock>0
          and coalesce(b.on_hand-b.blocked-b.reserved,0)<m.minimum_stock
      ) item
    ),'[]'::jsonb));
  end if;

$stock$ || marker);
end;
$migration$;
