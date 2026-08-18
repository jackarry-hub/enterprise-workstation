create or replace function public.lock_feishu_provider_tenant(
  p_provider_tenant_key text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id bigint;
  v_provider_id bigint;
  v_current_provider_tenant_key text;
  v_provider_tenant_key text := nullif(btrim(p_provider_tenant_key), '');
begin
  perform pg_advisory_xact_lock(
    hashtextextended('quantxy:feishu-provider-tenant-lock', 0)
  );

  if v_provider_tenant_key is null
     or length(v_provider_tenant_key) > 200 then
    raise exception 'Feishu provider tenant key is invalid'
      using errcode = '22023';
  end if;

  select tenant.id into strict v_tenant_id
  from public.tenants tenant
  where tenant.slug = 'quantxy'
    and tenant.status = 'active';

  select provider.id, provider.provider_tenant_key
  into strict v_provider_id, v_current_provider_tenant_key
  from public.identity_providers provider
  where provider.tenant_id = v_tenant_id
    and provider.provider_code = 'feishu'
    and provider.auth_provider = 'custom:feishu'
    and provider.status = 'active'
  for update;

  if v_current_provider_tenant_key = 'tenant_qxy' then
    update public.identity_providers provider
    set provider_tenant_key = v_provider_tenant_key,
        safe_metadata = provider.safe_metadata || jsonb_build_object(
          'tenant_lock_state', 'locked',
          'tenant_lock_source', 'oauth_userinfo'
        ),
        updated_at = now()
    where provider.id = v_provider_id
      and provider.provider_tenant_key = 'tenant_qxy';
  elsif v_current_provider_tenant_key <> v_provider_tenant_key then
    raise exception 'Feishu tenant conflicts with the provider lock'
      using errcode = '42501';
  end if;

  return v_provider_tenant_key;
end;
$$;

revoke all on function public.lock_feishu_provider_tenant(text)
  from public, anon, authenticated;
grant execute on function public.lock_feishu_provider_tenant(text)
  to service_role;

create or replace function public.bootstrap_first_owner_from_auth_identity(
  p_auth_user_id uuid,
  p_employee_no text,
  p_department_code text,
  p_job_title text,
  p_skills text[]
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_original_auth_sub text := current_setting(
    'request.jwt.claim.sub',
    true
  );
  v_tenant_id bigint;
  v_total_tenants_before bigint;
  v_organization_id bigint;
  v_member_count bigint;
  v_identity_count bigint;
  v_identity_data jsonb;
  v_auth_provider_subject text;
  v_provider_id bigint;
  v_provider_tenant_key text;
  v_claimed_tenant_key text;
  v_provider_subject text;
  v_provider_match_keys text[];
  v_verified_email text;
  v_display_name text;
  v_member_id bigint;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('quantxy:first-owner-bootstrap', 0)
  );

  if p_auth_user_id is null
     or nullif(btrim(p_employee_no), '') is null
     or nullif(btrim(p_department_code), '') is null
     or nullif(btrim(p_job_title), '') is null then
    raise exception 'Bootstrap owner fields are incomplete'
      using errcode = '22023';
  end if;
  if cardinality(coalesce(p_skills, '{}'::text[])) > 30 then
    raise exception 'Bootstrap owner skills are invalid'
      using errcode = '22023';
  end if;

  select tenant.id into strict v_tenant_id
  from public.tenants tenant
  where tenant.slug = 'quantxy'
    and tenant.status = 'active';

  select count(*) into v_total_tenants_before from public.tenants;

  select organization.id into strict v_organization_id
  from public.organizations organization
  where organization.tenant_id = v_tenant_id
    and organization.slug = 'quantum-galaxy';

  select count(*) into v_member_count
  from public.organization_members member
  where member.tenant_id = v_tenant_id;
  if v_member_count <> 0 then
    raise exception 'Bootstrap is already complete' using errcode = '55000';
  end if;

  if not exists (select 1 from auth.users where id = p_auth_user_id) then
    raise exception 'Bootstrap auth user does not exist' using errcode = '23503';
  end if;
  if exists (
    select 1 from public.external_identities external
    where external.auth_user_id = p_auth_user_id
  ) then
    raise exception 'Bootstrap auth user is already bound' using errcode = '23505';
  end if;

  select count(*) into v_identity_count
  from auth.identities identity
  where identity.user_id = p_auth_user_id
    and identity.provider = 'custom:feishu';
  if v_identity_count <> 1 then
    raise exception 'Bootstrap requires one Feishu identity'
      using errcode = '22023';
  end if;

  select identity.identity_data, identity.provider_id
  into strict v_identity_data, v_auth_provider_subject
  from auth.identities identity
  where identity.user_id = p_auth_user_id
    and identity.provider = 'custom:feishu';

  select provider.id, provider.provider_tenant_key
  into strict v_provider_id, v_provider_tenant_key
  from public.identity_providers provider
  where provider.tenant_id = v_tenant_id
    and provider.provider_code = 'feishu'
    and provider.auth_provider = 'custom:feishu'
    and provider.status = 'active'
  for update;

  if v_provider_tenant_key = 'tenant_qxy' then
    raise exception 'Bootstrap Feishu provider lock is pending'
      using errcode = '55000';
  end if;

  v_claimed_tenant_key := coalesce(
    nullif(btrim(v_identity_data ->> 'provider_tenant_key'), ''),
    nullif(btrim(v_identity_data ->> 'tenant_key'), '')
  );
  if v_claimed_tenant_key is not null
     and v_claimed_tenant_key <> v_provider_tenant_key then
    raise exception 'Bootstrap Feishu tenant conflicts with the provider lock'
      using errcode = '42501';
  end if;

  v_provider_subject := coalesce(
    nullif(lower(btrim(v_identity_data ->> 'provider_subject')), ''),
    nullif(lower(btrim(v_identity_data ->> 'sub')), ''),
    nullif(lower(btrim(v_auth_provider_subject)), '')
  );
  v_provider_match_keys := array[v_provider_subject]::text[];
  v_display_name := nullif(btrim(coalesce(
    v_identity_data ->> 'display_name',
    v_identity_data ->> 'name'
  )), '');
  v_verified_email := case
    when lower(coalesce(v_identity_data ->> 'email_verified', 'false')) = 'true'
      then nullif(lower(btrim(v_identity_data ->> 'email')), '')
    else null
  end;

  if v_provider_subject is null
     or length(v_provider_subject) > 200
     or v_display_name is null
     or length(v_display_name) > 200 then
    raise exception 'Bootstrap Feishu identity is invalid'
      using errcode = '22023';
  end if;

  perform set_config('request.jwt.claim.sub', '', true);

  v_member_id := public.provision_employee_identity(
    p_tenant_slug => 'quantxy',
    p_organization_slug => 'quantum-galaxy',
    p_employee_no => upper(btrim(p_employee_no)),
    p_display_name => v_display_name,
    p_department_code => upper(btrim(p_department_code)),
    p_job_title => btrim(p_job_title),
    p_role_code => 'owner',
    p_provider_code => 'feishu',
    p_provider_tenant_key => v_provider_tenant_key,
    p_provider_subject => v_provider_subject,
    p_provider_match_keys => v_provider_match_keys,
    p_skills => coalesce(p_skills, '{}'::text[]),
    p_work_email => v_verified_email
  );

  perform public.bind_preprovisioned_identity(
    'quantxy',
    'feishu',
    v_provider_tenant_key,
    v_provider_subject,
    p_auth_user_id
  );

  perform set_config(
    'request.jwt.claim.sub',
    coalesce(v_original_auth_sub, ''),
    true
  );

  if (select count(*) from public.tenants) <> v_total_tenants_before then
    raise exception 'Bootstrap changed the tenant count' using errcode = '55000';
  end if;
  if (
    select count(*)
    from public.organization_members member
    where member.tenant_id = v_tenant_id
  ) <> 1 then
    raise exception 'Bootstrap member count is invalid' using errcode = '55000';
  end if;

  perform public.append_audit_log(
    v_tenant_id,
    v_organization_id,
    p_auth_user_id,
    v_member_id,
    'tenant.bootstrap_owner',
    'tenant',
    v_tenant_id::text,
    null,
    null,
    jsonb_build_object(
      'employee_no', upper(btrim(p_employee_no)),
      'role', 'owner',
      'identity_claims', 'normalized'
    )
  );

  return v_member_id;
exception
  when others then
    perform set_config(
      'request.jwt.claim.sub',
      coalesce(v_original_auth_sub, ''),
      true
    );
    raise;
end;
$$;

revoke all on function public.bootstrap_first_owner_from_auth_identity(
  uuid, text, text, text, text[]
) from public, anon, authenticated;
grant execute on function public.bootstrap_first_owner_from_auth_identity(
  uuid, text, text, text, text[]
) to service_role;
