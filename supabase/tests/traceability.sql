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
do $$declare c uuid:='37000000-0000-0000-0000-000000000001';f uuid;f2 uuid;b uuid;v uuid;k uuid:=gen_random_uuid();p jsonb;out jsonb;recipe jsonb;hash text;rev integer;begin
 p:='{"kind":"new","product":"67000000-0000-0000-0000-000000000001","name":"Receta inicial","code":"F0001","state":"current","capture_mode":"quantity","loss_enabled":true,"loss_percent":5,"ingredients":[{"material":"57000000-0000-0000-0000-000000000003","unit":"47000000-0000-0000-0000-000000000003","quantity":200,"density_g_ml":0.9,"line_kind":"ingredient"},{"material":"57000000-0000-0000-0000-000000000004","unit":"47000000-0000-0000-0000-000000000004","quantity":2,"line_kind":"packaging"}]}';
 f:=(public.formula_command(c,'save',gen_random_uuid(),p)->>'id')::uuid;
 p:=jsonb_set(p,'{ingredients,0,quantity}','230')||jsonb_build_object('kind','edit','source',f,'edit_revision',1,'name','Receta corregida');
 out:=public.formula_command(c,'edit',k,p);
 if (out->>'id')::uuid<>f or(out->>'version')::int<>1 or(select count(*) from public.formulas where company_id=c)<>1 then raise exception 'Correction created version';end if;
 if public.formula_command(c,'edit',k,p)<>out then raise exception 'Edit not idempotent';end if;
 if(select quantity from public.formula_ingredients where formula_id=f and material_id='57000000-0000-0000-0000-000000000003')<>230 then raise exception 'Current version was not editable';end if;
 begin perform public.formula_command(c,'edit',gen_random_uuid(),p);raise exception 'Stale edit accepted';exception when serialization_failure then null;end;
 b:=(public.production_command(c,'draft_save',gen_random_uuid(),jsonb_build_object('product','67000000-0000-0000-0000-000000000001','quantity',10,'formula_scale',1,'date',current_date,'available_on',current_date))->>'id')::uuid;
 if(select formula_id from public.production_batches where id=b) is not null then raise exception 'Draft invented formula';end if;
 begin perform public.production_command(c,'start',gen_random_uuid(),jsonb_build_object('id',b));raise exception 'Missing version accepted';exception when raise_exception then if sqlerrm='Missing version accepted' then raise;end if;end;
 begin perform public.production_command(c,'draft_save',gen_random_uuid(),jsonb_build_object('id',b,'product','67000000-0000-0000-0000-000000000002','formula',f,'quantity',10,'date',current_date,'available_on',current_date));raise exception 'Wrong product accepted';exception when raise_exception then if sqlerrm='Wrong product accepted' then raise;end if;end;
 perform public.production_command(c,'draft_save',gen_random_uuid(),jsonb_build_object('id',b,'product','67000000-0000-0000-0000-000000000001','formula',f,'quantity',10,'date',current_date,'available_on',current_date));
 perform public.production_command(c,'start',gen_random_uuid(),jsonb_build_object('id',b));
 p:=p||jsonb_build_object('edit_revision',2);perform public.formula_command(c,'edit',gen_random_uuid(),p);
 select edit_revision into rev from public.formulas where id=f;
 if rev<>3 then raise exception 'Unconfirmed preparation locked correction';end if;
 perform public.operations(c,'receive',gen_random_uuid(),'{"material":"57000000-0000-0000-0000-000000000003","unit":"47000000-0000-0000-0000-000000000003","quantity":1000,"amount":100}'::jsonb||jsonb_build_object('date',current_date));
 perform public.operations(c,'receive',gen_random_uuid(),'{"material":"57000000-0000-0000-0000-000000000004","unit":"47000000-0000-0000-0000-000000000004","quantity":10,"amount":20}'::jsonb||jsonb_build_object('date',current_date));
 v:=(public.operations(c,'variant_save',gen_random_uuid(),'{"product":"67000000-0000-0000-0000-000000000001","name":"Variante","price":10,"weight_min":50,"weight_max":60}')->>'id')::uuid;
 recipe:=jsonb_build_object('batch',b,'expected_revision',rev,'consumptions',jsonb_build_array(jsonb_build_object('material','57000000-0000-0000-0000-000000000003','unit','47000000-0000-0000-0000-000000000003','quantity',235),jsonb_build_object('material','57000000-0000-0000-0000-000000000004','unit','47000000-0000-0000-0000-000000000004','quantity',3)),'outputs',jsonb_build_array(jsonb_build_object('variant',v,'quantity',10)));
 begin perform public.operations(c,'batch_finish',gen_random_uuid(),recipe||jsonb_build_object('expected_revision',1));raise exception 'Stale production accepted';exception when serialization_failure then null;end;
 begin perform public.operations(c,'batch_finish',gen_random_uuid(),jsonb_set(recipe,'{outputs,0,variant}','"99000000-0000-0000-0000-000000000001"'));raise exception 'Bad output accepted';exception when no_data_found then null;end;
 if exists(select 1 from public.batch_consumptions where company_id=c and batch_id=b) or(select on_hand from public.inventory_balances where company_id=c and item_id='57000000-0000-0000-0000-000000000003')<>1000 then raise exception 'Partial consumption persisted';end if;
 k:=gen_random_uuid();out:=public.operations(c,'batch_finish',k,recipe);perform public.operations(c,'batch_finish',k,recipe);perform public.operations(c,'batch_finish',gen_random_uuid(),recipe);
 if (select on_hand from public.inventory_balances where company_id=c and item_id='57000000-0000-0000-0000-000000000003')<>765 or(select on_hand from public.inventory_balances where company_id=c and item_id='57000000-0000-0000-0000-000000000004')<>7 then raise exception 'Actual consumption wrong or repeated';end if;
 select recipe_snapshot into recipe from public.production_batches where id=b;
 if(recipe->'lines'->0->>'density_g_ml')::numeric is distinct from 0.9 then raise exception 'Snapshot density missing';end if;
 if recipe#>>'{formula,name}'<>'Receta corregida' or(recipe#>>'{formula,version}')::int<>1 or(recipe->>'total_cost')::numeric<>29.5 or recipe#>>'{loss,enabled}'<>'true' then raise exception 'Wrong historical header/cost';end if;
 if not exists(select 1 from jsonb_array_elements(recipe->'lines')x where x->>'material_id'='57000000-0000-0000-0000-000000000003' and (x->>'planned_quantity')::numeric=230 and(x->>'actual_quantity')::numeric=235 and(x->>'applied_unit_cost')::numeric=0.1) then raise exception 'Planned/actual missing';end if;
 if not exists(select 1 from jsonb_array_elements(recipe->'lines')x where x->>'line_kind'='packaging' and(x->>'planned_quantity')::numeric=2 and(x->>'actual_quantity')::numeric=3) then raise exception 'Packaging history lost';end if;
 hash:=md5(recipe::text);
 begin perform public.formula_command(c,'edit',gen_random_uuid(),p||jsonb_build_object('edit_revision',rev));raise exception 'Used recipe edited';exception when sqlstate '55000' then null;end;
 perform public.formula_command(c,'notes',gen_random_uuid(),jsonb_build_object('id',f,'admin_notes','Nota administrativa permitida'));
 f2:=(public.formula_command(c,'save',gen_random_uuid(),jsonb_set(p,'{ingredients,0,quantity}','300')||jsonb_build_object('kind','version','source',f,'name','Receta nueva'))->>'id')::uuid;
 if f2=f or (select version from public.formulas where id=f2)<>2 then raise exception 'New version wrong';end if;
 update public.raw_materials set name='Nombre posterior' where company_id=c and id='57000000-0000-0000-0000-000000000003';
 update public.products set name='Producto posterior' where company_id=c and id='67000000-0000-0000-0000-000000000001';
 update public.units set name='Nombre posterior unidad',symbol='cc' where company_id=c and id='47000000-0000-0000-0000-000000000003';
 if md5((public.production_command(c,'detail',null,jsonb_build_object('id',b))->'snapshot')::text)<>hash then raise exception 'History changed with catalog/version';end if;
 if not exists(select 1 from jsonb_array_elements(public.formula_command(c,'list'))x,jsonb_array_elements(x->'used_batches')z where x->>'id'=f::text and x->>'locked'='true' and z->>'id'=b::text and z->>'confirmed'='true') then raise exception 'Formula batch trace absent';end if;
 begin perform public.production_command('37000000-0000-0000-0000-000000000002','detail',null,jsonb_build_object('id',b));raise exception 'Cross tenant trace';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub','17000000-0000-0000-0000-000000000003',true);
