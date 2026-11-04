-- Preserve commercial references and production mode in future snapshots only.
do $$declare d text;begin
 d:=pg_get_functiondef('access_private.batch_recipe_snapshot(uuid,uuid,uuid,uuid,numeric,jsonb,text,numeric)'::regprocedure);
 d:=replace(d,'''version'',f.version,''edit_revision''','''version'',f.version,''production_mode'',f.production_mode,''edit_revision''');
 execute d;
 d:=pg_get_functiondef('access_private.variable_cost_plan(uuid,uuid,jsonb)'::regprocedure);
 d:=replace(d,'allocation_sum numeric;','allocation_sum numeric;variant_name text;variant_sku text;');
 d:=replace(d,'quote:=access_private.additional_cost_quote(c,1,','select access_private.variant_label(to_jsonb(pv)),pv.sku into variant_name,variant_sku from public.product_variants pv where pv.company_id=c and pv.id=(o->>''variant'')::uuid;quote:=access_private.additional_cost_quote(c,1,');
 d:=replace(d,'''variant_id'',o->>''variant'',''position''','''variant_id'',o->>''variant'',''variant_name'',variant_name,''variant_sku'',variant_sku,''position''');
 execute d;
end $$;
create or replace function access_private.price_entry_used(c uuid,e uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.order_lines where company_id=c and price_reference->>'entry_id'=e::text)
 or exists(select 1 from public.production_batches b where b.company_id=c and b.confirmed and
  (b.recipe_snapshot#>>'{additional_costs,price_reference,entry_id}'=e::text or exists(select 1 from jsonb_array_elements(coalesce(b.recipe_snapshot#>'{weight_costs,units}','[]'))u where u#>>'{price_reference,entry_id}'=e::text)));
$$;
create or replace function access_private.price_list_used(c uuid,l uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.order_lines where company_id=c and price_reference->>'list_id'=l::text)
 or exists(select 1 from public.production_batches b where b.company_id=c and b.confirmed and
  (b.recipe_snapshot#>>'{additional_costs,price_reference,list_id}'=l::text or exists(select 1 from jsonb_array_elements(coalesce(b.recipe_snapshot#>'{weight_costs,units}','[]'))u where u#>>'{price_reference,list_id}'=l::text)));
$$;
