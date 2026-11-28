-- Run only in a disposable database with the complete migration history.
begin;
insert into auth.users(id,email,email_confirmed_at)
values('15000000-0000-0000-0000-000000000001','admin-workflow@example.invalid',now());
insert into public.corporations(id,name)
values('25000000-0000-0000-0000-000000000001','Fixture'),('25000000-0000-0000-0000-000000000002','Other');
insert into public.corporation_members(corporation_id,user_id)
values('25000000-0000-0000-0000-000000000001','15000000-0000-0000-0000-000000000001');
insert into public.companies(id,name,corporation_id)
values('35000000-0000-0000-0000-000000000001','Fixture','25000000-0000-0000-0000-000000000001'),
('35000000-0000-0000-0000-000000000002','Other','25000000-0000-0000-0000-000000000002');
insert into public.products(id,company_id,name,sku,published)
values('45000000-0000-0000-0000-000000000001','35000000-0000-0000-0000-000000000001','Test product','P0001',true);
insert into public.business_partners(id,company_id,name,is_courier,courier_tariff_mode)
values('55000000-0000-0000-0000-000000000001','35000000-0000-0000-0000-000000000001','Synthetic courier',true,'general');
select set_config('request.jwt.claim.sub','15000000-0000-0000-0000-000000000001',true);
do $$
declare c uuid:='35000000-0000-0000-0000-000000000001'; v uuid; result jsonb; u uuid; m uuid; f uuid; p uuid;
begin
  result:=public.operations(c,'variant_save',gen_random_uuid(),
    '{"product":"45000000-0000-0000-0000-000000000001","name":"Small","published":true,"price":20}');
  v:=(result->>'id')::uuid;
  if not exists(select 1 from public.price_lists where company_id=c and is_base) then
    insert into public.price_lists(company_id,name,is_base) values(c,'BASE',true);
  end if;
  insert into public.price_list_entries(company_id,list_id,variant_id,price,currency)
    select c,id,v,20,'GTQ' from public.price_lists where company_id=c and is_base;
  insert into public.units(company_id,name,symbol,dimension,base_factor)
    values(c,'Gramo de prueba','g','mass',1) returning id into u;
  insert into public.raw_materials(company_id,name,unit_id) values(c,'Synthetic material',u) returning id into m;
  insert into public.presentations(company_id,raw_material_id,unit_id,name,quantity)
    values(c,m,u,'Synthetic quote',100) returning id into p;
  insert into public.price_history(company_id,presentation_id,amount,currency,effective_on) values(c,p,20,'GTQ',current_date);
  insert into public.formulas(company_id,product_id,name,version,standard_yield,state,estimated_units)
    values(c,'45000000-0000-0000-0000-000000000001','Synthetic formula',1,10,'current',10) returning id into f;
  insert into public.formula_ingredients(company_id,formula_id,material_id,quantity,unit_id)
    values(c,f,m,100,u);
  perform access_private.post_stock(c,'variant',v,10,0,0,'test_fixture',gen_random_uuid(),5,'Synthetic stock');
end $$;
set local role authenticated;
do $$
declare c uuid:='35000000-0000-0000-0000-000000000001'; v uuid; o uuid; second_order uuid;
  order_id uuid; revision int; payload jsonb; payment jsonb; key uuid:=gen_random_uuid(); before_qty numeric;
