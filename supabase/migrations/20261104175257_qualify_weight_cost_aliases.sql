do $$declare d text;begin
 d:=pg_get_functiondef('access_private.operations(uuid,text,uuid,jsonb)'::regprocedure);
 d:=replace(d,$old$select case when bool_and(u->>'manufacturing_cost' is not null)then sum((u->>'manufacturing_cost')::numeric)/x.quantity end into amount from jsonb_array_elements(variable_plan->'units')u where u->>'variant_id'=x.variant_id::text;$old$,
 $new$select case when bool_and(cost_row.value->>'manufacturing_cost' is not null)then sum((cost_row.value->>'manufacturing_cost')::numeric)/x.quantity end into amount from jsonb_array_elements(variable_plan->'units')cost_row(value) where cost_row.value->>'variant_id'=x.variant_id::text;$new$);
 d:=replace(d,$old$(select u from jsonb_array_elements(coalesce(variable_plan->'units','[]'))u where u->>'variant_id'=x.variant_id::text and (u->>'position')::bigint=w.position)$old$,
 $new$(select cost_row.value from jsonb_array_elements(coalesce(variable_plan->'units','[]'))cost_row(value) where cost_row.value->>'variant_id'=x.variant_id::text and (cost_row.value->>'position')::bigint=w.position)$new$);
 execute d;
end $$;
