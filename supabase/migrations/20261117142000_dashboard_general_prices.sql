do $migration$
declare
  definition text := pg_get_functiondef('public.company_dashboard(uuid)'::regprocedure);
  marker constant text := $sql$b.on_hand-b.blocked-b.reserved available
        from public.inventory_balances b$sql$;
begin
  if strpos(definition,marker)=0 then raise exception 'No se encontró el listado de productos disponibles'; end if;
  execute replace(definition,marker,$sql$b.on_hand-b.blocked-b.reserved available,
          (select e.price
           from public.price_lists pl
           join public.price_list_entries e on e.company_id=pl.company_id and e.list_id=pl.id
           where catalog_ok and pl.company_id=p_company and pl.active and lower(btrim(pl.name))='general'
             and e.active and e.variant_id=v.id and e.currency=company_currency) general_price
        from public.inventory_balances b$sql$);
end;
$migration$;
