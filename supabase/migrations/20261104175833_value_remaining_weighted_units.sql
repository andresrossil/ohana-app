-- Only the remaining lot valuation changes; unit and batch snapshots stay immutable.
do $$declare d text;begin
 d:=pg_get_functiondef('access_private.post_stock(uuid,text,uuid,numeric,numeric,numeric,text,uuid,numeric,text)'::regprocedure);
 d:=replace(d,$old$if changed<>take then raise exception 'No se pudo conservar la asignación individual del inventario';end if;
   end if;$old$,
 $new$if changed<>take then raise exception 'No se pudo conservar la asignación individual del inventario';end if;
    if lot.remaining>take and exists(select 1 from public.inventory_units un where un.company_id=c and un.lot_id=lot.id and un.cost_snapshot is not null) then
     update public.inventory_lots il set unit_cost=(
      select case when bool_and(case when un.cost_snapshot is null then lot.unit_cost else (un.cost_snapshot->>'manufacturing_cost')::numeric end is not null)
       then sum(case when un.cost_snapshot is null then lot.unit_cost else (un.cost_snapshot->>'manufacturing_cost')::numeric end)/count(*) end
      from public.inventory_units un where un.company_id=c and un.lot_id=lot.id and un.status not in('sold','retired'))
     where il.company_id=c and il.id=lot.id;
    end if;
   end if;$new$);
 execute d;
end $$;
