do $migration$
declare
  definition text := pg_get_functiondef('access_private.sales_fulfillment(uuid,text,uuid,jsonb)'::regprocedure);
  fields text := '''available'',coalesce(b.on_hand-b.blocked-b.reserved,0)';
  relation text := 'where m.company_id=c and m.active and m.classification in';
begin
  if strpos(definition,fields)=0 or strpos(definition,relation)=0 then
    raise exception 'La consulta de empaque del pedido cambió';
  end if;
  execute replace(replace(definition,fields,fields||',''unit_cost'',quote.unit_cost,''cost_currency'',quote.currency'),
    relation,'left join lateral access_private.material_purchase_quote(c,m.id) quote on true '||relation);
end $migration$;
