-- Durable, service-role-only observability for Feishu directory synchronization.
-- The legacy apply function owns all snapshot mutations.  These wrappers only
-- correlate its committed run or record the failure after its transaction rolls
-- back, so a failed fetch/apply can never publish a partial snapshot.

alter table public.directory_sync_runs
  add column if not exists request_id uuid;

create unique index if not exists directory_sync_runs_tenant_request_id_uidx
  on public.directory_sync_runs (tenant_id, request_id)
  where request_id is not null;

create or replace function public.apply_feishu_directory_sync_observed(
  p_tenant_public_id uuid,
  p_actor_auth_user_id uuid,
  p_snapshot jsonb,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id bigint;
  v_organization_id bigint;
  v_actor_member_id bigint;
  v_before_run_id bigint := 0;
  v_sync_run_id bigint;
  v_existing_result jsonb;
begin
  if p_tenant_public_id is null or p_actor_auth_user_id is null
     or p_request_id is null then
    raise exception 'Directory sync request is invalid' using errcode = '22023';
  end if;

  select tenant.id, organization.id
  into strict v_tenant_id, v_organization_id
  from public.tenants tenant
  join public.organizations organization on organization.tenant_id = tenant.id
  where tenant.public_id = p_tenant_public_id
    and tenant.status = 'active'
  order by organization.id
  limit 1;

  select member.id into v_actor_member_id
  from public.organization_members member
  where member.tenant_id = v_tenant_id
    and member.organization_id = v_organization_id
    and member.user_id = p_actor_auth_user_id
    and member.status = 'active';
  if v_actor_member_id is null or not exists (
    select 1
    from public.member_roles assignment
    join public.roles role
      on role.tenant_id = assignment.tenant_id
     and role.id = assignment.role_id
     and role.is_enabled
    where assignment.tenant_id = v_tenant_id
      and assignment.member_id = v_actor_member_id
      and role.code in ('owner', 'admin')
  ) then
    raise exception 'Directory actor is not authorized' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('directory-sync:' || v_tenant_id::text, 0)
  );

  select jsonb_build_object(
    'runId', run.public_id,
    'status', run.status,
    'departmentCount', run.departments_seen,
    'employeeCount', run.employees_seen,
    'issueCount', (
      select count(*)
      from public.directory_sync_issues issue
      where issue.tenant_id = run.tenant_id
        and issue.sync_run_id = run.id
    )
  ) into v_existing_result
  from public.directory_sync_runs run
  where run.tenant_id = v_tenant_id
    and run.request_id = p_request_id;
  if v_existing_result is not null then
    return v_existing_result;
  end if;

  select coalesce(max(run.id), 0) into v_before_run_id
  from public.directory_sync_runs run
  where run.tenant_id = v_tenant_id;

  perform public.apply_feishu_directory_sync(
    p_tenant_public_id,
    p_actor_auth_user_id,
    p_snapshot
  );

  select run.id into strict v_sync_run_id
  from public.directory_sync_runs run
  where run.tenant_id = v_tenant_id
    and run.id > v_before_run_id;

  update public.directory_sync_runs run
  set request_id = p_request_id
  where run.tenant_id = v_tenant_id
    and run.id = v_sync_run_id;

  return (
    select jsonb_build_object(
      'runId', run.public_id,
      'status', run.status,
      'departmentCount', run.departments_seen,
      'employeeCount', run.employees_seen,
      'issueCount', (
        select count(*)
        from public.directory_sync_issues issue
        where issue.tenant_id = run.tenant_id
          and issue.sync_run_id = run.id
      )
    )
    from public.directory_sync_runs run
    where run.tenant_id = v_tenant_id
      and run.id = v_sync_run_id
  );
end;
$$;

