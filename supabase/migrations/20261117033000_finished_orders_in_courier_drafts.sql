do $migration$
declare
  definition text;
  original text;
begin
  select pg_get_functiondef('access_private.courier_pending(uuid,uuid)'::regprocedure) into definition;
  original := definition;
  definition := replace(definition,
    $old$coalesce((select max((h->>'at')::timestamptz) from jsonb_array_elements(o.fulfillment_history) h where h->>'stage' in('courier','delivered')),d.updated_at) delivered_at,$old$,
    $new$(o.fulfillment_stage='finished' and d.status='pending') pending_handoff,
 case when o.fulfillment_stage='finished' and d.status='pending' then null else
 coalesce((select max((h->>'at')::timestamptz) from jsonb_array_elements(o.fulfillment_history) h where h->>'stage' in('courier','delivered')),d.updated_at) end delivered_at,$new$);
  definition := replace(definition, $old$(o.fulfillment_stage='invoiced' and d.status<>'cancelled')$old$,
    $new$(o.fulfillment_stage='invoiced' and d.status<>'cancelled') or (o.fulfillment_stage='finished' and d.status='pending')$new$);
  definition := replace(definition, 'where collected>0 or shipping_cost>0 or expected_cash>0',
    'where collected>0 or shipping_cost>0 or expected_cash>0 or pending_handoff or reserved_id is not null');
  if definition=original then raise exception 'No se encontró el filtro de pedidos para liquidación'; end if;
  execute definition;

  select pg_get_functiondef('access_private.settlement_engine(uuid,text,uuid,jsonb)'::regprocedure) into definition;
  original := definition;
  definition := replace(definition, 'no fue entregado a mensajería', 'no está listo para esta mensajería');
  definition := replace(definition, $old$   extra:=round(extra,2);$old$,
    $new$   if (available->>'pending_handoff')::boolean and coalesce((x->>'mark_collected')::boolean,false) then
    raise exception 'Registra la entrega a mensajería antes de marcar efectivo cobrado';
   end if;
   extra:=round(extra,2);$new$);
  definition := replace(definition, $old$if (available->>'shipping_cost')::numeric>0 then$old$,
    $new$if (available->>'shipping_cost')::numeric>0 or
      ((available->>'pending_handoff')::boolean or available->>'reserved_id'=sid::text)
      and not exists(select 1 from public.courier_settlement_items where company_id=c and settlement_id=sid and order_id=oid) then$new$);
  -- Read the candidates before replacing the draft's rows so zero-cost selections
  -- remain available after handoff when editing the same draft.
  definition := replace(definition, $old$  if sid is null then
   select coalesce(max(number),0)+1 into n from public.courier_settlements$old$,
    $new$  pending:=access_private.courier_pending(c,partner);
  if sid is null then
   select coalesce(max(number),0)+1 into n from public.courier_settlements$new$);
  definition := replace(definition, $old$  pending:=access_private.courier_pending(c,partner);
  for x$old$, $new$  for x$new$);
  definition := replace(definition, 'o.status order_status,o.payment order_payment', 'o.status order_status,o.fulfillment_stage order_stage,o.payment order_payment');
  definition := replace(definition, $old$   if r.order_payment='transfer'$old$,
    $new$   if r.order_stage='finished' and r.delivery_status='pending' then
    raise exception 'Registra la entrega a mensajería antes de liquidar el pedido';
   end if;
   if r.order_payment='transfer'$new$);
  definition := replace(definition, $old$elsif r.payer<>'ohana' or r.shipping_cost<>r.amount then$old$,
    $new$elsif (case when r.payer='ohana' then r.shipping_cost else 0 end) is distinct from r.amount then$new$);
  definition := replace(definition, $old$  update public.courier_settlement_items set active=true where company_id=c and settlement_id=sid;$old$,
    $new$  update public.courier_settlement_items i
  set active=true, snapshot=case when i.snapshot->>'pending_handoff'='true' then
    i.snapshot || jsonb_build_object('pending_handoff',false,'delivered_at',
      coalesce((select max((h->>'at')::timestamptz) from jsonb_array_elements(o.fulfillment_history) h
                where h->>'stage' in ('courier','delivered')),d.updated_at))
    else i.snapshot end
  from public.sales_orders o join public.sales_deliveries d on d.company_id=o.company_id and d.order_id=o.id
  where i.company_id=c and i.settlement_id=sid and o.company_id=c and o.id=i.order_id;$new$);
  if definition=original or strpos(definition, 'Registra la entrega a mensajería antes de liquidar el pedido')=0 then
    raise exception 'No se encontró la validación de liquidación';
  end if;
  execute definition;
end;
$migration$;
