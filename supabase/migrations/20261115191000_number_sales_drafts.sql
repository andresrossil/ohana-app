create or replace function access_private.assign_customer_invoice_number()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  prefix text;
  seq bigint;
  candidate text;
begin
  if tg_op='UPDATE' then
    if old.invoice_number is not null then
      if new.customer_id is distinct from old.customer_id
        or new.invoice_number is distinct from old.invoice_number
        or new.customer_sequence is distinct from old.customer_sequence then
        raise exception 'Un pedido numerado conserva su cliente y número';
      end if;
      return new;
    end if;
    if old.fulfillment_stage<>'draft' then return new; end if;
  end if;

  if new.status<>'pending' or (
    new.fulfillment_stage<>'draft'
    and (tg_op='INSERT' or new.fulfillment_stage<>'invoiced')
  ) then return new; end if;

  perform pg_advisory_xact_lock(hashtextextended('invoice-number:'||new.company_id::text,0));
  select code into prefix from public.business_partners
    where company_id=new.company_id and id=new.customer_id;
  if nullif(trim(prefix),'') is null then
    raise exception 'El cliente necesita un código para numerar el pedido';
  end if;

  select coalesce(max(customer_sequence),0)+1 into seq from public.sales_orders
    where company_id=new.company_id and customer_id=new.customer_id and customer_sequence is not null;
  loop
    candidate:=prefix||'-'||lpad(seq::text,greatest(4,length(seq::text)),'0');
    exit when not exists(select 1 from public.sales_orders
      where company_id=new.company_id and invoice_number=candidate);
    seq:=seq+1;
  end loop;
  new.customer_sequence:=seq;
  new.invoice_number:=candidate;
  return new;
end $$;

create or replace trigger sale_customer_invoice_number
  before insert or update of fulfillment_stage,customer_id,invoice_number,customer_sequence
  on public.sales_orders for each row execute function access_private.assign_customer_invoice_number();

do $$
declare draft record;
begin
  for draft in
    select id,company_id from public.sales_orders
      where fulfillment_stage='draft' and status='pending' and invoice_number is null
      order by company_id,created_at,id
  loop
    update public.sales_orders set invoice_number=null, revision=revision+1
      where company_id=draft.company_id and id=draft.id and invoice_number is null;
  end loop;
end $$;
