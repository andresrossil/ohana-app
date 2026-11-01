alter table public.formulas add column edit_revision integer not null default 1 check(edit_revision>0),
 add column admin_notes text not null default '' check(length(admin_notes)<=4000);
alter table public.production_batches add column confirmed boolean not null default false,
 add column confirmed_at timestamptz,
 add column recipe_snapshot jsonb,
 add column batch_number bigint;
alter table public.production_batches alter column formula_id drop not null;
alter table public.production_batches drop constraint production_batches_state_check;
alter table public.production_batches add constraint production_batches_state_check check(state in('draft','in_progress','curing','released','cancelled'));
update public.production_batches set confirmed=true where state in('curing','released') or finish_payload is not null;
with numbered as(select id,row_number() over(partition by company_id order by created_at,id) n from public.production_batches)
update public.production_batches b set batch_number=n.n from numbered n where b.id=n.id;
alter table public.production_batches alter column batch_number set not null;
alter table public.production_batches add unique(company_id,batch_number),add check(batch_number>0),
 add check(not confirmed or formula_id is not null),
 add check(state='draft' or state='cancelled' or formula_id is not null);
alter table public.formulas add unique(company_id,id,product_id);
alter table public.production_batches add foreign key(company_id,formula_id,product_id) references public.formulas(company_id,id,product_id);
create index batch_formula_trace on public.production_batches(company_id,formula_id,confirmed);

create function access_private.formula_locked(c uuid,f uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.production_batches where company_id=c and formula_id=f and confirmed)$$;
revoke all on function access_private.formula_locked(uuid,uuid) from public,anon,authenticated;
create or replace function access_private.formula_identity_guard() returns trigger language plpgsql security definer set search_path='' as $$begin
 if tg_op='INSERT' then
  if new.family_id is null then
   perform pg_advisory_xact_lock(hashtextextended(new.company_id::text,0));
   insert into public.formula_families(company_id,product_id,code) values(new.company_id,new.product_id,access_private.next_formula_code(new.company_id)) returning id into new.family_id;new.version:=1;
  end if;
 else
  perform pg_advisory_xact_lock(hashtextextended(old.company_id::text,0));
  if row(new.id,new.company_id,new.product_id,new.family_id,new.version,new.source_formula_id,new.created_at,new.origin_action) is distinct from row(old.id,old.company_id,old.product_id,old.family_id,old.version,old.source_formula_id,old.created_at,old.origin_action) then raise exception 'La identidad y el producto de una revisión no se cambian; utiliza Duplicar fórmula';end if;
  if (to_jsonb(new)-array['state','admin_notes','edit_revision']) is distinct from (to_jsonb(old)-array['state','admin_notes','edit_revision']) or new.edit_revision<>old.edit_revision then
   if access_private.formula_locked(old.company_id,old.id) then raise exception 'La versión ya se utilizó en producción confirmada. Crea una nueva versión' using errcode='55000';end if;
   new.edit_revision:=old.edit_revision+1;
  end if;
 end if;return new;
end $$;
create or replace function access_private.formula_line_guard() returns trigger language plpgsql security definer set search_path='' as $$begin
 perform pg_advisory_xact_lock(hashtextextended(old.company_id::text,0));
 if access_private.formula_locked(old.company_id,old.formula_id) then raise exception 'La composición ya se utilizó en producción confirmada. Crea una nueva versión' using errcode='55000';end if;
 if tg_op='DELETE' then return old;else return new;end if;
end $$;

-- Extend the checked formula command; reuse its unit/percentage/duplicate validation.
do $patch$declare def text;old_insert text:=$source$insert into public.formulas(company_id,product_id,family_id,name,version,standard_yield,state,capture_mode,total_quantity,total_unit_id,loss_enabled,loss_percent,source_formula_id,origin_action)
    values(c,product,family,trim(data->>'name'),ver,null,status,capture,case when capture='percentage' then total else null end,case when capture='percentage' then tu.id else null end,coalesce((data->>'loss_enabled')::boolean,false),coalesce(nullif(data->>'loss_percent','')::numeric,5),src.id,data->>'kind') returning id into fid;$source$;
