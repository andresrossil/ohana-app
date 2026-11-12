create index if not exists sales_orders_company_created_id_idx
  on public.sales_orders (company_id, created_at desc, id desc);

create index if not exists sales_orders_customer_created_id_idx
  on public.sales_orders (company_id, customer_id, created_at desc, id desc);

create index if not exists courier_settlement_items_active_order_idx
  on public.courier_settlement_items (company_id, order_id) where active;
