alter table public.raw_materials add column photo_path text;
alter table public.raw_materials add constraint material_photo_company_path check (
  photo_path is null or photo_path ~ ('^' || company_id::text || '/materials/[0-9a-f-]+\.(png|jpg|webp)$')
);

-- Keep creation, presentation and image assignment in the same existing transaction.
do $migration$
declare definition text; anchor text := '   o:=m.origin_id;';
begin
  definition := pg_get_functiondef('public.save_material_sheet(uuid,uuid,jsonb)'::regprocedure);
  if position(anchor in definition)=0 then raise exception 'Unexpected material save definition'; end if;
  definition := replace(definition, anchor, $body$
   if r ? 'photoPath' then
    update public.raw_materials set photo_path=nullif(r->>'photoPath','') where company_id=p_company and id=mid;
   end if;
$body$ || anchor);
  execute definition;
end $migration$;
