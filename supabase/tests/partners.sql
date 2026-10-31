begin;
insert into auth.users(id,email,email_confirmed_at) values
('16000000-0000-0000-0000-000000000001','corp-partner@example.invalid',now()),
('16000000-0000-0000-0000-000000000002','company-partner@example.invalid',now()),
('16000000-0000-0000-0000-000000000003','operator-partner@example.invalid',now()),
('16000000-0000-0000-0000-000000000004','platform-partner@example.invalid',now());
insert into public.corporations(id,name) values('26000000-0000-0000-0000-000000000001','Partner tests'),('26000000-0000-0000-0000-000000000002','Other tests');
insert into public.corporation_members(corporation_id,user_id) values('26000000-0000-0000-0000-000000000001','16000000-0000-0000-0000-000000000001');
insert into public.companies(id,name,corporation_id) values('36000000-0000-0000-0000-000000000001','Partner company','26000000-0000-0000-0000-000000000001'),('36000000-0000-0000-0000-000000000002','Other company','26000000-0000-0000-0000-000000000002');
insert into public.company_members(company_id,user_id,role) values('36000000-0000-0000-0000-000000000001','16000000-0000-0000-0000-000000000002','admin'),('36000000-0000-0000-0000-000000000001','16000000-0000-0000-0000-000000000003','editor');
insert into public.company_module_access(company_id,user_id,module,can_read,can_write) values('36000000-0000-0000-0000-000000000001','16000000-0000-0000-0000-000000000003','sales',true,true),('36000000-0000-0000-0000-000000000001','16000000-0000-0000-0000-000000000003','catalog',false,false);
insert into access_private.platform_admins(user_id) values('16000000-0000-0000-0000-000000000004');
insert into public.units(id,company_id,name,symbol,dimension,base_factor) values('46000000-0000-0000-0000-000000000001','36000000-0000-0000-0000-000000000001','Unidad','ud','count',1);
insert into public.raw_materials(id,company_id,name,unit_id) values('56000000-0000-0000-0000-000000000001','36000000-0000-0000-0000-000000000001','Material de prueba','46000000-0000-0000-0000-000000000001');
insert into public.products(id,company_id,name,sku) values('66000000-0000-0000-0000-000000000001','36000000-0000-0000-0000-000000000001','Producto prueba','P0001');
set local role authenticated;
select set_config('request.jwt.claim.sub','16000000-0000-0000-0000-000000000001',true);
do $$declare c uuid:='36000000-0000-0000-0000-000000000001';s uuid;cu uuid;p uuid;a uuid;v uuid;k uuid;order_id uuid;out jsonb;payload jsonb;begin
 if public.partners(c,'suggest','{"type":"supplier"}')->>'code'<>'PR0001' then raise exception 'Supplier code';end if;
 out:=public.partners(c,'save','{"type":"supplier","name":"Proveedor pruebas","code":"PR0001","phone":"+502 5555-1111","addresses":[{"label":"Bodega","address":"Dirección de prueba","is_primary":true},{"label":"Oficina","address":"Otra dirección"}]}');s:=(out->>'id')::uuid;
 cu:=(public.partners(c,'save','{"type":"customer","name":"Cliente pruebas","phone":"55551111","addresses":[]}')->>'id')::uuid;
 if (select code from public.business_partners where id=cu)<>'C0001' then raise exception 'Customer code';end if;
 if (select count(*) from public.suppliers where company_id=c)<>1 or (select count(*) from public.customers where company_id=c)<>1 then raise exception 'Types leaked through compatibility views';end if;
 if jsonb_array_length(public.partners(c,'get',jsonb_build_object('id',s))->'addresses')<>2 then raise exception 'Address persistence';end if;
 begin perform public.partners(c,'save','{"type":"customer","name":"Duplicado","code":"pr0001","addresses":[]}');raise exception 'Duplicate code accepted';exception when unique_violation then null;end;
 begin perform public.partners(c,'save','{"type":"customer","name":"Email inválido","email":"bad","addresses":[]}');raise exception 'Invalid email accepted';exception when check_violation then null;end;
 begin perform public.partners(c,'save',jsonb_build_object('id',cu,'type','customer','name','Cliente pruebas','addresses',jsonb_build_array(jsonb_build_object('id',(public.partners(c,'get',jsonb_build_object('id',s))#>>'{addresses,0,id}'),'label','Ajena','address','Intento ajeno'))));raise exception 'Address reassigned';exception when insufficient_privilege then null;end;
 -- A free contact can change type; linked suppliers cannot.
 perform public.partners(c,'save',jsonb_build_object('id',cu,'type','supplier','name','Cliente temporal','addresses','[]'::jsonb));
 perform public.partners(c,'save',jsonb_build_object('id',cu,'type','customer','name','Cliente pruebas','phone','55551111','addresses','[]'::jsonb));
 insert into public.presentations(name,company_id,raw_material_id,supplier_id,unit_id,quantity) values('Presentación de prueba',c,'56000000-0000-0000-0000-000000000001',s,'46000000-0000-0000-0000-000000000001',1) returning id into p;
 begin perform public.partners(c,'save',jsonb_build_object('id',s,'type','customer','name','Proveedor pruebas','addresses','[]'::jsonb));raise exception 'Linked type changed';exception when raise_exception then if sqlerrm='Linked type changed' then raise;end if;end;
 perform public.partners(c,'active',jsonb_build_object('id',s,'active',false));
 if not exists(select 1 from public.presentations where id=p and supplier_id=s) then raise exception 'History lost';end if;
 begin insert into public.presentations(name,company_id,raw_material_id,supplier_id,unit_id,quantity) values('Presentación de prueba',c,'56000000-0000-0000-0000-000000000001',s,'46000000-0000-0000-0000-000000000001',2);raise exception 'Inactive supplier used';exception when raise_exception then if sqlerrm='Inactive supplier used' then raise;end if;end;
 begin insert into public.price_history(company_id,presentation_id,amount,currency,effective_on) values(c,p,10,'GTQ',current_date);raise exception 'Inactive quote inserted';exception when raise_exception then if sqlerrm='Inactive quote inserted' then raise;end if;end;
 begin perform public.operations(c,'receive',gen_random_uuid(),jsonb_build_object('material','56000000-0000-0000-0000-000000000001','unit','46000000-0000-0000-0000-000000000001','supplier',s,'quantity',1,'amount',1,'date',current_date));raise exception 'Inactive receipt accepted';exception when raise_exception then if sqlerrm='Inactive receipt accepted' then raise;end if;end;
 begin perform public.operations(c,'receive',gen_random_uuid(),jsonb_build_object('material','56000000-0000-0000-0000-000000000001','unit','46000000-0000-0000-0000-000000000001','supplier',cu,'quantity',1,'amount',1,'date',current_date));raise exception 'Customer used as supplier';exception when raise_exception then if sqlerrm='Customer used as supplier' then raise;end if;end;
 for n in 1..26 loop perform public.partners(c,'save',jsonb_build_object('type','customer','name','Página '||n,'tax_id','NITTEST'||n,'addresses','[]'::jsonb));end loop;
 if jsonb_array_length(public.partners(c,'list','{"type":"customer","page":1}')->'rows')<>25 or jsonb_array_length(public.partners(c,'list','{"type":"customer","page":2}')->'rows')<>2 then raise exception 'Pagination incorrect';end if;
 if (public.partners(c,'list','{"query":"NITTEST26"}')->>'total')::int<>1 then raise exception 'Tax search';end if;
 -- Selected customers are reused, snapshots stay immutable, retries remain idempotent.
 v:=(public.operations(c,'variant_save',gen_random_uuid(),'{"product":"66000000-0000-0000-0000-000000000001","name":"Variante","price":10,"allow_preorder":true}')->>'id')::uuid;
 k:=gen_random_uuid();payload:=jsonb_build_object('customer_id',cu,'delivery','pickup','payment','cash','items',jsonb_build_array(jsonb_build_object('variant',v,'quantity',1)));
 out:=public.sales(c,'create',k,payload);order_id:=(out->>'id')::uuid;
 if (select customer_id from public.sales_orders where id=order_id)<>cu then raise exception 'Selected customer duplicated';end if;
 perform public.partners(c,'save',jsonb_build_object('id',cu,'type','customer','name','Cliente editado','phone','55551111','addresses','[]'::jsonb));
 if public.sales(c,'create',k,payload)<>out then raise exception 'Selected customer retry changed';end if;
 if (select customer_snapshot->>'name' from public.sales_orders where id=order_id)<>'Cliente pruebas' then raise exception 'Historical snapshot changed';end if;
 begin perform public.partners(c,'save',jsonb_build_object('id',cu,'type','supplier','name','Cambio no permitido','addresses','[]'::jsonb));raise exception 'Customer with sales changed type';exception when raise_exception then if sqlerrm='Customer with sales changed type' then raise;end if;end;
 perform public.partners(c,'active',jsonb_build_object('id',cu,'active',false));
 begin perform public.sales(c,'create',gen_random_uuid(),payload);raise exception 'Inactive customer used';exception when raise_exception then if sqlerrm='Inactive customer used' then raise;end if;end;
 perform public.sales(c,'cancel',gen_random_uuid(),jsonb_build_object('order',order_id));
 perform public.partners(c,'active',jsonb_build_object('id',cu,'active',true));
 begin perform public.partners('36000000-0000-0000-0000-000000000002','list');raise exception 'Other tenant read';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub','16000000-0000-0000-0000-000000000002',true);
do $$begin perform public.partners('36000000-0000-0000-0000-000000000001','save','{"type":"customer","name":"Administrador autorizado","addresses":[]}');end $$;
select set_config('request.jwt.claim.sub','16000000-0000-0000-0000-000000000003',true);
do $$declare c uuid:='36000000-0000-0000-0000-000000000001';begin
 if exists(select 1 from public.business_partners where company_id=c and partner_type='supplier') then raise exception 'Operator read forbidden suppliers';end if;
 if not exists(select 1 from public.customers where company_id=c) then raise exception 'Sales module cannot read customers';end if;
 if exists(select 1 from public.partner_addresses where company_id=c) then raise exception 'Addresses leaked';end if;
 begin perform public.partners(c,'save','{"type":"customer","name":"Not allowed","addresses":[]}');raise exception 'Operator wrote';exception when insufficient_privilege then null;end;
 begin insert into public.business_partners(company_id,name,partner_type) values(c,'Direct denied','customer');raise exception 'Direct write allowed';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub','16000000-0000-0000-0000-000000000004',true);
do $$begin
 if exists(select 1 from public.business_partners) then raise exception 'Platform tenant bypass';end if;
 begin perform public.partners('36000000-0000-0000-0000-000000000001','list');raise exception 'Platform RPC bypass';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