begin
  select id into strict v from public.product_variants where company_id=c;
  payload:=jsonb_build_object('draft',true,'customer',jsonb_build_object('name','Synthetic Customer','phone','+50255551234'),
    'payment','cash','delivery','pickup','delivery_info',jsonb_build_object('kind','pickup'),'discount',jsonb_build_object('mode','amount','value',0),'items',jsonb_build_array(jsonb_build_object('variant',v,'quantity',2,'unit_price',20)));
  o:=(public.sales(c,'create',gen_random_uuid(),payload)->>'id')::uuid;
  second_order:=(public.sales(c,'create',gen_random_uuid(),payload)->>'id')::uuid;
  if (select reserved from public.inventory_balances where company_id=c and item_id=v)<>0 then raise exception 'Pedido reservó inventario';end if;
  for order_id in select unnest(array[o,second_order]) loop
    select s.revision into revision from public.sales_orders s where s.id=order_id;
    perform public.sales_fulfillment(c,'confirm_customer',gen_random_uuid(),
      jsonb_build_object('order',order_id,'expected_stage','draft','expected_revision',revision));
  end loop;
  if (select reserved from public.inventory_balances where company_id=c and item_id=v)<>4 then raise exception 'Reserva incorrecta';end if;
  payload:=jsonb_build_object('order',o,'expected_stage','invoiced','gifts',
    jsonb_build_array(jsonb_build_object('variant',v,'quantity',1)));
  order_id:=gen_random_uuid();
  perform public.sales_fulfillment(c,'finish',order_id,payload);
  perform public.sales_fulfillment(c,'finish',order_id,payload);
  if not exists(select 1 from public.sales_orders where id=o and fulfillment_stage='finished')
    or (select count(*) from public.order_lines l where l.company_id=c and l.order_id=o and l.is_gift)<>1 then
    raise exception 'El estado preparado o el regalo no se conservó, o se duplicó';
  end if;
  select on_hand into before_qty from public.inventory_balances where company_id=c and item_id=v;
  if before_qty<>7 or (select reserved from public.inventory_balances where company_id=c and item_id=v)<>2 then raise exception 'Salida incorrecta';end if;
  payment:=jsonb_build_object('method','transfer','date',current_date,'payments',jsonb_build_array(
    jsonb_build_object('order',o,'amount',40,'expected_due',40),
    jsonb_build_object('order',second_order,'amount',10,'expected_due',40)));
  perform public.register_admin_payments(c,key,payment);
  perform public.register_admin_payments(c,key,payment);
  if (select count(*) from public.order_payments where company_id=c and confirmed and voided_at is null)<>2 then raise exception 'Pagos duplicados o faltantes';end if;
  if (select on_hand from public.inventory_balances where company_id=c and item_id=v)<>before_qty then raise exception 'El pago movió inventario';end if;
  begin
    perform public.register_admin_payments('35000000-0000-0000-0000-000000000002',gen_random_uuid(),payment);
    raise exception 'Pago cruzado aceptado';
  exception when insufficient_privilege then null;
  end;
  set constraints all immediate;
  if not exists(select 1 from public.fund_movements fm where fm.company_id=c and fm.order_id=o and kind='sale') then
    raise exception 'Pago directo no distribuyó fondos';
  end if;
  if (select sum(amount) from public.fund_movements fm where fm.company_id=c and fm.order_id=o and kind='sale')<>40 then
    raise exception 'El reparto no conserva la mercancía cobrada';
  end if;
  if (select sum(amount) from public.fund_movements fm where fm.company_id=c and fm.order_id=o and fund_key='materials')<>4 then
    raise exception 'El regalo modificó el reparto de materia prima';
  end if;
  if exists(select 1 from public.fund_movements fm where fm.company_id=c and fm.order_id=second_order) then
    raise exception 'Pago parcial distribuyó fondos prematuramente';
  end if;
  begin
    perform public.register_admin_payments(c,gen_random_uuid(),payment);
    raise exception 'Se aceptaron pagos duplicados con otra llave';
  exception when others then
    if sqlerrm='Se aceptaron pagos duplicados con otra llave' then raise; end if;
  end;
  select jsonb_build_object('id',id,'reason','Reversión de pago sintético') into payload
    from public.order_payments where company_id=c and order_payments.order_id=o and confirmed;
  perform public.courier_operations(c,'payment_void',gen_random_uuid(),payload);
  if (select sum(amount) from public.fund_movements fm where fm.company_id=c and fm.order_id=o)<>0 then
    raise exception 'Anular el pago no revirtió fondos';
  end if;
  perform public.company_dashboard(c);
  perform public.partners(c,'list','{"type":"customer","q":"Synthetic"}');
end $$;
do $$
declare c uuid:='35000000-0000-0000-0000-000000000001'; courier uuid:='55000000-0000-0000-0000-000000000001';
  v uuid; o uuid; revision int; sid uuid; payload jsonb; caught boolean:=false; initial_qty numeric;
