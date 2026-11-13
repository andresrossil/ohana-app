create table access_private.customer_code_start (
  company_id uuid primary key references public.companies(id) on delete cascade,
  first_number bigint not null check (first_number between 1 and 999999999999)
);
revoke all on access_private.customer_code_start from public,anon,authenticated;

do $migration$
declare target_company uuid;
begin
  select id into strict target_company from public.companies where lower(trim(name))='ohana';
  insert into access_private.customer_code_start(company_id,first_number) values(target_company,910);
end $migration$;

create or replace function access_private.next_partner_code(c uuid,t text)
returns text language sql stable security definer set search_path='' as $function$
  with next_code as (
    select greatest(
      coalesce(max(substring(code from '[0-9]+$')::bigint),0)+1,
      case when t='supplier' or t='courier' then 1
        else coalesce((select first_number from access_private.customer_code_start where company_id=c),1)
      end
    )::text as number
    from public.business_partners
    where company_id=c
      and code ~ case when t='supplier' then '^PR[0-9]{1,12}$'
        when t='courier' then '^MS[0-9]{1,12}$' else '^C[0-9]{1,12}$' end
  )
  select (case when t='supplier' then 'PR' when t='courier' then 'MS' else 'C' end)
    ||lpad(number,greatest(4,length(number)),'0') from next_code
$function$;
