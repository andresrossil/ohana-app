-- Keep draft edits and financial confirmation in one transaction.
create function public.finalize_courier_settlement(p_company uuid,p_key uuid,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  cached access_private.operation_requests%rowtype;
  saved jsonb;
  result jsonb;
  doc public.courier_settlements%rowtype;
begin
  if auth.uid() is null or not coalesce(public.company_permission(p_company,'write','sales'),false) then
    raise exception 'Liquidación no autorizada' using errcode='42501';
  end if;
  if p_key is null or jsonb_typeof(p_data) is distinct from 'object' or length(p_data::text)>200000 then
    raise exception 'Solicitud de liquidación inválida';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company::text,0));
  select * into cached from access_private.operation_requests where company_id=p_company and key=p_key;
  if found then
    if cached.action<>'finalize_courier_settlement' or cached.payload<>p_data then
      raise exception 'Identificador utilizado con otros datos';
    end if;
    return cached.result;
  end if;
  saved:=access_private.settlement_engine(p_company,'settlement_save',gen_random_uuid(),
    (p_data->'draft')||jsonb_build_object('admin_draft',true,'cash_discrepancies_confirmed',false));
  select * into strict doc from public.courier_settlements where company_id=p_company and id=(saved->>'id')::uuid;
  if doc.collected is distinct from (p_data->>'expected_collected')::numeric
    or doc.shipping_cost is distinct from (p_data->>'expected_shipping')::numeric then
    raise exception 'Cambió el efectivo o el costo de envío. Cierra y vuelve a abrir la liquidación para revisar los importes';
  end if;
  result:=access_private.settlement_engine(p_company,'settlement_confirm',gen_random_uuid(),
    jsonb_build_object('id',doc.id,'expected_revision',doc.revision,'admin_complete',true,
      'actual_amount',abs(doc.net),'method',p_data->>'method',
      'exchange_date',p_data->>'exchange_date','exchange_notes',p_data->>'exchange_notes'));
  insert into access_private.operation_requests(company_id,key,action,payload,result)
    values(p_company,p_key,'finalize_courier_settlement',p_data,result);
  return result;
end $$;
revoke all on function public.finalize_courier_settlement(uuid,uuid,jsonb) from public,anon;
grant execute on function public.finalize_courier_settlement(uuid,uuid,jsonb) to authenticated;
