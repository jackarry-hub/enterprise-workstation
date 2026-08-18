alter table public.audit_logs
  drop constraint if exists audit_logs_action_check;

alter table public.audit_logs
  add constraint audit_logs_action_check check (action in (
    'identity.provisioned',
    'identity.claimed',
    'identity.revoked',
    'member.status_changed',
    'member.role_changed',
    'profile.updated',
    'roster.imported',
    'tenant.bootstrap_owner'
  ));

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
  v_tenant_id bigint;
  v_tenant_count bigint;
  v_total_tenants_before bigint;
  v_organization_id bigint;
  v_member_count bigint;
  v_identity_count bigint;
  v_identity_data jsonb;
  v_auth_provider_subject text;
  v_provider_id bigint;
  v_existing_provider_tenant_key text;
  v_provider_tenant_key text;
  v_provider_subject text;
  v_provider_match_keys text[] := '{}'::text[];
  v_verified_email text;
  v_display_name text;
  v_open_id text;
  v_union_id text;
  v_member_id bigint;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('quantxy:first-owner-bootstrap', 0)
  );

  if p_auth_user_id is null
     or nullif(btrim(p_employee_no), '') is null
     or nullif(btrim(p_department_code), '') is null
     or nullif(btrim(p_job_title), '') is null then
    raise exception 'Bootstrap owner fields are incomplete' using errcode = '22023';
  end if;
  if cardinality(coalesce(p_skills, '{}'::text[])) > 30 then
    raise exception 'Bootstrap owner skills are invalid' using errcode = '22023';
  end if;

  select count(*), min(tenant.id)
  into v_tenant_count, v_tenant_id
  from public.tenants tenant
  where tenant.slug = 'quantxy'
    and tenant.status = 'active';
  if v_tenant_count <> 1 then
    raise exception 'Bootstrap tenant is not unique' using errcode = 'P0002';
  end if;

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
    raise exception 'Bootstrap requires one Feishu identity' using errcode = '22023';
  end if;

  select identity.identity_data, identity.provider_id
  into strict v_identity_data, v_auth_provider_subject
  from auth.identities identity
  where identity.user_id = p_auth_user_id
    and identity.provider = 'custom:feishu';

  v_provider_tenant_key := coalesce(
    nullif(btrim(v_identity_data ->> 'provider_tenant_key'), ''),
    nullif(btrim(v_identity_data ->> 'tenant_key'), '')
  );
  v_provider_subject := coalesce(
    nullif(lower(btrim(v_identity_data ->> 'provider_subject')), ''),
    nullif(lower(btrim(v_identity_data ->> 'sub')), ''),
    nullif(lower(btrim(v_auth_provider_subject)), '')
  );
  v_display_name := nullif(btrim(coalesce(
    v_identity_data ->> 'display_name',
    v_identity_data ->> 'name'
  )), '');
  v_verified_email := nullif(lower(btrim(
    v_identity_data ->> 'verified_email'
  )), '');
  v_open_id := nullif(lower(btrim(v_identity_data ->> 'open_id')), '');
  v_union_id := nullif(lower(btrim(v_identity_data ->> 'union_id')), '');

  if jsonb_typeof(v_identity_data -> 'provider_match_keys') = 'array' then
    select coalesce(array_agg(distinct lower(btrim(match_key))), '{}'::text[])
    into v_provider_match_keys
    from jsonb_array_elements_text(
      v_identity_data -> 'provider_match_keys'
    ) as match_key
    where length(btrim(match_key)) between 1 and 200;
  end if;

  select coalesce(array_agg(distinct match_key), '{}'::text[])
  into v_provider_match_keys
  from unnest(
    v_provider_match_keys
    || array[
      v_provider_subject,
      case when v_open_id is not null then 'open_id:' || v_open_id end,
      case when v_union_id is not null then 'union_id:' || v_union_id end,
      case when v_verified_email is not null then 'email:' || v_verified_email end
    ]
  ) as match_key
  where match_key is not null
    and length(match_key) between 1 and 200;

  if v_provider_tenant_key is null
     or length(v_provider_tenant_key) > 200
     or v_provider_subject is null
     or length(v_provider_subject) > 200
     or v_display_name is null
     or length(v_display_name) > 200
     or cardinality(v_provider_match_keys) = 0
     or cardinality(v_provider_match_keys) > 30 then
    raise exception 'Bootstrap Feishu identity is invalid' using errcode = '22023';
  end if;

  select provider.id, provider.provider_tenant_key
  into strict v_provider_id, v_existing_provider_tenant_key
  from public.identity_providers provider
  where provider.tenant_id = v_tenant_id
    and provider.provider_code = 'feishu'
    and provider.auth_provider = 'custom:feishu'
    and provider.status = 'active'
  for update;

  if v_existing_provider_tenant_key <> 'tenant_qxy'
     and v_existing_provider_tenant_key <> v_provider_tenant_key then
    raise exception 'Bootstrap Feishu tenant conflicts with the provider lock'
      using errcode = '42501';
  end if;

  update public.identity_providers provider
  set provider_tenant_key = v_provider_tenant_key,
      safe_metadata = provider.safe_metadata
        || jsonb_build_object('tenant_lock_state', 'locked'),
      updated_at = now()
  where provider.tenant_id = v_tenant_id
    and provider.id = v_provider_id;

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

  if (select count(*) from public.tenants) <> v_total_tenants_before then
    raise exception 'Bootstrap changed the tenant count' using errcode = '55000';
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
      'role', 'owner'
    )
  );

  return v_member_id;
end;
$$;

revoke all on function public.bootstrap_first_owner_from_auth_identity(
  uuid, text, text, text, text[]
) from public, anon, authenticated;
grant execute on function public.bootstrap_first_owner_from_auth_identity(
  uuid, text, text, text, text[]
) to service_role;
