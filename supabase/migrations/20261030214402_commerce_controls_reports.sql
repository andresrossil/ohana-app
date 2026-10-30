-- Serialize profile and currency changes after checking administrative scope.
do $$declare def text;merge_source text:=$merge$p_details:=(p_details-'store')||coalesce((select jsonb_build_object('store',details->'store') from public.company_settings where company_id=p_company and details?'store'),'{}'::jsonb);$merge$;begin
 def:=pg_get_functiondef('access_private.save_company_settings(uuid,text,text,jsonb,jsonb,text)'::regprocedure);
 if strpos(def,merge_source)=0 then raise exception 'Profile source mismatch';end if;
 def:=replace(def,merge_source,'');def:=replace(def,'perform pg_advisory_xact_lock(hashtextextended(p_company::text,0));','');
 def:=replace(def,'if length(trim(p_name))','perform pg_advisory_xact_lock(hashtextextended(p_company::text,0));'||merge_source||' if length(trim(p_name))');execute def;
 def:=pg_get_functiondef('access_private.store_settings(uuid,jsonb)'::regprocedure);
 def:=replace(def,'config:=jsonb_build_object(', $guard$
 if length(data::text)>10000 or length(coalesce(data->>'discount_code',''))>80 then raise exception 'Configuración demasiado extensa';end if;
 if nullif(data->>'shipping_fee','') is not null and (data->>'shipping_fee')::numeric<>round((data->>'shipping_fee')::numeric,2) then raise exception 'El envío admite dos decimales';end if;
 if nullif(data->>'gift_threshold','') is not null and ((data->>'gift_threshold')::numeric='NaN' or (data->>'gift_threshold')::numeric>1000000000 or (data->>'gift_threshold')::numeric<>round((data->>'gift_threshold')::numeric,2)) then raise exception 'Monto de regalo inválido';end if;
 if coalesce((data->>'published')::boolean,false) and not (coalesce((data->>'pickup')::boolean,true) or(coalesce((data->>'delivery')::boolean,false) and nullif(data->>'shipping_fee','') is not null)) then raise exception 'Configura al menos una forma de entrega antes de publicar';end if;
 config:=jsonb_build_object($guard$);execute def;
end $$;

create function access_private.report_summary(c uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 if auth.uid() is null or not public.company_permission(c,'read','reports') then raise exception 'Reportes no autorizados' using errcode='42501';end if;
 return jsonb_build_object('materials',(select count(*) from public.raw_materials where company_id=c and active),'products',(select count(*) from public.products where company_id=c and active),'variants',(select count(*) from public.product_variants where company_id=c and active),'batches',(select count(*) from public.production_batches where company_id=c),'units_available',coalesce((select sum(on_hand-blocked-reserved) from public.inventory_balances where company_id=c and item_kind='variant'),0),'units_curing',coalesce((select sum(blocked) from public.inventory_balances where company_id=c and item_kind='variant'),0),'units_reserved',coalesce((select sum(reserved) from public.inventory_balances where company_id=c and item_kind='variant'),0),'orders_pending',(select count(*) from public.sales_orders where company_id=c and status='pending'),'sales',coalesce((select jsonb_agg(to_jsonb(z)) from(select currency,count(*) as orders,sum(total) as total,coalesce(sum(total) filter(where paid_at is null),0) as unpaid from public.sales_orders where company_id=c and status='dispatched' group by currency)z),'[]'),'purchases',coalesce((select jsonb_agg(to_jsonb(z)) from(select currency,count(*) as receipts,sum(amount) as total from public.purchase_receipts where company_id=c group by currency)z),'[]'),'stock_value',coalesce((select jsonb_agg(to_jsonb(z)) from(select currency,sum(remaining*unit_cost) as known_value,count(*) filter(where unit_cost is null) as unknown_lots from public.inventory_lots where company_id=c and remaining>0 group by currency)z),'[]'));
end $$;
create function public.report_summary(p_company uuid) returns jsonb language sql stable security invoker set search_path='' as $$select access_private.report_summary(p_company)$$;
revoke all on function access_private.report_summary(uuid),public.report_summary(uuid) from public,anon;grant execute on function access_private.report_summary(uuid),public.report_summary(uuid) to authenticated;
notify pgrst,'reload schema';
