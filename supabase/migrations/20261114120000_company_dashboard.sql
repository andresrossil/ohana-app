create function public.catalog_material_costs(p_company uuid)
returns table(id uuid, unit_cost numeric, currency text)
language sql stable security definer set search_path='' as $$
  select m.id, q.unit_cost, q.currency
  from public.raw_materials m
  cross join lateral access_private.material_purchase_quote(p_company,m.id) q
  where m.company_id=p_company
    and auth.uid() is not null
    and public.company_permission(p_company,'read','catalog')
$$;

create function public.company_dashboard(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  catalog_ok boolean := public.company_permission(p_company,'read','catalog');
  inventory_ok boolean := public.company_permission(p_company,'read','inventory');
  sales_ok boolean := public.company_permission(p_company,'read','sales');
  month_start timestamp := date_trunc('month',now() at time zone 'America/Guatemala');
  company_currency text;
  result jsonb := '{}';
begin
  if auth.uid() is null or not (catalog_ok or inventory_ok or sales_ok) then
    return result;
  end if;
  select currency into company_currency from public.companies where id=p_company;

  if catalog_ok then
    result := result || jsonb_build_object('suppliers', (
      select count(*) from public.business_partners where company_id=p_company and active and is_supplier
    ));
  end if;

  if catalog_ok and inventory_ok then
    result := result || (
      select jsonb_build_object(
        'material_value',coalesce(sum(b.on_hand*q.unit_cost),0),
        'material_missing',count(*) filter (where b.on_hand<>0 and q.unit_cost is null),
        'reorder',count(distinct m.sku) filter (
          where m.active and m.minimum_stock>0 and coalesce(b.on_hand-b.blocked-b.reserved,0)<m.minimum_stock
        ))
      from public.raw_materials m
      left join public.inventory_balances b on b.company_id=m.company_id and b.item_kind='material' and b.item_id=m.id
      left join public.catalog_material_costs(p_company) q on q.id=m.id
      where m.company_id=p_company
    ) || (
      with general_list as (
        select id,name from public.price_lists where company_id=p_company and active and lower(btrim(name))='general'
      )
      select jsonb_build_object(
        'product_value',coalesce(sum(b.on_hand*e.price),0),
        'product_missing',count(*) filter (where e.price is null),
        'price_list', (select name from general_list))
      from (
        select * from public.inventory_balances
        where company_id=p_company and item_kind='variant' and on_hand<>0
      ) b
      left join public.price_list_entries e on e.company_id=b.company_id and e.variant_id=b.item_id
        and e.active and e.currency=company_currency and e.list_id=(select id from general_list)
    );
  end if;

  if sales_ok then
    result := result || (
      select jsonb_build_object(
        'drafts', count(*) filter (where fulfillment_stage='draft'),
        'invoices', count(*) filter (where current_month and fulfillment_stage<>'draft'),
        'active_customers', count(distinct customer_id) filter (where current_month and fulfillment_stage<>'draft'),
        'sales_current', coalesce(sum(total) filter (where current_month and fulfillment_stage<>'draft'),0),
        'sales_previous', coalesce(sum(total) filter (where not current_month and fulfillment_stage<>'draft'),0),
        'drop_size', avg(total) filter (where current_month and fulfillment_stage<>'draft'))
      from (
        select o.*, o.created_at >= month_start at time zone 'America/Guatemala' as current_month
        from public.sales_orders o where o.company_id=p_company and o.currency=company_currency
          and o.status not in ('cancelled','expired')
          and (o.fulfillment_stage='draft' or (
            o.created_at >= (month_start-interval '1 month') at time zone 'America/Guatemala'
            and o.created_at < (month_start+interval '1 month') at time zone 'America/Guatemala'
          ))
      ) sales
    ) || jsonb_build_object('customers',(
      select count(*) from public.business_partners where company_id=p_company and active and is_customer
    ));
  end if;
  return result;
end $$;

revoke all on function public.catalog_material_costs(uuid), public.company_dashboard(uuid) from public, anon, authenticated;
grant execute on function public.catalog_material_costs(uuid), public.company_dashboard(uuid) to authenticated;
