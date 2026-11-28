begin;
insert into auth.users(id,email,email_confirmed_at) values
 ('15000000-0000-0000-0000-000000000001','wtw-test@example.invalid',now()),
 ('15000000-0000-0000-0000-000000000002','wtw-viewer@example.invalid',now());
insert into public.corporations(id,name)
values('25000000-0000-0000-0000-000000000001','Fixture'),('25000000-0000-0000-0000-000000000002','Fixture 2');
insert into public.corporation_members(corporation_id,user_id)
values('25000000-0000-0000-0000-000000000001','15000000-0000-0000-0000-000000000001');
insert into public.companies(id,name,corporation_id)
values('35000000-0000-0000-0000-000000000001','Fixture','25000000-0000-0000-0000-000000000001'),
 ('35000000-0000-0000-0000-000000000002','Fixture 2','25000000-0000-0000-0000-000000000002');
insert into public.company_members(company_id,user_id,role)
values('35000000-0000-0000-0000-000000000001','15000000-0000-0000-0000-000000000002','viewer');
insert into public.units(id,company_id,name,symbol,dimension,base_factor) values
 ('45000000-0000-0000-0000-000000000001','35000000-0000-0000-0000-000000000001','Gramo prueba','g','mass',1),
 ('45000000-0000-0000-0000-000000000002','35000000-0000-0000-0000-000000000001','Kilogramo prueba','kg','mass',1000),
 ('45000000-0000-0000-0000-000000000003','35000000-0000-0000-0000-000000000001','Mililitro prueba','ml','volume',1);
insert into public.units(company_id,name,symbol,dimension,base_factor) values('35000000-0000-0000-0000-000000000001','Unidad de prueba','ud','count',1);
insert into public.raw_materials(id,company_id,name,unit_id) values
 ('55000000-0000-0000-0000-000000000001','35000000-0000-0000-0000-000000000001','Material A','45000000-0000-0000-0000-000000000001'),
 ('55000000-0000-0000-0000-000000000002','35000000-0000-0000-0000-000000000001','Material B','45000000-0000-0000-0000-000000000001');
insert into public.products(id,company_id,name,sku)
values('65000000-0000-0000-0000-000000000001','35000000-0000-0000-0000-000000000001','Producto de prueba','P0001');
select set_config('request.jwt.claim.sub','15000000-0000-0000-0000-000000000001',true);
do $$
declare c uuid:='35000000-0000-0000-0000-000000000001'; a uuid:='55000000-0000-0000-0000-000000000001';
b uuid:='55000000-0000-0000-0000-000000000002'; result jsonb;
begin
  result:=access_private.post_stock_selected(c,'material',a,1000,0,0,'test_fixture',gen_random_uuid(),2,'Fixture',null,null);
  update public.inventory_lots set label='Lote A' where id=(result->>'lot')::uuid;
  result:=access_private.post_stock_selected(c,'material',a,700,0,0,'test_fixture',gen_random_uuid(),3,'Fixture',null,null);
  update public.inventory_lots set label='Lote B' where id=(result->>'lot')::uuid;
  perform access_private.post_stock(c,'material',b,200,0,0,'test_fixture',gen_random_uuid(),4,'Fixture');
end $$;
set local role authenticated;
do $$
declare c uuid:='35000000-0000-0000-0000-000000000001'; a uuid:='55000000-0000-0000-0000-000000000001';
 b uuid:='55000000-0000-0000-0000-000000000002'; g uuid:='45000000-0000-0000-0000-000000000001';
 kg uuid:='45000000-0000-0000-0000-000000000002'; ml uuid:='45000000-0000-0000-0000-000000000003';
 s uuid; la uuid; lb uuid; eid uuid; k uuid:=gen_random_uuid(); payload jsonb; review jsonb; result jsonb; qty_before numeric;