do $$declare c uuid:='37000000-0000-0000-0000-000000000001';b uuid;begin
 select id into b from public.production_batches where company_id=c limit 1;
 perform public.production_command(c,'detail',null,jsonb_build_object('id',b));
 begin perform public.production_command(c,'draft_save',gen_random_uuid(),'{}');raise exception 'Viewer wrote draft';exception when insufficient_privilege then null;end;
 begin perform public.formula_command(c,'edit',gen_random_uuid(),'{}');raise exception 'Viewer edited formula';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub','17000000-0000-0000-0000-000000000004',true);
do $$begin
 begin perform public.production_command('37000000-0000-0000-0000-000000000001','list');raise exception 'Platform bypass';exception when insufficient_privilege then null;end;
end $$;
reset role;
do $$begin
 begin update public.production_batches set recipe_snapshot=recipe_snapshot||'{"total_cost":999}' where company_id='37000000-0000-0000-0000-000000000001' and confirmed;raise exception 'Snapshot changed';exception when raise_exception then if sqlerrm='Snapshot changed' then raise;end if;end;
 begin update public.production_batches set formula_id=(select id from public.formulas where company_id='37000000-0000-0000-0000-000000000001' and version=2) where company_id='37000000-0000-0000-0000-000000000001' and confirmed;raise exception 'Confirmed formula reassigned';exception when raise_exception then if sqlerrm='Confirmed formula reassigned' then raise;end if;end;
end $$;
select 'PASS: direct corrections, confirmed locks, administrative notes, draft validation, immutable snapshots, planned/actual consumption, transaction rollback, retry safety and tenant permissions' result;
rollback;
