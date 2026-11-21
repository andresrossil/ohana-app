-- A withdrawal may have the same fund key in several currencies.
drop index public.fund_manual_once;
create unique index fund_manual_once
  on public.fund_movements(company_id,operation_id,fund_key,currency)
  where kind in ('expense','transfer');

create function access_private.withdraw_all_funds(c uuid,k uuid,data jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare
  note text:=btrim(coalesce(data->>'description',''));
  ref text:=btrim(coalesce(data->>'reference',''));
  expected jsonb:=data->'balances';
  current_balances jsonb;
begin
  if auth.uid() is null or not public.company_permission(c,'manage') then
    raise exception 'Fondos no autorizados' using errcode='42501';
  end if;
  if k is null or length(note) not between 1 and 500 or length(ref)>200
    or jsonb_typeof(expected) is distinct from 'object' then
    raise exception 'Revisa los saldos, el concepto y la referencia';
  end if;

  -- Other ledger writers take a conflicting lock when inserting a movement.
  -- Hold the balances steady across verification and posting.
  lock table public.fund_movements in share row exclusive mode;
  if exists(select 1 from public.fund_movements
    where company_id=c and operation_id=k and kind in ('expense','transfer')) then
    if exists(select 1 from public.fund_movements
      where company_id=c and operation_id=k and detail->>'total_withdrawal'='true') then
      return;
    end if;
    raise exception 'El identificador ya corresponde a otro movimiento';
  end if;
  select jsonb_object_agg(currency||'/'||fund_key,balance)
    into current_balances from public.fund_balances where company_id=c and balance>0;
  if current_balances is null then
    raise exception 'No hay saldos positivos para retirar';
  end if;
  if current_balances is distinct from expected then
    raise exception 'Los saldos cambiaron. Revisa el desglose actualizado antes de confirmar';
  end if;
  if exists(select 1 from public.fund_balances where company_id=c and balance>1e20) then
    raise exception 'Un saldo supera el límite por movimiento';
  end if;

  insert into public.fund_movements
    (company_id,fund_key,fund_name,kind,currency,amount,occurred_on,created_by,description,reference,operation_id,detail)
  select c,fund_key,fund_name,'expense',currency,-balance,
    (now() at time zone 'America/Guatemala')::date,auth.uid(),note,ref,k,
    jsonb_build_object('total_withdrawal',true)
  from public.fund_balances where company_id=c and balance>0;
end $$;
revoke all on function access_private.withdraw_all_funds(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function access_private.withdraw_all_funds(uuid,uuid,jsonb) to authenticated;

create function public.withdraw_all_funds(p_company uuid,p_key uuid,p_data jsonb)
returns void language sql security invoker set search_path='' as $$
  select access_private.withdraw_all_funds(p_company,p_key,p_data)
$$;
revoke all on function public.withdraw_all_funds(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.withdraw_all_funds(uuid,uuid,jsonb) to authenticated;
