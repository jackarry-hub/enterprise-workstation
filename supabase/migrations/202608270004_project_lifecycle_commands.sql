-- This migration deliberately follows the 202608270002/003 audit-constraint
-- rebuilds so fresh installs and incremental upgrades converge on one schema.
alter table public.audit_logs drop constraint if exists audit_logs_action_check;
alter table public.audit_logs add constraint audit_logs_action_check check (action in (
  'identity.provisioned', 'identity.claimed', 'identity.revoked', 'member.status_changed',
  'member.role_changed', 'profile.updated', 'roster.imported', 'tenant.bootstrap_owner',
  'enterprise.initialized', 'directory.sync_started', 'directory.sync_completed',
  'directory.sync_failed', 'directory.role_mapped', 'project.created', 'project.updated',
  'project.archived', 'project.command_failed', 'task.created',
  'payroll_policy.activated', 'payroll.calculated', 'payroll.confirmed', 'ai.config.updated',
  'organization.department_created', 'organization.department_updated',
  'organization.position_upserted', 'organization.role_assigned', 'organization.command_failed',
  'organization.manager_assigned', 'directory.manager_mapped',
  'employee_skill.verified', 'employee_skill.verification_failed',
  'directory.sync_issue_resolved'
));

alter table public.projects
  add column tenant_id bigint,
  add column category text not null default '企业项目',
  add column budget_amount numeric(18, 2) not null default 0,
  add column version bigint not null default 1,
  add column updated_by_member_id bigint,
  add column archived_at timestamptz;

update public.projects project
set tenant_id = organization.tenant_id,
    updated_by_member_id = project.created_by_member_id,
    archived_at = case
      when project.deleted_at is not null then project.deleted_at
      else project.archived_at
    end
from public.organizations organization
where organization.id = project.organization_id;

alter table public.projects
  alter column tenant_id set not null,
  alter column updated_by_member_id set not null,
  add constraint projects_tenant_fkey
    foreign key (tenant_id) references public.tenants(id) on delete restrict,
  add constraint projects_tenant_organization_fkey
    foreign key (tenant_id, organization_id)
    references public.organizations(tenant_id, id) on delete restrict,
  add constraint projects_updated_by_same_organization_fkey
    foreign key (organization_id, updated_by_member_id)
    references public.organization_members(organization_id, id) on delete restrict,
  add constraint projects_budget_amount_check check (budget_amount >= 0),
  add constraint projects_version_check check (version > 0),
  add constraint projects_category_check check (length(btrim(category)) between 1 and 80),
  add constraint projects_archive_state_check check (
    (archived_at is null and deleted_at is null)
    or (archived_at is not null and deleted_at is not null)
  );

create unique index projects_tenant_organization_id_uidx
  on public.projects(tenant_id, organization_id, id);

alter table public.project_members
  add column tenant_id bigint,
  add column created_by_member_id bigint,
  add column updated_by_member_id bigint,
  add column version bigint not null default 1;

update public.project_members membership
set tenant_id = project.tenant_id,
    created_by_member_id = project.created_by_member_id,
    updated_by_member_id = project.updated_by_member_id
from public.projects project
where project.id = membership.project_id
  and project.organization_id = membership.organization_id;

alter table public.project_members
  alter column tenant_id set not null,
  alter column created_by_member_id set not null,
  alter column updated_by_member_id set not null,
  add constraint project_members_tenant_fkey
    foreign key (tenant_id) references public.tenants(id) on delete restrict,
  add constraint project_members_exact_project_fkey
    foreign key (tenant_id, organization_id, project_id)
    references public.projects(tenant_id, organization_id, id) on delete cascade,
  add constraint project_members_creator_same_organization_fkey
    foreign key (organization_id, created_by_member_id)
    references public.organization_members(organization_id, id) on delete restrict,
  add constraint project_members_updater_same_organization_fkey
    foreign key (organization_id, updated_by_member_id)
    references public.organization_members(organization_id, id) on delete restrict,
  add constraint project_members_version_check check (version > 0);

