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
update public.products set unit_id='47000000-0000-0000-0000-000000000001' where company_id='37000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','17000000-0000-0000-0000-000000000001',true);

do $$declare c uuid:='37000000-0000-0000-0000-000000000001';f uuid;fv uuid;v uuid;v2 uuid;d uuid;family uuid;root uuid;p jsonb;r jsonb;rev integer;begin
 p:='{"kind":"new","product":"67000000-0000-0000-0000-000000000001","name":"Estimated recipe","code":"HACK-CODE","own_reference":"REF-A","estimated_units":10,"estimate_unit_id":"47000000-0000-0000-0000-000000000001","quantity_per_unit":50,"ingredients":[{"material":"57000000-0000-0000-0000-000000000003","unit":"47000000-0000-0000-0000-000000000003","quantity":200,"density_g_ml":0.9}]}';
 -- Product presentation exists independently; it must not be changed by the formula.
 f:=(public.formula_command(c,'save',gen_random_uuid(),p)->>'id')::uuid;
 select family_id,edit_revision into root,rev from public.formulas where id=f;
 if not exists(select 1 from public.formula_families where id=root and formula_origen_id=id and code='F000001' and own_reference='REF-A') then raise exception 'Auto code/root/reference failed';end if;
 if not exists(select 1 from public.formulas where id=f and estimated_units=10 and quantity_per_unit=50 and estimate_unit_id='47000000-0000-0000-0000-000000000001') then raise exception 'Estimate not stored';end if;
 if(select density_g_ml from public.formula_ingredients where formula_id=f) is distinct from 0.9 then raise exception 'Density lost';end if;
 fv:=(public.formula_command(c,'save',gen_random_uuid(),p||jsonb_build_object('kind','version','source',f))->>'id')::uuid;
 if fv=f or not exists(select 1 from public.formulas where id=fv and family_id=root and version=2) then raise exception 'Version identity failed';end if;
 v:=(public.formula_command(c,'save',gen_random_uuid(),p||jsonb_build_object('kind','variation','source',fv,'own_reference','REF-V','confirm_duplicate',true))->>'id')::uuid;
 v2:=(public.formula_command(c,'save',gen_random_uuid(),p||jsonb_build_object('kind','variation','source',v,'own_reference','REF-V2','confirm_duplicate',true))->>'id')::uuid;
 if not exists(select 1 from public.formula_families ff join public.formulas f on f.family_id=ff.id where f.id=v2 and ff.formula_origen_id=root and ff.code='F000003') then raise exception 'Variation from variation lost original root';end if;
 d:=(public.formula_command(c,'save',gen_random_uuid(),p||jsonb_build_object('kind','duplicate','source',v,'own_reference','REF-D','confirm_duplicate',true))->>'id')::uuid;
 if not exists(select 1 from public.formula_families ff join public.formulas f on f.family_id=ff.id where f.id=d and ff.formula_origen_id=ff.id and ff.id<>root and ff.code='F000004') then raise exception 'Duplicate not independent';end if;
 begin perform public.formula_command(c,'save',gen_random_uuid(),p||'{"own_reference":" ref-a ","confirm_duplicate":true}');raise exception 'Duplicate ref accepted';exception when unique_violation then null;end;
 perform public.formula_command(c,'notes',gen_random_uuid(),jsonb_build_object('id',d,'own_reference',''));
 perform public.formula_command(c,'notes',gen_random_uuid(),jsonb_build_object('id',v2,'own_reference',''));
 p:=p||jsonb_build_object('kind','edit','source',f,'edit_revision',rev,'own_reference','REF-A','estimated_units',20,'confirm_duplicate',true);
 perform public.formula_command(c,'edit',gen_random_uuid(),p);
 if(select estimated_units from public.formulas where id=f)<>20 then raise exception 'Direct estimate correction failed';end if;
 begin perform public.formula_command(c,'save',gen_random_uuid(),p||jsonb_build_object('kind','duplicate','own_reference','','confirm_duplicate',true,'estimate_unit_id','47000000-0000-0000-0000-000000000003'));raise exception 'Incompatible presentation accepted';exception when raise_exception then if sqlerrm='Incompatible presentation accepted' then raise;end if;end;
 begin perform public.formula_command(c,'save',gen_random_uuid(),p||jsonb_build_object('kind','new','own_reference','','confirm_duplicate',true,'ingredients',jsonb_build_array(jsonb_build_object('material','57000000-0000-0000-0000-000000000003','unit','47000000-0000-0000-0000-000000000003','quantity',2,'density_g_ml',-1))));raise exception 'Negative density accepted';exception when check_violation then null;end;
 r:=public.formula_command(c,'list');
 if not exists(select 1 from jsonb_array_elements(r)x where x->>'id'=fv::text and x->>'code'='F000001' and x->>'own_reference'='REF-A') then raise exception 'Version code/reference not shared';end if;
end $$;
reset role;
do $$declare c uuid:='37000000-0000-0000-0000-000000000001';root uuid;other uuid;last_code text;begin
 select id into root from public.formula_families where company_id=c and code='F000001';
 begin update public.formula_families set code='F999999' where id=root;raise exception 'Code editable';exception when raise_exception then if sqlerrm='Code editable' then raise;end if;end;
 begin insert into public.formulas(company_id,product_id,family_id,name,version) values(c,'67000000-0000-0000-0000-000000000001',root,'Repeated version',1);raise exception 'Duplicate version accepted';exception when unique_violation then null;end;
 begin insert into public.formula_families(company_id,product_id,code,formula_origen_id) values(c,'67000000-0000-0000-0000-000000000001','ignored',(select id from public.formula_families where company_id=c and code='F000002'));raise exception 'Variation root accepted';exception when raise_exception then if sqlerrm='Variation root accepted' then raise;end if;end;

 begin update public.formula_families set formula_origen_id=(select id from public.formula_families where company_id=c and code='F000002') where id=root;raise exception 'Cycle allowed';exception when raise_exception then if sqlerrm='Cycle allowed' then raise;end if;end;
 other:='67000000-0000-0000-0000-000000000002';
 begin insert into public.formula_families(company_id,product_id,code,formula_origen_id) values('37000000-0000-0000-0000-000000000002',other,'x',root);raise exception 'Cross tenant origin accepted';exception when raise_exception then if sqlerrm='Cross tenant origin accepted' then raise;end if;end;
 -- Deleting a never-used empty family cannot recycle its assigned code.
 insert into public.formula_families(company_id,product_id,code) values(c,'67000000-0000-0000-0000-000000000001','ignored') returning id,code into other,last_code;
 -- Reserved number remains consumed regardless of later lifecycle.
 if access_private.next_formula_code(c)=last_code then raise exception 'Code reused';end if;
 if(select unit_id from public.products where id='67000000-0000-0000-0000-000000000001')<>'47000000-0000-0000-0000-000000000001'::uuid then raise exception 'Commercial unit altered';end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','17000000-0000-0000-0000-000000000003',true);
do $$begin
 if(select count(*) from public.formula_families where company_id='37000000-0000-0000-0000-000000000002')<>0 then raise exception 'Tenant families leaked';end if;
 begin perform public.formula_command('37000000-0000-0000-0000-000000000001','notes',gen_random_uuid(),'{"own_reference":"bypass"}');raise exception 'Viewer wrote reference';exception when insufficient_privilege then null;end;
end $$;
select 'PASS: automatic codes, roots, variation ancestry, independent duplicates, versions, optional unique references, estimates, densities, presentation validation, non-reuse and tenant permissions' result;
rollback;

