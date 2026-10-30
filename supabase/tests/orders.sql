begin;
insert into auth.users(id,email,email_confirmed_at) values('15000000-0000-0000-0000-000000000001','corp@example.invalid',now()),('15000000-0000-0000-0000-000000000002','company@example.invalid',now()),('15000000-0000-0000-0000-000000000003','operator@example.invalid',now()),('15000000-0000-0000-0000-000000000004','viewer@example.invalid',now()),('15000000-0000-0000-0000-000000000005','platform@example.invalid',now());
insert into public.corporations(id,name) values('25000000-0000-0000-0000-000000000001','One'),('25000000-0000-0000-0000-000000000002','Other');
insert into public.corporation_members(corporation_id,user_id) values('25000000-0000-0000-0000-000000000001','15000000-0000-0000-0000-000000000001');
insert into public.companies(id,name,corporation_id) values('35000000-0000-0000-0000-000000000001','Business','25000000-0000-0000-0000-000000000001'),('35000000-0000-0000-0000-000000000002','Other business','25000000-0000-0000-0000-000000000002');
insert into public.company_members(company_id,user_id,role) values('35000000-0000-0000-0000-000000000001','15000000-0000-0000-0000-000000000002','admin'),('35000000-0000-0000-0000-000000000001','15000000-0000-0000-0000-000000000003','editor'),('35000000-0000-0000-0000-000000000001','15000000-0000-0000-0000-000000000004','viewer');
insert into public.units(company_id,name,symbol,dimension,base_factor) values('35000000-0000-0000-0000-000000000001','Gramo','g','mass',1);
insert into access_private.platform_admins values('15000000-0000-0000-0000-000000000005');

insert into public.products(id,company_id,name,sku)values('45000000-0000-0000-0000-000000000001','35000000-0000-0000-0000-000000000001','Test soap','P0001');
insert into public.raw_materials(id,company_id,name,unit_id,sku)select '55000000-0000-0000-0000-000000000001',company_id,'Test oil',id,'M0001' from public.units where company_id='35000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','15000000-0000-0000-0000-000000000001',true);
do $$declare c uuid:='35000000-0000-0000-0000-000000000001';p uuid:='45000000-0000-0000-0000-000000000001';m uuid:='55000000-0000-0000-0000-000000000001';u uuid;v uuid;f uuid;b uuid;k uuid:=gen_random_uuid();payload jsonb;out jsonb;act text;begin
 select id into strict u from public.units where company_id=c;
 foreach act in array array['inventory','receipts','formulas','batches','production_catalog','variants']loop perform public.operations(c,act);end loop;
 out:=public.operations(c,'variant_save',gen_random_uuid(),jsonb_build_object('product',p,'name','Small','weight_min',50,'weight_max',60,'price',20));v:=(out->>'id')::uuid;
 if (select sku from public.product_variants where id=v)<>'P0001-01' then raise exception 'Child SKU incorrect';end if;
 begin perform public.operations(c,'variant_save',gen_random_uuid(),jsonb_build_object('product',p,'name','Overlap','weight_min',55,'weight_max',70,'price',25));raise exception 'Overlap accepted';exception when others then if sqlerrm='Overlap accepted' then raise;end if;end;
 payload:=jsonb_build_object('material',m,'unit',u,'quantity',1000,'amount',100,'date',current_date,'currency','GTQ');
 perform public.operations(c,'receive',k,payload);perform public.operations(c,'receive',k,payload);
 if (select on_hand from public.inventory_balances where company_id=c and item_id=m)<>1000 then raise exception 'Receipt repeated';end if;
 out:=public.operations(c,'formula_create',gen_random_uuid(),jsonb_build_object('product',p,'name','Soap formula','yield',10,'ingredients',jsonb_build_array(jsonb_build_object('material',m,'unit',u,'quantity',500))));f:=(out->>'id')::uuid;
 out:=public.operations(c,'batch_start',gen_random_uuid(),jsonb_build_object('formula',f,'quantity',10,'date',current_date,'available_on',current_date));b:=(out->>'id')::uuid;
 payload:=jsonb_build_object('batch',b,'consumptions',jsonb_build_array(jsonb_build_object('material',m,'unit',u,'quantity',500)),'outputs',jsonb_build_array(jsonb_build_object('variant',v,'quantity',8)));
 perform public.operations(c,'batch_finish',gen_random_uuid(),payload);perform public.operations(c,'batch_finish',gen_random_uuid(),payload);
 if (select on_hand from public.inventory_balances where company_id=c and item_id=m)<>500 then raise exception 'Consumption repeated';end if;
 if (select blocked from public.inventory_balances where company_id=c and item_id=v)<>8 then raise exception 'Curing not blocked';end if;
 perform public.operations(c,'batch_release',gen_random_uuid(),jsonb_build_object('batch',b));
 if (select on_hand-blocked-reserved from public.inventory_balances where company_id=c and item_id=v)<>8 then raise exception 'Release failed';end if;
 foreach act in array array['inventory','receipts','formulas','batches','production_catalog','variants']loop perform public.operations(c,act,null,jsonb_build_object('product',p));end loop;
 begin perform public.operations('35000000-0000-0000-0000-000000000002','inventory');raise exception 'Tenant leak';exception when insufficient_privilege then null;end;
 begin perform public.operations(c,'adjust',gen_random_uuid(),jsonb_build_object('kind','variant','item',v,'quantity',-9,'reason','Test reduction'));raise exception 'Negative stock accepted';exception when others then if sqlerrm='Negative stock accepted' then raise;end if;end;
