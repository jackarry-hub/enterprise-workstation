begin;

create or replace function public.ensure_current_feishu_directory_connection(
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
  v_provider public.identity_providers%rowtype;
  v_connection public.directory_connections%rowtype;
begin
  if p_request_id is null then
    raise exception 'invalid_directory_connection_request' using errcode = '22023';
  end if;
  select * into v_actor from public.current_agent_actor('organization.manage');
  if not found then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select * into v_provider
  from public.identity_providers provider
  where provider.tenant_id = v_actor.tenant_id
    and provider.provider_code = 'feishu'
    and provider.status = 'active'
  order by provider.id
  limit 1;
  if not found then
    raise exception 'feishu_provider_not_found' using errcode = 'P0002';
  end if;

  insert into public.directory_connections(
    tenant_id, organization_id, identity_provider_id, provider_type,
    external_tenant_key, sync_mode, status
  ) values (
    v_actor.tenant_id, v_actor.organization_id, v_provider.id, 'feishu',
    v_provider.provider_tenant_key, 'manual', 'active'
  )
  on conflict (tenant_id, organization_id, identity_provider_id) do update set
    external_tenant_key = excluded.external_tenant_key,
    status = 'active',
    updated_at = clock_timestamp()
  returning * into v_connection;

  perform public.append_audit_log(
    v_actor.tenant_id, v_actor.organization_id, v_actor.user_id,
    v_actor.member_id, 'directory.connection.ready',
    'directory_connection', v_connection.public_id::text,
    p_request_id, null,
    jsonb_build_object('provider', 'feishu', 'status', v_connection.status)
  );

  return jsonb_build_object(
    'id', v_connection.public_id,
    'provider', 'feishu',
    'status', v_connection.status
  );
end;
$$;

create or replace function public.activate_current_enterprise(
  p_company_name text,
  p_short_name text,
  p_industry text,
  p_description text,
  p_timezone text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_initialization jsonb;
  v_connection jsonb;
begin
  if p_request_id is null then
    raise exception 'invalid_enterprise_activation_request' using errcode = '22023';
  end if;
  v_initialization := public.initialize_current_enterprise(
    p_company_name, p_short_name, p_industry, p_description, p_timezone
  );
  v_connection := public.ensure_current_feishu_directory_connection(p_request_id);
  return v_initialization || jsonb_build_object('directoryConnection', v_connection);
end;
$$;

revoke all on function public.ensure_current_feishu_directory_connection(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.activate_current_enterprise(
  text, text, text, text, text, uuid
) from public, anon;
grant execute on function public.activate_current_enterprise(
  text, text, text, text, text, uuid
) to authenticated;

commit;