create or replace function public.record_feishu_directory_sync_failure(
  p_tenant_public_id uuid,
  p_actor_auth_user_id uuid,
  p_code text,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id bigint;
  v_organization_id bigint;
  v_actor_member_id bigint;
  v_provider_id bigint;
  v_provider_tenant_key text;
  v_connection_id bigint;
  v_sync_run_id bigint;
  v_existing_result jsonb;
begin
  if p_tenant_public_id is null or p_actor_auth_user_id is null
     or p_request_id is null
     or p_code is null
     or p_code not in (
       'directory_configuration_invalid',
       'directory_provider_unavailable',
       'directory_pagination_invalid',
       'directory_pagination_limit',
       'directory_apply_failed',
       'directory_unexpected'
     ) then
    raise exception 'Directory failure request is invalid' using errcode = '22023';
  end if;

  select tenant.id, organization.id
  into strict v_tenant_id, v_organization_id
  from public.tenants tenant
  join public.organizations organization on organization.tenant_id = tenant.id
  where tenant.public_id = p_tenant_public_id
    and tenant.status = 'active'
  order by organization.id
  limit 1;

  select member.id into v_actor_member_id
  from public.organization_members member
  where member.tenant_id = v_tenant_id
    and member.organization_id = v_organization_id
    and member.user_id = p_actor_auth_user_id
    and member.status = 'active';
  if v_actor_member_id is null or not exists (
    select 1
    from public.member_roles assignment
    join public.roles role
      on role.tenant_id = assignment.tenant_id
     and role.id = assignment.role_id
     and role.is_enabled
    where assignment.tenant_id = v_tenant_id
      and assignment.member_id = v_actor_member_id
      and role.code in ('owner', 'admin')
  ) then
    raise exception 'Directory actor is not authorized' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('directory-sync:' || v_tenant_id::text, 0)
  );

  select jsonb_build_object(
    'runId', run.public_id,
    'status', run.status,
    'departmentCount', run.departments_seen,
    'employeeCount', run.employees_seen,
    'issueCount', (
      select count(*)
      from public.directory_sync_issues issue
      where issue.tenant_id = run.tenant_id
        and issue.sync_run_id = run.id
    )
  ) into v_existing_result
  from public.directory_sync_runs run
  where run.tenant_id = v_tenant_id
    and run.request_id = p_request_id;
  if v_existing_result is not null then
    return v_existing_result;
  end if;

  select provider.id, provider.provider_tenant_key
  into strict v_provider_id, v_provider_tenant_key
  from public.identity_providers provider
  where provider.tenant_id = v_tenant_id
    and provider.provider_code = 'feishu'
    and provider.status = 'active';

  insert into public.directory_connections (
    tenant_id, organization_id, identity_provider_id, provider_type,
    external_tenant_key, sync_mode, status
  ) values (
    v_tenant_id, v_organization_id, v_provider_id, 'feishu',
    v_provider_tenant_key, 'manual', 'error'
  )
  on conflict (tenant_id, identity_provider_id) do update set
    organization_id = excluded.organization_id,
    external_tenant_key = excluded.external_tenant_key,
    status = 'error',
    updated_at = clock_timestamp()
  returning id into v_connection_id;

  insert into public.directory_sync_runs (
    tenant_id, organization_id, connection_id, actor_member_id,
    status, snapshot_complete, departments_seen, employees_seen,
    positions_seen, error_count, request_id, started_at, completed_at
  ) values (
    v_tenant_id, v_organization_id, v_connection_id, v_actor_member_id,
    'failed', false, 0, 0, 0, 1, p_request_id, clock_timestamp(), clock_timestamp()
  ) returning id into v_sync_run_id;

  insert into public.directory_sync_issues (
    tenant_id, organization_id, sync_run_id, severity, code, message
  ) values (
    v_tenant_id, v_organization_id, v_sync_run_id, 'error', upper(p_code),
    'Directory synchronization failed; retry with the request ID.'
  );

  perform public.append_audit_log(
    v_tenant_id, v_organization_id, p_actor_auth_user_id, v_actor_member_id,
    'directory.sync_failed', 'directory_sync_run', v_sync_run_id::text,
    p_request_id, null, jsonb_build_object('code', p_code, 'issueCount', 1)
  );

  return (
    select jsonb_build_object(
      'runId', run.public_id,
      'status', run.status,
      'departmentCount', run.departments_seen,
      'employeeCount', run.employees_seen,
      'issueCount', (
        select count(*)
        from public.directory_sync_issues issue
        where issue.tenant_id = run.tenant_id
          and issue.sync_run_id = run.id
      )
    )
    from public.directory_sync_runs run
    where run.tenant_id = v_tenant_id
      and run.id = v_sync_run_id
  );
end;
$$;

revoke all on function public.apply_feishu_directory_sync_observed(uuid, uuid, jsonb, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.apply_feishu_directory_sync_observed(uuid, uuid, jsonb, uuid)
  to service_role;

revoke all on function public.record_feishu_directory_sync_failure(uuid, uuid, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.record_feishu_directory_sync_failure(uuid, uuid, text, uuid)
  to service_role;

revoke insert, update, delete on table public.directory_connections,
  public.directory_sync_runs, public.directory_sync_issues
  from public, anon, authenticated, service_role;
