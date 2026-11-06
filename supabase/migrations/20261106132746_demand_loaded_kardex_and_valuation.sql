-- Dedicated read actions avoid loading movements, physical history or valuation together.
CREATE OR REPLACE FUNCTION access_private.inventory_command(c uuid, action text, data jsonb, k uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare review jsonb;r jsonb;answer jsonb;cached access_private.operation_requests%rowtype;docid uuid;lineid uuid;move jsonb;lotid uuid;unitid uuid;n bigint;sgn numeric;items jsonb;total bigint;page integer;
begin
 if auth.uid() is null or not public.company_permission(c,case when action in('review','confirm') then 'write' else 'read' end,'inventory') then raise exception 'No tienes permiso para esta empresa';end if;
 if action in('cancellation_info','cancel_document') then return access_private.document_cancellation(c,case when action='cancellation_info' then 'info' else 'confirm' end,k,data);end if;
 if action='kardex_options' then
 return jsonb_build_object(
 'materials',(select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'sku',m.sku,'name',m.name) order by m.name),'[]') from public.raw_materials m where m.company_id=c),
 'variants',(select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'sku',v.sku,'product_id',v.product_id,'product_name',p.name,'label',access_private.variant_label(to_jsonb(v))) order by p.name),'[]') from public.product_variants v join public.products p on p.company_id=c and p.id=v.product_id where v.company_id=c));
 elsif action='stock_valuation' then return jsonb_build_object('stock',(select coalesce(jsonb_agg(jsonb_build_object('item_kind',b.item_kind,'item_id',b.item_id,'on_hand',b.on_hand,'blocked',b.blocked,'reserved',b.reserved,'available',b.on_hand-b.blocked-b.reserved,'known_value',(select sum(l.remaining*l.unit_cost) from public.inventory_lots l where l.company_id=c and l.item_kind=b.item_kind and l.item_id=b.item_id),'pending_cost',(select coalesce(sum(abs(l.remaining)),0) from public.inventory_lots l where l.company_id=c and l.item_kind=b.item_kind and l.item_id=b.item_id and l.unit_cost is null))),'[]') from public.inventory_balances b where b.company_id=c));
 elsif action='catalog' then
  return jsonb_build_object(
   'materials',(select coalesce(jsonb_agg(to_jsonb(m)||jsonb_build_object('suggested_cost',(select s.unit_price*bu.base_factor/s.base_factor from public.material_sheet s join public.units bu on bu.company_id=c and bu.id=m.unit_id where s.company_id=c and s.raw_material_id=m.id and s.active and s.effective_on<=current_date and s.currency=cp.currency and s.unit_price is not null order by s.effective_on desc,s.price_created_at desc limit 1)) order by m.name),'[]') from public.raw_materials m join public.companies cp on cp.id=c where m.company_id=c),
   'variants',(select coalesce(jsonb_agg(to_jsonb(v)||jsonb_build_object('product_name',p.name,'label',access_private.variant_label(to_jsonb(v)),'suggested_cost',(select l.unit_cost from public.inventory_lots l where l.company_id=c and l.item_kind='variant' and l.item_id=v.id and l.unit_cost is not null order by l.created_at desc limit 1)) order by p.name),'[]') from public.product_variants v join public.products p on p.company_id=v.company_id and p.id=v.product_id where v.company_id=c),
   'units',(select coalesce(jsonb_agg(to_jsonb(u) order by u.name),'[]') from public.units u where u.company_id=c and u.active),
   'lots',(select coalesce(jsonb_agg(to_jsonb(l) order by l.created_at),'[]') from public.inventory_lots l where l.company_id=c),
   'physical',(select coalesce(jsonb_agg(to_jsonb(u) order by u.created_at),'[]') from public.inventory_units u where u.company_id=c and u.status='available'));
 elsif action='review' then
  review:=access_private.inventory_document_review(c,data);return review||jsonb_build_object('proof',md5(review::text));
 elsif action='confirm' then
  if k is null then raise exception 'Falta identificador de operación';end if;
  perform pg_advisory_xact_lock(hashtextextended(c::text,0));
  if not public.company_permission(c,'write','inventory') then raise exception 'Permiso revocado';end if;
  select * into cached from access_private.operation_requests where company_id=c and key=k;
  if found then if cached.action<>'inventory_confirm' or cached.payload<>data then raise exception 'Identificador de operación utilizado con otros datos';end if;return cached.result;end if;
  review:=access_private.inventory_document_review(c,data);
  if data->>'proof' is distinct from md5(review::text) then raise exception 'Los datos o las existencias cambiaron. Revisa nuevamente antes de confirmar';end if;
  if jsonb_array_length(review->'warnings')>0 and coalesce((data->>'acknowledged')::boolean,false)=false then raise exception 'Confirma las advertencias antes de continuar';end if;
  insert into access_private.inventory_document_counters(company_id,last_value) values(c,1) on conflict(company_id) do update set last_value=inventory_document_counters.last_value+1 returning last_value into n;
  insert into public.inventory_documents(company_id,number,kind,effective_on,reason,notes,reverses_id,corrects_id,created_by) values(c,n,review->>'kind',(review->>'date')::date,review->>'reason',review->>'notes',(review->>'reverses_id')::uuid,(review->>'corrects_id')::uuid,auth.uid()) returning id into docid;
  for r in select value from jsonb_array_elements(review->'lines') loop
   lineid:=case when review->>'kind'='reversal' then gen_random_uuid() else (r->>'line_key')::uuid end;sgn:=(r->>'direction')::numeric;
   insert into public.inventory_document_lines(id,company_id,document_id,line_number,item_kind,item_id,material_id,variant_id,input_unit_id,quantity,base_quantity,unit_cost,base_unit_cost,total_value,currency,lot_id,individual_unit_id,weight,external_code,notes,snapshot)
   values(lineid,c,docid,(r->>'line_number')::integer,r->>'item_kind',(r->>'item_id')::uuid,(r->>'material_id')::uuid,(r->>'variant_id')::uuid,(r->>'input_unit_id')::uuid,(r->>'quantity')::numeric,(r->>'base_quantity')::numeric,(r->>'unit_cost')::numeric,(r->>'base_unit_cost')::numeric,(r->>'total_value')::numeric,r->>'currency',(r->>'lot_id')::uuid,(r->>'individual_unit_id')::uuid,(r->>'weight')::numeric,r->>'external_code',r->>'notes',r->'snapshot');
   move:=access_private.post_stock_selected(c,r->>'item_kind',(r->>'item_id')::uuid,sgn*(r->>'base_quantity')::numeric,0,0,'inventory_document',lineid,(r->>'base_unit_cost')::numeric,r->>'notes',(r->>'lot_id')::uuid,(r->>'individual_unit_id')::uuid);
   lotid:=coalesce((move->>'lot')::uuid,(r->>'lot_id')::uuid);unitid:=(r->>'individual_unit_id')::uuid;
   update public.inventory_document_lines set movement_id=(move->>'movement')::uuid,lot_id=lotid where company_id=c and id=lineid;
   if sgn=1 then
    if review->>'kind'<>'reversal' then update public.inventory_lots set label=r->>'lot_label' where company_id=c and id=lotid;end if;
    if unitid is not null then
     update public.inventory_units set status='available',last_movement_id=(move->>'movement')::uuid where company_id=c and id=unitid;
    elsif r->>'item_kind'='variant' and r->>'weight' is not null then
     insert into public.inventory_units(company_id,lot_id,variant_id,weight,variant_snapshot,cost_snapshot,status,last_movement_id,external_code)
     select c,lotid,v.id,(r->>'weight')::numeric,to_jsonb(v)||jsonb_build_object('name',access_private.variant_label(to_jsonb(v)),'product_name',p.name,'origin_document',docid),jsonb_build_object('manufacturing_cost',(r->>'base_unit_cost')::numeric,'currency',r->>'currency','cost_basis','inventory_document'),'available',(move->>'movement')::uuid,r->>'external_code' from public.product_variants v join public.products p on p.company_id=v.company_id and p.id=v.product_id where v.company_id=c and v.id=(r->>'item_id')::uuid returning id into unitid;
     update public.inventory_document_lines set individual_unit_id=unitid where company_id=c and id=lineid;
    end if;
   end if;
  end loop;
  update public.inventory_documents set state='confirmed' where company_id=c and id=docid;
  answer:=jsonb_build_object('id',docid,'number',n,'state','confirmed');
  insert into access_private.operation_requests(company_id,key,action,payload,result) values(c,k,'inventory_confirm',data,answer);return answer;
 elsif action='source' then
  select x into r from access_private.inventory_ledger_rows(c)x where x->>'id'=data->>'id';
  if r is null then raise exception 'Movimiento no disponible';end if;
  return jsonb_build_object('movement',r,'reversal',(select (to_jsonb(dc)-'snapshot')||jsonb_build_object('original_movement_id',dc.snapshot#>>'{effects,0,original_movement_id}') from public.document_cancellations dc where dc.company_id=c and dc.id=nullif(r->>'source_document_id','')::uuid and r->>'source_kind'='document_reversal'),'cancellation',access_private.document_cancellation(c,'info',null,jsonb_build_object('movement_id',r->>'id')),'lines',(select jsonb_agg(x order by x->>'created_at') from access_private.inventory_ledger_rows(c)x where x->>'source_document_id'=r->>'source_document_id' and not(x->>'source_kind'='release' and coalesce((x->>'entry')::numeric,0)=0 and coalesce((x->>'exit')::numeric,0)=0)),
  'reference',case when r->>'source_kind'='receipt' then(select pr.reference from public.purchase_receipts pr where pr.company_id=c and pr.id=(r->>'source_id')::uuid) else r->>'document_number' end);
 elsif action='detail' then
  return jsonb_build_object('header',(select to_jsonb(d)||jsonb_build_object('user_name',coalesce((select nullif(btrim(up.display_name),'') from public.user_profiles up where up.user_id=d.created_by),case when d.created_by is null then 'Histórico' else 'Usuario sin nombre registrado' end)) from public.inventory_documents d where d.company_id=c and d.id=(data->>'id')::uuid),'lines',(select coalesce(jsonb_agg(to_jsonb(l) order by l.line_number),'[]') from public.inventory_document_lines l where l.company_id=c and l.document_id=(data->>'id')::uuid),'reversal',(select id from public.inventory_documents where company_id=c and reverses_id=(data->>'id')::uuid));
 elsif action='ledger' then
  page:=greatest(coalesce((data->>'page')::integer,0),0);
  with ledger as materialized(select x from access_private.inventory_ledger_rows(c)x),filtered as(
   select x from ledger where not(x->>'source_kind'='release' and coalesce((x->>'entry')::numeric,0)=0 and coalesce((x->>'exit')::numeric,0)=0) and (nullif(data->>'from','') is null or (x->>'date')::date>=(data->>'from')::date) and (nullif(data->>'to','') is null or (x->>'date')::date<=(data->>'to')::date)
   and(nullif(data->>'kind','') is null or x->>'item_kind'=data->>'kind') and(nullif(data->>'item','') is null or x->>'item_id'=data->>'item')
   and(nullif(data->>'lot','') is null or x->'lots' ? (data->>'lot')) and(nullif(data->>'source','') is null or x->>'source_kind'=data->>'source')
   and(nullif(data->>'type','') is null or x->>'movement_type'=data->>'type' or(data->>'type' in('production_consumption','production_output') and x->>'source_kind'=data->>'type'))
   and(nullif(data->>'query','') is null or concat_ws(' ',x->>'sku',x->>'name',x->>'variant',x->>'document_number',x->'units') ilike '%'||(data->>'query')||'%'))
  select jsonb_build_object('total',(select count(*) from filtered),'rows',(select coalesce(jsonb_agg(x order by x->>'date' desc,x->>'created_at' desc,x->>'id' desc),'[]') from(select x from filtered order by x->>'date' desc,x->>'created_at' desc,x->>'id' desc limit 100 offset page*100)s),
  'stock','[]'::jsonb) into answer;return answer;
 end if;
 raise exception 'Acción no válida';
end $function$
;