begin
  select id into strict v from public.product_variants where company_id=c;
  payload:=jsonb_build_object('draft',true,'customer',jsonb_build_object('name','Route Customer','phone','+50255551235'),
    'payment','cash','delivery','delivery','delivery_info',jsonb_build_object('kind','courier','courier_id',courier,
      'address','Synthetic address','shipping_cost',5,'shipping_charged',0,'payer','ohana'),
    'items',jsonb_build_array(jsonb_build_object('variant',v,'quantity',1,'unit_price',20)));
  o:=(public.sales(c,'create',gen_random_uuid(),payload)->>'id')::uuid;
  select s.revision into revision from public.sales_orders s where s.id=o;
  perform public.sales_fulfillment(c,'confirm_customer',gen_random_uuid(),jsonb_build_object('order',o,'expected_stage','draft','expected_revision',revision));
  select on_hand into initial_qty from public.inventory_balances where company_id=c and item_id=v;
  if not exists(select 1 from jsonb_array_elements(public.courier_operations(c,'pending',null,jsonb_build_object('courier',courier)))
    e where e->>'order_id'=o::text and (e->>'needs_preparation')::boolean) then raise exception 'Factura faltante en ruta';end if;
  sid:=(public.courier_operations(c,'settlement_save',gen_random_uuid(),
    jsonb_build_object('admin_draft',true,'courier',courier,'date',current_date,'orders',jsonb_build_array(jsonb_build_object('order',o))))->>'id')::uuid;
  if (select on_hand from public.inventory_balances where company_id=c and item_id=v)<>initial_qty then raise exception 'El borrador descargó inventario';end if;
  payload:=jsonb_build_object('id',sid,'admin_complete',true,'actual_amount',5,'method','cash','exchange_date',current_date);
  begin
    perform public.courier_operations(c,'settlement_confirm',gen_random_uuid(),payload);
  exception when others then
    if sqlerrm not like 'Confirma la preparación%' then raise;end if;
    caught:=true;
  end;
  if not caught then raise exception 'Liquidación aceptó una factura sin preparar';end if;
  perform public.sales_fulfillment(c,'finish',gen_random_uuid(),jsonb_build_object('order',o,'expected_stage','invoiced'));
  payload:=jsonb_build_object('draft',jsonb_build_object('id',sid,
    'expected_revision',(select st.revision from public.courier_settlements st where st.id=sid),
    'courier',courier,'date',current_date,'orders',jsonb_build_array(jsonb_build_object('order',o,'mark_collected',true,'extra_cash',20))),
    'expected_collected',20,'expected_shipping',5,'method','transfer','exchange_date',current_date);
  begin
    perform public.finalize_courier_settlement(c,gen_random_uuid(),jsonb_set(payload,'{expected_shipping}','6'));
    raise exception 'Se aceptó un importe desactualizado';
  exception when others then
    if sqlerrm not like 'Cambió el efectivo%' then raise;end if;
  end;
  if (select st.revision from public.courier_settlements st where st.id=sid)<>(payload#>>'{draft,expected_revision}')::int then
    raise exception 'El intento fallido modificó el borrador';
  end if;
  declare retry_key uuid:=gen_random_uuid(); first_result jsonb;
  begin
    first_result:=public.finalize_courier_settlement(c,retry_key,payload);
    if first_result<>public.finalize_courier_settlement(c,retry_key,payload) then raise exception 'Reintento inconsistente';end if;
  end;
  if (select count(*) from public.courier_account_movements where settlement_id=sid)<>2 then
    raise exception 'Se duplicaron movimientos del mensajero';
  end if;
  if (select state from public.courier_settlements where id=sid)<>'settled' then raise exception 'No liquidada';end if;
  if (select count(*) from public.order_payments where company_id=c and order_id=o and receiver='courier' and confirmed)<>1 then raise exception 'Cobro de ruta incorrecto';end if;
  if (select on_hand from public.inventory_balances where company_id=c and item_id=v)<>initial_qty-1 then raise exception 'Liquidación descargó inventario';end if;
  set constraints all immediate;
  if (select sum(amount) from public.fund_movements fm where fm.company_id=c and fm.order_id=o)<>20 then
    raise exception 'La liquidación no repartió lo cobrado';
  end if;
  perform public.courier_operations(c,'settlement_cancel',gen_random_uuid(),jsonb_build_object('id',sid,'reason','Anulación sintética'));
  if (select sum(amount) from public.fund_movements fm where fm.company_id=c and fm.order_id=o)<>0 then
    raise exception 'La anulación dejó dinero distribuido';
  end if;
  if (select on_hand from public.inventory_balances where company_id=c and item_id=v)<>initial_qty-1 then raise exception 'La anulación de ruta movió inventario';end if;
  perform public.sales_fulfillment(c,'revert',gen_random_uuid(),jsonb_build_object('order',o,'expected_stage','finished','reason','Revertir preparación sintética'));
  if (select on_hand from public.inventory_balances where company_id=c and item_id=v)<>initial_qty then raise exception 'No devolvió inventario';end if;
end $$;
do $$
declare c uuid:='35000000-0000-0000-0000-000000000001'; v uuid; o uuid; revision int;
  payload jsonb; reserved_before numeric; qty_before numeric;
begin
  select id into strict v from public.product_variants where company_id=c;
  select reserved,on_hand into reserved_before,qty_before from public.inventory_balances where company_id=c and item_id=v;
  payload:=jsonb_build_object('draft',true,'customer',jsonb_build_object('name','Edit Customer','phone','+50255551236'),
    'payment','cash','delivery','pickup','delivery_info',jsonb_build_object('kind','pickup'),'discount',jsonb_build_object('mode','amount','value',0),'items',jsonb_build_array(jsonb_build_object('variant',v,'quantity',1,'unit_price',20)));
  o:=(public.sales(c,'create',gen_random_uuid(),payload)->>'id')::uuid;
  select s.revision into revision from public.sales_orders s where s.id=o;
  perform public.edit_sale(c,gen_random_uuid(),payload||jsonb_build_object('order',o,'expected_revision',revision,'expected_total',20));
  if (select reserved from public.inventory_balances where company_id=c and item_id=v)<>reserved_before then raise exception 'Se reservó al editar un pedido';end if;
  select s.revision into revision from public.sales_orders s where s.id=o;
  perform public.sales_fulfillment(c,'confirm_customer',gen_random_uuid(),jsonb_build_object('order',o,'expected_stage','draft','expected_revision',revision));
  select s.revision into revision from public.sales_orders s where s.id=o;
  perform public.edit_sale(c,gen_random_uuid(),payload||jsonb_build_object('order',o,'expected_revision',revision,
    'expected_total',40,'items',jsonb_build_array(jsonb_build_object('variant',v,'quantity',2,'unit_price',20))));
  if (select reserved from public.inventory_balances where company_id=c and item_id=v)<>reserved_before+2 then raise exception 'No ajustó la reserva';end if;
  perform public.sales(c,'cancel',gen_random_uuid(),jsonb_build_object('order',o,'reason','Cancelación sintética'));
  if (select reserved from public.inventory_balances where company_id=c and item_id=v)<>reserved_before then raise exception 'No liberó la reserva';end if;
  if (select on_hand from public.inventory_balances where company_id=c and item_id=v)<>qty_before then raise exception 'Editó existencia física';end if;
end $$;
do $$
declare c uuid:='35000000-0000-0000-0000-000000000001'; courier uuid:='55000000-0000-0000-0000-000000000001';
  v uuid; o uuid; other_order uuid; sid uuid; second_sid uuid; revision int; payload jsonb; list jsonb; mode text;
begin
  select id into strict v from public.product_variants where company_id=c;
  foreach mode in array array['cash','transfer'] loop
    payload:=jsonb_build_object('draft',true,'customer',jsonb_build_object('name','Mixed Route','phone','+50255551237'),
      'payment',mode,'delivery','delivery','delivery_info',jsonb_build_object('kind','courier','courier_id',courier,
        'address','Synthetic address','shipping_cost',case when mode='cash' then 15 else 5 end,'shipping_charged',0,'payer','ohana'),
      'items',jsonb_build_array(jsonb_build_object('variant',v,'quantity',1,'unit_price',20)));
    o:=(public.sales(c,'create',gen_random_uuid(),payload)->>'id')::uuid;
    select s.revision into revision from public.sales_orders s where s.id=o;
    perform public.sales_fulfillment(c,'confirm_customer',gen_random_uuid(),jsonb_build_object('order',o,'expected_stage','draft','expected_revision',revision));
    perform public.sales_fulfillment(c,'finish',gen_random_uuid(),jsonb_build_object('order',o,'expected_stage','invoiced'));
    if mode='cash' then other_order:=o;
    else perform public.courier_operations(c,'payment_add',gen_random_uuid(),
      jsonb_build_object('order',o,'amount',20,'expected_due',20,'method','transfer','receiver','ohana','confirmed',true,'received_on',current_date));
    end if;
  end loop;
  payload:=jsonb_build_object('admin_draft',true,'courier',courier,'date',current_date);
  list:=jsonb_build_array(jsonb_build_object('order',other_order,'mark_collected',true,'extra_cash',20),jsonb_build_object('order',o));
  sid:=(public.courier_operations(c,'settlement_save',gen_random_uuid(),payload||jsonb_build_object('orders',list))->>'id')::uuid;
  if (select net from public.courier_settlements where id=sid)<>0 then raise exception 'Neto mixto de cero incorrecto';end if;
  -- Remove the transferred invoice from the draft and add it to a different draft.
  perform public.courier_operations(c,'settlement_save',gen_random_uuid(),payload||jsonb_build_object('id',sid,'orders',jsonb_build_array(list->0)));
  second_sid:=(public.finalize_courier_settlement(c,gen_random_uuid(),
    jsonb_build_object('draft',payload||jsonb_build_object('orders',jsonb_build_array(list->1)),
      'expected_collected',0,'expected_shipping',5,'method','cash','exchange_date',current_date))->>'id')::uuid;
  if (select net from public.courier_settlements where id=second_sid)<>-5 then raise exception 'La transferencia entró como efectivo';end if;
  if (select state from public.courier_settlements where id=second_sid)<>'settled' then raise exception 'No liquidó saldo a favor del mensajero';end if;
  begin
    perform public.courier_operations(c,'settlement_save',gen_random_uuid(),payload||jsonb_build_object('orders',jsonb_build_array(list->1)));
    raise exception 'Liquidación duplicada aceptada';
  exception when others then
    if sqlerrm='Liquidación duplicada aceptada' then raise;end if;
  end;
  perform public.courier_operations(c,'settlement_cancel',gen_random_uuid(),
    jsonb_build_object('id',second_sid,'reason','Anulación de liquidación sintética'));
  perform public.finalize_courier_settlement(c,gen_random_uuid(),
    jsonb_build_object('draft',payload||jsonb_build_object('id',sid,
      'expected_revision',(select st.revision from public.courier_settlements st where st.id=sid),'orders',list),
      'expected_collected',20,'expected_shipping',20,'method','cash','exchange_date',current_date));
  if (select state from public.courier_settlements where id=sid)<>'settled'
    or exists(select 1 from public.courier_account_movements where settlement_id=sid and kind='exchange') then
    raise exception 'La liquidación en cero generó un intercambio';
  end if;
end $$;
select public.store_settings('35000000-0000-0000-0000-000000000001','{"published":true,"pickup":true,"delivery":true}');
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $$
declare c uuid:='35000000-0000-0000-0000-000000000001'; v uuid; result jsonb; key uuid:=gen_random_uuid(); payload jsonb;
begin
  v:=(public.storefront(c)#>>'{products,0,variants,0,id}')::uuid;
  if v is null then raise exception 'Tienda de prueba sin variante';end if;
  payload:=jsonb_build_object('customer',jsonb_build_object('name','Store Fixture','phone','+50255551239'),
    'payment','cash','delivery','pickup','delivery_info',jsonb_build_object('kind','pickup'),'discount',jsonb_build_object('mode','amount','value',0),'items',jsonb_build_array(jsonb_build_object('variant',v,'quantity',1)));
  result:=public.checkout(c,key,payload);
  if result->>'id' is null or (result->>'total')::numeric<>20 or public.checkout(c,key,payload)<>result then
    raise exception 'Regresión de checkout';
  end if;
end $$;
reset role;
do $$
begin
  if not exists(select 1 from public.sales_orders o join public.order_lines l on l.company_id=o.company_id and l.order_id=o.id
      where o.customer_snapshot->>'name'='Store Fixture' and o.fulfillment_stage='invoiced' and l.reserved_quantity=1) then
    raise exception 'Checkout perdió su reserva';
  end if;
end $$;
rollback;
