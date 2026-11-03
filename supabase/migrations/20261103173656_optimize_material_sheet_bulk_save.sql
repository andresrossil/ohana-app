-- Resolve only the current price ID; never calculate cross-presentation comparisons
-- for every row being saved. Keep the sheet's dated/undated ordering exactly.
create function catalog_private.sheet_current_price(c uuid,p uuid) returns uuid language sql stable security invoker set search_path='' as $$
 select h.id from public.price_history h
 where h.company_id=c and h.presentation_id=p and
 (h.effective_on<=current_date or (h.effective_on is null and not exists(
  select 1 from public.price_history dated where dated.company_id=h.company_id and dated.presentation_id=h.presentation_id and dated.effective_on<=current_date and (dated.created_at,dated.id)>(h.created_at,h.id))))
 order by coalesce(h.effective_on,h.created_at::date) desc,h.created_at desc,h.id desc limit 1
$$;
revoke all on function catalog_private.sheet_current_price(uuid,uuid) from public,anon;
grant execute on function catalog_private.sheet_current_price(uuid,uuid) to authenticated;
do $patch$declare def text;begin
 def:=pg_get_functiondef('catalog_private.save_material_sheet(uuid,uuid,jsonb)'::regprocedure);
 def:=replace(def,'(select price_id::text from public.material_sheet where company_id=p_company and id=pid)','catalog_private.sheet_current_price(p_company,pid)::text');
 def:=replace(def,'(select price_id from public.material_sheet where company_id=p_company and id=pid)','catalog_private.sheet_current_price(p_company,pid)');
 if strpos(def,'from public.material_sheet')>0 then raise exception 'La consulta de precio vigente no se pudo sustituir';end if;
 -- Do not fire identifier sync and SKU triggers for unchanged material metadata.
 def:=replace(def,$s$where company_id=p_company and id=mid;
   if pid is null then$s$,$s$where company_id=p_company and id=mid and (name,alternative_name) is distinct from (trim(r->>'material'),coalesce(r->>'alternative',''));
   if pid is null then$s$);
 execute def;
 def:=pg_get_functiondef('public.save_material_sheet(uuid,uuid,jsonb)'::regprocedure);
 def:=replace(def,$s$barcode_custom=(desired->>'barcode_custom')::boolean where company_id=p_company and id=mid;$s$,$s$barcode_custom=(desired->>'barcode_custom')::boolean where company_id=p_company and id=mid and (sku,classification,origin_id,barcode,barcode_custom) is distinct from (desired->>'sku',desired->>'classification',o,desired->>'barcode',(desired->>'barcode_custom')::boolean);$s$);
 execute def;
end $patch$;
notify pgrst,'reload schema';
