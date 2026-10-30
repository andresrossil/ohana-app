create policy internal_only on access_private.child_code_counters using(false);
create policy internal_only on access_private.operation_requests using(false);
create function access_private.normalize_attributes(a jsonb) returns jsonb language sql immutable set search_path='' as $$select coalesce(jsonb_object_agg(public.catalog_key(key),public.catalog_key(value)) filter(where length(trim(value))>0),'{}'::jsonb) from jsonb_each_text(a)$$;
revoke all on function access_private.normalize_attributes(jsonb) from public,anon,authenticated;
create function access_private.presentation_sku() returns trigger language plpgsql security definer set search_path='' as $$
declare parent_code text;class text;next_value bigint;candidate text;begin
 if not public.company_permission(new.company_id,'write') then raise exception 'Presentación no autorizada' using errcode='42501';end if;
 if nullif(trim(new.sku),'') is not null then return new;end if;
 perform pg_advisory_xact_lock(hashtextextended(new.company_id::text,0));
 select sku,classification into strict parent_code,class from public.raw_materials where company_id=new.company_id and id=new.raw_material_id;
 if parent_code is null then
  parent_code:=catalog_private.reserve_sku(new.company_id,case when class='Material de empaque' then 'E' else 'M' end);
  update public.raw_materials set sku=parent_code where company_id=new.company_id and id=new.raw_material_id;
 end if;
 loop
  insert into access_private.child_code_counters(company_id,kind,parent_id,last_value) values(new.company_id,'presentation',new.raw_material_id,1) on conflict(company_id,kind,parent_id) do update set last_value=access_private.child_code_counters.last_value+1 returning last_value into next_value;
  candidate:=parent_code||'-'||case when next_value<100 then lpad(next_value::text,2,'0') else next_value::text end;
  exit when not exists(select 1 from public.catalog_identifiers where company_id=new.company_id and (public.catalog_key(sku)=public.catalog_key(candidate) or public.catalog_key(barcode)=public.catalog_key(candidate)));
 end loop;
 new.sku:=candidate;return new;
end $$;
revoke all on function access_private.presentation_sku() from public,anon,authenticated;
create trigger a_suggest_presentation_sku before insert or update on public.presentations for each row execute function access_private.presentation_sku();
do $$declare def text;begin def:=pg_get_functiondef('access_private.operations(uuid,text,uuid,jsonb)'::regprocedure);def:=replace(def,'coalesce(p_data->''attributes'',''{}'')','access_private.normalize_attributes(coalesce(p_data->''attributes'',''{}''))');execute def;end $$;
alter table public.production_batches add constraint actual_weight_positive check(actual_weight>0 and actual_weight<>'NaN');
notify pgrst,'reload schema';
