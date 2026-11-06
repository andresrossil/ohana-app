alter table public.user_profiles add column avatar_path text;
create function access_private.user_profile_allowed(c uuid,target uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and access_private.company_permission(c,'manage') and
 (exists(select 1 from public.company_members m where m.company_id=c and m.user_id=target)
  or exists(select 1 from public.companies cp join public.corporation_members cm on cm.corporation_id=cp.corporation_id where cp.id=c and cm.user_id=target))
 and (target=auth.uid() or not exists(select 1 from public.companies cp join public.corporation_members cm on cm.corporation_id=cp.corporation_id where cp.id=c and cm.user_id=target)
  or exists(select 1 from public.companies cp join public.corporation_members cm on cm.corporation_id=cp.corporation_id where cp.id=c and cm.user_id=auth.uid()));
$$;
revoke all on function access_private.user_profile_allowed(uuid,uuid) from public,anon,authenticated;
create function access_private.avatar_manage(path text) returns boolean language plpgsql stable security definer set search_path='' as $$
declare c uuid;target uuid;begin
 if array_length(string_to_array(path,'/'),1)<>3 then return false;end if;
 c:=split_part(path,'/',1)::uuid;target:=split_part(path,'/',2)::uuid;
 return access_private.user_profile_allowed(c,target);
exception when invalid_text_representation then return false;end $$;
create function access_private.avatar_read(path text) returns boolean language plpgsql stable security definer set search_path='' as $$
declare target uuid;begin
 if auth.uid() is null then return false;end if;
 if access_private.avatar_manage(path) then return true;end if;
 target:=split_part(path,'/',2)::uuid;
 return exists(select 1 from public.user_profiles up where up.user_id=target and up.avatar_path=path) and
 (auth.uid()=target or exists(select 1 from public.companies cp where access_private.user_profile_allowed(cp.id,target)));
exception when invalid_text_representation then return false;end $$;
revoke all on function access_private.avatar_manage(text),access_private.avatar_read(text) from public,anon;
grant execute on function access_private.avatar_manage(text),access_private.avatar_read(text) to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('user-avatars','user-avatars',false,3145728,array['image/png','image/jpeg','image/webp']);
create policy avatar_select on storage.objects for select to authenticated using(bucket_id='user-avatars' and access_private.avatar_read(name));
create policy avatar_insert on storage.objects for insert to authenticated with check(bucket_id='user-avatars' and access_private.avatar_manage(name));
create policy avatar_delete on storage.objects for delete to authenticated using(bucket_id='user-avatars' and access_private.avatar_manage(name));
create function access_private.user_settings(c uuid,action text,data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare target uuid;display text;photo text;previous text;answer jsonb;begin
 if auth.uid() is null or not access_private.company_permission(c,'manage') then raise exception 'No tienes permiso para administrar usuarios de esta empresa' using errcode='42501';end if;
 if action='list' then
  with assigned as(
   select m.user_id,m.role from public.company_members m where m.company_id=c
   union all select cm.user_id,'corporation_admin' from public.corporation_members cm join public.companies cp on cp.corporation_id=cm.corporation_id where cp.id=c
  ),unique_users as(select distinct on(user_id) user_id,role from assigned order by user_id,(role='corporation_admin') desc)
  select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'email',u.email,'role',a.role,'self',u.id=auth.uid(),'display_name',coalesce(up.display_name,''),'avatar_path',up.avatar_path,'can_edit',access_private.user_profile_allowed(c,u.id)) order by coalesce(nullif(up.display_name,''),u.email)),'[]') into answer
   from unique_users a join auth.users u on u.id=a.user_id left join public.user_profiles up on up.user_id=u.id;
  return answer;
 end if;
 target:=(data->>'user_id')::uuid;
 if not access_private.user_profile_allowed(c,target) then raise exception 'No puedes modificar este usuario' using errcode='42501';end if;
 if action<>'save' then raise exception 'Acción no válida';end if;
 display:=btrim(data->>'display_name');photo:=nullif(data->>'avatar_path','');
 if length(coalesce(display,'')) not between 1 and 120 then raise exception 'Escribe un nombre de 1 a 120 caracteres';end if;
 select avatar_path into previous from public.user_profiles where user_id=target;
 if photo is not null and photo is distinct from previous and
 (split_part(photo,'/',1)<>c::text or split_part(photo,'/',2)<>target::text or
 not exists(select 1 from storage.objects o where o.bucket_id='user-avatars' and o.name=photo))then raise exception 'La fotografía no corresponde a este usuario';end if;
 insert into public.user_profiles(user_id,display_name,avatar_path) values(target,display,photo)
 on conflict(user_id) do update set display_name=excluded.display_name,avatar_path=excluded.avatar_path;
 return jsonb_build_object('saved',true);
end $$;
revoke all on function access_private.user_settings(uuid,text,jsonb) from public,anon;
grant execute on function access_private.user_settings(uuid,text,jsonb) to authenticated;
create function public.user_settings(p_company uuid,p_action text,p_data jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$
 select access_private.user_settings(p_company,p_action,p_data) $$;
revoke all on function public.user_settings(uuid,text,jsonb) from public,anon;
grant execute on function public.user_settings(uuid,text,jsonb) to authenticated;
