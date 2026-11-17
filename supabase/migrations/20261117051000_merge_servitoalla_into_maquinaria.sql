-- Merge the historical movements into the existing fund in the same company.
with target as (
  select company_id, min(fund_key) fund_key
  from public.fund_movements
  where upper(trim(fund_name))='MAQUINARIA'
  group by company_id
  having count(distinct fund_key)=1
)
update public.fund_movements m
set fund_key=target.fund_key, fund_name='MAQUINARIA'
from target
where m.company_id=target.company_id and upper(trim(m.fund_name)) in ('SERVITOALLA','SERVITOALLAS');
