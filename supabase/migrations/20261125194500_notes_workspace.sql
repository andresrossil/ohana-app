create table public.note_catalog (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  kind text not null check (kind in ('group','status','tag')),
  name text not null check (length(btrim(name)) between 1 and 100),
  color text not null default '' check (color = '' or color ~ '^#[0-9a-fA-F]{6}$'),
  icon text not null default '' check (icon ~ '^[a-z0-9-]{0,64}$'),
  position integer not null default 0,
  active boolean not null default true,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  unique (company_id, kind, id)
);
alter table public.note_catalog enable row level security;
revoke all on public.note_catalog from public, anon, authenticated;
grant select on public.note_catalog to authenticated;
grant insert(company_id,kind,name,color,icon,position,active),
  update(name,color,icon,position,active) on public.note_catalog to authenticated;
create policy note_catalog_read on public.note_catalog for select to authenticated
  using (public.company_permission(company_id,'read','production') or public.company_permission(company_id,'manage'));
create policy note_catalog_create on public.note_catalog for insert to authenticated
  with check (public.company_permission(company_id,'manage') or
    (kind = 'group' and public.company_permission(company_id,'read','production')));
create policy note_catalog_edit on public.note_catalog for update to authenticated
  using (public.company_permission(company_id,'manage') or
    (kind = 'group' and created_by = (select auth.uid()) and public.company_permission(company_id,'read','production')))
  with check (public.company_permission(company_id,'manage') or
    (kind = 'group' and created_by = (select auth.uid()) and public.company_permission(company_id,'read','production')));

alter table public.production_notes
  add column group_id uuid,
  add column status_id uuid,
  add column group_kind text generated always as ('group') stored,
  add column status_kind text generated always as ('status') stored,
  add column rich_body text check (length(rich_body) <= 500000),
  add column pinned boolean not null default false,
  add column position integer not null default 0,
  add column revision integer not null default 0,
  add column created_at timestamptz,
  add column updated_by uuid references auth.users(id) on delete set null,
  add unique (company_id,id),
  add foreign key (company_id,group_kind,group_id) references public.note_catalog(company_id,kind,id),
  add foreign key (company_id,status_kind,status_id) references public.note_catalog(company_id,kind,id);
alter table public.production_notes alter column created_at set default now();
grant insert(id,group_id,status_id,rich_body,pinned,position), update(group_id,status_id,rich_body,pinned,position)
  on public.production_notes to authenticated;
create index notes_group on public.production_notes(company_id, group_id);
create index notes_status on public.production_notes(company_id, status_id);

create table public.note_markers (
  company_id uuid not null,
  note_id uuid not null,
  marker_id uuid not null,
  marker_kind text generated always as ('tag') stored,
  primary key (company_id,note_id,marker_id),
  foreign key (company_id,note_id) references public.production_notes(company_id,id) on delete cascade,
  foreign key (company_id,marker_kind,marker_id) references public.note_catalog(company_id,kind,id)
);
alter table public.note_markers enable row level security;
revoke all on public.note_markers from public, anon, authenticated;
grant select, delete on public.note_markers to authenticated;
grant insert(company_id,note_id,marker_id) on public.note_markers to authenticated;
create index note_markers_catalog on public.note_markers(company_id, marker_id);
create policy own_note_markers on public.note_markers for all to authenticated
  using (exists(select 1 from public.production_notes n where n.company_id = note_markers.company_id and n.id = note_markers.note_id))
  with check (exists(select 1 from public.production_notes n where n.company_id = note_markers.company_id and n.id = note_markers.note_id));

create function access_private.touch_production_note() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := clock_timestamp();
  if tg_op = 'UPDATE' then
    new.revision := old.revision + 1;
  end if;
  return new;
end $$;
revoke all on function access_private.touch_production_note() from public, anon, authenticated;
create trigger touch_production_note before insert or update on public.production_notes
  for each row execute function access_private.touch_production_note();

