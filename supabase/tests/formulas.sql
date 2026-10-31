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
do $$declare c uuid:='37000000-0000-0000-0000-000000000001';f1 uuid;f2 uuid;v uuid;copy_id uuid;b uuid;k uuid:=gen_random_uuid();p jsonb;out jsonb;cat jsonb;begin
 cat:=public.formula_catalog(c);
 if (select(x->>'unit_cost')::numeric from jsonb_array_elements(cat->'materials')x where x->>'id'='57000000-0000-0000-0000-000000000001')<>0.05 then raise exception 'Wrong quote conversion/currency';end if;
 if (select x->>'unit_cost' from jsonb_array_elements(cat->'materials')x where x->>'id'='57000000-0000-0000-0000-000000000003') is not null then raise exception 'Unknown cost fabricated';end if;
 p:='{"kind":"new","product":"67000000-0000-0000-0000-000000000001","name":"Base","code":"F0001","state":"current","capture_mode":"percentage","total_quantity":1000,"total_unit":"47000000-0000-0000-0000-000000000001","loss_enabled":true,"loss_percent":5,"ingredients":[{"material":"57000000-0000-0000-0000-000000000001","unit":"47000000-0000-0000-0000-000000000001","percentage":60,"line_kind":"ingredient"},{"material":"57000000-0000-0000-0000-000000000002","unit":"47000000-0000-0000-0000-000000000002","percentage":40,"line_kind":"ingredient"},{"material":"57000000-0000-0000-0000-000000000004","unit":"47000000-0000-0000-0000-000000000004","quantity":2,"line_kind":"packaging"}]}';
 out:=public.formula_command(c,'save',k,p);f1:=(out->>'id')::uuid;
 if public.formula_command(c,'save',k,p)<>out then raise exception 'Formula retry duplicated';end if;
 if (select quantity from public.formula_ingredients where company_id=c and formula_id=f1 and material_id='57000000-0000-0000-0000-000000000001')<>600 or (select quantity from public.formula_ingredients where company_id=c and formula_id=f1 and material_id='57000000-0000-0000-0000-000000000002')<>0.4 then raise exception 'Percentages do not respect units';end if;
 if (select sum(percentage) from public.formula_ingredients where formula_id=f1)<>100 then raise exception 'Packaging affected 100 percent';end if;
 if (select standard_yield from public.formulas where id=f1) is not null then raise exception 'Yield introduced';end if;
 if exists(select 1 from public.inventory_movements where company_id=c) then raise exception 'Formula/loss changed stock';end if;
 begin perform public.formula_command(c,'save',gen_random_uuid(),jsonb_set(p,'{ingredients,0,percentage}','50'));raise exception '90 percent accepted';exception when raise_exception then if sqlerrm='90 percent accepted' then raise;end if;end;
 begin perform public.formula_command(c,'save',gen_random_uuid(),jsonb_set(p,'{ingredients,1}',p#>'{ingredients,0}'));raise exception 'Duplicate material accepted';exception when raise_exception then if sqlerrm='Duplicate material accepted' then raise;end if;end;
 begin perform public.formula_command(c,'save',gen_random_uuid(),jsonb_set(p,'{ingredients,1}','{"material":"57000000-0000-0000-0000-000000000003","unit":"47000000-0000-0000-0000-000000000003","percentage":40,"line_kind":"ingredient"}'));raise exception 'Mixed dimensions accepted';exception when raise_exception then if sqlerrm='Mixed dimensions accepted' then raise;end if;end;
 f2:=(public.formula_command(c,'save',gen_random_uuid(),p||jsonb_build_object('kind','version','source',f1))->>'id')::uuid;
 if (select version from public.formulas where id=f2)<>2 or (select family_id from public.formulas where id=f2)<>(select family_id from public.formulas where id=f1) then raise exception 'Version lineage incorrect';end if;
 if (select state from public.formulas where id=f1)<>'inactive' then raise exception 'Two current versions';end if;
 out:=public.formula_command(c,'save',gen_random_uuid(),p||jsonb_build_object('kind','variation','source',f2,'code','F0002'));
 if jsonb_array_length(out->'duplicates')<1 or out?'id' then raise exception 'Identical composition not warned';end if;
 v:=(public.formula_command(c,'save',gen_random_uuid(),p||jsonb_build_object('kind','variation','source',f2,'code','F0002','confirm_duplicate',true))->>'id')::uuid;
 if (select family_id from public.formulas where id=v)=(select family_id from public.formulas where id=f2) or (select product_id from public.formulas where id=v)<>(select product_id from public.formulas where id=f2) then raise exception 'Variation not independent/same product';end if;
 copy_id:=(public.formula_command(c,'save',gen_random_uuid(),p||jsonb_build_object('kind','duplicate','source',f2,'product','67000000-0000-0000-0000-000000000002','code','F0003'))->>'id')::uuid;
 if copy_id is null or (select version from public.formulas where id=copy_id)<>1 then raise exception 'Cross-product copy blocked';end if;
 if (select count(*) from public.formula_ingredients where formula_id=copy_id)<>3 then raise exception 'Copy lost packaging';end if;
 begin perform public.formula_command(c,'save',gen_random_uuid(),p||jsonb_build_object('kind','version','source',f2,'product','67000000-0000-0000-0000-000000000002'));raise exception 'Cross product revision accepted';exception when raise_exception then if sqlerrm='Cross product revision accepted' then raise;end if;end;
 begin perform public.formula_command(c,'save',gen_random_uuid(),p||jsonb_build_object('code','f0001','confirm_duplicate',true));raise exception 'Duplicate code accepted';exception when unique_violation then null;end;
 out:=public.formula_command(c,'save',gen_random_uuid(),p||'{"kind":"variation","code":"F0004","capture_mode":"quantity","ingredients":[{"material":"57000000-0000-0000-0000-000000000001","unit":"47000000-0000-0000-0000-000000000001","quantity":1200,"line_kind":"ingredient"},{"material":"57000000-0000-0000-0000-000000000002","unit":"47000000-0000-0000-0000-000000000002","quantity":0.8,"line_kind":"ingredient"},{"material":"57000000-0000-0000-0000-000000000004","unit":"47000000-0000-0000-0000-000000000004","quantity":4,"line_kind":"packaging"}]}'::jsonb||jsonb_build_object('source',f2));
 if not(out?'id') then raise exception 'Simple scaling flagged duplicate';end if;
 begin perform public.operations(c,'batch_start',gen_random_uuid(),jsonb_build_object('formula',f1,'quantity',10,'formula_scale',2,'date',current_date,'available_on',current_date));raise exception 'Inactive recipe used';exception when raise_exception then if sqlerrm='Inactive recipe used' then raise;end if;end;
 b:=(public.operations(c,'batch_start',gen_random_uuid(),jsonb_build_object('formula',f2,'quantity',10,'formula_scale',2,'date',current_date,'available_on',current_date))->>'id')::uuid;
 perform public.formula_command(c,'state',gen_random_uuid(),jsonb_build_object('id',f2,'state','inactive'));
 if (select formula_id from public.production_batches where id=b)<>f2 or (select formula_scale from public.production_batches where id=b)<>2 then raise exception 'Batch reference lost';end if;
 -- Loss is informational: production consumes the actual entered amounts once.
 perform public.operations(c,'receive',gen_random_uuid(),jsonb_build_object('material','57000000-0000-0000-0000-000000000001','unit','47000000-0000-0000-0000-000000000001','quantity',2000,'amount',100,'date',current_date));
 perform public.operations(c,'receive',gen_random_uuid(),jsonb_build_object('material','57000000-0000-0000-0000-000000000002','unit','47000000-0000-0000-0000-000000000001','quantity',2000,'amount',200,'date',current_date));
 perform public.operations(c,'receive',gen_random_uuid(),jsonb_build_object('material','57000000-0000-0000-0000-000000000004','unit','47000000-0000-0000-0000-000000000004','quantity',10,'amount',20,'date',current_date));
 v:=(public.operations(c,'variant_save',gen_random_uuid(),'{"product":"67000000-0000-0000-0000-000000000001","name":"Salida de prueba","price":10,"weight_min":50,"weight_max":60}')->>'id')::uuid;
 p:=jsonb_build_object('batch',b,'consumptions',jsonb_build_array(jsonb_build_object('material','57000000-0000-0000-0000-000000000001','unit','47000000-0000-0000-0000-000000000001','quantity',1200),jsonb_build_object('material','57000000-0000-0000-0000-000000000002','unit','47000000-0000-0000-0000-000000000002','quantity',0.8),jsonb_build_object('material','57000000-0000-0000-0000-000000000004','unit','47000000-0000-0000-0000-000000000004','quantity',4)),'outputs',jsonb_build_array(jsonb_build_object('variant',v,'quantity',10)));
 perform public.operations(c,'batch_finish',gen_random_uuid(),p);perform public.operations(c,'batch_finish',gen_random_uuid(),p);
 if (select on_hand from public.inventory_balances where company_id=c and item_id='57000000-0000-0000-0000-000000000001')<>800 or (select on_hand from public.inventory_balances where company_id=c and item_id='57000000-0000-0000-0000-000000000002')<>1200 or (select on_hand from public.inventory_balances where company_id=c and item_id='57000000-0000-0000-0000-000000000004')<>6 then raise exception 'Loss or retry duplicated consumption';end if;
 if (select total_cost from public.production_batches where id=b)<>148 then raise exception 'Actual cost changed by informative loss';end if;
 begin perform public.formula_command('37000000-0000-0000-0000-000000000002','list');raise exception 'Cross tenant read';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub','17000000-0000-0000-0000-000000000002',true);
do $$begin perform public.formula_command('37000000-0000-0000-0000-000000000001','list');perform public.formula_catalog('37000000-0000-0000-0000-000000000001');end $$;
select set_config('request.jwt.claim.sub','17000000-0000-0000-0000-000000000003',true);
do $$begin
 if not exists(select 1 from public.formula_families where company_id='37000000-0000-0000-0000-000000000001') then raise exception 'Viewer cannot read';end if;
 begin perform public.formula_command('37000000-0000-0000-0000-000000000001','state',gen_random_uuid(),'{}');raise exception 'Viewer changed state';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub','17000000-0000-0000-0000-000000000004',true);
do $$begin
 if exists(select 1 from public.formula_families) then raise exception 'Platform bypass';end if;
 begin perform public.formula_catalog('37000000-0000-0000-0000-000000000001');raise exception 'Platform RPC bypass';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$begin
 begin update public.formulas set name='Mutate revision' where company_id='37000000-0000-0000-0000-000000000001';raise exception 'Revision mutated';exception when raise_exception then if sqlerrm='Revision mutated' then raise;end if;end;
 begin update public.formula_ingredients set quantity=quantity*2 where company_id='37000000-0000-0000-0000-000000000001';raise exception 'Old ingredient mutated';exception when raise_exception then if sqlerrm='Old ingredient mutated' then raise;end if;end;
end $$;
select 'PASS: formula revisions, percentages, unit conversions, packaging, costs, duplicate controls, independent copies, batch scales, immutable history and tenant permissions' result;
rollback;
