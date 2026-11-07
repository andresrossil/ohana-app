do $patch$
declare f text;anchor text;begin
 f:=pg_get_functiondef('access_private.settlement_engine(uuid,text,uuid,jsonb)'::regprocedure);
 anchor:='   select * into strict so from public.sales_orders where company_id=c and id=oid;';
 if strpos(f,anchor)=0 then raise exception 'Unexpected settlement validation';end if;
 f:=replace(f,anchor,$review$
   if extra>0 and extra<>(available->>'expected_cash')::numeric and not coalesce((data->>'cash_discrepancies_confirmed')::boolean,false) then raise exception 'Confirma el cobro diferente al saldo pendiente antes de guardar';end if;
$review$||anchor);execute f;
 f:=pg_get_functiondef('access_private.add_order_payment(uuid,uuid,jsonb)'::regprocedure);
 anchor:=' if info->>''receiver''=''courier'' and (d.courier_id is null';
 if strpos(f,anchor)=0 then raise exception 'Unexpected payment validation';end if;
 f:=replace(f,anchor,$closed$
 if info->>'receiver'='courier' and exists(select 1 from public.courier_settlement_items where company_id=c and order_id=o and active) then raise exception 'La ruta de esta factura ya está liquidada. Revierte la liquidación antes de registrar otro cobro del mensajero';end if;
$closed$||anchor);execute f;
end $patch$;
notify pgrst,'reload schema';
