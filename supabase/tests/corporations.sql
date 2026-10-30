begin;
insert into auth.users(id,email,email_confirmed_at) values('15000000-0000-0000-0000-000000000001','corp@example.invalid',now()),('15000000-0000-0000-0000-000000000002','company@example.invalid',now()),('15000000-0000-0000-0000-000000000003','operator@example.invalid',now()),('15000000-0000-0000-0000-000000000004','viewer@example.invalid',now()),('15000000-0000-0000-0000-000000000005','platform@example.invalid',now());
insert into public.corporations(id,name) values('25000000-0000-0000-0000-000000000001','One'),('25000000-0000-0000-0000-000000000002','Other');
insert into public.corporation_members(corporation_id,user_id) values('25000000-0000-0000-0000-000000000001','15000000-0000-0000-0000-000000000001');
insert into public.companies(id,name,corporation_id) values('35000000-0000-0000-0000-000000000001','Business','25000000-0000-0000-0000-000000000001'),('35000000-0000-0000-0000-000000000002','Other business','25000000-0000-0000-0000-000000000002');
insert into public.company_members(company_id,user_id,role) values('35000000-0000-0000-0000-000000000001','15000000-0000-0000-0000-000000000002','admin'),('35000000-0000-0000-0000-000000000001','15000000-0000-0000-0000-000000000003','editor'),('35000000-0000-0000-0000-000000000001','15000000-0000-0000-0000-000000000004','viewer');
insert into public.units(company_id,name,symbol,dimension,base_factor) values('35000000-0000-0000-0000-000000000001','Gramo','g','mass',1);
insert into access_private.platform_admins values('15000000-0000-0000-0000-000000000005');
set local role authenticated;
select set_config('request.jwt.claim.sub','15000000-0000-0000-0000-000000000001',true);
do $$ declare c uuid:='35000000-0000-0000-0000-000000000001'; newcorp uuid; newcompany uuid;begin
 if not public.company_permission(c,'manage') then raise exception 'Corporation admin cannot manage';end if;
 if public.company_permission('35000000-0000-0000-0000-000000000002','read') then raise exception 'Cross tenant access';end if;
 newcorp:=public.manage_structure('create_corporation',null,'New corporation');
 newcompany:=public.manage_structure('create_company',null,'New company',newcorp);
 if not public.company_permission(newcompany,'write') then raise exception 'Creator not associated';end if;
 perform public.manage_structure('rename_corporation',newcorp,'Renamed corporation');
 if (select name from public.companies where id=newcompany)<>'New company' then raise exception 'Names coupled';end if;
 perform public.save_material_sheet(c,gen_random_uuid(),'[{"material":"Corporate editor test","quantity":1,"unit":"g"}]');
 perform public.save_company_settings(c,'Renamed business','GTQ','{"country":"GT","social":{"website":{"url":"https://example.com","visible":true}}}','{"primary":"#123456","font":"Arial"}');
 begin perform public.save_company_settings(c,'Business','GTQ','{"country":"GT"}','{"font":"url(evil)"}');raise exception 'Unsafe appearance';exception when others then if sqlerrm='Unsafe appearance' then raise;end if;end;
 begin perform public.assign_member(c,'corp@example.invalid','admin');raise exception 'Self role mutation';exception when insufficient_privilege then null;end;
 if exists(select 1 from public.companies where id='35000000-0000-0000-0000-000000000002') then raise exception 'RLS leak';end if;
end $$;
select set_config('request.jwt.claim.sub','15000000-0000-0000-0000-000000000002',true);
do $$begin
 if not public.company_permission('35000000-0000-0000-0000-000000000001','manage') then raise exception 'Company admin denied';end if;
 begin perform public.manage_structure('create_corporation',null,'Denied');raise exception 'Company admin created corporation';exception when insufficient_privilege then null;end;
 begin perform public.manage_structure('create_company',null,'Denied','25000000-0000-0000-0000-000000000001');raise exception 'Company admin created company';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub','15000000-0000-0000-0000-000000000003',true);
do $$begin
 if not public.company_permission('35000000-0000-0000-0000-000000000001','write') then raise exception 'Existing editor access lost';end if;
 begin perform public.save_company_settings('35000000-0000-0000-0000-000000000001','Bad','GTQ','{"country":"GT"}','{}');raise exception 'Operator changed settings';exception when insufficient_privilege then null;end;
 begin perform public.assign_member('35000000-0000-0000-0000-000000000001','viewer@example.invalid','admin');raise exception 'Operator escalated role';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub','15000000-0000-0000-0000-000000000004',true);
do $$begin
 if not public.company_permission('35000000-0000-0000-0000-000000000001','read') or public.company_permission('35000000-0000-0000-0000-000000000001','write') then raise exception 'Viewer compatibility';end if;
end $$;
select set_config('request.jwt.claim.sub','15000000-0000-0000-0000-000000000005',true);
do $$begin
 if not public.can_create_corporation() then raise exception 'Platform creation denied';end if;
 if public.company_permission('35000000-0000-0000-0000-000000000001','read') or exists(select 1 from public.raw_materials) then raise exception 'Platform role got commercial access';end if;
 begin insert into access_private.platform_admins values(auth.uid());raise exception 'Platform role writable';exception when insufficient_privilege then null;end;
end $$;
set local role anon;
do $$begin begin perform public.company_context();raise exception 'Anonymous context';exception when insufficient_privilege then null;end;end $$;
select 'PASS: corporate creation, independent names, company roles, no self-escalation, settings, legacy catalog and platform isolation' as result;
rollback;
