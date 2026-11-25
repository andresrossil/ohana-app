-- Company identity access checks live membership and company status without a module grant.
create policy company_notes_read on public.production_notes for select to authenticated
  using (public.company_permission(company_id,'read','identity'));
create policy company_notes_create on public.production_notes for insert to authenticated
  with check (author_id=(select auth.uid()) and public.company_permission(company_id,'read','identity'));
create policy company_notes_edit on public.production_notes for update to authenticated
  using (public.company_permission(company_id,'read','identity'))
  with check (public.company_permission(company_id,'read','identity'));
create policy author_notes_delete on public.production_notes for delete to authenticated
  using (author_id=(select auth.uid()) and public.company_permission(company_id,'read','identity'));
drop policy own_notes on public.production_notes;

alter policy note_catalog_read on public.note_catalog
  using (public.company_permission(company_id,'read','identity') or public.company_permission(company_id,'manage'));
alter policy note_catalog_create on public.note_catalog
  with check (public.company_permission(company_id,'manage') or
    (kind='group' and public.company_permission(company_id,'read','identity')));
alter policy note_catalog_edit on public.note_catalog
  using (public.company_permission(company_id,'manage') or
    (kind='group' and created_by=(select auth.uid()) and public.company_permission(company_id,'read','identity')))
  with check (public.company_permission(company_id,'manage') or
    (kind='group' and created_by=(select auth.uid()) and public.company_permission(company_id,'read','identity')));

alter policy note_image_read on storage.objects using (
  bucket_id='note-images' and public.company_permission(
    case when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    then ((storage.foldername(name))[1])::uuid end,'read','identity')
);
alter policy note_image_create on storage.objects with check (
  bucket_id='note-images' and (storage.foldername(name))[2]=(select auth.uid())::text
  and public.company_permission(
    case when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    then ((storage.foldername(name))[1])::uuid end,'read','identity')
);

create or replace function access_private.remove_note_group(c uuid, g uuid, destination uuid, expected_count integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare amount integer;
begin
  if auth.uid() is null or not (public.company_permission(c,'manage') or public.company_permission(c,'read','identity')) then
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
