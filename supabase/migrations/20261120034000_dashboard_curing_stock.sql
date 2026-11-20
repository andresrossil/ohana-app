do $migration$
declare
  definition text := pg_get_functiondef('public.company_dashboard(uuid)'::regprocedure);
  first_marker constant text := '  if inventory_ok then' || chr(10)
    || '    result := result || jsonb_build_object(''available_products''';
  next_marker constant text := '  if catalog_ok and inventory_ok then' || chr(10)
    || '    result := result || jsonb_build_object(''reorder_materials''';
  first_pos int := strpos(definition,first_marker);
  next_pos int := strpos(definition,next_marker);
begin
  if first_pos=0 or next_pos<=first_pos then
    raise exception 'No se encontró el listado de productos del inicio';
  end if;

  execute left(definition,first_pos-1) || $stock$
  if inventory_ok then
    result := result || jsonb_build_object('available_products',coalesce((
      with curing_batches as (
        select pb.id,pb.product_id,pb.preliminary_outputs,
          coalesce(pb.actual_quantity,pb.preliminary_quantity,pb.planned_quantity,
            case when f.estimated_units>0 and pb.formula_scale>0 then round(f.estimated_units*pb.formula_scale,8) end) quantity,
          pb.actual_quantity is null and (pb.yield_timing is distinct from 'before' or pb.preliminary_quantity is null) estimated
        from public.production_batches pb
        left join public.formulas f on f.company_id=pb.company_id and f.id=pb.formula_id
        where pb.company_id=p_company and pb.state='curing'
          and public.company_permission(p_company,'read','production')
      ), assigned as (
        select cb.id,cb.product_id,o.variant_id,o.quantity
        from curing_batches cb
        join public.batch_outputs o on o.company_id=p_company and o.batch_id=cb.id and o.quantity>0
        union all
        select cb.id,cb.product_id,(line->>'variant')::uuid,(line->>'quantity')::int
        from curing_batches cb
        cross join lateral jsonb_array_elements(cb.preliminary_outputs) line
        where not exists (
          select 1 from public.batch_outputs o where o.company_id=p_company and o.batch_id=cb.id and o.quantity>0
        )
      ), by_variant as (
        select variant_id,sum(quantity) curing
        from assigned group by variant_id
      ), unassigned as (
        select cb.product_id,
          sum(greatest(cb.quantity-coalesce(a.quantity,0),0)) filter (where cb.quantity is not null) curing,
          coalesce(sum(greatest(cb.quantity-coalesce(a.quantity,0),0)) filter (where cb.estimated),0) estimated,
          count(*) filter (where cb.quantity is null and a.quantity is null) unknown_lots
        from curing_batches cb
        left join (select id,sum(quantity) quantity from assigned group by id) a on a.id=cb.id
        group by cb.product_id
      ), items as (
        select v.id::text,p.name product,access_private.variant_label(to_jsonb(v)) variant,
          coalesce(b.on_hand-b.blocked-b.reserved,0) available,
          coalesce(c.curing,0) curing,0 estimated,0 unknown_lots,
          (select e.price from public.price_lists pl
           join public.price_list_entries e on e.company_id=pl.company_id and e.list_id=pl.id
           where catalog_ok and pl.company_id=p_company and pl.active and lower(btrim(pl.name))='general'
             and e.active and e.variant_id=v.id and e.currency=company_currency) general_price
        from public.product_variants v
        join public.products p on p.company_id=v.company_id and p.id=v.product_id
        left join public.inventory_balances b on b.company_id=v.company_id and b.item_id=v.id and b.item_kind='variant'
        left join by_variant c on c.variant_id=v.id
        where v.company_id=p_company
          and ((v.active and p.active and b.on_hand>b.blocked+b.reserved) or c.curing>0)
        union all
        select 'unassigned-'||p.id,p.name,'Variante por definir',0,
          nullif(u.curing,0),u.estimated,u.unknown_lots,null
        from unassigned u
        join public.products p on p.company_id=p_company and p.id=u.product_id
        where u.curing>0 or u.unknown_lots>0
      )
      select jsonb_agg(to_jsonb(item) order by item.product,item.variant,item.id) from items item
    ),'[]'::jsonb));
  end if;

$stock$ || substr(definition,next_pos);
end;
$migration$;
