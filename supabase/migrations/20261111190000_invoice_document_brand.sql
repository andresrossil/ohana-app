do $migration$
declare
  settings_sql text := pg_get_functiondef('access_private.save_company_settings(uuid,text,text,jsonb,jsonb,text)'::regprocedure);
  detail_sql text := pg_get_functiondef('access_private.sales_fulfillment(uuid,text,uuid,jsonb)'::regprocedure);
begin
  if strpos(settings_sql,$old$ if length(trim(p_name)) not between$old$)=0
     or strpos(detail_sql,$old$'delivery',to_jsonb(d),'commercial_info'$old$)=0 then
    raise exception 'No coinciden los comandos de configuración y ventas';
  end if;
  execute replace(settings_sql,$old$ if length(trim(p_name)) not between$old$,$new$
 if not (p_details ? 'document_logo_path') then
  p_details:=p_details||coalesce((select jsonb_build_object('document_logo_path',details->'document_logo_path')
    from public.company_settings where company_id=p_company and details ? 'document_logo_path'),'{}'::jsonb);
 end if;
 if p_details->>'document_logo_path' is not null and (
    split_part(p_details->>'document_logo_path','/',1)<>p_company::text
    or split_part(p_details->>'document_logo_path','/',2) !~ '^document-[a-f0-9-]+[.](png|webp|jpg)$'
    or not exists(select 1 from storage.objects where bucket_id='company-logos' and name=p_details->>'document_logo_path')
 ) then raise exception 'Logo para documentos no autorizado'; end if;
 if length(trim(p_name)) not between$new$);
  execute replace(detail_sql,$old$'delivery',to_jsonb(d),'commercial_info'$old$,$new$
    'delivery',to_jsonb(d),'document_brand',(select jsonb_build_object('name',co.name,'logo_path',cs.details->>'document_logo_path')
      from public.companies co left join public.company_settings cs on cs.company_id=co.id where co.id=c),
    'commercial_info'$new$);
end
$migration$;
