begin;
insert into auth.users(id) values ('10000000-0000-0000-0000-000000000001'),('10000000-0000-0000-0000-000000000002'),('10000000-0000-0000-0000-000000000003');
insert into public.companies(id,name) values ('20000000-0000-0000-0000-000000000001','Test A'),('20000000-0000-0000-0000-000000000002','Test B');
insert into public.company_members values ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','editor'),('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','admin'),('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003','viewer');
insert into public.units(id,company_id,name,symbol,dimension,base_factor) values ('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','gram','g','mass',1),('30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','gram','g','mass',1),('30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','kg','kg','mass',1000);
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
do $$ begin
 if (select count(*) from public.companies) <> 1 then raise exception 'Tenant read isolation failed'; end if;
 if (select count(*) from public.units) <> 2 then raise exception 'Unit isolation failed'; end if;
 begin
  insert into public.suppliers(company_id,name) values('20000000-0000-0000-0000-000000000002','Forbidden');
  raise exception 'Tenant insert isolation failed';
 exception when insufficient_privilege then null; end;
 begin
  insert into public.company_members values('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','admin');
  raise exception 'Escalation was allowed';
 exception when insufficient_privilege then null; end;
 begin
  insert into public.raw_materials(company_id,name,unit_id) values('20000000-0000-0000-0000-000000000001','Bad FK','30000000-0000-0000-0000-000000000002');
  raise exception 'Cross tenant FK allowed';
 exception when foreign_key_violation then null; end;
end $$;
insert into public.suppliers(id,company_id,name) values('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Supplier');
insert into public.raw_materials(id,company_id,name,unit_id) values('50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Material','30000000-0000-0000-0000-000000000001');
insert into public.presentations(id,company_id,raw_material_id,supplier_id,unit_id,name,quantity) values('60000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000003','1 kg',1);
insert into public.price_history(company_id,presentation_id,amount,effective_on) values('20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001',100,current_date),('20000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001',200,current_date+1);
do $$ begin
 if (select cost_per_material_unit from public.current_prices) <> 0.1 then raise exception 'Price conversion/latest failed'; end if;
 begin update public.price_history set amount=1; raise exception 'History update allowed'; exception when insufficient_privilege then null; end;
 begin delete from public.price_history; raise exception 'History deletion allowed'; exception when insufficient_privilege then null; end;
 begin update public.presentations set quantity=2; raise exception 'History semantics mutation allowed'; exception when raise_exception then if sqlerrm='History semantics mutation allowed' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
do $$ begin
 if exists(select 1 from public.current_prices) then raise exception 'View leaked another tenant'; end if;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
do $$ begin
 if (select count(*) from public.raw_materials) <> 1 then raise exception 'Viewer cannot read'; end if;
 begin insert into public.suppliers(company_id,name) values('20000000-0000-0000-0000-000000000001','Forbidden'); raise exception 'Viewer wrote data'; exception when insufficient_privilege then null; end;
 update public.raw_materials set name='Forbidden';
 if found then raise exception 'Viewer updated data'; end if;
end $$;
reset role;
set local role anon;
do $$ begin
 begin perform 1 from public.raw_materials; raise exception 'Anon read allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: tenant reads/writes, composite FK, role escalation, immutable prices, conversion, future prices, viewer and anonymous denial' as result;
rollback;
