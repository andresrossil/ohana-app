create or replace view public.material_sheet with(security_invoker=true) as
select p.id,p.company_id,p.raw_material_id,p.supplier_id,p.unit_id,p.quantity,p.capacity,p.comment,p.active,
 p.name as presentation_name,p.product_url,m.name as material_name,m.alternative_name,m.notes as material_notes,
 s.name as supplier_name,u.symbol as unit_symbol,u.name as unit_name,u.dimension,u.base_factor,
 h.id as price_id,h.amount,h.currency,h.effective_on,h.created_at as price_created_at,
 h.amount/p.quantity as unit_price,
 case when prev.id is not null then prev.normalized_unit_price
      when h.legacy_previous_basis='unit' then h.legacy_previous_amount
      when h.legacy_previous_basis='presentation' then h.legacy_previous_amount/p.quantity end as previous_unit_price,
 case when prev.id is not null then prev.normalized_unit_price
      else h.legacy_previous_amount end as previous_display,
 coalesce(prev.supplier_name,h.legacy_previous_supplier) as previous_supplier,
 prev.effective_on as previous_date,
 case when prev.id is not null then 'history' else h.legacy_previous_basis end as previous_basis,
 h.legacy_previous_amount,h.legacy_previous_supplier,h.legacy_previous_basis,h.legacy_previous_date
from public.presentations p
join public.raw_materials m on m.id=p.raw_material_id and m.company_id=p.company_id
join public.suppliers s on s.id=p.supplier_id and s.company_id=p.company_id
join public.units u on u.id=p.unit_id and u.company_id=p.company_id
left join lateral (
 select * from public.price_history h where h.company_id=p.company_id and h.presentation_id=p.id and h.effective_on <= current_date
 order by h.effective_on desc,h.created_at desc,h.id desc limit 1
) h on true
left join lateral (
 select ph.id,ph.effective_on,ps.name as supplier_name,
 ph.amount/pp.quantity*(u.base_factor/pu.base_factor) as normalized_unit_price
 from public.price_history ph
 join public.presentations pp on pp.company_id=ph.company_id and pp.id=ph.presentation_id
 join public.units pu on pu.company_id=pp.company_id and pu.id=pp.unit_id
 join public.suppliers ps on ps.company_id=pp.company_id and ps.id=pp.supplier_id
 where ph.company_id=p.company_id and pp.raw_material_id=p.raw_material_id
 and pu.dimension=u.dimension and ph.currency=h.currency
 and (ph.effective_on,ph.created_at,ph.id)<(h.effective_on,h.created_at,h.id)
 order by ph.effective_on desc,ph.created_at desc,ph.id desc limit 1
) prev on true;

-- Enforce the same canonical names through classic forms and Data API writes.
drop index public.suppliers_catalog_key_idx;
drop index public.materials_catalog_key_idx;
drop index public.units_catalog_key_idx;
create unique index suppliers_catalog_key_idx on public.suppliers(company_id,public.catalog_key(name));
create unique index materials_catalog_key_idx on public.raw_materials(company_id,public.catalog_key(name));
create unique index units_catalog_key_idx on public.units(company_id,public.catalog_key(symbol));
