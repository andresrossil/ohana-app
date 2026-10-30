-- Appearance is shared with assigned users without granting access to fiscal details.
create function access_private.company_theme(p_company uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 if auth.uid() is null or not access_private.company_permission(p_company,'read','identity') then raise exception 'Empresa no autorizada' using errcode='42501';end if;
 return coalesce((select appearance from public.company_settings where company_id=p_company),'{}'::jsonb);
end $$;
create function public.company_theme(p_company uuid) returns jsonb language sql stable security invoker set search_path='' as $$select access_private.company_theme(p_company)$$;
revoke all on function access_private.company_theme(uuid),public.company_theme(uuid) from public,anon;
grant execute on function access_private.company_theme(uuid),public.company_theme(uuid) to authenticated;
drop policy company_logo_read on storage.objects;
create policy company_logo_read on storage.objects for select to authenticated using(bucket_id='company-logos' and public.company_permission((storage.foldername(name))[1]::uuid,'read','identity'));
notify pgrst,'reload schema';