create function public.save_note_workspace(c uuid, n uuid, expected integer, fields jsonb, markers uuid[])
returns setof public.production_notes language plpgsql security invoker set search_path = '' as $$
declare saved public.production_notes;
begin
  if expected is null then
    insert into public.production_notes(id,company_id,title,body,rich_body,group_id,status_id,pinned,position)
    values(n,c,fields->>'title',fields->>'body',fields->>'rich_body',(fields->>'group_id')::uuid,
      (fields->>'status_id')::uuid,(fields->>'pinned')::boolean,(fields->>'position')::integer)
    returning * into saved;
  else
    update public.production_notes set title=fields->>'title',body=fields->>'body',rich_body=fields->>'rich_body',
      group_id=(fields->>'group_id')::uuid,status_id=(fields->>'status_id')::uuid,
      pinned=(fields->>'pinned')::boolean,position=(fields->>'position')::integer
    where company_id=c and id=n and revision=expected returning * into saved;
    if not found then return; end if;
  end if;
  delete from public.note_markers where company_id=c and note_id=n and not(marker_id = any(markers));
  insert into public.note_markers(company_id,note_id,marker_id)
    select c,n,marker from unnest(markers) as marker on conflict do nothing;
  return next saved;
end $$;
revoke all on function public.save_note_workspace(uuid,uuid,integer,jsonb,uuid[]) from public, anon;
grant execute on function public.save_note_workspace(uuid,uuid,integer,jsonb,uuid[]) to authenticated;

-- Group administrators can relocate assignments without reading or opening another author's notes.
create function access_private.remove_note_group(c uuid, g uuid, destination uuid, expected_count integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare amount integer;
begin
  if auth.uid() is null or not (public.company_permission(c,'manage') or public.company_permission(c,'read','production')) then
    raise exception 'Access denied' using errcode='42501';
  end if;
  perform 1 from public.note_catalog where company_id=c and kind='group' and id=g
    and (created_by=auth.uid() or public.company_permission(c,'manage')) for update;
  if not found then raise exception 'Access denied' using errcode='42501'; end if;
  select count(*) into amount from public.production_notes where company_id=c and group_id=g;
  if expected_count is null then return amount; end if;
  if expected_count <> amount then raise exception 'Group count changed' using errcode='40001'; end if;
  if destination is not null and (destination=g or not exists(
    select 1 from public.note_catalog where company_id=c and kind='group' and id=destination
  )) then raise exception 'Invalid destination'; end if;
  update public.production_notes set group_id=destination where company_id=c and group_id=g;
  delete from public.note_catalog where company_id=c and kind='group' and id=g;
  return amount;
end $$;
revoke all on function access_private.remove_note_group(uuid,uuid,uuid,integer) from public, anon;
grant execute on function access_private.remove_note_group(uuid,uuid,uuid,integer) to authenticated;
create function public.remove_note_group(c uuid, g uuid, destination uuid, expected_count integer)
returns integer language sql security invoker set search_path = '' as $$
  select access_private.remove_note_group(c,g,destination,expected_count);
$$;
revoke all on function public.remove_note_group(uuid,uuid,uuid,integer) from public, anon;
grant execute on function public.remove_note_group(uuid,uuid,uuid,integer) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('note-images','note-images',false,3145728,array['image/png','image/jpeg','image/webp','image/gif']);
create policy note_image_read on storage.objects for select to authenticated using (
  bucket_id='note-images' and (storage.foldername(name))[2]=(select auth.uid())::text
  and public.company_permission(case when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    then ((storage.foldername(name))[1])::uuid end,'read','production')
);
create policy note_image_create on storage.objects for insert to authenticated with check (
  bucket_id='note-images' and (storage.foldername(name))[2]=(select auth.uid())::text
  and public.company_permission(case when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    then ((storage.foldername(name))[1])::uuid end,'read','production')
);

create function public.order_workspace_notes(c uuid, items jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare expected_count integer;
declare changed_count integer;
begin
  expected_count := jsonb_array_length(items);
  update public.production_notes n set position = item.position
  from jsonb_to_recordset(items) as item(id uuid, revision integer, position integer)
  where n.company_id=c and n.id=item.id and n.revision=item.revision;
  get diagnostics changed_count = row_count;
  if changed_count <> expected_count then
    raise exception 'Notes changed' using errcode='40001';
  end if;
end $$;
revoke all on function public.order_workspace_notes(uuid,jsonb) from public, anon;
grant execute on function public.order_workspace_notes(uuid,jsonb) to authenticated;

create function public.order_note_groups(c uuid, items jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare changed_count integer;
begin
  update public.note_catalog n set position = item.position
  from jsonb_to_recordset(items) as item(id uuid, previous integer, position integer)
  where n.company_id=c and n.kind='group' and n.id=item.id and n.position=item.previous;
  get diagnostics changed_count = row_count;
  if changed_count <> jsonb_array_length(items) then
    raise exception 'Groups changed' using errcode='40001';
  end if;
end $$;
revoke all on function public.order_note_groups(uuid,jsonb) from public, anon;
grant execute on function public.order_note_groups(uuid,jsonb) to authenticated;
