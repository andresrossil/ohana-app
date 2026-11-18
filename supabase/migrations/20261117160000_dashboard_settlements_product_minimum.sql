alter table public.products add column minimum_stock numeric(20,8) not null default 0
  check (minimum_stock>=0 and minimum_stock<'Infinity'::numeric);

do $migration$
declare definition text := pg_get_functiondef('public.company_dashboard(uuid)'::regprocedure);
marker constant text := '  if sales_ok then';
begin
 if strpos(definition,marker)=0 then raise exception 'No se encontró el dashboard';end if;
 execute replace(definition,marker,$extra$
 if catalog_ok and inventory_ok then
  result:=result||jsonb_build_object('suggested_production',coalesce((
   select jsonb_agg(to_jsonb(item) order by item.name,item.id) from (
    select p.id,p.name,p.minimum_stock minimum,coalesce(sum(b.on_hand-b.blocked-b.reserved),0) available,
      p.minimum_stock-coalesce(sum(b.on_hand-b.blocked-b.reserved),0) suggested
    from public.products p
    left join public.product_variants v on v.company_id=p.company_id and v.product_id=p.id and v.active
    left join public.inventory_balances b on b.company_id=v.company_id and b.item_kind='variant' and b.item_id=v.id
    where p.company_id=p_company and p.active and p.minimum_stock>0
    group by p.id
    having coalesce(sum(b.on_hand-b.blocked-b.reserved),0)<p.minimum_stock
   ) item
  ),'[]'::jsonb));
 end if;
 if sales_ok then
  result:=result||jsonb_build_object('pending_settlements',coalesce((
   select jsonb_agg(to_jsonb(item) order by item.date,item.number) from (
    select s.id,s.number,s.settled_on date,b.name courier,s.state,
      case when s.state='draft' then s.net else access_private.settlement_remaining(p_company,s.id) end remaining
    from public.courier_settlements s
    join public.business_partners b on b.company_id=s.company_id and b.id=s.courier_id
    where s.company_id=p_company and s.state in ('draft','pending','partial')
   ) item
  ),'[]'::jsonb));
 end if;
$extra$||marker);
end;
$migration$;
