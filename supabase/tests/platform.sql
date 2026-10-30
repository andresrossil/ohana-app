begin;
insert into auth.users(id,email,email_confirmed_at)values('16000000-0000-0000-0000-000000000001','global@example.invalid',now()),('16000000-0000-0000-0000-000000000002','normal@example.invalid',now());
insert into access_private.platform_admins values('16000000-0000-0000-0000-000000000001');
set local role authenticated;select set_config('request.jwt.claim.sub','16000000-0000-0000-0000-000000000002',true);
do $$begin if public.platform_access() then raise exception 'Unassigned global access';end if;begin perform public.platform_admin('role','{"user":"16000000-0000-0000-0000-000000000002","enabled":true}');raise exception 'Self elevation';exception when insufficient_privilege then null;end;end $$;
select set_config('request.jwt.claim.sub','16000000-0000-0000-0000-000000000001',true);
do $$declare data jsonb;begin
 data:=public.platform_admin('list');if jsonb_array_length(data->'users')<2 then raise exception 'Global directory denied';end if;
 begin perform public.platform_admin('role','{"user":"16000000-0000-0000-0000-000000000001","enabled":false}');raise exception 'Self role mutation';exception when insufficient_privilege then null;end;
 perform public.platform_admin('role','{"user":"16000000-0000-0000-0000-000000000002","enabled":true}');
 perform public.platform_admin('currency','{"code":"JPY","name":"Yen japonés","active":true}');
end $$;
select set_config('request.jwt.claim.sub','16000000-0000-0000-0000-000000000002',true);
do $$begin if not public.platform_access() then raise exception 'Explicit grant failed';end if;if exists(select 1 from public.companies)or exists(select 1 from public.sales_orders)then raise exception 'Global role acquired private company access';end if;end $$;
select 'PASS: explicit platform assignment, no self-elevation, global catalog controls, no commercial access' as result;
rollback;
