do $migration$
declare
  definition text := pg_get_functiondef('access_private.fund_line_cost(uuid,uuid,text)'::regprocedure);
  batch_query text := $old$left join public.production_batches b on b.company_id=c and b.id=u.batch_id
  where u.company_id=c and u.order_line_id=line_id and u.status='sold'
   and (coalesce(b.recipe_snapshot->'component_costs'->ol.variant_id::text->>'pending','true')<>'false'
    or b.currency is distinct from ccy)$old$;
  formula_query text := $old$from public.formulas f join access_private.formula_intermediates i on i.company_id=c and i.formula_id=f.id
    where f.company_id=c and f.product_id=pid and f.state='current'$old$;
begin
  if strpos(definition,batch_query)=0 or strpos(definition,formula_query)=0 then
    raise exception 'Cambió la consulta de costos de fondos';
  end if;
  definition := replace(definition,batch_query,
    replace(replace(batch_query,'production_batches b on','production_batches sold_batch on'),'b.','sold_batch.'));
  definition := replace(definition,formula_query,
    replace(replace(formula_query,'formulas f join','formulas current_formula join'),'f.','current_formula.'));
  execute definition;
end
$migration$;