end $$;

select public.store_settings('35000000-0000-0000-0000-000000000001','{"published":true,"pickup":true,"delivery":true,"shipping_fee":15,"discount_code":"BIENVENIDA","discount_percent":10,"gift_threshold":100,"gift":"Tarjeta de regalo"}');
update public.products set published=true where company_id='35000000-0000-0000-0000-000000000001';
-- Variants are command-only, including tests.
do $$declare v public.product_variants%rowtype;begin select * into strict v from public.product_variants where company_id='35000000-0000-0000-0000-000000000001';perform public.operations(v.company_id,'variant_save',gen_random_uuid(),to_jsonb(v)||jsonb_build_object('product',v.product_id,'published',true));end $$;
set local role anon;select set_config('request.jwt.claim.sub','',true);
do $$declare c uuid:='35000000-0000-0000-0000-000000000001';shop jsonb;v uuid;k uuid:=gen_random_uuid();data jsonb;o jsonb;begin
 shop:=public.storefront(c);if shop is null or shop::text like '%"sku"%' or shop::text like '%"barcode"%' or shop::text like '%M0001%' then raise exception 'Private catalog fields exposed';end if;
 v:=(shop#>>'{products,0,variants,0,id}')::uuid;
 data:=jsonb_build_object('customer',jsonb_build_object('name','Test Customer','phone','+50255551234','email','test@example.invalid'),'delivery','pickup','payment','cash','discount_code','BIENVENIDA','items',jsonb_build_array(jsonb_build_object('variant',v,'quantity',3,'price',0)));
 if (public.checkout_quote(c,data)->>'total')::numeric<>54 then raise exception 'Incorrect quote';end if;
 o:=public.checkout(c,k,data);if (o->>'total')::numeric<>54 then raise exception 'Client price or discount calculation incorrect';end if;if public.checkout(c,k,data)<>o then raise exception 'Checkout not idempotent';end if;
 begin perform public.checkout(c,gen_random_uuid(),jsonb_set(data,'{items}',jsonb_build_array(jsonb_build_object('variant',v,'quantity',6))));raise exception 'Oversell accepted';exception when others then if sqlerrm='Oversell accepted' then raise;end if;end;
 begin perform 1 from public.sales_orders;raise exception 'Anonymous order access';exception when insufficient_privilege then null;end;
 if public.storefront('35000000-0000-0000-0000-000000000002') is not null then raise exception 'Unpublished store exposed';end if;
end $$;
set local role authenticated;select set_config('request.jwt.claim.sub','15000000-0000-0000-0000-000000000001',true);
do $$declare c uuid:='35000000-0000-0000-0000-000000000001';o uuid;v uuid;begin
 select id into strict o from public.sales_orders where company_id=c;select variant_id into strict v from public.order_lines where company_id=c and order_id=o;
 if (select reserved from public.inventory_balances where company_id=c and item_id=v)<>3 then raise exception 'Reservation repeated';end if;
 perform public.sales(c,'paid',gen_random_uuid(),jsonb_build_object('order',o));perform public.sales(c,'dispatch',gen_random_uuid(),jsonb_build_object('order',o));perform public.sales(c,'dispatch',gen_random_uuid(),jsonb_build_object('order',o));
 if (select on_hand from public.inventory_balances where company_id=c and item_id=v)<>5 or(select reserved from public.inventory_balances where company_id=c and item_id=v)<>0 then raise exception 'Dispatch repeated or reservation retained';end if;
 if (select unit_price from public.order_lines where company_id=c and order_id=o)<>20 then raise exception 'Price snapshot modified';end if;
 begin perform public.sales('35000000-0000-0000-0000-000000000002','list');raise exception 'Cross-company sales access';exception when insufficient_privilege then null;end;
end $$;
reset role;
-- Expiry and cancellation are tested with disposable records in this rollback.
set local role authenticated;select set_config('request.jwt.claim.sub','15000000-0000-0000-0000-000000000001',true);
do $$declare c uuid:='35000000-0000-0000-0000-000000000001';v uuid;u uuid;ml uuid;kg uuid;o jsonb;payload jsonb;details jsonb;begin
 select id into strict v from public.product_variants where company_id=c;
 payload:=jsonb_build_object('customer',jsonb_build_object('name','Disposable Customer','phone','+50200000000'),'delivery','pickup','payment','transfer','items',jsonb_build_array(jsonb_build_object('variant',v,'quantity',2)));
 o:=public.sales(c,'create',gen_random_uuid(),payload);
 begin perform public.sales(c,'dispatch',gen_random_uuid(),jsonb_build_object('order',o->>'id'));raise exception 'Unpaid transfer dispatched';exception when others then if sqlerrm='Unpaid transfer dispatched' then raise;end if;end;
 perform public.sales(c,'cancel',gen_random_uuid(),jsonb_build_object('order',o->>'id'));perform public.sales(c,'cancel',gen_random_uuid(),jsonb_build_object('order',o->>'id'));
 if(select reserved from public.inventory_balances where company_id=c and item_id=v)<>0 then raise exception 'Cancel did not release';end if;
 select st.details into details from public.company_settings st where company_id=c;
 perform public.save_company_settings(c,'Business','GTQ',details,'{"font":"Arial"}');
 perform public.report_summary(c);
 select id into strict u from public.units where company_id=c and symbol='g';
 insert into public.units(company_id,name,symbol,dimension,base_factor)values(c,'Kilogramo','kg','mass',1000)returning id into kg;
 perform public.operations(c,'receive',gen_random_uuid(),jsonb_build_object('material','55000000-0000-0000-0000-000000000001','unit',kg,'quantity',2,'amount',100,'date',current_date,'currency','GTQ'));
 if(select on_hand from public.inventory_balances where company_id=c and item_id='55000000-0000-0000-0000-000000000001')<>2500 then raise exception 'Unit conversion failed';end if;
 insert into public.units(company_id,name,symbol,dimension,base_factor)values(c,'Mililitro','ml','volume',1)returning id into ml;
 begin perform public.operations(c,'receive',gen_random_uuid(),jsonb_build_object('material','55000000-0000-0000-0000-000000000001','unit',ml,'quantity',2,'amount',100,'date',current_date,'currency','GTQ'));raise exception 'Mass-volume conversion accepted';exception when others then if sqlerrm='Mass-volume conversion accepted' then raise;end if;end;
end $$;
reset role;
insert into public.company_module_access(company_id,user_id,module,can_read,can_write) values('35000000-0000-0000-0000-000000000001','15000000-0000-0000-0000-000000000003','catalog',false,false),('35000000-0000-0000-0000-000000000001','15000000-0000-0000-0000-000000000003','inventory',true,false);
set local role authenticated;select set_config('request.jwt.claim.sub','15000000-0000-0000-0000-000000000003',true);
do $$declare c uuid:='35000000-0000-0000-0000-000000000001';begin
 if public.company_permission(c,'read','catalog') then raise exception 'Catalog override ignored';end if;
 perform public.company_context();perform public.company_theme(c);perform public.operations(c,'inventory');
 begin perform public.operations(c,'adjust',gen_random_uuid(),'{}');raise exception 'Read-only operator wrote stock';exception when insufficient_privilege then null;end;
 begin perform public.store_settings(c,'{}');raise exception 'Operator changed shop';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub','15000000-0000-0000-0000-000000000005',true);
do $$begin if exists(select 1 from public.sales_orders)or exists(select 1 from public.customers)then raise exception 'Platform role accessed private sales';end if;end $$;
select set_config('request.jwt.claim.sub','15000000-0000-0000-0000-000000000001',true);
do $$declare c uuid:='35000000-0000-0000-0000-000000000001';v public.product_variants%rowtype;begin
 select * into strict v from public.product_variants where company_id=c;
 perform public.operations(c,'variant_save',gen_random_uuid(),to_jsonb(v)||jsonb_build_object('product',v.product_id,'price',25));
 if(select unit_price from public.order_lines where company_id=c and quantity=3)<>20 then raise exception 'Price history changed';end if;
 perform public.sales(c,'create',gen_random_uuid(),jsonb_build_object('customer',jsonb_build_object('name','Expiry Test','phone','+50200000000'),'delivery','pickup','payment','cash','items',jsonb_build_array(jsonb_build_object('variant',v.id,'quantity',1))));
end $$;
reset role;
update public.sales_orders set expires_at=now()-interval '1 minute' where company_id='35000000-0000-0000-0000-000000000001' and status='pending';
set local role anon;select set_config('request.jwt.claim.sub','',true);
do $$begin perform public.storefront('35000000-0000-0000-0000-000000000001');end $$;
reset role;
do $$begin if exists(select 1 from public.sales_orders where company_id='35000000-0000-0000-0000-000000000001' and status='pending')or exists(select 1 from public.inventory_balances where company_id='35000000-0000-0000-0000-000000000001' and reserved<>0)then raise exception 'Expiry did not release reservation';end if;end $$;
select 'PASS: public projection, server quotes, unit conversions, idempotent checkout, no oversell, immutable sold prices, single dispatch, cancellation, expiry and module permissions' as result;
rollback;
