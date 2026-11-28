-- Physical counting is independent of posting inventory.
create table access_private.inventory_count_sessions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  number bigint not null,
  description text not null check(length(trim(description)) between 1 and 200),
  notes text not null default '' check(length(notes)<=2000),
  state text not null default 'open' check(state in ('open','confirmed','cancelled')),
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid not null references auth.users(id),
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users(id),
  document_id uuid,
  evidence jsonb,
  unique(company_id,id), unique(company_id,number),
  foreign key(company_id,document_id) references public.inventory_documents(company_id,id)
);

create table access_private.inventory_count_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  session_id uuid not null,
  item_kind text not null check(item_kind in ('material','variant')),
  item_id uuid not null,
  unit_id uuid not null,
  quantity numeric(20,8) not null check(quantity>=0 and quantity<1e12),
  base_quantity numeric(20,8) not null check(base_quantity>=0 and base_quantity<1e12),
  location text not null default '' check(length(location)<=250),
  notes text not null default '' check(length(notes)<=1000),
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid not null references auth.users(id),
  counted_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  revision integer not null default 1,
  audit jsonb not null default '[]',
  foreign key(company_id,session_id) references access_private.inventory_count_sessions(company_id,id),
  foreign key(company_id,unit_id) references public.units(company_id,id)
);
create index inventory_count_entries_scope on access_private.inventory_count_entries(company_id,session_id,item_kind,item_id) where deleted_at is null;
alter table access_private.inventory_count_sessions enable row level security;
alter table access_private.inventory_count_entries enable row level security;
revoke all on access_private.inventory_count_sessions,access_private.inventory_count_entries from public,anon,authenticated;

create function access_private.wall_to_wall_articles(c uuid,s uuid default null)
returns table(item_kind text,item_id uuid,name text,sku text,barcode text,unit_id uuid,unit text,
 physical numeric,reserved numeric,blocked numeric,active boolean)
language sql stable set search_path='' as $$
  select a.kind,a.id,a.name,a.sku,a.barcode,a.unit_id,u.symbol,coalesce(b.on_hand,0),
    coalesce(b.reserved,0),coalesce(b.blocked,0),a.active
  from (
    select 'material' kind,m.id,m.name,m.sku,m.barcode,m.unit_id,m.active
      from public.raw_materials m where m.company_id=c
    union all
    select 'variant',v.id,p.name||' · '||access_private.variant_label(to_jsonb(v)),v.sku,v.barcode,
      (select x.id from public.units x where x.company_id=c and x.dimension='count'
       and x.base_factor=1 and x.active order by (x.symbol='ud') desc,x.id limit 1),p.active and v.active
      from public.product_variants v join public.products p on p.company_id=c and p.id=v.product_id
      where v.company_id=c
  ) a
  left join public.units u on u.company_id=c and u.id=a.unit_id
  left join public.inventory_balances b on b.company_id=c and b.item_kind=a.kind and b.item_id=a.id
  where a.active or coalesce(b.on_hand,0)<>0 or exists(
    select 1 from access_private.inventory_count_entries e where e.company_id=c and e.session_id=s
      and e.item_kind=a.kind and e.item_id=a.id and e.deleted_at is null);
$$;

create function access_private.wall_to_wall_review(c uuid,s uuid)
returns jsonb language sql stable set search_path='' as $$
  with entries as (
    select * from access_private.inventory_count_entries where company_id=c and session_id=s and deleted_at is null
  ), captured as (
    select item_kind,item_id,sum(base_quantity) counted,count(*) records,min(counted_at) oldest
    from entries group by 1,2
  ), rows as (
    select a.*,a.physical-a.reserved-a.blocked available,
      coalesce(t.counted,0) counted,coalesce(t.counted,0)-a.physical difference,
      coalesce(t.records,0) records,greatest(0,a.reserved-coalesce(t.counted,0)) reservation_shortage,
      (coalesce(t.counted,0)<a.physical and
        (coalesce(t.counted,0)<a.reserved+a.blocked or a.physical-coalesce(t.counted,0)>stock.usable))
        or (coalesce(t.counted,0)<>a.physical and a.unit_id is null) protected,
      exists(select 1 from public.inventory_movements m where m.company_id=c and m.item_kind=a.item_kind
        and m.item_id=a.item_id and m.quantity<>0 and m.created_at>=coalesce(t.oldest,ss.created_at)) stale
    from access_private.wall_to_wall_articles(c,s) a
    join access_private.inventory_count_sessions ss on ss.company_id=c and ss.id=s
    left join captured t using(item_kind,item_id)
    cross join lateral (
      select coalesce(sum(case when u.total>0 then least(l.remaining,u.available) else l.remaining end),0) usable
      from public.inventory_lots l
      cross join lateral (select count(*) total,count(*) filter(where status='available') available
        from public.inventory_units where company_id=c and lot_id=l.id) u
      where l.company_id=c and l.item_kind=a.item_kind and l.item_id=a.item_id and not l.blocked and l.remaining>0
    ) stock
  )
  select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(r) order by r.name,r.item_kind,r.item_id) from rows r),'[]'),
    'revision',md5(coalesce((select string_agg(id::text||':'||revision,',' order by id) from entries),'')||
      coalesce((select string_agg(m.id::text,',' order by m.id) from public.inventory_movements m
        where m.company_id=c and m.created_at>=(select created_at from access_private.inventory_count_sessions where company_id=c and id=s)),'')));
