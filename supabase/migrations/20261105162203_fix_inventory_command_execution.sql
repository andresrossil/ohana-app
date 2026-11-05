-- The public SECURITY INVOKER wrapper needs this entry-point permission.
-- Authorization remains inside inventory_command: auth.uid(), company and module.
-- Internal posting/review helpers remain inaccessible to client roles.
grant execute on function access_private.inventory_command(uuid,text,jsonb,uuid) to authenticated;
