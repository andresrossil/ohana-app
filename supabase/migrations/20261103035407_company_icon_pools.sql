
-- Reuse the pinned name whitelist without weakening validation of legacy icon names.
do $$declare def text;begin
 def:=pg_get_functiondef('access_private.company_icons_valid(jsonb)'::regprocedure);
 execute replace(def,'access_private.company_icons_valid','access_private.legacy_company_icons_valid');
end $$;
revoke all on function access_private.legacy_company_icons_valid(jsonb) from public,anon;
grant execute on function access_private.legacy_company_icons_valid(jsonb) to authenticated;
create function access_private.default_icon_pools() returns jsonb language sql immutable set search_path='' as $defaults$select '{"navigation.menu":{"options":["menu","align-justify","panel-left","square-menu","list"],"active":"menu"},"navigation.close":{"options":["panel-left-close","panel-left","x","chevrons-left","panel-right-close"],"active":"panel-left-close"},"control.sort":{"options":["arrow-up-down","arrow-down-up","list-ordered","arrow-up-wide-narrow","arrow-down-wide-narrow"],"active":"arrow-up-down"},"control.filter":{"options":["list-filter","filter","funnel","sliders-horizontal","list-filter-plus"],"active":"list-filter"},"status.active":{"options":["circle-check","check","check-check","square-check","badge-check"],"active":"circle-check"},"status.archived":{"options":["archive","archive-x","archive-restore","package-x","circle-off"],"active":"archive"},"status.purchased":{"options":["shopping-cart","shopping-bag","shopping-basket","store","receipt"],"active":"shopping-cart"},"status.manufactured":{"options":["factory","workflow","cog","settings-2","hammer"],"active":"factory"},"module.dashboard":{"options":["house","layout-dashboard","home","building-2","house-plus"],"active":"house"},"module.materials":{"options":["layers","layers-2","boxes","component","shapes"],"active":"layers"},"module.products":{"options":["package","package-2","box","package-open","boxes"],"active":"package"},"module.purchases":{"options":["shopping-cart","shopping-bag","shopping-basket","store","receipt"],"active":"shopping-cart"},"module.formulas":{"options":["flask-conical","flask-round","test-tubes","beaker","test-tube"],"active":"flask-conical"},"module.production":{"options":["factory","workflow","cog","settings-2","hammer"],"active":"factory"},"module.inventory":{"options":["warehouse","boxes","package-search","container","clipboard-list"],"active":"warehouse"},"module.sales":{"options":["trending-up","chart-no-axes-combined","receipt","badge-dollar-sign","store"],"active":"trending-up"},"module.customers":{"options":["users","users-round","contact","handshake","user-round"],"active":"users"},"module.reports":{"options":["chart-column","chart-line","chart-pie","chart-area","chart-bar"],"active":"chart-column"},"module.settings":{"options":["settings","settings-2","sliders-horizontal","sliders-vertical","wrench"],"active":"settings"},"action.save":{"options":["save","save-all","save-check","save-pen","hard-drive-download"],"active":"save"},"action.confirm":{"options":["circle-check","check","check-check","square-check","badge-check"],"active":"circle-check"},"action.cancel":{"options":["x","circle-x","square-x","ban","undo-2"],"active":"x"},"action.edit":{"options":["pencil","pen","square-pen","pencil-line","file-pen"],"active":"pencil"},"action.delete":{"options":["trash-2","trash","shredder","eraser","delete"],"active":"trash-2"},"action.add":{"options":["plus","circle-plus","square-plus","list-plus","file-plus"],"active":"plus"},"action.duplicate":{"options":["copy","copy-plus","files","clipboard-copy","layers-2"],"active":"copy"},"action.search":{"options":["search","search-check","scan-search","list-filter","file-search"],"active":"search"},"action.compare":{"options":["git-compare-arrows","git-compare","columns-2","arrow-left-right","scale"],"active":"git-compare-arrows"},"action.history":{"options":["history","clock","calendar-clock","timer","list-ordered"],"active":"history"},"action.calculate":{"options":["calculator","sigma","square-function","percent","divide"],"active":"calculator"},"action.download":{"options":["download","cloud-download","folder-down","file-down","arrow-down-to-line"],"active":"download"},"action.upload":{"options":["upload","cloud-upload","folder-up","file-up","arrow-up-from-line"],"active":"upload"},"action.print":{"options":["printer","printer-check","file-text","receipt-text","scan-line"],"active":"printer"},"action.barcode":{"options":["barcode","scan-barcode","qr-code","scan-line","scan-qr-code"],"active":"barcode"},"action.refresh":{"options":["refresh-cw","refresh-ccw","rotate-cw","repeat","refresh-ccw-dot"],"active":"refresh-cw"},"action.access":{"options":["user-round-cog","user-cog","user-key","shield-user","key-round"],"active":"user-round-cog"},"action.back":{"options":["arrow-left","chevron-left","corner-up-left","undo","move-left"],"active":"arrow-left"},"action.expand":{"options":["chevron-right","chevrons-right","arrow-right","circle-chevron-right","panel-left-open"],"active":"chevron-right"},"action.collapse":{"options":["chevron-down","chevrons-down","arrow-down","circle-chevron-down","fold-vertical"],"active":"chevron-down"},"status.success":{"options":["circle-check","check","check-check","square-check","badge-check"],"active":"circle-check"},"status.pending":{"options":["clock","hourglass","timer","calendar-clock","circle-dashed"],"active":"clock"},"status.info":{"options":["info","circle-help","message-circle","badge-info","circle-ellipsis"],"active":"info"},"status.warning":{"options":["triangle-alert","circle-alert","badge-alert","octagon-alert","bell-ring"],"active":"triangle-alert"},"status.error":{"options":["circle-alert","circle-x","octagon-x","shield-x","ban"],"active":"circle-alert"}}'::jsonb$defaults$;
create or replace function access_private.company_icons_valid(t jsonb) returns boolean language plpgsql immutable set search_path='' as $$declare k text;v jsonb;n jsonb;begin
 if t is null or jsonb_typeof(t)<>'object' or length(t::text)>64000 then return false;end if;
 for k,v in select * from jsonb_each(t) loop
  if k!~'^(module|action|status|navigation|control)\.[a-z][a-z0-9_.-]{0,79}$' then return false;end if;
  if jsonb_typeof(v)='string' then
   if not access_private.legacy_company_icons_valid(jsonb_build_object('action.iconpool',v)) then return false;end if;
  else
   if jsonb_typeof(v)<>'object' or jsonb_typeof(v->'options') is distinct from 'array' or jsonb_typeof(v->'active') is distinct from 'string' then return false;end if;
   if jsonb_array_length(v->'options') not between 1 and 5 or not(v->'options' @> jsonb_build_array(v->'active')) then return false;end if;
   if (select count(distinct value) from jsonb_array_elements(v->'options'))<>jsonb_array_length(v->'options') then return false;end if;
   for n in select value from jsonb_array_elements(v->'options') loop
    if jsonb_typeof(n)<>'string' or not access_private.legacy_company_icons_valid(jsonb_build_object('action.iconpool',n)) then return false;end if;
   end loop;
  end if;
 end loop;return true;
