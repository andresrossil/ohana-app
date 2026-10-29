alter table public.price_history alter column created_at set default clock_timestamp();
alter table public.price_history add constraint price_amount_finite check(amount <> 'NaN'::numeric);
alter table public.presentations add constraint presentation_quantity_finite check(quantity <> 'NaN'::numeric);
alter table public.units add constraint unit_factor_finite check(base_factor <> 'NaN'::numeric);
