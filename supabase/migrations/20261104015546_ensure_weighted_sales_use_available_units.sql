do $patch$declare d text;begin
 d:=pg_get_functiondef('access_private.place_order(uuid,uuid,jsonb,boolean)'::regprocedure);
 d:=replace(d,'qty>stock and not v.allow_preorder','qty>stock and (not v.allow_preorder or v.weight_min is not null)');execute d;
 d:=pg_get_functiondef('access_private.checkout_quote(uuid,jsonb)'::regprocedure);
 d:=replace(d,'coalesce(stock,0)<q and not v.allow_preorder','coalesce(stock,0)<q and (not v.allow_preorder or v.weight_min is not null)');execute d;
end $patch$;
notify pgrst,'reload schema';
