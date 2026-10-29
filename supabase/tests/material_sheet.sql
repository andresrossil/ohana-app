begin;
insert into auth.users(id) values('11000000-0000-0000-0000-000000000001'),('11000000-0000-0000-0000-000000000002');
insert into public.companies(id,name) values('22000000-0000-0000-0000-000000000001','Sheet Test'),('22000000-0000-0000-0000-000000000002','Other');
insert into public.company_members(company_id,user_id,role) values('22000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000001','editor'),('22000000-0000-0000-0000-000000000001','11000000-0000-0000-0000-000000000002','viewer');
insert into public.units(company_id,name,symbol,dimension,base_factor) values('22000000-0000-0000-0000-000000000001','Onza','oz','mass',28.34952313),('22000000-0000-0000-0000-000000000001','Gramo','g','mass',1),('22000000-0000-0000-0000-000000000001','Kilogramo','kg','mass',1000);
set local role authenticated;
select set_config('request.jwt.claim.sub','11000000-0000-0000-0000-000000000001',true);
do $test$
declare c uuid:='22000000-0000-0000-0000-000000000001'; b uuid:=gen_random_uuid(); payload jsonb; result jsonb; p uuid; h uuid; count_before integer;
begin
 payload:='[{"supplier":"PRICESMART","material":"ACEITE COCO","alternative":"","capacity":"54 OZ","quantity":50,"unit":"OZ","comment":"","price":120,"date":"2026-07-03","previous":110,"previousSupplier":"Proveedor previo","previousBasis":"unknown"}]';
 result:=public.save_material_sheet(c,b,payload);
 p:=(result->0->>'id')::uuid;
 if (select unit_price from public.material_sheet where id=p)<>2.4 then raise exception 'Capacity incorrectly used in division'; end if;
 if (select previous_unit_price from public.material_sheet where id=p) is not null then raise exception 'Unknown prior compared'; end if;
 if (select legacy_previous_date from public.price_history where presentation_id=p) is not null then raise exception 'Unknown prior date fabricated'; end if;
 perform public.save_material_sheet(c,b,payload);
 if (select count(*) from public.price_history where presentation_id=p)<>1 then raise exception 'Retry duplicated history'; end if;
 begin
  perform public.save_material_sheet(c,gen_random_uuid(),payload);
  raise exception 'Unconfirmed duplicate accepted';
 exception when others then if sqlerrm='Unconfirmed duplicate accepted' then raise; end if; end;
 payload:=jsonb_set(payload,'{0,mode}','"update"');
 payload:=jsonb_set(payload,'{0,confirmedDuplicate}','true');
 payload:=jsonb_set(payload,'{0,supplier}','"  pricesmart  "');
 perform public.save_material_sheet(c,gen_random_uuid(),payload);
 if (select count(*) from public.suppliers where company_id=c)<>1 then raise exception 'Supplier case duplicate'; end if;
 if (select count(*) from public.raw_materials where company_id=c)<>1 then raise exception 'Material duplicate'; end if;
 select price_id into h from public.material_sheet where id=p;
 payload:=jsonb_set(payload,'{0,id}',to_jsonb(p::text));
 payload:=jsonb_set(payload,'{0,expectedPriceId}',to_jsonb(h::text));
 payload:=jsonb_set(payload,'{0,price}','150');
 payload:=jsonb_set(payload,'{0,date}','"2026-07-04"');
 perform public.save_material_sheet(c,gen_random_uuid(),payload);
 if (select count(*) from public.price_history where presentation_id=p)<>2 then raise exception 'History overwritten'; end if;
 if (select previous_unit_price from public.material_sheet where id=p)<>2.4 then raise exception 'Previous unit price incorrect'; end if;
 if (select unit_price-previous_unit_price from public.material_sheet where id=p)<>0.6 then raise exception 'VS incorrect'; end if;
 select price_id into h from public.material_sheet where id=p;
 payload:=jsonb_set(payload,'{0,expectedPriceId}',to_jsonb(h::text));
 payload:=jsonb_set(payload,'{0,supplier}','"New Supplier"');
 payload:=jsonb_set(payload,'{0,quantity}','100');
 payload:=jsonb_set(payload,'{0,price}','250');
 payload:=jsonb_set(payload,'{0,date}','"2026-07-05"');
 result:=public.save_material_sheet(c,gen_random_uuid(),payload);
 if (select active from public.presentations where id=p) then raise exception 'Old presentation not archived'; end if;
 p:=(result->0->>'id')::uuid;
 if (select previous_unit_price from public.material_sheet where id=p)<>3 then raise exception 'Supplier/quantity normalization failed'; end if;
 if (select previous_supplier from public.material_sheet where id=p)<>'PRICESMART' then raise exception 'Previous supplier lost'; end if;
 -- Same-day records inside one batch preserve insertion order.
 perform public.save_material_sheet(c,gen_random_uuid(),'[{"supplier":"Same supplier","material":"Same day","quantity":1,"unit":"g","price":10,"date":"2026-07-01"},{"supplier":"Same supplier","material":"Same day","quantity":1,"unit":"g","price":11,"date":"2026-07-01","mode":"update","confirmedDuplicate":true}]');
 if (select unit_price from public.material_sheet where material_name='Same day')<>11 then raise exception 'Same-day chronology failed';end if;
 if (select previous_unit_price from public.material_sheet where material_name='Same day')<>10 then raise exception 'Same-day prior failed';end if;
 -- Package conversion: 100 / 1kg = .1/g, current 60 / 500g = .12/g.
 perform public.save_material_sheet(c,gen_random_uuid(),'[{"supplier":"A","material":"Sugar","quantity":1,"unit":"kg","price":100,"date":"2026-07-01"},{"supplier":"B","material":"sugar","quantity":500,"unit":"g","price":60,"date":"2026-07-02"}]');
 if (select previous_unit_price from public.material_sheet where material_name='sugar' and supplier_name='B')<>0.1 then raise exception 'Unit conversion failed'; end if;
 select count(*) into count_before from public.raw_materials where company_id=c;
 begin
  perform public.save_material_sheet(c,gen_random_uuid(),'[{"supplier":"ROLLBACK SUPPLIER","material":"Should rollback","quantity":1,"unit":"g","price":5,"date":"2026-07-01"},{"supplier":"Z","material":"Invalid","quantity":0,"unit":"g","price":1,"date":"2026-07-01"}]');
  raise exception 'Invalid batch accepted';
 exception when others then if sqlerrm='Invalid batch accepted' then raise; end if; if position('Fila 2:' in sqlerrm)=0 then raise; end if; end;
 if (select count(*) from public.raw_materials where company_id=c)<>count_before then raise exception 'Batch was partially saved'; end if;
 if exists(select 1 from public.suppliers where name='ROLLBACK SUPPLIER') then raise exception 'Supplier not rolled back'; end if;
 begin
  perform public.save_material_sheet('22000000-0000-0000-0000-000000000002',gen_random_uuid(),payload);
  raise exception 'Other tenant write allowed';
 exception when insufficient_privilege then null; end;
end $test$;
select set_config('request.jwt.claim.sub','11000000-0000-0000-0000-000000000002',true);
do $$ begin
 begin perform public.save_material_sheet('22000000-0000-0000-0000-000000000001',gen_random_uuid(),'[]');raise exception 'Viewer wrote';exception when insufficient_privilege then null;end;
 if exists(select 1 from public.catalog_batches) then raise exception 'Viewer sees batch payload';end if;
end $$;
reset role;
select 'PASS: capacity, unknown history, retry, duplicate choices, normalized names, immutable history, provider changes, unit conversions, atomic rollback, tenant and viewer denial' as result;
rollback;
