do $patch$declare d text;begin
 d:=pg_get_functiondef('access_private.admin_text()'::regprocedure);
 d:=replace(d,$s$tg_table_name<>'business_partners' or new.partner_type='supplier'$s$,$s$tg_table_name<>'business_partners' or to_jsonb(new)->>'partner_type'='supplier'$s$);execute d;
 d:=pg_get_functiondef('access_private.operations(uuid,text,uuid,jsonb)'::regprocedure);
 d:=replace(d,$s$'product_sku',pr.sku)$s$,$s$'product_sku',pr.sku,'batch_number',b.batch_number)$s$);execute d;
end $patch$;
notify pgrst,'reload schema';