begin
  s:=(public.wall_to_wall(c,'create',gen_random_uuid(),'{"description":"Conteo sintético"}')->>'id')::uuid;
  select id into strict la from public.inventory_lots where company_id=c and label='Lote A';
  select id into strict lb from public.inventory_lots where company_id=c and label='Lote B';
  payload:=jsonb_build_object('session',s,'entries',jsonb_build_array(
    jsonb_build_object('item_kind','material','item_id',a,'quantity',1,'unit_id',kg),
    jsonb_build_object('item_kind','material','item_id',a,'quantity',50,'unit_id',g),
    jsonb_build_object('item_kind','material','item_id',a,'quantity',400,'unit_id',g),
    jsonb_build_object('item_kind','material','item_id',a,'quantity',30,'unit_id',g)));
  result:=public.wall_to_wall(c,'add',k,payload);
  if result<>public.wall_to_wall(c,'add',k,payload) then raise exception 'Reintento no idempotente';end if;
  if jsonb_array_length(public.wall_to_wall(c,'detail',null,jsonb_build_object('session',s))->'entries')<>4 then
    raise exception 'Capturas repetidas o perdidas';end if;
  if (select on_hand from public.inventory_balances where company_id=c and item_id=a)<>1700 then raise exception 'Captura cambió el saldo';end if;
  review:=public.wall_to_wall(c,'review',null,jsonb_build_object('session',s));
  if not exists(select 1 from jsonb_array_elements(review->'rows') r where r->>'item_id'=a::text and (r->>'counted')::numeric=1480) then
    raise exception 'Conversión incorrecta';end if;
  if review is distinct from public.wall_to_wall(c,'review',null,jsonb_build_object('session',s)) then raise exception 'Consolidado no determinista';end if;
  begin
    perform public.wall_to_wall(c,'add',gen_random_uuid(),jsonb_build_object('session',s,'entries',jsonb_build_array(
      jsonb_build_object('item_kind','material','item_id',a,'unit_id',ml,'quantity',1))));
    raise exception 'Unidad incompatible aceptada';
  exception when others then if sqlerrm='Unidad incompatible aceptada' then raise;end if;end;
  eid:=(public.wall_to_wall(c,'add',gen_random_uuid(),jsonb_build_object('session',s,'entries',jsonb_build_array(
    jsonb_build_object('item_kind','material','item_id',b,'unit_id',g,'quantity',0))))->>'entry')::uuid;
  perform public.wall_to_wall(c,'edit',gen_random_uuid(),jsonb_build_object('session',s,'entry',eid,'revision',1,'unit_id',g,'quantity',0,'location','Estante'));
  begin
    perform public.wall_to_wall(c,'confirm',gen_random_uuid(),jsonb_build_object('session',s,'proof',review->>'proof','acknowledged',true));
    raise exception 'Confirmación desactualizada aceptada';
  exception when others then if sqlerrm='Confirmación desactualizada aceptada' then raise;end if;end;
  perform public.wall_to_wall(c,'delete',gen_random_uuid(),jsonb_build_object('session',s,'entry',eid,'revision',2));
  review:=public.wall_to_wall(c,'review',null,jsonb_build_object('session',s));
  payload:=jsonb_build_object('session',s,'proof',review->>'proof','acknowledged',true);
  k:=gen_random_uuid();
  result:=public.wall_to_wall(c,'confirm',k,payload);
  if result<>public.wall_to_wall(c,'confirm',k,payload) then raise exception 'Confirmación duplicada';end if;
  if (select remaining from public.inventory_lots where id=la)<>780 or (select unit_cost from public.inventory_lots where id=la)<>2
    or (select remaining from public.inventory_lots where id=lb)<>700 or (select unit_cost from public.inventory_lots where id=lb)<>3 then
    raise exception 'Se alteró lote o costo incorrecto';end if;
  if (select on_hand from public.inventory_balances where company_id=c and item_id=b)<>0 then
    raise exception 'No ajustó existencia omitida a cero';end if;
  if (select count(*) from public.inventory_movements where document_id=(result->>'document_id')::uuid)<>2 then
    raise exception 'Movimientos de Kardex ausentes o duplicados';end if;
  begin
    perform public.wall_to_wall('35000000-0000-0000-0000-000000000002','list');
    raise exception 'Acceso de otra empresa';
  exception when insufficient_privilege then null;end;
  perform set_config('request.jwt.claim.sub','15000000-0000-0000-0000-000000000002',true);
  begin
    perform public.wall_to_wall(c,'create',gen_random_uuid(),'{"description":"No permitido"}');
    raise exception 'Escritura sin permiso';
  exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','15000000-0000-0000-0000-000000000001',true);
do $$
declare c uuid:='35000000-0000-0000-0000-000000000001'; v uuid; l uuid; s uuid; b uuid;
  review jsonb; q jsonb; blocked boolean; result jsonb; entry_id uuid;
