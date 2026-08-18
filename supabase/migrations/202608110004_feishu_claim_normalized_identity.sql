alter function public.claim_current_identity()
  rename to claim_current_identity_v1;

revoke all on function public.claim_current_identity_v1()
  from public, anon, authenticated, service_role;

create or replace function public.claim_current_identity()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth_user_id uuid := (select auth.uid());
  v_bound_identity record;
  v_original_identity_data jsonb;
  v_provider_tenant_key text;
  v_provider_subject text;
  v_result text;
begin
  if v_auth_user_id is null then
    return 'unauthenticated';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('claim-current-identity:' || v_auth_user_id::text, 0)
  );

  select external.id as external_identity_id,
         external.status as external_identity_status,
         member.status as member_status,
         profile.employment_status as employment_status,
         provider.status = 'active' as provider_active,
         tenant.status = 'active' as tenant_active
  into v_bound_identity
  from public.external_identities external
  join public.identity_providers provider
    on provider.tenant_id = external.tenant_id
   and provider.id = external.identity_provider_id
  join public.tenants tenant
    on tenant.id = external.tenant_id
  join public.organization_members member
    on member.tenant_id = external.tenant_id
   and member.id = external.organization_member_id
  join public.employee_profiles profile
    on profile.tenant_id = external.tenant_id
   and profile.organization_member_id = member.id
   and profile.deleted_at is null
  where external.auth_user_id = v_auth_user_id
  order by external.updated_at desc
  limit 1;

  if found then
    if not v_bound_identity.provider_active
       or not v_bound_identity.tenant_active then
      return 'invalid_identity';
    end if;
    if v_bound_identity.external_identity_status = 'revoked' then
      return 'revoked';
    end if;
    if v_bound_identity.member_status = 'suspended' then
      return 'suspended';
    end if;
    if v_bound_identity.employment_status = 'departed' then
      return 'departed';
    end if;

    update public.external_identities external
    set last_login_at = now(),
        updated_at = now()
    where external.id = v_bound_identity.external_identity_id;
    return 'active';
  end if;

  select identity.identity_data,
         provider.provider_tenant_key,
         coalesce(
           nullif(lower(btrim(identity.identity_data ->> 'provider_subject')), ''),
           nullif(lower(btrim(identity.identity_data ->> 'sub')), ''),
           nullif(lower(btrim(identity.provider_id)), '')
         )
  into v_original_identity_data, v_provider_tenant_key, v_provider_subject
  from auth.identities identity
  join public.identity_providers provider
    on provider.auth_provider = identity.provider
   and provider.status = 'active'
  join public.tenants tenant
    on tenant.id = provider.tenant_id
   and tenant.status = 'active'
  where identity.user_id = v_auth_user_id
    and identity.provider = 'custom:feishu'
  order by identity.updated_at desc
  limit 1
  for update of identity;

  if not found then
    return 'not_provisioned';
  end if;
  if v_provider_tenant_key = 'tenant_qxy'
     or v_provider_subject is null
     or length(v_provider_subject) > 200 then
    return 'invalid_identity';
  end if;

  update auth.identities identity
  set identity_data = identity.identity_data || jsonb_build_object(
    'provider_tenant_key', v_provider_tenant_key,
    'provider_subject', v_provider_subject,
    'provider_match_keys', jsonb_build_array(v_provider_subject)
  )
  where identity.user_id = v_auth_user_id
    and identity.provider = 'custom:feishu';

  v_result := public.claim_current_identity_v1();

  update auth.identities identity
  set identity_data = v_original_identity_data
  where identity.user_id = v_auth_user_id
    and identity.provider = 'custom:feishu';

  return v_result;
end;
$$;

revoke all on function public.claim_current_identity()
  from public, anon;
grant execute on function public.claim_current_identity() to authenticated;
