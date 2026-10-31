begin;
insert into auth.users(id,email,email_confirmed_at) values('15000000-0000-0000-0000-000000000001','corp@example.invalid',now()),('15000000-0000-0000-0000-000000000002','company@example.invalid',now()),('15000000-0000-0000-0000-000000000003','operator@example.invalid',now()),('15000000-0000-0000-0000-000000000004','viewer@example.invalid',now()),('15000000-0000-0000-0000-000000000005','platform@example.invalid',now());
insert into public.corporations(id,name) values('25000000-0000-0000-0000-000000000001','One'),('25000000-0000-0000-0000-000000000002','Other');
insert into public.corporation_members(corporation_id,user_id) values('25000000-0000-0000-0000-000000000001','15000000-0000-0000-0000-000000000001');
insert into public.companies(id,name,corporation_id) values('35000000-0000-0000-0000-000000000001','Business','25000000-0000-0000-0000-000000000001'),('35000000-0000-0000-0000-000000000002','Other business','25000000-0000-0000-0000-000000000002');
insert into public.company_members(company_id,user_id,role) values('35000000-0000-0000-0000-000000000001','15000000-0000-0000-0000-000000000002','admin'),('35000000-0000-0000-0000-000000000001','15000000-0000-0000-0000-000000000003','editor'),('35000000-0000-0000-0000-000000000001','15000000-0000-0000-0000-000000000004','viewer');
insert into public.units(company_id,name,symbol,dimension,base_factor) values('35000000-0000-0000-0000-000000000001','Gramo','g','mass',1);
insert into access_private.platform_admins values('15000000-0000-0000-0000-000000000005');
insert into public.company_settings(company_id,appearance) values('35000000-0000-0000-0000-000000000001','{"primary":"#123456"}');
set local role authenticated;select set_config('request.jwt.claim.sub','15000000-0000-0000-0000-000000000001',true);
select public.save_company_icons('35000000-0000-0000-0000-000000000001','{"module.materials":"flower","action.save":"save"}');
do $$begin
 if public.company_icons('35000000-0000-0000-0000-000000000001')->>'module.materials'<>'flower' then raise exception 'Persistence failed';end if;
 if(select appearance from public.company_settings where company_id='35000000-0000-0000-0000-000000000001')<>'{"primary":"#123456"}'::jsonb then raise exception 'Store appearance changed';end if;
 begin perform public.save_company_icons('35000000-0000-0000-0000-000000000002','{}');raise exception 'Cross company edit';exception when insufficient_privilege then null;end;
 begin perform public.save_company_icons('35000000-0000-0000-0000-000000000001','{"action.save":"arbitrary-svg-url"}');raise exception 'Unknown icon accepted';exception when check_violation then null;end;
 begin perform public.save_company_icons('35000000-0000-0000-0000-000000000001','{"status.warning":"flower"}');raise exception 'Warning changed';exception when check_violation then null;end;
end $$;
select set_config('request.jwt.claim.sub','15000000-0000-0000-0000-000000000003',true);
do $$begin
 if public.company_icons('35000000-0000-0000-0000-000000000001')->>'module.materials'<>'flower' then raise exception 'Operator cannot read';end if;
 begin perform public.save_company_icons('35000000-0000-0000-0000-000000000001','{}');raise exception 'Operator changed icons';exception when insufficient_privilege then null;end;
end $$;
select set_config('request.jwt.claim.sub','15000000-0000-0000-0000-000000000005',true);
do $$begin begin perform public.company_icons('35000000-0000-0000-0000-000000000001');raise exception 'Platform bypass';exception when insufficient_privilege then null;end;end $$;
select set_config('request.jwt.claim.sub','15000000-0000-0000-0000-000000000002',true);
select public.save_company_icons('35000000-0000-0000-0000-000000000001','{}');
select 'PASS: manager writes, operator reads, tenant isolation, no platform bypass, allowlisted identifiers, protected warnings and restore' as result;
rollback;
