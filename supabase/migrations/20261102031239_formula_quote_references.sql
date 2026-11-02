-- Read-only quote metadata: use dated effective quotes first; undated imports
-- are an explicitly labelled fallback, never assigned an invented effective date.
do $patch$declare def text;begin
 def:=pg_get_functiondef('access_private.formula_catalog(uuid)'::regprocedure);
 if strpos(def,'and h.effective_on<=current_date')=0 then raise exception 'Catálogo de fórmulas no reconocido';end if;
 def:=replace(def,'select id,name,unit_id,active from public.products','select id,name,sku,unit_id,active from public.products');
 def:=replace(def,'quote.unit_cost,quote.effective_on,ccy currency','quote.unit_cost,quote.effective_on,quote.presentation_price,quote.presentation_name,quote.presentation_quantity,quote.presentation_unit,quote.price_id,quote.price_basis,ccy currency');
 def:=replace(def,'unit_cost,h.effective_on from public.price_history h', 'unit_cost,h.effective_on,h.id price_id,h.amount presentation_price,pp.name presentation_name,pp.quantity presentation_quantity,qu.symbol presentation_unit,case when h.effective_on is null then ''undated'' else ''dated'' end price_basis from public.price_history h');
 def:=replace(def,'and h.effective_on<=current_date','and (h.effective_on<=current_date or h.effective_on is null)');
 def:=replace(def,'order by h.effective_on desc,h.created_at desc,h.id desc','order by (h.effective_on is not null) desc,h.effective_on desc nulls last,h.created_at desc,h.id desc');
 if strpos(def,'presentation_price')=0 or strpos(def,'price_basis')=0 then raise exception 'No se integró la referencia de precios';end if;
 execute def;
end $patch$;
notify pgrst,'reload schema';
