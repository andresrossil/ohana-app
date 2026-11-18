create table access_private.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  material_id uuid not null,
  supplier_id uuid,
  quantity numeric(20,8) not null check(quantity>0 and quantity<'Infinity'::numeric),
  unit_id uuid not null,
  notes text not null default '' check(length(notes)<=2000),
  purchased boolean not null default false,
  revision integer not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references auth.users(id),
  foreign key(company_id,material_id) references public.raw_materials(company_id,id),
  foreign key(company_id,supplier_id) references public.business_partners(company_id,id),
  foreign key(company_id,unit_id) references public.units(company_id,id)
);
create index purchase_order_lines_company on access_private.purchase_order_lines(company_id,created_at,id);
alter table access_private.purchase_order_lines enable row level security;
revoke all on access_private.purchase_order_lines from public,anon,authenticated;

create function access_private.purchase_planning(c uuid,action text,data jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare
  line jsonb; target uuid; material uuid; supplier uuid; unit uuid; expected integer;
  result_ids jsonb:='[]';
begin
 if auth.uid() is null or not public.company_permission(c,
    case when action='purchase_plan' then 'read' else 'write' end,'inventory') then
  raise exception 'Orden de compra no autorizada' using errcode='42501';
 end if;
 if action='purchase_plan' then
  return coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('material',m.name,'sku',m.sku,
    'supplier',s.name,'unit',u.symbol) order by p.purchased,p.created_at,p.id)
    from access_private.purchase_order_lines p
    join public.raw_materials m on m.company_id=p.company_id and m.id=p.material_id
    join public.units u on u.company_id=p.company_id and u.id=p.unit_id
    left join public.business_partners s on s.company_id=p.company_id and s.id=p.supplier_id
    where p.company_id=c),'[]');
 elsif action='purchase_plan_save' then
  if jsonb_typeof(data->'lines') is distinct from 'array' or jsonb_array_length(data->'lines') not between 1 and 100 then
   raise exception 'Agrega entre 1 y 100 materiales';
  end if;
  for line in select value from jsonb_array_elements(data->'lines') loop
   target:=nullif(line->>'id','')::uuid;
   material:=(line->>'material_id')::uuid;
   supplier:=nullif(line->>'supplier_id','')::uuid;
   unit:=(line->>'unit_id')::uuid;
   if not exists(select from public.raw_materials m join public.units base on base.company_id=m.company_id and base.id=m.unit_id
      join public.units u on u.company_id=m.company_id and u.id=unit and u.active and u.dimension=base.dimension
      where m.company_id=c and m.id=material and m.active) then
    raise exception 'Selecciona un material y una unidad compatibles de esta empresa';
   end if;
   if supplier is not null and not exists(select from public.business_partners where company_id=c and id=supplier and is_supplier and active) then
    raise exception 'Selecciona un proveedor activo de esta empresa';
   end if;
   if target is null then
    insert into access_private.purchase_order_lines(company_id,material_id,supplier_id,quantity,unit_id,notes)
      values(c,material,supplier,(line->>'quantity')::numeric,unit,coalesce(line->>'notes',''))
      returning id into target;
   else
    update access_private.purchase_order_lines set material_id=material,supplier_id=supplier,
      quantity=(line->>'quantity')::numeric,unit_id=unit,notes=coalesce(line->>'notes',''),revision=revision+1
      where company_id=c and id=target and revision=(line->>'revision')::int;
    if not found then raise exception 'La línea cambió; actualiza la orden antes de editar';end if;
   end if;
   result_ids:=result_ids||jsonb_build_array(target);
  end loop;
  return jsonb_build_object('ids',result_ids);
 elsif action in ('purchase_plan_mark','purchase_plan_delete') then
  target:=(data->>'id')::uuid; expected:=(data->>'revision')::int;
  if action='purchase_plan_delete' then
   delete from access_private.purchase_order_lines where company_id=c and id=target and revision=expected;
  else
   if jsonb_typeof(data->'purchased') is distinct from 'boolean' then raise exception 'Indica el estado de la línea';end if;
   update access_private.purchase_order_lines set purchased=(data->>'purchased')::boolean,revision=revision+1
     where company_id=c and id=target and revision=expected;
  end if;
  if not found then raise exception 'La línea cambió; actualiza la orden';end if;
  return jsonb_build_object('id',target);
 end if;
 raise exception 'Acción de orden de compra inválida';
end;
$$;
revoke all on function access_private.purchase_planning(uuid,text,jsonb) from public,anon,authenticated;

do $migration$
declare definition text:=pg_get_functiondef('access_private.operations(uuid,text,uuid,jsonb)'::regprocedure);
begin
 if strpos(definition,$s$'receive_document'$s$)=0 or strpos(definition,$s$ elsif p_action='purchase_documents' then$s$)=0 then
  raise exception 'No se encontró el flujo de compras';
 end if;
 definition:=replace(definition,$s$'purchase_documents','receive_document'$s$,
   $s$'purchase_documents','receive_document','purchase_plan','purchase_plan_save','purchase_plan_mark','purchase_plan_delete'$s$);
 definition:=replace(definition,$s$'receipts','purchase_documents','formulas'$s$,
   $s$'receipts','purchase_documents','purchase_plan','formulas'$s$);
 definition:=replace(definition,$s$ elsif p_action='purchase_documents' then$s$,
   $s$ elsif p_action='purchase_plan' then return access_private.purchase_planning(p_company,p_action,p_data);
 elsif p_action='purchase_documents' then$s$);
 definition:=replace(definition,$s$ elsif p_action='receive_document' then$s$,
   $s$ elsif p_action in ('purchase_plan_save','purchase_plan_mark','purchase_plan_delete') then
  v_result:=access_private.purchase_planning(p_company,p_action,p_data);
 elsif p_action='receive_document' then$s$);
 execute definition;
end;
$migration$;