$$;

revoke all on function access_private.wall_to_wall_articles(uuid,uuid),access_private.wall_to_wall_review(uuid,uuid) from public,anon,authenticated;

create function access_private.wall_to_wall(c uuid,action text,k uuid,data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  s access_private.inventory_count_sessions%rowtype;
  prior access_private.inventory_count_entries%rowtype;
  cached access_private.operation_requests%rowtype;
  article record; base public.units%rowtype; input public.units%rowtype;
  item jsonb; review jsonb; row_data jsonb; result jsonb;
  sid uuid; eid uuid; did uuid; line_id uuid; posted jsonb;
  n bigint; line_no integer:=0; captured_qty numeric; converted numeric; delta numeric; unit_cost numeric;
  ccy text; reason text; signed_at date:=(clock_timestamp() at time zone 'America/Guatemala')::date;
begin
  if auth.uid() is null or not coalesce(public.company_permission(c,
    case when action in ('list','detail','review') then 'read' else 'write' end,'inventory'),false) then
    raise exception 'Levantamiento no autorizado' using errcode='42501';
  end if;
  if action='list' then
    return coalesce((select jsonb_agg(to_jsonb(r) order by r.number desc) from (
      select x.id,x.number,x.description,x.notes,x.state,x.created_at,x.confirmed_at,x.document_id,
        coalesce(nullif(u.raw_user_meta_data->>'display_name',''),x.created_by::text) responsible,
        coalesce((x.evidence->>'record_count')::bigint,stats.records) record_count,
        coalesce((x.evidence->>'article_count')::bigint,stats.articles) article_count,
        coalesce((x.evidence->>'total_articles')::bigint,(select count(*) from access_private.wall_to_wall_articles(c,x.id))) total_articles
      from access_private.inventory_count_sessions x left join auth.users u on u.id=x.created_by
      cross join lateral (
        select count(*) records,count(distinct (e.item_kind,e.item_id)) articles from access_private.inventory_count_entries e
        where e.company_id=c and e.session_id=x.id and e.deleted_at is null
      ) stats where x.company_id=c
    ) r),'[]');
  end if;
  if action not in ('detail','review','create','add','edit','delete','cancel','confirm') then raise exception 'Acción de levantamiento inválida'; end if;
  if action not in ('detail','review') then
    if k is null then raise exception 'Falta identificador de operación'; end if;
    perform pg_advisory_xact_lock(hashtextextended(c::text,0));
    select * into cached from access_private.operation_requests where company_id=c and key=k;
    if found then
      if cached.action<>'wall_to_wall_'||action or cached.payload<>data then raise exception 'Identificador utilizado con otros datos'; end if;
      return cached.result;
    end if;
  end if;
  if action='create' then
    select coalesce(max(number),0)+1 into n from access_private.inventory_count_sessions where company_id=c;
    insert into access_private.inventory_count_sessions(company_id,number,description,notes,created_by)
      values(c,n,trim(coalesce(data->>'description','')),coalesce(data->>'notes',''),auth.uid()) returning id into sid;
    result:=jsonb_build_object('id',sid);
  else
    sid:=(data->>'session')::uuid;
    if action in ('detail','review') then
      select * into strict s from access_private.inventory_count_sessions where company_id=c and id=sid;
    else
      select * into strict s from access_private.inventory_count_sessions where company_id=c and id=sid for update;
    end if;
    if action='detail' then
      return jsonb_build_object('session',to_jsonb(s)-'evidence',
        'document',(select number from public.inventory_documents where company_id=c and id=s.document_id),
        'articles',coalesce((select jsonb_agg(to_jsonb(a) order by a.name)
          from access_private.wall_to_wall_articles(c,sid) a),'[]'),
        'units',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'name',u.name,'symbol',u.symbol,'dimension',u.dimension)
          order by u.name) from public.units u where u.company_id=c and u.active),'[]'),
        'entries',coalesce((select jsonb_agg((to_jsonb(e)-'audit')||jsonb_build_object('user_name',
          coalesce(nullif(u.raw_user_meta_data->>'display_name',''),e.created_by::text),'unit',mu.symbol)
          order by e.created_at desc,e.id desc) from access_private.inventory_count_entries e
          left join auth.users u on u.id=e.created_by join public.units mu on mu.company_id=c and mu.id=e.unit_id
          where e.company_id=c and e.session_id=sid and e.deleted_at is null),'[]'));
    end if;
    if action='review' then
      review:=case when s.state='confirmed' then s.evidence else access_private.wall_to_wall_review(c,sid) end;
      return review||jsonb_build_object('proof',md5(review::text));
    end if;
    if s.state<>'open' then raise exception 'El levantamiento ya está cerrado';end if;
    if action='cancel' then
      update access_private.inventory_count_sessions set state='cancelled' where company_id=c and id=sid;
    elsif action in ('add','edit','delete') then
      if action<>'add' then
        eid:=(data->>'entry')::uuid;
        select * into strict prior from access_private.inventory_count_entries
          where company_id=c and session_id=sid and id=eid and deleted_at is null for update;
        if (data->>'revision')::integer is distinct from prior.revision then raise exception 'La captura cambió. Actualiza el levantamiento';end if;
      end if;
      if action='delete' then
        update access_private.inventory_count_entries set deleted_at=clock_timestamp(),revision=revision+1,
          audit=audit||jsonb_build_array(jsonb_build_object('action','delete','at',clock_timestamp(),'by',auth.uid()))
          where company_id=c and session_id=sid and id=eid;
      else
        if action='add' and (jsonb_typeof(data->'entries') is distinct from 'array'
          or jsonb_array_length(data->'entries') not between 1 and 500) then raise exception 'Captura entre 1 y 500 registros';end if;
        for item in select value from jsonb_array_elements(case when action='add' then data->'entries' else jsonb_build_array(data) end) loop
          select * into strict article from access_private.wall_to_wall_articles(c,sid) a
            where a.item_kind=coalesce(prior.item_kind,item->>'item_kind') and a.item_id=coalesce(prior.item_id,(item->>'item_id')::uuid);
          select * into strict base from public.units where company_id=c and id=article.unit_id;
          select * into strict input from public.units where company_id=c and active and id=coalesce(nullif(item->>'unit_id','')::uuid,base.id);
          captured_qty:=nullif(item->>'quantity','')::numeric;
          if input.dimension<>base.dimension or captured_qty is null or captured_qty<0 or captured_qty>=1e12 or captured_qty<>round(captured_qty,8)
            or (article.item_kind='variant' and (input.id<>base.id or captured_qty<>trunc(captured_qty))) then
            raise exception 'Cantidad o unidad incompatible para %',article.name;
          end if;
          converted:=round(captured_qty*input.base_factor/base.base_factor,8);
          if action='add' then
            insert into access_private.inventory_count_entries(company_id,session_id,item_kind,item_id,unit_id,quantity,base_quantity,location,notes,created_by)
            values(c,sid,article.item_kind,article.item_id,input.id,captured_qty,converted,coalesce(item->>'location',''),coalesce(item->>'notes',''),auth.uid())
            returning id into eid;
          else
            update access_private.inventory_count_entries set unit_id=input.id,quantity=captured_qty,base_quantity=converted,
              location=coalesce(item->>'location',''),notes=coalesce(item->>'notes',''),counted_at=case when coalesce((item->>'recounted')::boolean,false) then clock_timestamp() else counted_at end,revision=revision+1,
              audit=audit||jsonb_build_array(jsonb_build_object('action','edit','at',clock_timestamp(),'by',auth.uid(),'before',to_jsonb(prior)-'audit'))
              where company_id=c and session_id=sid and id=eid;
          end if;
        end loop;
      end if;
    elsif action='confirm' then
      -- All balance-changing commands update these tables. This lock also covers
      -- new balance rows, releases and quantifiable changes outside the session.
      lock table public.inventory_balances,public.inventory_movements,public.inventory_lots in share row exclusive mode;
      review:=access_private.wall_to_wall_review(c,sid);
      if data->>'proof' is distinct from md5(review::text) then raise exception 'El conteo o las existencias cambiaron. Consolida de nuevo';end if;
      if exists(select 1 from jsonb_array_elements(review->'rows') r where (r->>'stale')::boolean or (r->>'protected')::boolean) then
        raise exception 'Revisa los artículos con movimientos posteriores al conteo, reservas o lotes protegidos';
      end if;
      if exists(select 1 from jsonb_array_elements(review->'rows') r
        where (r->>'records')::bigint=0 and (r->>'physical')::numeric>0)
        and not coalesce((data->>'acknowledged')::boolean,false) then raise exception 'Acepta expresamente los ajustes de existencias sin conteo';end if;
      select currency into strict ccy from public.companies where id=c;
      reason:='Levantamiento físico #'||s.number||' · '||s.description;
      insert into access_private.inventory_document_counters(company_id,last_value) values(c,1)
        on conflict(company_id) do update set last_value=inventory_document_counters.last_value+1 returning last_value into n;
      insert into public.inventory_documents(company_id,number,kind,effective_on,reason,notes,created_by,count_snapshot)
        values(c,n,'count',signed_at,reason,s.notes,auth.uid(),(
          select coalesce(jsonb_agg(jsonb_build_object(
            'line_key',md5((r->>'item_kind')||':'||(r->>'item_id'))::uuid,
            'sku',r->>'sku','name',r->>'name','unit',r->>'unit',
            'theoretical',r->'physical','actual',r->'counted','difference',r->'difference')
            order by r->>'name',r->>'item_id'),'[]')
          from jsonb_array_elements(review->'rows') r
        )) returning id into did;
      for row_data in select value from jsonb_array_elements(review->'rows') loop
          delta:=(row_data->>'difference')::numeric;
          if delta=0 then continue;end if;
          if delta>0 and row_data->>'item_kind'='material' then
            select q.unit_cost into unit_cost from access_private.material_purchase_quote(c,(row_data->>'item_id')::uuid) q
              where q.currency=ccy;
            if unit_cost is null then
              select l.unit_cost into unit_cost from public.inventory_lots l where l.company_id=c and l.item_kind='material'
                and l.item_id=(row_data->>'item_id')::uuid and l.currency=ccy and l.unit_cost is not null
                order by l.created_at desc,l.id desc limit 1;
            end if;
          else
            unit_cost:=null;
          end if;
          line_id:=gen_random_uuid();line_no:=line_no+1;
          insert into public.inventory_document_lines(id,company_id,document_id,line_number,item_kind,item_id,material_id,variant_id,
            input_unit_id,quantity,base_quantity,unit_cost,base_unit_cost,total_value,currency,lot_id,notes,snapshot)
          values(line_id,c,did,line_no,row_data->>'item_kind',(row_data->>'item_id')::uuid,
            case when row_data->>'item_kind'='material' then (row_data->>'item_id')::uuid end,
            case when row_data->>'item_kind'='variant' then (row_data->>'item_id')::uuid end,
            (row_data->>'unit_id')::uuid,abs(delta),abs(delta),unit_cost,unit_cost,unit_cost*abs(delta),ccy,null,reason,
            jsonb_build_object('name',row_data->>'name','sku',row_data->>'sku','unit',row_data->>'unit',
              'input_unit',row_data->>'unit','count_direction',sign(delta),'wall_to_wall',sid,'count',row_data));
          posted:=access_private.post_stock_selected(c,row_data->>'item_kind',(row_data->>'item_id')::uuid,delta,0,0,
            'inventory_document',line_id,unit_cost,reason,null,null);
          update public.inventory_document_lines set movement_id=(posted->>'movement')::uuid,
            lot_id=(posted->>'lot')::uuid,
            unit_cost=(posted->>'cost')::numeric/abs(delta),
            base_unit_cost=(posted->>'cost')::numeric/abs(delta),
            total_value=(posted->>'cost')::numeric
            where company_id=c and id=line_id;
          if delta>0 then
            update public.inventory_lots set label='Ajuste WTW #'||s.number where company_id=c and id=(posted->>'lot')::uuid;
          end if;
      end loop;
      update public.inventory_documents set state='confirmed' where company_id=c and id=did;
      update access_private.inventory_count_sessions set state='confirmed',confirmed_at=clock_timestamp(),confirmed_by=auth.uid(),
        document_id=did,evidence=review||jsonb_build_object('total_articles',jsonb_array_length(review->'rows'),
          'record_count',(select coalesce(sum((r->>'records')::bigint),0) from jsonb_array_elements(review->'rows') r),
          'article_count',(select count(*) from jsonb_array_elements(review->'rows') r where (r->>'records')::bigint>0))
        where company_id=c and id=sid;
    end if;
    result:=jsonb_build_object('id',sid,'entry',eid,'document_id',did,'number',n);
  end if;
  insert into access_private.operation_requests(company_id,key,action,payload,result)
    values(c,k,'wall_to_wall_'||action,data,result);
  return result;
end $$;

create function public.wall_to_wall(p_company uuid,p_action text,p_key uuid default null,p_data jsonb default '{}')
returns jsonb language sql security invoker set search_path='' as $$
  select access_private.wall_to_wall(p_company,p_action,p_key,p_data)
$$;
revoke all on function public.wall_to_wall(uuid,text,uuid,jsonb),access_private.wall_to_wall(uuid,text,uuid,jsonb) from public,anon;
grant execute on function public.wall_to_wall(uuid,text,uuid,jsonb),access_private.wall_to_wall(uuid,text,uuid,jsonb) to authenticated;