begin
 def:=pg_get_functiondef('access_private.formula_command(uuid,text,uuid,jsonb)'::regprocedure);
 if strpos(def,old_insert)=0 then raise exception 'No se encontró la estructura de guardado de fórmulas';end if;
 def:=replace(def,'jsonb_build_object(''code'',ff.code,','jsonb_build_object(''locked'',access_private.formula_locked(c,fm.id),''used_batches'',coalesce((select jsonb_agg(jsonb_build_object(''id'',pb.id,''batch_number'',pb.batch_number,''state'',pb.state,''confirmed'',pb.confirmed,''production_date'',pb.production_date) order by pb.created_at desc) from public.production_batches pb where pb.company_id=c and pb.formula_id=fm.id),''[]''),''code'',ff.code,');
 def:=replace(def,'action not in(''save'',''state'')','action not in(''save'',''state'',''edit'',''notes'')');
 def:=replace(def,'if action=''state'' then', $new$if action='notes' then
  if length(coalesce(data->>'admin_notes',''))>4000 then raise exception 'Las notas administrativas admiten 4000 caracteres';end if;
  update public.formulas set admin_notes=coalesce(data->>'admin_notes','') where company_id=c and id=(data->>'id')::uuid returning id into fid;
  if not found then raise exception 'Fórmula no disponible';end if;answer:=jsonb_build_object('id',fid);
 elsif action='state' then$new$);
 def:=replace(def,'''new'',''version'',''variation'',''duplicate''','''new'',''version'',''variation'',''duplicate'',''edit''');
 def:=replace(def,'product:=(data->>''product'')::uuid;', $new$
  if (action='edit' and data->>'kind'<>'edit') or (action='save' and data->>'kind'='edit') then raise exception 'Acción y modalidad incompatibles';end if;
  if action='edit' then
   if access_private.formula_locked(c,src.id) then raise exception 'La versión ya se utilizó en producción confirmada. Crea una nueva versión' using errcode='55000';end if;
   if (data->>'edit_revision')::integer is distinct from src.edit_revision then raise exception 'La fórmula cambió mientras la editabas. Actualiza antes de guardar' using errcode='40001';end if;
  end if;
  product:=(data->>'product')::uuid;$new$);
 def:=replace(def,'in(''version'',''variation'')','in(''version'',''variation'',''edit'')');
 def:=replace(def,'if data->>''kind''=''version'' then family:=src.family_id;ver:=', 'if data->>''kind''=''edit'' then family:=src.family_id;ver:=src.version;elsif data->>''kind''=''version'' then family:=src.family_id;ver:=');
 def:=replace(def,old_insert,$new$
  if action='edit' then
   update public.formulas set name=trim(data->>'name'),state=status,capture_mode=capture,total_quantity=case when capture='percentage' then total else null end,total_unit_id=case when capture='percentage' then tu.id else null end,loss_enabled=coalesce((data->>'loss_enabled')::boolean,false),loss_percent=coalesce(nullif(data->>'loss_percent','')::numeric,5),admin_notes=coalesce(data->>'admin_notes',src.admin_notes),edit_revision=edit_revision+1 where company_id=c and id=src.id;
   fid:=src.id;delete from public.formula_ingredients where company_id=c and formula_id=fid;
  else $new$||old_insert||' update public.formulas set admin_notes=coalesce(data->>''admin_notes'','''') where company_id=c and id=fid; end if;');
 execute def;
end $patch$;

create function access_private.batch_recipe_snapshot(c uuid,bid uuid,fid uuid,pid uuid,factor numeric,payload jsonb,ccy text,total numeric) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('schema',1,'captured_at',now(),'company_id',c,'product',jsonb_build_object('id',p.id,'name',p.name,'sku',p.sku),
 'formula',jsonb_build_object('id',f.id,'family_id',f.family_id,'code',ff.code,'name',f.name,'version',f.version,'edit_revision',f.edit_revision),
 'scale',factor,'loss',jsonb_build_object('enabled',f.loss_enabled,'percent',f.loss_percent),'currency',ccy,'total_cost',total,
 'lines',coalesce((select jsonb_agg(jsonb_build_object('material_id',m.id,'material_name',m.name,'material_sku',m.sku,'line_kind',i.line_kind,'percentage',i.percentage,
   'planned_quantity',i.quantity*factor,'planned_unit',jsonb_build_object('id',pu.id,'symbol',pu.symbol,'name',pu.name,'dimension',pu.dimension,'base_factor',pu.base_factor),
   'actual_quantity',(actual.row->>'quantity')::numeric,'actual_unit',jsonb_build_object('id',au.id,'symbol',au.symbol,'name',au.name,'dimension',au.dimension,'base_factor',au.base_factor),
   'base_quantity',bc.base_quantity,'base_unit',jsonb_build_object('id',bu.id,'symbol',bu.symbol,'name',bu.name),
   'applied_unit_cost',case when (actual.row->>'quantity')::numeric>0 then bc.cost/(actual.row->>'quantity')::numeric else null end,
   'applied_base_unit_cost',case when bc.base_quantity>0 then bc.cost/bc.base_quantity else null end,'total_cost',bc.cost) order by i.line_kind,m.name)
  from public.formula_ingredients i join public.raw_materials m on m.company_id=i.company_id and m.id=i.material_id
  join public.units pu on pu.company_id=i.company_id and pu.id=i.unit_id
  join public.units bu on bu.company_id=m.company_id and bu.id=m.unit_id
  join public.batch_consumptions bc on bc.company_id=c and bc.batch_id=bid and bc.material_id=i.material_id
  join lateral(select x as row from jsonb_array_elements(payload->'consumptions') x where x->>'material'=i.material_id::text limit 1)actual on true
  join public.units au on au.company_id=c and au.id=(actual.row->>'unit')::uuid
  where i.company_id=c and i.formula_id=fid),'[]'))
 from public.formulas f join public.formula_families ff on ff.company_id=f.company_id and ff.id=f.family_id join public.products p on p.company_id=f.company_id and p.id=f.product_id
 where f.company_id=c and f.id=fid and f.product_id=pid
$$;
revoke all on function access_private.batch_recipe_snapshot(uuid,uuid,uuid,uuid,numeric,jsonb,text,numeric) from public,anon,authenticated;
create function access_private.batch_trace_guard() returns trigger language plpgsql security definer set search_path='' as $$begin
 perform pg_advisory_xact_lock(hashtextextended(new.company_id::text,0));
 if tg_op='INSERT' then
  if new.batch_number is null then select coalesce(max(batch_number),0)+1 into new.batch_number from public.production_batches where company_id=new.company_id;end if;
  if new.confirmed or new.recipe_snapshot is not null or new.state not in('draft','in_progress') then raise exception 'El lote se confirma desde Producción';end if;
 else
  if row(new.id,new.company_id,new.batch_number) is distinct from row(old.id,old.company_id,old.batch_number) then raise exception 'La identidad del lote no cambia';end if;
  if old.confirmed then
   if (to_jsonb(new)-array['state','release_note']) is distinct from(to_jsonb(old)-array['state','release_note']) then raise exception 'El lote confirmado y su receta histórica son inmutables';end if;
   if new.state<>old.state and not(old.state='curing' and new.state='released') then raise exception 'Transición no válida para un lote confirmado';end if;
  elsif new.state='curing' then
   if old.state<>'in_progress' or new.formula_id is null or new.finish_payload is null then raise exception 'Completa la versión y los consumos antes de confirmar';end if;
   new.recipe_snapshot:=access_private.batch_recipe_snapshot(new.company_id,new.id,new.formula_id,new.product_id,new.formula_scale,new.finish_payload,new.currency,new.total_cost);
   if new.recipe_snapshot is null or jsonb_array_length(new.recipe_snapshot->'lines')<>(select count(*) from public.formula_ingredients where company_id=new.company_id and formula_id=new.formula_id) then raise exception 'No se pudo conservar la receta completa; no se confirmó la producción';end if;
   new.confirmed:=true;new.confirmed_at:=now();
  elsif new.confirmed or new.recipe_snapshot is not null then raise exception 'La confirmación requiere el registro transaccional de consumos';end if;
 end if;return new;
end $$;
revoke all on function access_private.batch_trace_guard() from public,anon,authenticated;
create trigger batch_trace_guard before insert or update on public.production_batches for each row execute function access_private.batch_trace_guard();

create function access_private.production_command(c uuid,action text,k uuid default null,data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.production_batches%rowtype;f public.formulas%rowtype;cached access_private.operation_requests%rowtype;bid uuid;pid uuid;fid uuid;answer jsonb;begin
 if auth.uid() is null or not public.company_permission(c,case when action in('list','detail') then 'read' else 'write' end,'production') then raise exception 'Producción no autorizada' using errcode='42501';end if;
 if action='list' then return coalesce((select jsonb_agg(to_jsonb(pb)||jsonb_build_object('product_name',coalesce(pb.recipe_snapshot#>>'{product,name}',p.name),'formula_code',coalesce(pb.recipe_snapshot#>>'{formula,code}',ff.code),'formula_name',coalesce(pb.recipe_snapshot#>>'{formula,name}',f.name),'formula_version',coalesce((pb.recipe_snapshot#>>'{formula,version}')::integer,f.version),'outputs',coalesce((select jsonb_agg(to_jsonb(o)||jsonb_build_object('variant_name',pv.name)) from public.batch_outputs o join public.product_variants pv on pv.company_id=o.company_id and pv.id=o.variant_id where o.company_id=c and o.batch_id=pb.id),'[]')) order by pb.batch_number desc) from public.production_batches pb join public.products p on p.company_id=pb.company_id and p.id=pb.product_id left join public.formulas f on f.company_id=pb.company_id and f.id=pb.formula_id left join public.formula_families ff on ff.company_id=f.company_id and ff.id=f.family_id where pb.company_id=c),'[]');end if;
 if action='detail' then
  select * into strict b from public.production_batches where company_id=c and id=(data->>'id')::uuid;
  return jsonb_build_object('batch',to_jsonb(b),'snapshot',b.recipe_snapshot,'legacy_consumptions',case when b.confirmed and b.recipe_snapshot is null then coalesce((select jsonb_agg(jsonb_build_object('material_id',material_id,'base_quantity',base_quantity,'cost',cost)) from public.batch_consumptions where company_id=c and batch_id=b.id),'[]') else '[]'::jsonb end);
 end if;
 if action not in('draft_save','start') or k is null then raise exception 'Acción de lote inválida';end if;
 perform pg_advisory_xact_lock(hashtextextended(c::text,0));
 select * into cached from access_private.operation_requests where company_id=c and key=k;
 if found then if cached.action<>'production_'||action or cached.payload<>data then raise exception 'Identificador utilizado con otros datos';end if;return cached.result;end if;
 bid:=nullif(data->>'id','')::uuid;
 if bid is not null then select * into strict b from public.production_batches where company_id=c and id=bid;end if;
 if action='start' then
  if b.id is null or b.state<>'draft' then raise exception 'Selecciona un lote borrador';end if;
  if b.formula_id is null then raise exception 'Selecciona una versión válida antes de preparar el lote';end if;
  select * into strict f from public.formulas where company_id=c and id=b.formula_id and product_id=b.product_id and state<>'inactive';
  update public.production_batches set state='in_progress' where company_id=c and id=bid;
 else
  if b.id is not null and b.state<>'draft' then raise exception 'Solo puedes editar un lote borrador';end if;
  pid:=(data->>'product')::uuid;fid:=nullif(data->>'formula','')::uuid;
  perform 1 from public.products where company_id=c and id=pid and active;if not found then raise exception 'Producto no disponible';end if;
  if fid is not null then perform 1 from public.formulas where company_id=c and id=fid and product_id=pid;if not found then raise exception 'La versión no corresponde a este producto y empresa';end if;end if;
  if b.id is null then
   insert into public.production_batches(company_id,product_id,formula_id,planned_quantity,formula_scale,production_date,available_on,currency,notes,state)
   values(c,pid,fid,(data->>'quantity')::integer,coalesce((data->>'formula_scale')::numeric,1),(data->>'date')::date,(data->>'available_on')::date,(select currency from public.companies where id=c),left(coalesce(data->>'notes',''),1000),'draft') returning id into bid;
  else
   update public.production_batches set product_id=pid,formula_id=fid,planned_quantity=(data->>'quantity')::integer,formula_scale=coalesce((data->>'formula_scale')::numeric,1),production_date=(data->>'date')::date,available_on=(data->>'available_on')::date,notes=left(coalesce(data->>'notes',''),1000) where company_id=c and id=bid;
  end if;
 end if;answer:=jsonb_build_object('id',bid);
 insert into access_private.operation_requests(company_id,key,action,payload,result) values(c,k,'production_'||action,data,answer);return answer;
end $$;
create function public.production_command(p_company uuid,p_action text,p_key uuid default null,p_data jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select access_private.production_command(p_company,p_action,p_key,p_data)$$;
revoke all on function access_private.production_command(uuid,text,uuid,jsonb),public.production_command(uuid,text,uuid,jsonb) from public,anon;
grant execute on function access_private.production_command(uuid,text,uuid,jsonb),public.production_command(uuid,text,uuid,jsonb) to authenticated;

do $$declare def text;begin
 def:=pg_get_functiondef('access_private.operations(uuid,text,uuid,jsonb)'::regprocedure);
 def:=replace(def,'if b.production_date>current_date then', $new$
 if nullif(p_data->>'expected_revision','') is not null and (p_data->>'expected_revision')::integer<>(select edit_revision from public.formulas where company_id=p_company and id=b.formula_id) then raise exception 'La fórmula fue corregida mientras preparabas el lote. Actualiza los consumos antes de confirmar' using errcode='40001';end if;
 if b.production_date>current_date then$new$);execute def;
end $$;
notify pgrst,'reload schema';
