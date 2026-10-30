create policy platform_admins_no_client_access on access_private.platform_admins for all to authenticated using(false) with check(false);
do $$declare def text;begin
 def:=pg_get_functiondef('access_private.company_permission(uuid,text,text)'::regprocedure);
 def:=replace(def,'m.role=''admin'' or p_action<>''manage''','m.role=''admin'' or (p_action=''read'' and p_module=''identity'') or p_action<>''manage''');execute def;
 def:=pg_get_functiondef('access_private.company_context()'::regprocedure);
 def:=replace(def,'''manage'',access_private.company_permission(c.id,''manage'')','''catalog_read'',access_private.company_permission(c.id,''read''),''inventory_read'',access_private.company_permission(c.id,''read'',''inventory''),''production_read'',access_private.company_permission(c.id,''read'',''production''),''sales_read'',access_private.company_permission(c.id,''read'',''sales''),''reports_read'',access_private.company_permission(c.id,''read'',''reports''),''manage'',access_private.company_permission(c.id,''manage'')');
 def:=replace(def,'access_private.company_permission(c.id,''read'') or access_private.company_permission(c.id,''manage'')','access_private.company_permission(c.id,''read'',''identity'') or access_private.company_permission(c.id,''manage'')');
 def:=replace(def,'c.corporation_id=co.id and access_private.company_permission(c.id,''read'')','c.corporation_id=co.id and access_private.company_permission(c.id,''read'',''identity'')');execute def;
end $$;
drop policy scoped_read on public.companies;
create policy scoped_read on public.companies for select to authenticated using(public.company_permission(id,'read','identity'));
create or replace function access_private.assign_member(p_company uuid,p_email text,p_role text,p_corporation uuid default null) returns void language plpgsql security definer set search_path='' as $$
declare target uuid;begin
 if auth.uid() is null then raise exception 'Inicia sesión' using errcode='42501';end if;
 if p_corporation is not null then
  if not access_private.corporation_permission(p_corporation) or p_role not in('corporation_admin','remove_corporation') then raise exception 'Asignación no permitida' using errcode='42501';end if;
 elsif not access_private.company_permission(p_company,'manage') or p_role not in('admin','editor','viewer','remove') then raise exception 'Asignación no permitida' using errcode='42501';end if;
 select id into target from auth.users where lower(email)=lower(trim(p_email)) and email_confirmed_at is not null;
 if target is null then raise exception 'La cuenta debe registrarse y verificar su correo antes de asignarla';end if;
 if target=auth.uid() then raise exception 'No puedes modificar tus propios permisos' using errcode='42501';end if;
 if p_corporation is not null then
  if p_role='remove_corporation' then delete from public.corporation_members where corporation_id=p_corporation and user_id=target;
  else insert into public.corporation_members(corporation_id,user_id) values(p_corporation,target) on conflict do nothing;end if;
 elsif p_role='remove' then delete from public.company_members where company_id=p_company and user_id=target;
 else
  insert into public.company_members(company_id,user_id,role) values(p_company,target,p_role) on conflict(company_id,user_id) do update set role=excluded.role;
  delete from public.company_module_access where company_id=p_company and user_id=target;
 end if;
end $$;
create function access_private.list_members(p_company uuid default null,p_corporation uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 if auth.uid() is null then raise exception 'Inicia sesión' using errcode='42501';end if;
 if p_corporation is not null then
  if not access_private.corporation_permission(p_corporation) then raise exception 'Sin permiso' using errcode='42501';end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'email',u.email,'role',m.role,'self',u.id=auth.uid()) order by u.email) from public.corporation_members m join auth.users u on u.id=m.user_id where m.corporation_id=p_corporation),'[]');
 end if;
 if not access_private.company_permission(p_company,'manage') then raise exception 'Sin permiso' using errcode='42501';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'email',u.email,'role',m.role,'business_role',m.business_role,'self',u.id=auth.uid(),'modules',coalesce((select jsonb_agg(jsonb_build_object('module',a.module,'read',a.can_read,'write',a.can_write)) from public.company_module_access a where a.company_id=m.company_id and a.user_id=m.user_id),'[]')) order by u.email) from public.company_members m join auth.users u on u.id=m.user_id where m.company_id=p_company),'[]');
end $$;
create function public.list_members(p_company uuid default null,p_corporation uuid default null) returns jsonb language sql stable security invoker set search_path='' as $$select access_private.list_members(p_company,p_corporation)$$;
create function access_private.set_member_modules(p_company uuid,p_user uuid,p_modules jsonb) returns void language plpgsql security definer set search_path='' as $$declare m jsonb;begin
 if auth.uid() is null or not access_private.company_permission(p_company,'manage') or p_user=auth.uid() then raise exception 'No puedes modificar estos permisos' using errcode='42501';end if;
 if not exists(select 1 from public.company_members where company_id=p_company and user_id=p_user and role in('editor','viewer')) then raise exception 'Selecciona un usuario operativo asignado a esta empresa';end if;
 if jsonb_typeof(p_modules)<>'array' or jsonb_array_length(p_modules)>5 then raise exception 'Permisos inválidos';end if;
 delete from public.company_module_access where company_id=p_company and user_id=p_user;
 for m in select value from jsonb_array_elements(p_modules) loop
  insert into public.company_module_access(company_id,user_id,module,can_read,can_write) values(p_company,p_user,m->>'module',coalesce((m->>'read')::boolean,false),coalesce((m->>'write')::boolean,false));
 end loop;
end $$;
create function public.set_member_modules(p_company uuid,p_user uuid,p_modules jsonb) returns void language sql security invoker set search_path='' as $$select access_private.set_member_modules(p_company,p_user,p_modules)$$;
revoke all on function access_private.list_members(uuid,uuid),public.list_members(uuid,uuid),access_private.set_member_modules(uuid,uuid,jsonb),public.set_member_modules(uuid,uuid,jsonb) from public,anon;
grant execute on function access_private.list_members(uuid,uuid),public.list_members(uuid,uuid),access_private.set_member_modules(uuid,uuid,jsonb),public.set_member_modules(uuid,uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
