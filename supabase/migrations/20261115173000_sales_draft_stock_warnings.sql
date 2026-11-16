do $migration$
declare
  definition text := pg_get_functiondef('access_private.sales_fulfillment(uuid,text,uuid,jsonb)'::regprocedure);
  draft_loop text := '  for line in select * from public.order_lines where company_id=c and order_id=so.id and quantity>0 order by variant_id,id loop';
  draft_start integer := strpos(definition, 'if so.fulfillment_stage=''draft'' then');
  loop_start integer;
begin
  if draft_start=0 then raise exception 'No se encontró la confirmación del borrador'; end if;
  loop_start := strpos(substr(definition,draft_start),draft_loop);
  if loop_start=0 then raise exception 'No se encontró la reserva del borrador'; end if;
  execute overlay(definition placing $check$
  declare
    shortages text;
  begin
    select string_agg(
      format('• %s: pedidas %s, disponibles %s (%s)', l.description, l.quantity,
        greatest(0,coalesce(b.on_hand-b.blocked-b.reserved,0)),
        case when b.item_id is null then 'sin inventario registrado' else 'existencias insuficientes' end),
      E'\n' order by l.description,l.id
    ) into shortages
    from public.order_lines l
    left join public.inventory_balances b on b.company_id=l.company_id and b.item_kind='variant' and b.item_id=l.variant_id
    where l.company_id=c and l.order_id=so.id and l.quantity>0
      and l.quantity>coalesce(b.on_hand-b.blocked-b.reserved,0);
    if shortages is not null then
      raise exception 'El pedido sigue en borrador. Revisa estas existencias:%', E'\n'||shortages;
    end if;
  end;
$check$ from draft_start+loop_start-1 for 0);
end
$migration$;
