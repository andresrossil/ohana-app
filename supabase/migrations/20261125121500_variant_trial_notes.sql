alter table public.product_variants
  add column comments text not null default '' check (char_length(comments) <= 4000),
  add column trial_failed boolean not null default false;

-- Preserve the existing permissions, validation and idempotency of variant_save.
do $migration$
declare
  definition text := pg_get_functiondef('access_private.operations(uuid,text,uuid,jsonb)'::regprocedure);
  branch_start integer := strpos(definition, 'if p_action=''variant_save'' then');
  result_marker text := 'end if;v_result:=jsonb_build_object(''id'',v_id);';
  result_offset integer := strpos(substr(definition, branch_start), result_marker);
  insertion_point integer := branch_start + result_offset - 1 + length('end if;');
begin
  if branch_start = 0 or result_offset = 0 then
    raise exception 'No se encontró la rama variant_save';
  end if;
  execute overlay(definition placing $patch$
  if p_data ? 'comments' or p_data ? 'trial_failed' then
   update public.product_variants pv
   set comments = case when p_data ? 'comments' then coalesce(p_data->>'comments','') else pv.comments end,
       trial_failed = case when p_data ? 'trial_failed' then coalesce((p_data->>'trial_failed')::boolean,false) else pv.trial_failed end
   where pv.company_id=p_company and pv.product_id=parent and pv.id=v_id;
  end if;
  $patch$ from insertion_point for 0);
end
$migration$;
