begin;
insert into auth.users(id,email,email_confirmed_at) values('17000000-0000-0000-0000-000000000001','formula-admin@example.invalid',now()),('17000000-0000-0000-0000-000000000002','formula-operator@example.invalid',now()),('17000000-0000-0000-0000-000000000003','formula-viewer@example.invalid',now()),('17000000-0000-0000-0000-000000000004','formula-platform@example.invalid',now());
insert into public.corporations(id,name) values('27000000-0000-0000-0000-000000000001','Formula tests'),('27000000-0000-0000-0000-000000000002','Other tests');
insert into public.companies(id,name,corporation_id) values('37000000-0000-0000-0000-000000000001','Formula company','27000000-0000-0000-0000-000000000001'),('37000000-0000-0000-0000-000000000002','Other company','27000000-0000-0000-0000-000000000002');
insert into public.company_members(company_id,user_id,role) values('37000000-0000-0000-0000-000000000001','17000000-0000-0000-0000-000000000001','admin'),('37000000-0000-0000-0000-000000000001','17000000-0000-0000-0000-000000000002','editor'),('37000000-0000-0000-0000-000000000001','17000000-0000-0000-0000-000000000003','viewer');
insert into public.company_module_access(company_id,user_id,module,can_read,can_write) values('37000000-0000-0000-0000-000000000001','17000000-0000-0000-0000-000000000002','production',true,true),('37000000-0000-0000-0000-000000000001','17000000-0000-0000-0000-000000000003','production',true,false);
insert into access_private.platform_admins(user_id) values('17000000-0000-0000-0000-000000000004');
insert into public.units(id,company_id,name,symbol,dimension,base_factor) values
('47000000-0000-0000-0000-000000000001','37000000-0000-0000-0000-000000000001','Gramo','g','mass',1),
('47000000-0000-0000-0000-000000000002','37000000-0000-0000-0000-000000000001','Kilogramo','kg','mass',1000),
('47000000-0000-0000-0000-000000000003','37000000-0000-0000-0000-000000000001','Mililitro','ml','volume',1),
('47000000-0000-0000-0000-000000000004','37000000-0000-0000-0000-000000000001','Unidad','ud','count',1);
insert into public.raw_materials(id,company_id,name,unit_id,classification) values
('57000000-0000-0000-0000-000000000001','37000000-0000-0000-0000-000000000001','Ingrediente A','47000000-0000-0000-0000-000000000001','Materia prima'),
('57000000-0000-0000-0000-000000000002','37000000-0000-0000-0000-000000000001','Ingrediente B','47000000-0000-0000-0000-000000000001','Materia prima'),
('57000000-0000-0000-0000-000000000003','37000000-0000-0000-0000-000000000001','Ingrediente C','47000000-0000-0000-0000-000000000003','Materia prima'),
('57000000-0000-0000-0000-000000000004','37000000-0000-0000-0000-000000000001','Empaque','47000000-0000-0000-0000-000000000004','Material de empaque');
insert into public.products(id,company_id,name) values('67000000-0000-0000-0000-000000000001','37000000-0000-0000-0000-000000000001','Producto A'),('67000000-0000-0000-0000-000000000002','37000000-0000-0000-0000-000000000001','Producto B');
select set_config('request.jwt.claim.sub','17000000-0000-0000-0000-000000000001',true);
insert into public.presentations(id,company_id,name,raw_material_id,quantity,unit_id) values('77000000-0000-0000-0000-000000000001','37000000-0000-0000-0000-000000000001','Paquete A','57000000-0000-0000-0000-000000000001',2,'47000000-0000-0000-0000-000000000002');
insert into public.price_history(company_id,presentation_id,amount,currency,effective_on) values('37000000-0000-0000-0000-000000000001','77000000-0000-0000-0000-000000000001',100,'GTQ',current_date-1),('37000000-0000-0000-0000-000000000001','77000000-0000-0000-0000-000000000001',999,'USD',current_date);
set local role authenticated;
select set_config('request.jwt.claim.sub','17000000-0000-0000-0000-000000000001',true);

reset role;
insert into public.presentations(id,company_id,name,raw_material_id,quantity,unit_id) values
('77000000-0000-0000-0000-000000000002','37000000-0000-0000-0000-000000000001','Imported package','57000000-0000-0000-0000-000000000003',1000,'47000000-0000-0000-0000-000000000003');
insert into public.price_history(company_id,presentation_id,amount,currency,effective_on) values
('37000000-0000-0000-0000-000000000001','77000000-0000-0000-0000-000000000001',200,'GTQ',null),
('37000000-0000-0000-0000-000000000001','77000000-0000-0000-0000-000000000002',250,'GTQ',null),
('37000000-0000-0000-0000-000000000001','77000000-0000-0000-0000-000000000002',999,'GTQ',current_date+10);
set local role authenticated;
do $$declare cat jsonb;r jsonb;begin
 cat:=public.formula_catalog('37000000-0000-0000-0000-000000000001');
 select value into r from jsonb_array_elements(cat->'materials') where value->>'id'='57000000-0000-0000-0000-000000000003';
 if (r->>'unit_cost')::numeric is distinct from 0.25 or r->>'price_basis' is distinct from 'undated' or (r->>'presentation_price')::numeric is distinct from 250 or (r->>'presentation_quantity')::numeric is distinct from 1000 or r->>'presentation_unit' is distinct from 'ml' then raise exception 'Undated reference or presentation conversion failed';end if;
 if (r->>'unit_cost')::numeric*55<>13.75 then raise exception 'Consumption cost failed';end if;
 select value into r from jsonb_array_elements(cat->'materials') where value->>'id'='57000000-0000-0000-0000-000000000001';
 if (r->>'unit_cost')::numeric is distinct from 0.05 or r->>'price_basis' is distinct from 'dated' or (r->>'presentation_price')::numeric is distinct from 100 then raise exception 'Dated quote did not take priority, or currency ignored';end if;
 select value into r from jsonb_array_elements(cat->'materials') where value->>'id'='57000000-0000-0000-0000-000000000002';
 if r->>'unit_cost' is not null then raise exception 'Incompatible dimension used';end if;
 if not exists(select 1 from jsonb_array_elements(cat->'products')p where p ? 'sku') then raise exception 'Product SKUs unavailable';end if;
 begin perform public.formula_catalog('37000000-0000-0000-0000-000000000002');raise exception 'Tenant catalog leaked';exception when insufficient_privilege then null;end;
end $$;
reset role;
update public.presentations set active=false where id='77000000-0000-0000-0000-000000000002';
set local role authenticated;
do $$begin if exists(select 1 from jsonb_array_elements(public.formula_catalog('37000000-0000-0000-0000-000000000001')->'materials')r where r->>'id'='57000000-0000-0000-0000-000000000003' and r->>'unit_cost' is not null) then raise exception 'Inactive presentation used';end if;end $$;
select 'PASS: undated references, presentation prices, unit normalization, dated priority, future/currency/dimension exclusions, inactive presentations and tenant isolation' result;
rollback;
