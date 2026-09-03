-- Recompile the existing command with deterministic variable resolution.
-- Its public signature and authorization/audit contract remain unchanged.

create or replace function public.update_current_ai_provider_config(
  provider text,
  model text,
  encrypted_key text,
  key_hint text,
  request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_variable
declare
  v_tenant_id bigint;
  v_tenant_public_id uuid;
  v_organization_id bigint;
  v_actor_member_id bigint;
  v_actor_auth_user_id uuid := (select auth.uid());
  v_envelope jsonb;
  v_envelope_key_count integer;
  v_ciphertext text;
  v_iv text;
  v_before jsonb;
  v_after jsonb;
  v_result jsonb;
begin
  if v_actor_auth_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if request_id is null then
    raise exception 'request_id is required' using errcode = '22023';
  end if;
  if provider <> 'deepseek' then
    raise exception 'unsupported AI provider' using errcode = '22023';
  end if;
  if model not in ('deepseek-v4-flash', 'deepseek-chat', 'deepseek-reasoner') then
    raise exception 'unsupported AI model' using errcode = '22023';
  end if;
  if (encrypted_key is null) <> (key_hint is null) then
    raise exception 'encrypted_key and key_hint must be supplied together' using errcode = '22023';
  end if;
  if key_hint is not null and length(key_hint) <> 4 then
    raise exception 'key_hint must be exactly four characters' using errcode = '22023';
  end if;

  if encrypted_key is not null then
    if octet_length(encrypted_key) > 16384 then
      raise exception 'encrypted_key must be a version 1 ciphertext envelope' using errcode = '22023';
    end if;
    begin
      v_envelope := encrypted_key::jsonb;
    exception when others then
      raise exception 'encrypted_key must be a version 1 ciphertext envelope' using errcode = '22023';
    end;
    if jsonb_typeof(v_envelope) <> 'object' then
      raise exception 'encrypted_key must be a version 1 ciphertext envelope' using errcode = '22023';
    end if;
    select count(*) into v_envelope_key_count
    from jsonb_object_keys(v_envelope);
    if v_envelope_key_count <> 3
       or not (v_envelope ?& array['v', 'ciphertext', 'iv'])
       or jsonb_typeof(v_envelope -> 'v') <> 'number'
       or (v_envelope ->> 'v') <> '1'
       or jsonb_typeof(v_envelope -> 'ciphertext') <> 'string'
       or jsonb_typeof(v_envelope -> 'iv') <> 'string' then
      raise exception 'encrypted_key must be a version 1 ciphertext envelope' using errcode = '22023';
    end if;
    v_ciphertext := v_envelope ->> 'ciphertext';
    v_iv := v_envelope ->> 'iv';
    if v_ciphertext !~ '^[A-Za-z0-9+/]+={0,2}$'
       or length(v_ciphertext) < 24
       or length(v_ciphertext) % 4 <> 0
       or v_iv !~ '^[A-Za-z0-9+/]{16}$' then
      raise exception 'encrypted_key must be a version 1 ciphertext envelope' using errcode = '22023';
    end if;
  end if;

  select
    tenant.id,
    tenant.public_id,
    organization.id,
    member.id
  into
    v_tenant_id,
    v_tenant_public_id,
    v_organization_id,
    v_actor_member_id
  from public.external_identities external
  join public.identity_providers identity_provider
    on identity_provider.tenant_id = external.tenant_id
   and identity_provider.id = external.identity_provider_id
   and identity_provider.status = 'active'
  join public.tenants tenant
    on tenant.id = external.tenant_id
   and tenant.status = 'active'
  join public.organizations organization
    on organization.tenant_id = external.tenant_id
   and organization.id = external.organization_id
  join public.organization_members member
    on member.tenant_id = external.tenant_id
   and member.id = external.organization_member_id
   and member.organization_id = external.organization_id
   and member.status = 'active'
  join public.employee_profiles profile
    on profile.tenant_id = external.tenant_id
   and profile.organization_member_id = member.id
   and profile.deleted_at is null
   and profile.employment_status in ('probation', 'active', 'on_leave')
  where external.auth_user_id = v_actor_auth_user_id
    and external.status = 'active'
  limit 1;

  if v_tenant_id is null then
    raise exception 'Active workspace membership required' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.member_roles assignment
    join public.roles role
      on role.tenant_id = assignment.tenant_id
     and role.id = assignment.role_id
    join public.role_permissions role_permission
      on role_permission.tenant_id = assignment.tenant_id
     and role_permission.role_id = assignment.role_id
    join public.permissions permission
      on permission.id = role_permission.permission_id
    where assignment.tenant_id = v_tenant_id
      and assignment.member_id = v_actor_member_id
      and role.is_enabled
      and (role.organization_id is null or role.organization_id = v_organization_id)
      and (
        not public.is_canonical_workspace_role_code(role.code)
        or (role.is_system and role.organization_id is null)
      )
      and permission.code = 'ai.config.manage'
  ) then
    raise exception 'AI configuration management permission required' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_tenant_public_id::text || ':' || provider, 0)
  );

  if exists (
    select 1 from public.audit_logs audit
    where audit.tenant_id = v_tenant_id
      and audit.action = 'ai.config.updated'
      and audit.request_id = request_id
  ) then
    raise exception 'request_id has already been used' using errcode = '23505';
  end if;

  select jsonb_build_object(
    'provider', config.provider,
    'model', config.model_name,
    'keyConfigured', config.encrypted_api_key is not null and config.api_key_iv is not null
  ) into v_before
  from public.ai_provider_configs config
  where config.tenant_id = v_tenant_public_id
    and config.provider = provider
  for update;

  insert into public.ai_provider_configs as config (
    tenant_id, provider, model_name, api_base_url,
    encrypted_api_key, api_key_iv, key_hint, updated_by
  ) values (
    v_tenant_public_id, provider, model, 'https://api.deepseek.com',
    v_ciphertext, v_iv, key_hint, v_actor_auth_user_id
  )
  on conflict on constraint ai_provider_configs_pkey do update
  set model_name = excluded.model_name,
      encrypted_api_key = case
        when encrypted_key is null then config.encrypted_api_key
        else excluded.encrypted_api_key
      end,
      api_key_iv = case
        when encrypted_key is null then config.api_key_iv
        else excluded.api_key_iv
      end,
      key_hint = case
        when encrypted_key is null then config.key_hint
        else excluded.key_hint
      end,
      updated_at = now(),
      updated_by = v_actor_auth_user_id
  returning jsonb_build_object(
    'provider', config.provider,
    'model', config.model_name,
    'keyConfigured', config.encrypted_api_key is not null and config.api_key_iv is not null
  ) into v_after;

  perform public.append_audit_log(
    v_tenant_id,
    v_organization_id,
    v_actor_auth_user_id,
    v_actor_member_id,
    'ai.config.updated',
    'ai_provider_config',
    provider,
    request_id,
    null,
    jsonb_build_object(
      'before', v_before,
      'after', v_after
    )
  );

  select jsonb_build_object(
    'provider', config.provider,
    'model_name', config.model_name,
    'api_base_url', config.api_base_url,
    'key_configured', config.encrypted_api_key is not null and config.api_key_iv is not null,
    'key_hint', config.key_hint,
    'updated_at', config.updated_at
  ) into v_result
  from public.ai_provider_configs config
  where config.tenant_id = v_tenant_public_id
    and config.provider = provider;
  return v_result;
end;
$$;

revoke all on function public.update_current_ai_provider_config(text, text, text, text, uuid)
  from public, anon;
grant execute on function public.update_current_ai_provider_config(text, text, text, text, uuid)
  to authenticated;