end $$;
create function access_private.seed_icon_pools(t jsonb) returns jsonb language plpgsql immutable set search_path='' as $$declare output jsonb:=coalesce(t,'{}');k text;v jsonb;old_icon text;opts jsonb;begin
 for k,v in select * from jsonb_each(access_private.default_icon_pools()) loop
  if not(output ? k) then output:=output||jsonb_build_object(k,v);
  elsif jsonb_typeof(output->k)='string' then
   old_icon:=output->>k;
   select jsonb_agg(name order by position) into opts from(select old_icon name,0 position union all select value#>>'{}',ordinality::integer from jsonb_array_elements(v->'options') with ordinality where value#>>'{}'<>old_icon order by position limit 5)s;
   output:=output||jsonb_build_object(k,jsonb_build_object('options',opts,'active',old_icon));
  end if;
 end loop;return output;
end $$;
create function access_private.prepare_company_icon_pools() returns trigger language plpgsql set search_path='' as $$begin new.admin_icons:=access_private.seed_icon_pools(new.admin_icons);return new;end$$;
revoke all on function access_private.default_icon_pools(),access_private.seed_icon_pools(jsonb),access_private.prepare_company_icon_pools() from public,anon;
grant execute on function access_private.default_icon_pools(),access_private.seed_icon_pools(jsonb),access_private.prepare_company_icon_pools() to authenticated;
create trigger seed_company_icon_pools before insert or update of admin_icons on public.company_settings for each row execute function access_private.prepare_company_icon_pools();
update public.company_settings set admin_icons=access_private.seed_icon_pools(admin_icons);
create function access_private.company_icon_pools(c uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 if auth.uid() is null or not public.company_permission(c,'read','identity') then raise exception 'Empresa no autorizada' using errcode='42501';end if;
 return access_private.seed_icon_pools(coalesce((select admin_icons from public.company_settings where company_id=c),'{}'));
end $$;
create function public.company_icon_pools(p_company uuid) returns jsonb language sql stable security invoker set search_path='' as $$select access_private.company_icon_pools(p_company)$$;
revoke all on function access_private.company_icon_pools(uuid),public.company_icon_pools(uuid) from public,anon;
grant execute on function access_private.company_icon_pools(uuid),public.company_icon_pools(uuid) to authenticated;
-- Existing consumers still receive only the selected icon names.
create or replace function access_private.company_icons(c uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_object_agg(key,case when jsonb_typeof(value)='string' then value else value->'active' end),'{}') from jsonb_each(access_private.company_icon_pools(c))
$$;
create or replace function public.save_company_icons(p_company uuid,p_icons jsonb) returns void language plpgsql security invoker set search_path='' as $$declare previous jsonb;next_icons jsonb;k text;v jsonb;opts jsonb;begin
 if not access_private.company_icons_valid(p_icons) then raise exception 'Cada pool debe tener de 1 a 5 iconos Lucide diferentes y uno activo incluido en el pool';end if;
 select admin_icons into previous from public.company_settings where company_id=p_company for update;
 next_icons:=coalesce(previous,'{}')||p_icons;
 -- Preserve options when an older client saves only the selected name.
 for k,v in select * from jsonb_each(p_icons) loop
  if jsonb_typeof(v)='string' and jsonb_typeof(previous->k)='object' then
   select jsonb_agg(name order by position) into opts from(select v#>>'{}' name,0 position union all select value#>>'{}',ordinality::integer from jsonb_array_elements(previous->k->'options') with ordinality where value<>v order by position limit 5)s;
   next_icons:=next_icons||jsonb_build_object(k,jsonb_build_object('options',opts,'active',v));
  end if;
 end loop;
 update public.company_settings set admin_icons=access_private.seed_icon_pools(next_icons) where company_id=p_company;
 if not found then raise exception 'Solo administradores autorizados pueden guardar íconos' using errcode='42501';end if;
end $$;
notify pgrst,'reload schema';
