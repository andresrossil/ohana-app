do $patch$
declare d text;start_at integer;end_at integer;old_block text;begin
 d:=pg_get_functiondef('access_private.save_order_delivery(uuid,uuid,jsonb)'::regprocedure);
 start_at:=strpos(d,' if kind=''courier'' and nullif(trim(info->>''guide''),'''') is null then');
 if start_at=0 then raise exception 'Unexpected shipping guide definition';end if;
 end_at:=strpos(substr(d,start_at),' end if;')+length(' end if;')-1;
 old_block:=substr(d,start_at,end_at);
 d:=replace(d,old_block,$new$
 if kind='courier' and nullif(trim(info->>'guide'),'') is null then
  info:=info||jsonb_build_object('guide',coalesce(nullif(current_delivery.guide,''),(select concat_ws('-',nullif(upper(trim(cs.details->>'shipping_guide_initials')),''),to_char(so.created_at at time zone 'America/Guatemala','DDMMYY'),bp.code) from public.sales_orders so join public.business_partners bp on bp.company_id=so.company_id and bp.id=so.customer_id left join public.company_settings cs on cs.company_id=so.company_id where so.company_id=c and so.id=o)));
 end if;$new$);
 execute d;
end $patch$;
notify pgrst,'reload schema';