begin
  v:=(public.operations(c,'variant_save',gen_random_uuid(),
    '{"product":"65000000-0000-0000-0000-000000000001","name":"Normal"}')->>'id')::uuid;
  l:=(access_private.post_stock_selected(c,'variant',v,10,0,0,'test_fixture',gen_random_uuid(),6,'Producto',null,null)->>'lot')::uuid;
  perform access_private.post_stock(c,'variant',v,0,0,4,'test_reserve',gen_random_uuid());
  s:=(public.wall_to_wall(c,'create',gen_random_uuid(),'{"description":"Conteo de producto"}')->>'id')::uuid;
  q:=jsonb_build_object('session',s,'entries',jsonb_build_array(jsonb_build_object('item_kind','variant','item_id',v,'quantity',3)));
  entry_id:=(public.wall_to_wall(c,'add',gen_random_uuid(),q)->>'entry')::uuid;
  review:=public.wall_to_wall(c,'review',null,jsonb_build_object('session',s));
  if not exists(select 1 from jsonb_array_elements(review->'rows') r where r->>'item_id'=v::text and
    (r->>'difference')::numeric=-7 and (r->>'reservation_shortage')::numeric=1 and (r->>'protected')::boolean) then
    raise exception 'Reserva o diferencia incorrecta';end if;
  blocked:=false;
  begin
    perform public.wall_to_wall(c,'confirm',gen_random_uuid(),jsonb_build_object('session',s,'proof',review->>'proof','acknowledged',true));
  exception when others then if sqlerrm like 'Revisa los artículos%' then blocked:=true;else raise;end if;end;
  if not blocked then raise exception 'Permite romper reservas';end if;
  perform access_private.post_stock(c,'variant',v,-1,0,0,'test_movement',gen_random_uuid());
  review:=public.wall_to_wall(c,'review',null,jsonb_build_object('session',s));
  if not exists(select 1 from jsonb_array_elements(review->'rows') r where r->>'item_id'=v::text and (r->>'stale')::boolean) then
    raise exception 'No detectó movimiento posterior';end if;
  perform public.wall_to_wall(c,'edit',gen_random_uuid(),jsonb_build_object('session',s,'entry',entry_id,'revision',1,'quantity',8,'recounted',true));
  -- Count the material lots from the previous scenario at their current quantities.
  select jsonb_agg(jsonb_build_object('item_kind',item_kind,'item_id',item_id,'lot_id',id,'quantity',remaining))
    into q from public.inventory_lots where company_id=c and item_kind='material' and remaining>0;
  perform public.wall_to_wall(c,'add',gen_random_uuid(),jsonb_build_object('session',s,'entries',q));
  review:=public.wall_to_wall(c,'review',null,jsonb_build_object('session',s));
  result:=public.wall_to_wall(c,'confirm',gen_random_uuid(),jsonb_build_object('session',s,'proof',review->>'proof','acknowledged',true));
  if (select on_hand from public.inventory_balances where company_id=c and item_id=v)<>8 or
    (select reserved from public.inventory_balances where company_id=c and item_id=v)<>4 then
    raise exception 'El ajuste alteró reservas o no registró la salida';end if;
  -- Reuse the traditional reversal engine for the generated document.
  b:=(result->>'document_id')::uuid;
  q:=jsonb_build_object('kind','reversal','reverses_id',b,'date',current_date,'reason','Reversión sintética');
  review:=public.inventory_command(c,'review',q,null);
  perform public.inventory_command(c,'confirm',q||jsonb_build_object('proof',review->>'proof','acknowledged',true),gen_random_uuid());
  if (select on_hand from public.inventory_balances where company_id=c and item_id=v)<>9 then raise exception 'La reversión no recuperó el lote';end if;
  s:=(public.wall_to_wall(c,'create',gen_random_uuid(),'{"description":"Sobrante de producto"}')->>'id')::uuid;
  q:=jsonb_build_object('session',s,'entries',jsonb_build_array(
    jsonb_build_object('item_kind','variant','item_id',v,'quantity',12),
    jsonb_build_object('item_kind','material','item_id','55000000-0000-0000-0000-000000000001','quantity',1480)));
  perform public.wall_to_wall(c,'add',gen_random_uuid(),q);
  review:=public.wall_to_wall(c,'review',null,jsonb_build_object('session',s));
  perform public.wall_to_wall(c,'confirm',gen_random_uuid(),jsonb_build_object('session',s,'proof',review->>'proof','acknowledged',true));
  if (select remaining from public.inventory_lots where id=l)<>9 or
    not exists(select 1 from public.inventory_lots where company_id=c and item_id=v and remaining=3 and label like 'Ajuste WTW #%') then
    raise exception 'Sobrante genérico incorrecto';end if;
end $$;
rollback;
