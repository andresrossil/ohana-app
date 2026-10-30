create function access_private.platform_access() returns boolean language sql stable security definer set search_path='' as $$select auth.uid() is not null and exists(select 1 from access_private.platform_admins where user_id=auth.uid())$$;
create function public.platform_access() returns boolean language sql stable security invoker set search_path='' as $$select access_private.platform_access()$$;
create function access_private.platform_admin(action text,data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$declare target uuid;code_value text;label text;enabled boolean;begin
 if not access_private.platform_access() then raise exception 'Administración de plataforma no autorizada' using errcode='42501';end if;
 if action='list' then return jsonb_build_object('users',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'email',u.email,'verified',u.email_confirmed_at is not null,'platform_admin',pa.user_id is not null)) from auth.users u left join access_private.platform_admins pa on pa.user_id=u.id),'[]'),'countries',(select jsonb_agg(to_jsonb(c)) from public.countries c),'currencies',(select jsonb_agg(to_jsonb(c)) from public.currencies c));end if;
 if action='role' then
  target:=(data->>'user')::uuid;
  if target=auth.uid() then raise exception 'No puedes modificar tu propio rol global' using errcode='42501';end if;
  if not exists(select 1 from auth.users where id=target and email_confirmed_at is not null) then raise exception 'Selecciona una cuenta verificada';end if;
  if (data->>'enabled')::boolean then insert into access_private.platform_admins(user_id) values(target) on conflict do nothing;else delete from access_private.platform_admins where user_id=target;end if;
 elsif action in('country','currency') then
  code_value:=upper(trim(data->>'code'));label:=trim(data->>'name');enabled:=coalesce((data->>'active')::boolean,true);
  if code_value is null or label is null or length(label) not between 1 and 100 or (action='country' and code_value!~'^[A-Z]{2}$')or(action='currency' and code_value!~'^[A-Z]{3}$')then raise exception 'Utiliza código ISO y nombre válidos';end if;
  if not enabled and ((action='country' and exists(select 1 from public.company_settings where details->>'country'=code_value))or(action='currency' and exists(select 1 from public.companies where currency=code_value)))then raise exception 'Este código está en uso y no se puede desactivar';end if;
  if action='country' then insert into public.countries(code,name,active) values(code_value,label,enabled) on conflict(code) do update set name=excluded.name,active=excluded.active;else insert into public.currencies(code,name,active) values(code_value,label,enabled) on conflict(code) do update set name=excluded.name,active=excluded.active;end if;
 else raise exception 'Operación global no válida';end if;
 return '{}';
end $$;
create function public.platform_admin(p_action text,p_data jsonb default '{}')returns jsonb language sql security invoker set search_path='' as $$select access_private.platform_admin(p_action,p_data)$$;
revoke all on function access_private.platform_access(),public.platform_access(),access_private.platform_admin(text,jsonb),public.platform_admin(text,jsonb) from public,anon;
grant execute on function access_private.platform_access(),public.platform_access(),access_private.platform_admin(text,jsonb),public.platform_admin(text,jsonb) to authenticated;
notify pgrst,'reload schema';
