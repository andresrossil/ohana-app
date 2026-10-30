-- Administrative appearance is independent from the existing storefront appearance.
create function access_private.color_luminance(c text) returns double precision language sql immutable strict set search_path='' as $$select sum((case when channel<=0.04045 then channel/12.92 else power((channel+0.055)/1.055,2.4) end)*weight)from(select (('x'||substr(c,2+2*i,2))::bit(8)::integer)/255.0 as channel,case i when 0 then .2126 when 1 then .7152 else .0722 end as weight from generate_series(0,2)i)s$$;
create function access_private.color_contrast(a text,b text) returns double precision language sql immutable strict set search_path='' as $$select (greatest(access_private.color_luminance(a),access_private.color_luminance(b))+.05)/(least(access_private.color_luminance(a),access_private.color_luminance(b))+.05)$$;
create function access_private.admin_theme_valid(t jsonb) returns boolean language plpgsql immutable set search_path='' as $$declare k text;pair text[];begin
 if t is null or jsonb_typeof(t)<>'object' then return false;end if;if t='{}'::jsonb then return true;end if;
 if t-'background'-'secondary'-'surface'-'heading'-'primary'-'text'-'muted'-'border'-'font'<>'{}'::jsonb then return false;end if;
 foreach k in array array['background','secondary','surface','heading','primary','text','muted','border']loop if coalesce(t->>k,'')!~'^#[0-9A-Fa-f]{6}$'then return false;end if;end loop;
 if coalesce(t->>'font','')not in('Inter','Roboto','Open Sans','Montserrat','Lato','Georgia')then return false;end if;
 foreach pair slice 1 in array array[['text','background'],['text','surface'],['text','secondary'],['muted','background'],['muted','surface'],['heading','background'],['heading','surface'],['heading','secondary']]loop if access_private.color_contrast(t->>pair[1],t->>pair[2])<4.5 then return false;end if;end loop;return true;
end $$;
revoke all on function access_private.color_luminance(text),access_private.color_contrast(text,text),access_private.admin_theme_valid(jsonb) from public,anon;
grant execute on function access_private.color_luminance(text),access_private.color_contrast(text,text),access_private.admin_theme_valid(jsonb) to authenticated;
alter table public.company_settings add column admin_theme jsonb not null default '{}' check(access_private.admin_theme_valid(admin_theme));
grant update(admin_theme) on public.company_settings to authenticated;
create policy admin_theme_update on public.company_settings for update to authenticated using(public.company_permission(company_id,'manage'))with check(public.company_permission(company_id,'manage'));
create function access_private.company_admin_theme(c uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 if auth.uid() is null or not public.company_permission(c,'read','identity')then raise exception 'Empresa no autorizada' using errcode='42501';end if;
 return coalesce((select admin_theme from public.company_settings where company_id=c),'{}');end $$;
create function public.company_admin_theme(p_company uuid) returns jsonb language sql stable security invoker set search_path='' as $$select access_private.company_admin_theme(p_company)$$;
create function public.save_admin_theme(p_company uuid,p_theme jsonb) returns void language plpgsql security invoker set search_path='' as $$begin
 update public.company_settings set admin_theme=p_theme where company_id=p_company;
 if not found then raise exception 'Solo los administradores autorizados pueden guardar el tema' using errcode='42501';end if;end $$;
revoke all on function access_private.company_admin_theme(uuid),public.company_admin_theme(uuid),public.save_admin_theme(uuid,jsonb) from public,anon;
grant execute on function access_private.company_admin_theme(uuid),public.company_admin_theme(uuid),public.save_admin_theme(uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
