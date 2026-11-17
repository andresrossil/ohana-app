create table access_private.purchase_receipt_documents (
  company_id uuid not null references public.companies(id),
  id uuid not null default gen_random_uuid(),
  supplier_id uuid,
  received_on date not null,
  reference text not null,
  currency text not null references public.currencies(code),
  exchange_rate numeric not null check (exchange_rate > 0 and exchange_rate < 'Infinity'::numeric),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (company_id,id),
  foreign key (company_id,supplier_id) references public.business_partners(company_id,id)
);

alter table access_private.purchase_receipt_documents enable row level security;
revoke all on access_private.purchase_receipt_documents from public, anon, authenticated;

alter table public.purchase_receipts
  add column document_id uuid,
  add column document_line integer,
  add foreign key (company_id,document_id) references access_private.purchase_receipt_documents(company_id,id),
  add constraint purchase_receipt_document_line check (
    (document_id is null and document_line is null) or
    (document_id is not null and document_line is not null and document_line > 0)
  );
create unique index purchase_receipt_document_lines
  on public.purchase_receipts(company_id,document_id,document_line)
  where document_id is not null;

create function access_private.receive_purchase_document(c uuid, data jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare
  purchase_id uuid;
  receipt_id uuid;
  line record;
  header jsonb := jsonb_build_object('supplier',data->>'supplier','date',data->>'date',
    'reference',data->>'reference','currency',data->>'currency','exchange_rate',data->>'exchange_rate');
  company_currency text;
begin
  if jsonb_typeof(data->'lines') is distinct from 'array'
    or jsonb_array_length(data->'lines') not between 1 and 100 then
    raise exception 'Agrega entre 1 y 100 materiales';
  end if;

  select currency into strict company_currency from public.companies where id=c;
  insert into access_private.purchase_receipt_documents(company_id,supplier_id,received_on,reference,currency,exchange_rate)
  values(c,nullif(data->>'supplier','')::uuid,(data->>'date')::date,coalesce(data->>'reference',''),
    coalesce(data->>'currency',company_currency),
    case when coalesce(data->>'currency',company_currency)=company_currency then 1
         else nullif(data->>'exchange_rate','')::numeric end)
  returning id into purchase_id;

  for line in select value,ordinality from jsonb_array_elements(data->'lines') with ordinality loop
    begin
      receipt_id := (access_private.operations(c,'receive',gen_random_uuid(),
        jsonb_build_object('material',line.value->>'material','unit',line.value->>'unit',
          'quantity',line.value->>'quantity','amount',line.value->>'amount') || header)->>'id')::uuid;
      update public.purchase_receipts r set document_id=purchase_id,document_line=line.ordinality
      where r.company_id=c and r.id=receipt_id;
    exception when others then
      raise exception using errcode=sqlstate, message=format('Línea %s: %s',line.ordinality,sqlerrm);
    end;
  end loop;
  return jsonb_build_object('id',purchase_id);
end;
$$;

create function access_private.purchase_documents(c uuid)
returns jsonb language sql stable set search_path='' as $$
  with latest as (
    select coalesce(r.document_id,r.id) id,r.document_id,max(r.created_at) created_at
    from public.purchase_receipts r where r.company_id=c
    group by 1,2 order by created_at desc,id limit 100
  )
  select coalesce(jsonb_agg(to_jsonb(rows) order by rows.created_at desc, rows.id),'[]')
  from (
    select l.id,l.created_at,coalesce(d.received_on,r.received_on) received_on,
      coalesce(d.reference,r.reference) reference,coalesce(d.currency,r.currency) currency,
      coalesce(d.supplier_id,r.supplier_id) supplier_id,s.name supplier_name,
      sum(r.amount) as total, count(*) filter (where r.cancelled_at is not null) as cancelled_count,
      jsonb_agg(to_jsonb(r)||jsonb_build_object('material_name',m.name)
        order by r.document_line nulls last,r.id) lines
    from latest l join public.purchase_receipts r on r.company_id=c
      and (r.document_id=l.document_id or (l.document_id is null and r.id=l.id))
    join public.raw_materials m on m.company_id=c and m.id=r.material_id
    left join access_private.purchase_receipt_documents d on d.company_id=c and d.id=l.document_id
    left join public.business_partners s on s.company_id=c and s.id=coalesce(d.supplier_id,r.supplier_id)
    group by 1,2,3,4,5,6,7
  ) rows;
$$;
revoke all on function access_private.receive_purchase_document(uuid,jsonb) from public,anon,authenticated;
revoke all on function access_private.purchase_documents(uuid) from public,anon,authenticated;

do $migration$
declare definition text := pg_get_functiondef('access_private.operations(uuid,text,uuid,jsonb)'::regprocedure);
begin
  if strpos(definition,$old$'inventory','receive','adjust','receipts'$old$)=0
     or strpos(definition,$old$ elsif p_action='receive' then$old$)=0
     or strpos(definition,$old$ elsif p_action='receipts' then$old$)=0 then
    raise exception 'No se encontró el flujo de compras';
  end if;
  definition := replace(definition,$old$'inventory','receive','adjust','receipts'$old$,
    $new$'inventory','receive','adjust','receipts','purchase_documents','receive_document'$new$);
  definition := replace(definition,$old$'inventory','receipts','formulas'$old$,
    $new$'inventory','receipts','purchase_documents','formulas'$new$);
  definition := replace(definition,$old$ elsif p_action='receipts' then$old$,
    $new$ elsif p_action='purchase_documents' then return access_private.purchase_documents(p_company);
 elsif p_action='receipts' then$new$);
  definition := replace(definition,$old$ elsif p_action='receive' then$old$,
    $new$ elsif p_action='receive_document' then
  v_result:=access_private.receive_purchase_document(p_company,p_data);
 elsif p_action='receive' then$new$);
  execute definition;
end;
$migration$;