create table public.project_command_idempotency (
  tenant_id bigint not null references public.tenants(id) on delete restrict,
  organization_id bigint not null,
  operation text not null check (operation in (
    'create_current_project_v2', 'update_current_project', 'archive_current_project'
  )),
  idempotency_key uuid not null,
  request_id uuid not null,
  result jsonb,
  created_at timestamptz not null default clock_timestamp(),
  primary key (tenant_id, operation, idempotency_key),
  foreign key (tenant_id, organization_id)
    references public.organizations(tenant_id, id) on delete restrict
);

alter table public.projects enable row level security;
alter table public.projects force row level security;
alter table public.project_members enable row level security;
alter table public.project_members force row level security;
alter table public.project_command_idempotency enable row level security;
alter table public.project_command_idempotency force row level security;

create or replace function public.current_project_command_context()
returns table (
  tenant_id bigint,
  organization_id bigint,
  actor_member_id bigint,
  actor_auth_user_id uuid,
  permission_scope text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Project command permission required' using errcode = '42501';
  end if;
  return query
  select tenant.id, organization.id, member.id, (select auth.uid()),
         case when exists (
           select 1
           from public.member_roles assignment
           join public.roles role on role.tenant_id = assignment.tenant_id
             and role.id = assignment.role_id and role.is_enabled
           join public.role_permissions role_grant on role_grant.tenant_id = assignment.tenant_id
             and role_grant.role_id = assignment.role_id
           join public.permissions permission on permission.id = role_grant.permission_id
           where assignment.tenant_id = member.tenant_id and assignment.member_id = member.id
             and (role.organization_id is null or role.organization_id = member.organization_id)
             and permission.code = 'project.manage'
         ) then 'project.manage' else 'organization.manage' end
  from public.external_identities external
  join public.identity_providers provider on provider.tenant_id = external.tenant_id
    and provider.id = external.identity_provider_id and provider.status = 'active'
  join public.tenants tenant on tenant.id = external.tenant_id and tenant.status = 'active'
  join public.organizations organization on organization.tenant_id = external.tenant_id
    and organization.id = external.organization_id
  join public.organization_members member on member.tenant_id = external.tenant_id
    and member.organization_id = external.organization_id
    and member.id = external.organization_member_id and member.status = 'active'
  join public.employee_profiles profile on profile.tenant_id = member.tenant_id
    and profile.organization_id = member.organization_id
    and profile.organization_member_id = member.id
    and profile.deleted_at is null
    and profile.employment_status in ('probation', 'active', 'on_leave')
  where external.auth_user_id = (select auth.uid()) and external.status = 'active'
    and exists (
      select 1
      from public.member_roles assignment
      join public.roles role on role.tenant_id = assignment.tenant_id
        and role.id = assignment.role_id and role.is_enabled
      join public.role_permissions role_grant on role_grant.tenant_id = assignment.tenant_id
        and role_grant.role_id = assignment.role_id
      join public.permissions permission on permission.id = role_grant.permission_id
      where assignment.tenant_id = member.tenant_id and assignment.member_id = member.id
        and (role.organization_id is null or role.organization_id = member.organization_id)
        and permission.code in ('project.manage', 'organization.manage')
    )
  limit 1;
  if not found then
    raise exception 'Project command permission required' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.complete_project_command(
  p_tenant_id bigint,
  p_organization_id bigint,
  p_actor_auth_user_id uuid,
  p_actor_member_id bigint,
  p_operation text,
  p_action text,
  p_target_id text,
  p_request_id uuid,
  p_idempotency_key uuid,
  p_permission_scope text,
  p_reason text,
  p_outcome text,
  p_error text,
  p_before jsonb,
  p_after jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  v_result := case when p_outcome = 'success' then jsonb_build_object(
    'outcome', 'success', 'id', p_target_id,
    'version', coalesce(p_after -> 'version', 'null'::jsonb),
    'project', coalesce(p_after, '{}'::jsonb)
  ) else jsonb_build_object('outcome', 'failure', 'error', p_error) end;
  update public.project_command_idempotency ledger
     set result = v_result
   where ledger.tenant_id = p_tenant_id
     and ledger.organization_id = p_organization_id
     and ledger.operation = p_operation
     and ledger.idempotency_key = p_idempotency_key;
  perform public.append_audit_log(
    p_tenant_id, p_organization_id, p_actor_auth_user_id, p_actor_member_id,
    case when p_outcome = 'success' then p_action else 'project.command_failed' end,
    'project', p_target_id, p_request_id, null,
    jsonb_build_object(
      'outcome', p_outcome, 'requestId', p_request_id,
      'idempotencyKey', p_idempotency_key, 'permissionScope', p_permission_scope,
      'businessReason', p_reason, 'before', coalesce(p_before, 'null'::jsonb),
      'after', coalesce(p_after, 'null'::jsonb),
      'failure', case when p_outcome = 'failure' then p_error else null end
    )
  );
  return v_result;
end;
$$;

create or replace function public.audit_project_scope_conflict(
  p_tenant_id bigint,
  p_organization_id bigint,
  p_actor_auth_user_id uuid,
  p_actor_member_id bigint,
  p_operation text,
  p_request_id uuid,
  p_idempotency_key uuid,
  p_permission_scope text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.append_audit_log(
    p_tenant_id, p_organization_id, p_actor_auth_user_id, p_actor_member_id,
    'project.command_failed', 'project', null, p_request_id, null,
    jsonb_build_object(
      'outcome', 'failure', 'requestId', p_request_id,
      'idempotencyKey', p_idempotency_key, 'permissionScope', p_permission_scope,
      'businessReason', p_reason, 'before', 'null'::jsonb, 'after', 'null'::jsonb,
      'failure', 'scope_conflict'
    )
  );
  return jsonb_build_object('outcome', 'failure', 'error', 'scope_conflict');
end;
$$;

create or replace function public.create_current_project_v2(
  p_name text,
  p_description text,
  p_category text,
  p_owner_employee_public_id uuid,
  p_budget_amount numeric,
  p_status text,
  p_priority text,
  p_starts_on date,
  p_due_on date,
  p_version bigint,
  p_reason text,
  request_id uuid,
  idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant bigint;
  v_org bigint;
  v_actor bigint;
  v_user uuid;
  v_permission text;
  v_claimed boolean;
  v_existing_org bigint;
  v_existing jsonb;
  v_owner bigint;
  v_project public.projects%rowtype;
  v_project_public_id uuid := gen_random_uuid();
  v_after jsonb;
  v_failure text;
begin
  select * into v_tenant, v_org, v_actor, v_user, v_permission
    from public.current_project_command_context();
  if request_id is null or idempotency_key is null or request_id = idempotency_key
     or p_version is null or p_version <> 0 or nullif(btrim(p_name), '') is null
     or length(btrim(p_name)) > 160 or p_description is null
     or length(p_description) > 4000 or nullif(btrim(p_category), '') is null
     or length(btrim(p_category)) > 80 or p_owner_employee_public_id is null
     or p_budget_amount is null or p_budget_amount = 'NaN'::numeric
     or p_budget_amount < 0 or p_budget_amount > 9999999999999999.99
     or p_budget_amount <> trunc(p_budget_amount, 2)
     or p_status is null or p_status not in ('planning', 'active')
     or p_priority is null or p_priority not in ('low', 'medium', 'high', 'critical')
     or p_starts_on is null or p_due_on is null or p_due_on < p_starts_on
     or p_reason is null or length(btrim(p_reason)) not between 1 and 500 then
    raise exception 'Project command is invalid' using errcode = '22023';
  end if;
  insert into public.project_command_idempotency(
    tenant_id, organization_id, operation, idempotency_key, request_id
  ) values (v_tenant, v_org, 'create_current_project_v2', idempotency_key, request_id)
  on conflict do nothing returning true into v_claimed;
  if not coalesce(v_claimed, false) then
    select ledger.organization_id, ledger.result
      into v_existing_org, v_existing
      from public.project_command_idempotency ledger
     where ledger.tenant_id = v_tenant
       and ledger.operation = 'create_current_project_v2'
       and ledger.idempotency_key = create_current_project_v2.idempotency_key;
    if v_existing_org is distinct from v_org then
      return public.audit_project_scope_conflict(
        v_tenant, v_org, v_user, v_actor, 'create_current_project_v2',
        request_id, idempotency_key, v_permission, btrim(p_reason)
      );
    end if;
    return v_existing;
  end if;
  select profile.organization_member_id into v_owner
    from public.employee_profiles profile
    join public.organization_members member on member.tenant_id = profile.tenant_id
      and member.organization_id = profile.organization_id
      and member.id = profile.organization_member_id and member.status = 'active'
   where profile.tenant_id = v_tenant and profile.organization_id = v_org
     and profile.public_id = p_owner_employee_public_id
     and profile.deleted_at is null
     and profile.employment_status in ('probation', 'active', 'on_leave');
  if not found then
    return public.complete_project_command(
      v_tenant, v_org, v_user, v_actor, 'create_current_project_v2', 'project.created',
      null, request_id, idempotency_key, v_permission, btrim(p_reason),
      'failure', 'not_found', null, null
    );
  end if;
  begin
    insert into public.projects(
      public_id, tenant_id, organization_id, code, name, category, description,
      owner_member_id, created_by_member_id, updated_by_member_id, budget_amount,
      status, health, priority, start_date, due_date, progress, version
    ) values (
      v_project_public_id, v_tenant, v_org,
      'QXY-' || upper(substr(replace(v_project_public_id::text, '-', ''), 1, 10)),
      btrim(p_name), btrim(p_category), btrim(p_description), v_owner, v_actor, v_actor,
      p_budget_amount, p_status, 'on_track', p_priority, p_starts_on, p_due_on, 0, 1
    ) returning * into v_project;
    insert into public.project_members(
      tenant_id, organization_id, project_id, member_id, role, allocation_percent,
      created_by_member_id, updated_by_member_id, version
    ) values (v_tenant, v_org, v_project.id, v_owner, 'owner', 100, v_actor, v_actor, 1);
    if v_actor <> v_owner then
      insert into public.project_members(
        tenant_id, organization_id, project_id, member_id, role, allocation_percent,
        created_by_member_id, updated_by_member_id, version
      ) values (v_tenant, v_org, v_project.id, v_actor, 'manager', 100, v_actor, v_actor, 1);
    end if;
  exception when unique_violation then
    v_failure := 'conflict';
  when others then
    v_failure := 'command_failed';
  end;
  if v_failure is not null then
    return public.complete_project_command(
      v_tenant, v_org, v_user, v_actor, 'create_current_project_v2', 'project.created',
      null, request_id, idempotency_key, v_permission, btrim(p_reason),
      'failure', v_failure, null, null
    );
  end if;
  v_after := jsonb_build_object(
    'id', v_project.public_id, 'version', v_project.version, 'name', v_project.name,
    'category', btrim(p_category), 'ownerPublicId', p_owner_employee_public_id,
    'budgetAmount', v_project.budget_amount::text, 'status', v_project.status,
    'priority', v_project.priority, 'health', v_project.health,
    'progress', v_project.progress, 'startsOn', v_project.start_date,
    'dueOn', v_project.due_date, 'updatedAt', v_project.updated_at
  );
  return public.complete_project_command(
    v_tenant, v_org, v_user, v_actor, 'create_current_project_v2', 'project.created',
    v_project.public_id::text, request_id, idempotency_key, v_permission, btrim(p_reason),
    'success', null, null, v_after
  );
end;
$$;

create or replace function public.update_current_project(
  p_project_public_id uuid,
  p_name text,
  p_description text,
  p_category text,
  p_owner_employee_public_id uuid,
  p_budget_amount numeric,
  p_priority text,
  p_starts_on date,
  p_due_on date,
  p_expected_version bigint,
  p_reason text,
  request_id uuid,
  idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant bigint;
  v_org bigint;
  v_actor bigint;
  v_user uuid;
  v_permission text;
  v_claimed boolean;
  v_existing_org bigint;
  v_existing jsonb;
  v_owner bigint;
  v_project public.projects%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_failure text;
begin
  select * into v_tenant, v_org, v_actor, v_user, v_permission
    from public.current_project_command_context();
  if p_project_public_id is null or request_id is null or idempotency_key is null
     or request_id = idempotency_key or p_expected_version is null or p_expected_version < 1
     or nullif(btrim(p_name), '') is null or length(btrim(p_name)) > 160
     or p_description is null or length(p_description) > 4000
     or nullif(btrim(p_category), '') is null or length(btrim(p_category)) > 80
     or p_owner_employee_public_id is null or p_budget_amount is null
     or p_budget_amount = 'NaN'::numeric or p_budget_amount < 0
     or p_budget_amount > 9999999999999999.99
     or p_budget_amount <> trunc(p_budget_amount, 2)
     or p_priority is null or p_priority not in ('low', 'medium', 'high', 'critical')
     or p_starts_on is null or p_due_on is null or p_due_on < p_starts_on
     or p_reason is null or length(btrim(p_reason)) not between 1 and 500 then
    raise exception 'Project command is invalid' using errcode = '22023';
  end if;
  insert into public.project_command_idempotency(
    tenant_id, organization_id, operation, idempotency_key, request_id
  ) values (v_tenant, v_org, 'update_current_project', idempotency_key, request_id)
  on conflict do nothing returning true into v_claimed;
  if not coalesce(v_claimed, false) then
    select ledger.organization_id, ledger.result into v_existing_org, v_existing
      from public.project_command_idempotency ledger
     where ledger.tenant_id = v_tenant and ledger.operation = 'update_current_project'
       and ledger.idempotency_key = update_current_project.idempotency_key;
    if v_existing_org is distinct from v_org then
      return public.audit_project_scope_conflict(
        v_tenant, v_org, v_user, v_actor, 'update_current_project', request_id,
        idempotency_key, v_permission, btrim(p_reason)
      );
    end if;
    return v_existing;
  end if;
  select * into v_project from public.projects project
   where project.tenant_id = v_tenant and project.organization_id = v_org
     and project.public_id = p_project_public_id and project.deleted_at is null
   for update;
  if not found then
    return public.complete_project_command(
      v_tenant, v_org, v_user, v_actor, 'update_current_project', 'project.updated',
      p_project_public_id::text, request_id, idempotency_key, v_permission, btrim(p_reason),
      'failure', 'not_found', null, null
    );
  end if;
  if v_project.version <> p_expected_version then
    return public.complete_project_command(
      v_tenant, v_org, v_user, v_actor, 'update_current_project', 'project.updated',
      v_project.public_id::text, request_id, idempotency_key, v_permission, btrim(p_reason),
      'failure', 'stale_version', null, null
    );
  end if;
  select profile.organization_member_id into v_owner
    from public.employee_profiles profile
    join public.organization_members member on member.tenant_id = profile.tenant_id
      and member.organization_id = profile.organization_id
      and member.id = profile.organization_member_id and member.status = 'active'
   where profile.tenant_id = v_tenant and profile.organization_id = v_org
     and profile.public_id = p_owner_employee_public_id and profile.deleted_at is null
     and profile.employment_status in ('probation', 'active', 'on_leave');
  if not found then
    return public.complete_project_command(
      v_tenant, v_org, v_user, v_actor, 'update_current_project', 'project.updated',
      v_project.public_id::text, request_id, idempotency_key, v_permission, btrim(p_reason),
      'failure', 'not_found', null, null
    );
  end if;
  v_before := jsonb_build_object(
    'id', v_project.public_id, 'version', v_project.version, 'name', v_project.name,
    'category', v_project.category, 'budgetAmount', v_project.budget_amount::text,
    'state', v_project.status, 'startsOn', v_project.start_date, 'dueOn', v_project.due_date
  );
  begin
    if v_owner <> v_project.owner_member_id then
      update public.project_members membership
         set role = case when membership.member_id = v_actor then 'manager' else 'member' end,
             updated_by_member_id = v_actor, version = membership.version + 1,
             updated_at = clock_timestamp()
       where membership.tenant_id = v_tenant and membership.organization_id = v_org
         and membership.project_id = v_project.id and membership.member_id = v_project.owner_member_id
         and membership.left_at is null;
      insert into public.project_members as membership(
        tenant_id, organization_id, project_id, member_id, role, allocation_percent,
        created_by_member_id, updated_by_member_id, version, left_at
      ) values (v_tenant, v_org, v_project.id, v_owner, 'owner', 100, v_actor, v_actor, 1, null)
      on conflict (project_id, member_id) do update set
        role = 'owner', left_at = null, updated_by_member_id = v_actor,
        version = membership.version + 1, updated_at = clock_timestamp();
    end if;
    update public.projects project set
      name = btrim(p_name), description = btrim(p_description), category = btrim(p_category),
      owner_member_id = v_owner, budget_amount = p_budget_amount, priority = p_priority,
      start_date = p_starts_on, due_date = p_due_on,
      updated_by_member_id = v_actor, version = project.version + 1,
      updated_at = clock_timestamp()
    where project.tenant_id = v_tenant and project.organization_id = v_org
      and project.id = v_project.id
    returning * into v_project;
  exception when unique_violation then
    v_failure := 'conflict';
  when others then
    v_failure := 'command_failed';
  end;
  if v_failure is not null then
    return public.complete_project_command(
      v_tenant, v_org, v_user, v_actor, 'update_current_project', 'project.updated',
      v_project.public_id::text, request_id, idempotency_key, v_permission, btrim(p_reason),
      'failure', v_failure, v_before, null
    );
  end if;
  v_after := jsonb_build_object(
    'id', v_project.public_id, 'version', v_project.version, 'name', v_project.name,
    'category', v_project.category, 'ownerPublicId', p_owner_employee_public_id,
    'budgetAmount', v_project.budget_amount::text, 'status', v_project.status,
    'startsOn', v_project.start_date, 'dueOn', v_project.due_date
  );
  return public.complete_project_command(
    v_tenant, v_org, v_user, v_actor, 'update_current_project', 'project.updated',
    v_project.public_id::text, request_id, idempotency_key, v_permission, btrim(p_reason),
    'success', null, v_before, v_after
  );
end;
$$;

create or replace function public.archive_current_project(
  p_project_public_id uuid,
  p_expected_version bigint,
  p_reason text,
  request_id uuid,
  idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant bigint;
  v_org bigint;
  v_actor bigint;
  v_user uuid;
  v_permission text;
  v_claimed boolean;
  v_existing_org bigint;
  v_existing jsonb;
  v_project public.projects%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_now timestamptz := clock_timestamp();
  v_failure text;
begin
  select * into v_tenant, v_org, v_actor, v_user, v_permission
    from public.current_project_command_context();
  if p_project_public_id is null or request_id is null or idempotency_key is null
     or request_id = idempotency_key or p_expected_version is null or p_expected_version < 1
     or p_reason is null or length(btrim(p_reason)) not between 1 and 500 then
    raise exception 'Project command is invalid' using errcode = '22023';
  end if;
  insert into public.project_command_idempotency(
    tenant_id, organization_id, operation, idempotency_key, request_id
  ) values (v_tenant, v_org, 'archive_current_project', idempotency_key, request_id)
  on conflict do nothing returning true into v_claimed;
  if not coalesce(v_claimed, false) then
    select ledger.organization_id, ledger.result into v_existing_org, v_existing
      from public.project_command_idempotency ledger
     where ledger.tenant_id = v_tenant and ledger.operation = 'archive_current_project'
       and ledger.idempotency_key = archive_current_project.idempotency_key;
    if v_existing_org is distinct from v_org then
      return public.audit_project_scope_conflict(
        v_tenant, v_org, v_user, v_actor, 'archive_current_project', request_id,
        idempotency_key, v_permission, btrim(p_reason)
      );
    end if;
    return v_existing;
  end if;
  select * into v_project from public.projects project
   where project.tenant_id = v_tenant and project.organization_id = v_org
     and project.public_id = p_project_public_id and project.deleted_at is null
   for update;
  if not found then
    return public.complete_project_command(
      v_tenant, v_org, v_user, v_actor, 'archive_current_project', 'project.archived',
      p_project_public_id::text, request_id, idempotency_key, v_permission, btrim(p_reason),
      'failure', 'not_found', null, null
    );
  end if;
  if v_project.version <> p_expected_version then
    return public.complete_project_command(
      v_tenant, v_org, v_user, v_actor, 'archive_current_project', 'project.archived',
      v_project.public_id::text, request_id, idempotency_key, v_permission, btrim(p_reason),
      'failure', 'stale_version', null, null
    );
  end if;
  v_before := jsonb_build_object(
    'id', v_project.public_id, 'version', v_project.version,
    'state', v_project.status, 'archivedAt', v_project.archived_at
  );
  begin
    update public.projects project set
      status = 'cancelled', archived_at = v_now, deleted_at = v_now,
      updated_by_member_id = v_actor, version = project.version + 1,
      updated_at = v_now
    where project.tenant_id = v_tenant and project.organization_id = v_org
      and project.id = v_project.id
    returning * into v_project;
  exception when others then
    v_failure := 'command_failed';
  end;
  if v_failure is not null then
    return public.complete_project_command(
      v_tenant, v_org, v_user, v_actor, 'archive_current_project', 'project.archived',
      v_project.public_id::text, request_id, idempotency_key, v_permission, btrim(p_reason),
      'failure', v_failure, v_before, null
    );
  end if;
  v_after := jsonb_build_object(
    'id', v_project.public_id, 'version', v_project.version,
    'state', v_project.status, 'archivedAt', v_project.archived_at
  );
  return public.complete_project_command(
    v_tenant, v_org, v_user, v_actor, 'archive_current_project', 'project.archived',
    v_project.public_id::text, request_id, idempotency_key, v_permission, btrim(p_reason),
    'success', null, v_before, v_after
  );
end;
$$;

-- project_members now has tenant/creator/updater ownership. Keep the existing
-- production task-create entry point compatible and tenant-exact in the same
-- migration so project hardening cannot break task assignment.
create or replace function public.create_current_project_task_v2(
  p_project_public_id uuid,
  p_title text,
  p_description text,
  p_assignee_member_id bigint,
  p_due_date date,
  p_priority text,
  p_acceptance_criteria text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id bigint := (select public.current_tenant_id());
  v_organization_id bigint;
  v_actor_member_id bigint;
  v_project_id bigint;
  v_task_public_id uuid := gen_random_uuid();
begin
  if v_tenant_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_project_public_id is null
     or nullif(btrim(p_title), '') is null
     or length(btrim(p_title)) > 240
     or length(coalesce(p_description, '')) > 4000
     or nullif(btrim(p_acceptance_criteria), '') is null
     or length(btrim(p_acceptance_criteria)) > 2000
     or p_assignee_member_id is null or p_assignee_member_id <= 0
     or p_due_date is null or p_priority is null
     or p_priority not in ('low', 'medium', 'high', 'urgent') then
    raise exception 'Task input is invalid' using errcode = '22023';
  end if;

  select member.organization_id, member.id
    into strict v_organization_id, v_actor_member_id
    from public.organization_members member
   where member.tenant_id = v_tenant_id
     and member.user_id = (select auth.uid())
     and member.status = 'active'
   limit 1;

  select project.id
    into strict v_project_id
    from public.projects project
   where project.tenant_id = v_tenant_id
     and project.organization_id = v_organization_id
     and project.public_id = p_project_public_id
     and project.deleted_at is null;

  if not (
    public.has_organization_role(v_organization_id, array['owner', 'admin'])
    or exists (
      select 1
        from public.projects project
        left join public.project_members membership
          on membership.tenant_id = project.tenant_id
         and membership.organization_id = project.organization_id
         and membership.project_id = project.id
         and membership.member_id = v_actor_member_id
         and membership.left_at is null
       where project.tenant_id = v_tenant_id
         and project.organization_id = v_organization_id
         and project.id = v_project_id
         and (project.owner_member_id = v_actor_member_id
           or membership.role in ('owner', 'manager'))
    )
  ) then
    raise exception 'Task creation is not allowed' using errcode = '42501';
  end if;

  if not exists (
    select 1
      from public.organization_members member
     where member.tenant_id = v_tenant_id
       and member.organization_id = v_organization_id
       and member.id = p_assignee_member_id
       and member.status in ('invited', 'active')
  ) then
    raise exception 'Task assignee is not an active organization member' using errcode = '23503';
  end if;

  insert into public.project_members as membership(
    tenant_id, organization_id, project_id, member_id, role, allocation_percent,
    created_by_member_id, updated_by_member_id, version
  ) values (
    v_tenant_id, v_organization_id, v_project_id, p_assignee_member_id,
    'member', 100, v_actor_member_id, v_actor_member_id, 1
  )
  on conflict (project_id, member_id) do update set
    left_at = null,
    updated_by_member_id = v_actor_member_id,
    version = membership.version + 1,
    updated_at = clock_timestamp();

  insert into public.tasks(
    public_id, organization_id, project_id, title, description,
    assignee_member_id, reporter_member_id, status, priority,
    start_date, due_date, progress, acceptance_criteria
  ) values (
    v_task_public_id, v_organization_id, v_project_id,
    btrim(p_title), btrim(coalesce(p_description, '')),
    p_assignee_member_id, v_actor_member_id, 'todo', p_priority,
    current_date, p_due_date, 0, btrim(p_acceptance_criteria)
  );

  perform public.append_audit_log(
    v_tenant_id, v_organization_id, (select auth.uid()), v_actor_member_id,
    'task.created', 'task', v_task_public_id::text, null, null,
    jsonb_build_object(
      'project', p_project_public_id,
      'priority', p_priority,
      'assignee_member_id', p_assignee_member_id
    )
  );
  return v_task_public_id;
end;
$$;

revoke all on table public.project_command_idempotency
  from public, anon, authenticated, service_role;
revoke insert, update, delete, truncate, references, trigger on table public.projects
  from public, anon, authenticated, service_role;
revoke insert, update, delete, truncate, references, trigger on table public.project_members
  from public, anon, authenticated, service_role;

revoke all on function public.current_project_command_context()
  from public, anon, authenticated, service_role;
revoke all on function public.complete_project_command(
  bigint, bigint, uuid, bigint, text, text, text, uuid, uuid, text, text, text, text, jsonb, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.audit_project_scope_conflict(
  bigint, bigint, uuid, bigint, text, uuid, uuid, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.create_current_project(
  text, text, bigint, bigint[], text, text, date, date
) from public, anon, authenticated, service_role;
revoke all on function public.create_current_project_v2(
  text, text, text, uuid, numeric, text, text, date, date, bigint, text, uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.create_current_project_v2(
  text, text, text, uuid, numeric, text, text, date, date, bigint, text, uuid, uuid
) to authenticated;
revoke all on function public.update_current_project(
  uuid, text, text, text, uuid, numeric, text, date, date, bigint, text, uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.update_current_project(
  uuid, text, text, text, uuid, numeric, text, date, date, bigint, text, uuid, uuid
) to authenticated;
revoke all on function public.archive_current_project(uuid, bigint, text, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.archive_current_project(uuid, bigint, text, uuid, uuid)
  to authenticated;
revoke all on function public.create_current_project_task_v2(uuid,text,text,bigint,date,text,text)
  from public, anon, service_role;
grant execute on function public.create_current_project_task_v2(uuid,text,text,bigint,date,text,text)
  to authenticated;
