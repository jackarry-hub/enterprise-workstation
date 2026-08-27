-- Forward-only Task 8 repair: operational direct-manager authority and a
-- distinct supervisor scope. Historical directory/session migrations remain
-- immutable so upgraded databases receive the same contract as fresh ones.

-- A user may belong to more than one organization in a tenant, but the active
-- workspace remains selected only by its exact external identity.
drop index if exists public.organization_members_tenant_user_idx;
create unique index if not exists organization_members_tenant_organization_user_idx
  on public.organization_members (tenant_id, organization_id, user_id)
  where user_id is not null;

alter table public.employee_profiles
  add column if not exists manager_version bigint not null default 1,
  add column if not exists manager_source text not null default 'unassigned';

update public.employee_profiles
set manager_source = 'unassigned'
where manager_employee_id is null
  and manager_source <> 'unassigned';

create or replace function public.classify_legacy_directory_manager_relationships()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_classified bigint;
begin
  update public.employee_profiles target
  set manager_source = 'directory',
      updated_at = clock_timestamp()
  where target.manager_employee_id is not null
    and target.manager_source in ('unassigned', 'manual')
    and target.deleted_at is null
    and target.employment_status in ('probation', 'active', 'on_leave')
    and exists (
      select 1
      from public.directory_connections connection
      join public.identity_providers provider
        on provider.tenant_id = connection.tenant_id
       and provider.id = connection.identity_provider_id
       and provider.provider_code = 'feishu'
       and provider.status = 'active'
      join public.directory_entity_links target_link
        on target_link.tenant_id = connection.tenant_id
       and target_link.organization_id = connection.organization_id
       and target_link.connection_id = connection.id
       and target_link.entity_type = 'employee'
       and target_link.employee_profile_id = target.id
      join public.employee_profiles manager_profile
        on manager_profile.tenant_id = target.tenant_id
       and manager_profile.organization_id = target.organization_id
       and manager_profile.id = target.manager_employee_id
       and manager_profile.deleted_at is null
       and manager_profile.employment_status in ('probation', 'active', 'on_leave')
      join public.organization_members manager_member
        on manager_member.tenant_id = manager_profile.tenant_id
       and manager_member.organization_id = manager_profile.organization_id
       and manager_member.id = manager_profile.organization_member_id
       and manager_member.status = 'active'
      join public.directory_entity_links manager_link
        on manager_link.tenant_id = connection.tenant_id
       and manager_link.organization_id = connection.organization_id
       and manager_link.connection_id = connection.id
       and manager_link.entity_type = 'employee'
       and manager_link.employee_profile_id = manager_profile.id
      join lateral (
        with recursive department_chain(id, parent_department_id) as (
          select department.id, department.parent_department_id
          from public.departments department
          where department.tenant_id = target.tenant_id
            and department.organization_id = target.organization_id
            and department.id = target.department_id
            and department.deleted_at is null

          union all

          select parent.id, parent.parent_department_id
          from public.departments parent
          join department_chain child on child.parent_department_id = parent.id
          where parent.tenant_id = target.tenant_id
            and parent.organization_id = target.organization_id
            and parent.deleted_at is null
        )
        select chain.id from department_chain chain
      ) authoritative_department on true
      join public.departments department
       on department.tenant_id = target.tenant_id
       and department.organization_id = target.organization_id
       and department.id = authoritative_department.id
       and manager_profile.organization_member_id = department.leader_member_id
      join public.directory_entity_links department_link
        on department_link.tenant_id = connection.tenant_id
       and department_link.organization_id = connection.organization_id
       and department_link.connection_id = connection.id
       and department_link.entity_type = 'department'
       and department_link.department_id = department.id
      where connection.tenant_id = target.tenant_id
        and connection.organization_id = target.organization_id
        and connection.provider_type = 'feishu'
        and connection.status = 'active'
    );
  get diagnostics v_classified = row_count;
  return v_classified;
end;
$$;

select public.classify_legacy_directory_manager_relationships();

update public.employee_profiles
set manager_source = 'manual'
where manager_employee_id is not null
  and manager_source <> 'directory';

create or replace function public.repair_legacy_manager_relationships()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_repaired bigint;
  v_repair record;
begin
  v_repaired := 0;
  for v_repair in
    with recursive legacy_manager_chain (
      tenant_id, organization_id, root_id, current_id,
      next_id, path, cycle
    ) as (
      select target.tenant_id,
        target.organization_id,
        target.id,
        target.id,
        target.manager_employee_id,
        array[target.id]::bigint[],
        target.manager_employee_id = target.id
      from public.employee_profiles target
      where target.manager_employee_id is not null

      union all

      select chain.tenant_id,
        chain.organization_id,
        chain.root_id,
        manager.id,
        manager.manager_employee_id,
        chain.path || manager.id,
        manager.id = any (chain.path)
      from legacy_manager_chain chain
      join public.employee_profiles manager
        on manager.tenant_id = chain.tenant_id
       and manager.organization_id = chain.organization_id
       and manager.id = chain.next_id
      where chain.next_id is not null
        and not chain.cycle
    ), cyclic_roots as (
      select distinct chain.tenant_id, chain.organization_id, chain.root_id
      from legacy_manager_chain chain
      where chain.cycle
    ), scored_roots as (
      select target.tenant_id,
        target.organization_id,
        target.id,
        target.public_id as target_public_id,
        manager.public_id as manager_public_id,
        target.manager_source as before_manager_source,
        target.manager_version as before_manager_version,
        case
          when exists (
            select 1 from cyclic_roots cyclic
            where cyclic.tenant_id = target.tenant_id
              and cyclic.organization_id = target.organization_id
              and cyclic.root_id = target.id
          ) then 'legacy_manager_cycle'
          when target.deleted_at is not null
            or target.employment_status not in ('probation', 'active', 'on_leave')
            then 'legacy_target_inactive'
          when manager.id is null
            or manager.tenant_id is distinct from target.tenant_id
            or manager.organization_id is distinct from target.organization_id
            or manager.deleted_at is not null
            or manager.employment_status not in ('probation', 'active', 'on_leave')
            or manager_member.status is distinct from 'active'
            then 'legacy_manager_inactive'
          when target.manager_source = 'manual'
            and (
              target.department_id is null
              or manager.department_id is distinct from target.department_id
            ) then 'legacy_manager_department_mismatch'
          else null
        end as repair_reason
      from public.employee_profiles target
      left join public.employee_profiles manager
        on manager.id = target.manager_employee_id
      left join public.organization_members manager_member
        on manager_member.tenant_id = manager.tenant_id
       and manager_member.organization_id = manager.organization_id
       and manager_member.id = manager.organization_member_id
       and manager_member.status = 'active'
      where target.manager_employee_id is not null
    ), repair_candidates as (
      select scored.*
      from scored_roots scored
      where scored.repair_reason is not null
    ), repaired as (
      update public.employee_profiles target
      set manager_employee_id = null,
          manager_source = 'unassigned',
          manager_version = target.manager_version + 1,
          updated_at = clock_timestamp()
      from repair_candidates invalid
      where target.tenant_id = invalid.tenant_id
        and target.organization_id = invalid.organization_id
        and target.id = invalid.id
      returning invalid.tenant_id,
        invalid.organization_id,
        invalid.id,
        invalid.target_public_id,
        invalid.manager_public_id,
        invalid.before_manager_source,
        invalid.before_manager_version,
        invalid.repair_reason
    )
    select repaired.* from repaired
    order by repaired.tenant_id, repaired.organization_id, repaired.id
  loop
    perform public.append_audit_log(
      v_repair.tenant_id,
      v_repair.organization_id,
      null,
      null,
      'profile.updated',
      'employee_manager_relationship',
      v_repair.target_public_id::text,
      null,
      null,
      jsonb_build_object(
        'repairReason', v_repair.repair_reason,
        'before', jsonb_build_object(
          'employeeRef', v_repair.target_public_id,
          'managerEmployeeRef', v_repair.manager_public_id,
          'managerSource', v_repair.before_manager_source,
          'version', v_repair.before_manager_version
        ),
        'after', jsonb_build_object(
          'employeeRef', v_repair.target_public_id,
          'managerEmployeeRef', null,
          'managerSource', 'unassigned',
          'version', v_repair.before_manager_version + 1
        )
      )
    );
    v_repaired := v_repaired + 1;
  end loop;
  return v_repaired;
end;
$$;

select public.repair_legacy_manager_relationships();

alter table public.employee_profiles
  drop constraint if exists employee_profiles_manager_source_check;
alter table public.employee_profiles
  add constraint employee_profiles_manager_source_check check (
    (manager_employee_id is null and manager_source = 'unassigned')
    or (manager_employee_id is not null and manager_source in ('manual', 'directory'))
  );

alter table public.employee_profiles
  drop constraint if exists employee_profiles_manager_version_check;
alter table public.employee_profiles
  add constraint employee_profiles_manager_version_check check (manager_version >= 1);

alter table public.employee_profiles
  drop constraint if exists employee_profiles_manager_employee_id_fkey;
alter table public.employee_profiles
  drop constraint if exists employee_profiles_tenant_manager_fkey;
alter table public.employee_profiles
  drop constraint if exists employee_profiles_exact_manager_fkey;
alter table public.employee_profiles
  add constraint employee_profiles_exact_manager_fkey
  foreign key (tenant_id, organization_id, manager_employee_id)
  references public.employee_profiles (tenant_id, organization_id, id)
  on delete no action;

alter table public.audit_logs drop constraint if exists audit_logs_action_check;
alter table public.audit_logs add constraint audit_logs_action_check check (action in (
  'identity.provisioned', 'identity.claimed', 'identity.revoked', 'member.status_changed',
  'member.role_changed', 'profile.updated', 'roster.imported', 'tenant.bootstrap_owner',
  'enterprise.initialized', 'directory.sync_started', 'directory.sync_completed',
  'directory.sync_failed', 'directory.role_mapped', 'project.created', 'task.created',
  'payroll_policy.activated', 'payroll.calculated', 'payroll.confirmed', 'ai.config.updated',
  'organization.department_created', 'organization.department_updated',
  'organization.position_upserted', 'organization.role_assigned', 'organization.command_failed',
  'organization.manager_assigned', 'directory.manager_mapped',
  'employee_skill.verified', 'employee_skill.verification_failed',
  'directory.sync_issue_resolved'
));

alter table public.organization_command_idempotency
  drop constraint if exists organization_command_idempotency_operation_check;
alter table public.organization_command_idempotency
  add constraint organization_command_idempotency_operation_check check (operation in (
    'create_current_department', 'update_current_department',
    'upsert_current_position', 'assign_current_member_role',
    'assign_current_member_manager'
  ));

insert into public.permissions (code, name, module, action)
values (
  'employee.supervisor.read', '查看主管工作范围', 'employees', 'supervisor.read'
)
on conflict (code) do update set
  name = excluded.name,
  module = excluded.module,
  action = excluded.action;

-- Keep legacy role IDs and their assignments, but quarantine every custom
-- lookalike under a collision-safe disabled code before canonical provisioning.
create or replace function public.quarantine_legacy_supervisor_roles()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role record;
  v_candidate text;
  v_suffix integer;
  v_quarantined bigint := 0;
begin
  for v_role in
    select legacy.id, legacy.tenant_id, legacy.organization_id
    from public.roles legacy
    where legacy.code = 'supervisor'
      and (not legacy.is_system or legacy.organization_id is not null)
    order by legacy.id
    for update
  loop
    v_suffix := 0;
    loop
      v_candidate := 'legacy_supervisor_' || v_role.id::text
        || case when v_suffix = 0 then '' else '_' || v_suffix::text end;
      exit when not exists (
        select 1
        from public.roles collision
        where collision.tenant_id = v_role.tenant_id
          and collision.organization_id is not distinct from v_role.organization_id
          and collision.code = v_candidate
          and collision.id <> v_role.id
      );
      v_suffix := v_suffix + 1;
    end loop;

    update public.roles legacy
    set code = v_candidate,
        is_enabled = false
    where legacy.id = v_role.id;
    v_quarantined := v_quarantined + 1;
  end loop;
  return v_quarantined;
end;
$$;

select public.quarantine_legacy_supervisor_roles();

create or replace function public.is_canonical_workspace_role_code(p_code text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_code = any (array[
    'owner', 'admin', 'department_head', 'supervisor', 'employee', 'finance', 'hr'
  ]::text[]);
$$;

create or replace function public.ensure_supervisor_role_for_tenant(p_tenant_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role_id bigint;
begin
  if p_tenant_id is null or not exists (
    select 1 from public.tenants tenant where tenant.id = p_tenant_id
  ) then
    raise exception 'Supervisor tenant is invalid' using errcode = '22023';
  end if;

  insert into public.roles (
    tenant_id, organization_id, code, name, description, is_system, is_enabled
  ) values (
    p_tenant_id, null, 'supervisor', '主管', '直属员工日常管理与受保护范围查看', true, true
  )
  on conflict (tenant_id, code) where organization_id is null
  do update set
    name = excluded.name,
    description = excluded.description,
    is_system = true,
    is_enabled = true
  returning id into v_role_id;

  delete from public.role_permissions grant_row
  using public.permissions permission
  where grant_row.tenant_id = p_tenant_id
    and grant_row.role_id = v_role_id
    and permission.id = grant_row.permission_id
    and not (permission.code = any (array[
      'task.manage', 'attendance.self', 'salary.self', 'approval.self',
      'files.manage', 'employee.supervisor.read'
    ]::text[]));

  insert into public.role_permissions (tenant_id, role_id, permission_id)
  select p_tenant_id, v_role_id, permission.id
  from public.permissions permission
  where permission.code = any (array[
    'task.manage', 'attendance.self', 'salary.self', 'approval.self',
    'files.manage', 'employee.supervisor.read'
  ]::text[])
  on conflict do nothing;
end;
$$;

create or replace function public.provision_supervisor_role_for_new_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.ensure_supervisor_role_for_tenant(new.id);
  return new;
end;
$$;

drop trigger if exists tenants_supervisor_role_provision on public.tenants;
create trigger tenants_supervisor_role_provision
after insert on public.tenants
for each row execute function public.provision_supervisor_role_for_new_tenant();

select public.ensure_supervisor_role_for_tenant(tenant.id)
from public.tenants tenant;

create or replace function public.guard_employee_profile_relations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_manager_department_id bigint;
begin
  if new.organization_member_id is not null and not exists (
    select 1
    from public.organization_members member
    where member.tenant_id = new.tenant_id
      and member.id = new.organization_member_id
      and member.organization_id = new.organization_id
  ) then
    raise exception 'Organization member must belong to the same tenant and organization'
      using errcode = '23514';
  end if;

  if new.department_id is not null and not exists (
    select 1
    from public.departments department
    where department.tenant_id = new.tenant_id
      and department.id = new.department_id
      and department.organization_id = new.organization_id
      and department.deleted_at is null
  ) then
    raise exception 'Department must belong to the same tenant and organization'
      using errcode = '23514';
  end if;

  if new.manager_employee_id is null then
    if new.manager_source <> 'unassigned' then
      raise exception 'manager_source_invalid' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.manager_employee_id = new.id then
    raise exception 'manager_cycle' using errcode = '23514';
  end if;

  select manager.department_id
  into v_manager_department_id
  from public.employee_profiles manager
  join public.organization_members manager_member
    on manager_member.tenant_id = manager.tenant_id
   and manager_member.organization_id = manager.organization_id
   and manager_member.id = manager.organization_member_id
   and manager_member.status = 'active'
  where manager.tenant_id = new.tenant_id
    and manager.organization_id = new.organization_id
    and manager.id = new.manager_employee_id
    and manager.deleted_at is null
    and manager.employment_status in ('probation', 'active', 'on_leave');
  if not found then
    raise exception 'Manager must be an active employee in the same tenant and organization'
      using errcode = '23514';
  end if;

  if new.manager_source = 'manual'
     and (tg_op = 'INSERT'
       or new.manager_employee_id is distinct from old.manager_employee_id
       or new.manager_source is distinct from old.manager_source)
     and (new.department_id is null
       or v_manager_department_id is distinct from new.department_id) then
    raise exception 'manager_department_forbidden' using errcode = '23514';
  end if;

  if new.manager_source = 'directory'
     and (tg_op = 'INSERT'
       or new.manager_employee_id is distinct from old.manager_employee_id
       or new.manager_source is distinct from old.manager_source)
     and not exists (
    with recursive department_chain as (
      select department.id, department.parent_department_id
      from public.departments department
      where department.tenant_id = new.tenant_id
        and department.organization_id = new.organization_id
        and department.id = new.department_id
        and department.deleted_at is null

      union all

      select parent.id, parent.parent_department_id
      from public.departments parent
      join department_chain child on child.parent_department_id = parent.id
      where parent.tenant_id = new.tenant_id
        and parent.organization_id = new.organization_id
        and parent.deleted_at is null
    )
    select 1
    from department_chain chain
    join public.departments department
      on department.tenant_id = new.tenant_id
     and department.organization_id = new.organization_id
     and department.id = chain.id
    join public.employee_profiles manager
      on manager.tenant_id = new.tenant_id
     and manager.organization_id = new.organization_id
     and manager.organization_member_id = department.leader_member_id
     and manager.id = new.manager_employee_id
     and manager.deleted_at is null
     and manager.employment_status in ('probation', 'active', 'on_leave')
  ) then
    raise exception 'directory_manager_invalid' using errcode = '23514';
  end if;

  if exists (
    with recursive reporting_chain(id, manager_employee_id, path) as (
      select manager.id, manager.manager_employee_id, array[manager.id]::bigint[]
      from public.employee_profiles manager
      where manager.tenant_id = new.tenant_id
        and manager.organization_id = new.organization_id
        and manager.id = new.manager_employee_id

      union all

      select next_manager.id, next_manager.manager_employee_id,
        chain.path || next_manager.id
      from reporting_chain chain
      join public.employee_profiles next_manager
        on next_manager.tenant_id = new.tenant_id
       and next_manager.organization_id = new.organization_id
       and next_manager.id = chain.manager_employee_id
      where not next_manager.id = any (chain.path)
    )
    select 1 from reporting_chain where id = new.id
  ) then
    raise exception 'manager_cycle' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists employee_profiles_guard_relations
  on public.employee_profiles;
create trigger employee_profiles_guard_relations
before insert or update of
  tenant_id,
  organization_id,
  organization_member_id,
  department_id,
  manager_employee_id,
  manager_source
on public.employee_profiles
for each row execute function public.guard_employee_profile_relations();

drop trigger if exists employee_profiles_00_manager_lifecycle_cleanup
  on public.employee_profiles;
drop function if exists public.cleanup_employee_manager_relationships();

-- Task 7 lifecycle implementations lock profile/member rows before updating
-- them. Keep their installed bodies intact, but put an exact-organization tree
-- lock in front of every active entry point before those legacy row locks.
do $manager_entrypoint_rename$
begin
  if to_regprocedure('public.task8_legacy_revoke_departed_member_access(uuid,text)') is null then
    alter function public.revoke_departed_member_access(uuid, text)
      rename to task8_legacy_revoke_departed_member_access;
  end if;
  if to_regprocedure('public.task8_legacy_apply_feishu_directory_sync(uuid,uuid,jsonb)') is null then
    alter function public.apply_feishu_directory_sync(uuid, uuid, jsonb)
      rename to task8_legacy_apply_feishu_directory_sync;
  end if;
  if to_regprocedure('public.task8_legacy_apply_feishu_directory_sync_observed(uuid,uuid,jsonb,uuid)') is null then
    alter function public.apply_feishu_directory_sync_observed(uuid, uuid, jsonb, uuid)
      rename to task8_legacy_apply_feishu_directory_sync_observed;
  end if;
  if to_regprocedure('public.task8_legacy_apply_feishu_directory_sync_exact(uuid,uuid,uuid,uuid,jsonb)') is null then
    alter function public.apply_feishu_directory_sync_exact(uuid, uuid, uuid, uuid, jsonb)
      rename to task8_legacy_apply_feishu_directory_sync_exact;
  end if;
  if to_regprocedure('public.task8_legacy_apply_feishu_directory_sync_fenced(uuid,uuid,uuid,jsonb)') is null then
    alter function public.apply_feishu_directory_sync_fenced(uuid, uuid, uuid, jsonb)
      rename to task8_legacy_apply_feishu_directory_sync_fenced;
  end if;
end;
$manager_entrypoint_rename$;

create or replace function public.revoke_departed_member_access(
  p_member_public_id uuid,
  p_event_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id bigint;
  v_organization_id bigint;
begin
  select profile.tenant_id, profile.organization_id
    into v_tenant_id, v_organization_id
    from public.employee_profiles profile
   where profile.public_id = p_member_public_id
     and profile.deleted_at is null
   limit 1;
  if found then
    perform pg_advisory_xact_lock(hashtextextended(
      'manager-tree:' || v_tenant_id::text || ':' || v_organization_id::text, 0
    ));
  end if;
  return public.task8_legacy_revoke_departed_member_access(
    p_member_public_id, p_event_id
  );
end;
$$;

create or replace function public.apply_feishu_directory_sync(
  p_tenant_public_id uuid,
  p_actor_auth_user_id uuid,
  p_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id bigint;
  v_organization_id bigint;
begin
  select tenant.id, organization.id
    into v_tenant_id, v_organization_id
    from public.tenants tenant
    join public.organizations organization
      on organization.tenant_id = tenant.id
    join public.organization_members member
      on member.tenant_id = tenant.id
     and member.organization_id = organization.id
     and member.user_id = p_actor_auth_user_id
     and member.status = 'active'
    join public.identity_providers provider
      on provider.tenant_id = tenant.id
     and provider.provider_code = 'feishu'
     and provider.status = 'active'
   where tenant.public_id = p_tenant_public_id
     and tenant.status = 'active'
   order by organization.id
   limit 1;
  if found then
    perform pg_advisory_xact_lock(hashtextextended(
      'manager-tree:' || v_tenant_id::text || ':' || v_organization_id::text, 0
    ));
  end if;
  return public.task8_legacy_apply_feishu_directory_sync(
    p_tenant_public_id, p_actor_auth_user_id, p_snapshot
  );
end;
$$;

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
begin
  select tenant.id, organization.id
    into v_tenant_id, v_organization_id
    from public.tenants tenant
    join public.organizations organization
      on organization.tenant_id = tenant.id
    join public.organization_members member
      on member.tenant_id = tenant.id
     and member.organization_id = organization.id
     and member.user_id = p_actor_auth_user_id
     and member.status = 'active'
    join public.identity_providers provider
      on provider.tenant_id = tenant.id
     and provider.provider_code = 'feishu'
     and provider.status = 'active'
   where tenant.public_id = p_tenant_public_id
     and tenant.status = 'active'
   order by organization.id
   limit 1;
  if found then
    perform pg_advisory_xact_lock(hashtextextended(
      'manager-tree:' || v_tenant_id::text || ':' || v_organization_id::text, 0
    ));
  end if;
  return public.task8_legacy_apply_feishu_directory_sync_observed(
    p_tenant_public_id, p_actor_auth_user_id, p_snapshot, p_request_id
  );
end;
$$;

create or replace function public.apply_feishu_directory_sync_exact(
  p_run_id uuid,
  p_tenant_public_id uuid,
  p_organization_public_id uuid,
  p_actor_auth_user_id uuid,
  p_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id bigint;
  v_organization_id bigint;
begin
  select run.tenant_id, run.organization_id
    into v_tenant_id, v_organization_id
    from public.directory_sync_runs run
    join public.tenants tenant
      on tenant.id = run.tenant_id
     and tenant.public_id = p_tenant_public_id
     and tenant.status = 'active'
    join public.organizations organization
      on organization.tenant_id = run.tenant_id
     and organization.id = run.organization_id
     and organization.public_id = p_organization_public_id
    join public.organization_members actor
      on actor.tenant_id = run.tenant_id
     and actor.organization_id = run.organization_id
     and actor.id = run.actor_member_id
     and actor.user_id = p_actor_auth_user_id
     and actor.status = 'active'
    join public.directory_connections connection
      on connection.tenant_id = run.tenant_id
     and connection.organization_id = run.organization_id
     and connection.id = run.connection_id
     and connection.provider_type = 'feishu'
     and connection.status = 'active'
    join public.identity_providers provider
      on provider.tenant_id = connection.tenant_id
     and provider.id = connection.identity_provider_id
     and provider.provider_code = 'feishu'
     and provider.status = 'active'
   where run.public_id = p_run_id
     and run.request_id = p_run_id
   limit 1;
  if found then
    perform pg_advisory_xact_lock(hashtextextended(
      'manager-tree:' || v_tenant_id::text || ':' || v_organization_id::text, 0
    ));
  end if;
  return public.task8_legacy_apply_feishu_directory_sync_exact(
    p_run_id, p_tenant_public_id, p_organization_public_id,
    p_actor_auth_user_id, p_snapshot
  );
end;
$$;

create or replace function public.apply_feishu_directory_sync_fenced(
  p_run_id uuid,
  p_organization_public_id uuid,
  p_actor_auth_user_id uuid,
  p_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id bigint;
  v_organization_id bigint;
begin
  select run.tenant_id, run.organization_id
    into v_tenant_id, v_organization_id
    from public.directory_sync_runs run
    join public.tenants tenant
      on tenant.id = run.tenant_id
     and tenant.status = 'active'
    join public.organizations organization
      on organization.tenant_id = run.tenant_id
     and organization.id = run.organization_id
     and organization.public_id = p_organization_public_id
    join public.organization_members actor
      on actor.tenant_id = run.tenant_id
     and actor.organization_id = run.organization_id
     and actor.id = run.actor_member_id
     and actor.user_id = p_actor_auth_user_id
     and actor.status = 'active'
    join public.directory_connections connection
      on connection.tenant_id = run.tenant_id
     and connection.organization_id = run.organization_id
     and connection.id = run.connection_id
     and connection.provider_type = 'feishu'
     and connection.status = 'active'
    join public.identity_providers provider
      on provider.tenant_id = connection.tenant_id
     and provider.id = connection.identity_provider_id
     and provider.provider_code = 'feishu'
     and provider.status = 'active'
   where run.public_id = p_run_id
     and run.request_id = p_run_id
   limit 1;
  if found then
    perform pg_advisory_xact_lock(hashtextextended(
      'manager-tree:' || v_tenant_id::text || ':' || v_organization_id::text, 0
    ));
  end if;
  return public.task8_legacy_apply_feishu_directory_sync_fenced(
    p_run_id, p_organization_public_id, p_actor_auth_user_id, p_snapshot
  );
end;
$$;

-- Unknown internal writers must never request the advisory lock after their
-- row lock has already been taken. They may mutate a profile in a manager tree
-- only when an authorized entry point already owns the exact transaction lock.
create or replace function public.require_employee_manager_tree_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lock_key bigint;
  v_lock_held boolean;
  v_participates boolean;
begin
  if row(new.tenant_id, new.organization_id, new.department_id,
         new.employment_status, new.deleted_at, new.manager_employee_id,
         new.manager_source)
     is not distinct from
     row(old.tenant_id, old.organization_id, old.department_id,
         old.employment_status, old.deleted_at, old.manager_employee_id,
         old.manager_source) then
    return new;
  end if;

  select old.manager_employee_id is not null
      or new.manager_employee_id is not null
      or exists (
        select 1
          from public.employee_profiles candidate
         where candidate.tenant_id = old.tenant_id
           and candidate.organization_id = old.organization_id
           and candidate.manager_employee_id = old.id
      )
    into v_participates;
  if not v_participates then return new; end if;

  v_lock_key := hashtextextended(
    'manager-tree:' || old.tenant_id::text || ':' || old.organization_id::text, 0
  );
  select exists (
    select 1
      from pg_catalog.pg_locks held_lock
     where held_lock.pid = pg_backend_pid()
       and held_lock.locktype = 'advisory'
       and held_lock.mode = 'ExclusiveLock'
       and held_lock.granted
       and held_lock.classid = ((v_lock_key >> 32) & 4294967295)::oid
       and held_lock.objid = (v_lock_key & 4294967295)::oid
       and held_lock.objsubid = 1
  ) into v_lock_held;
  if not v_lock_held then
    raise exception 'manager_tree_lock_required' using errcode = '55000';
  end if;

  if new.tenant_id is distinct from old.tenant_id
     or new.organization_id is distinct from old.organization_id then
    v_lock_key := hashtextextended(
      'manager-tree:' || new.tenant_id::text || ':' || new.organization_id::text, 0
    );
    select exists (
      select 1
        from pg_catalog.pg_locks held_lock
       where held_lock.pid = pg_backend_pid()
         and held_lock.locktype = 'advisory'
         and held_lock.mode = 'ExclusiveLock'
         and held_lock.granted
         and held_lock.classid = ((v_lock_key >> 32) & 4294967295)::oid
         and held_lock.objid = (v_lock_key & 4294967295)::oid
         and held_lock.objsubid = 1
    ) into v_lock_held;
    if not v_lock_held then
      raise exception 'manager_tree_lock_required' using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists employee_profiles_00_manager_tree_lock
  on public.employee_profiles;
drop trigger if exists employee_profiles_require_manager_tree_lock
  on public.employee_profiles;
create trigger employee_profiles_require_manager_tree_lock
before update of tenant_id, organization_id, department_id, employment_status,
  deleted_at, manager_employee_id, manager_source
on public.employee_profiles
for each row execute function public.require_employee_manager_tree_lock();

-- Reconcile only after the complete UPDATE statement is visible. Transition
-- tables make manager/report bulk departures safe; the nested cleanup UPDATE
-- is ignored by the depth guard and rows are always locked in stable order.
create or replace function public.reconcile_employee_manager_lifecycle_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 or not exists (
    select 1
    from new_profiles changed
    join old_profiles previous
      on previous.tenant_id = changed.tenant_id
     and previous.organization_id = changed.organization_id
     and previous.id = changed.id
    where changed.employment_status is distinct from previous.employment_status
       or changed.deleted_at is distinct from previous.deleted_at
  ) then
    return null;
  end if;

  perform target.id
  from public.employee_profiles target
  where target.manager_employee_id is not null
    and exists (
      select 1
      from new_profiles changed
      join old_profiles previous
        on previous.tenant_id = changed.tenant_id
       and previous.organization_id = changed.organization_id
       and previous.id = changed.id
      where changed.tenant_id = target.tenant_id
        and changed.organization_id = target.organization_id
        and (
          changed.employment_status is distinct from previous.employment_status
          or changed.deleted_at is distinct from previous.deleted_at
        )
        and (
          target.id = changed.id
          or target.manager_employee_id = changed.id
        )
        and (
          changed.deleted_at is not null
          or changed.employment_status not in ('probation', 'active', 'on_leave')
        )
    )
  order by target.tenant_id, target.organization_id, target.id
  for update of target;

  update public.employee_profiles target
  set manager_employee_id = null,
      manager_source = 'unassigned',
      manager_version = target.manager_version + 1,
      updated_at = clock_timestamp()
  where target.manager_employee_id is not null
    and exists (
      select 1
      from new_profiles changed
      join old_profiles previous
        on previous.tenant_id = changed.tenant_id
       and previous.organization_id = changed.organization_id
       and previous.id = changed.id
      where changed.tenant_id = target.tenant_id
        and changed.organization_id = target.organization_id
        and (
          changed.employment_status is distinct from previous.employment_status
          or changed.deleted_at is distinct from previous.deleted_at
        )
        and (
          target.id = changed.id
          or target.manager_employee_id = changed.id
        )
        and (
          changed.deleted_at is not null
          or changed.employment_status not in ('probation', 'active', 'on_leave')
        )
    );
  return null;
end;
$$;

drop trigger if exists employee_profiles_manager_lifecycle_reconcile
  on public.employee_profiles;
create trigger employee_profiles_manager_lifecycle_reconcile
after update on public.employee_profiles
referencing old table as old_profiles new table as new_profiles
for each statement execute function public.reconcile_employee_manager_lifecycle_changes();

create or replace function public.cleanup_employee_managers_for_member_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.organization_members%rowtype;
  v_lock_key bigint;
  v_lock_held boolean;
  v_participates boolean;
begin
  if tg_op = 'DELETE' then
    v_member := old;
  else
    v_member := new;
  end if;
  if tg_op = 'DELETE' or v_member.status <> 'active' then
    select exists (
      select 1
        from public.employee_profiles profile
       where profile.tenant_id = v_member.tenant_id
         and profile.organization_id = v_member.organization_id
         and (
           (profile.organization_member_id = v_member.id
             and profile.manager_employee_id is not null)
           or profile.manager_employee_id in (
             select manager.id
               from public.employee_profiles manager
              where manager.tenant_id = v_member.tenant_id
                and manager.organization_id = v_member.organization_id
                and manager.organization_member_id = v_member.id
           )
         )
    ) into v_participates;
    if v_participates then
      v_lock_key := hashtextextended(
        'manager-tree:' || v_member.tenant_id::text || ':' || v_member.organization_id::text,
        0
      );
      select exists (
        select 1
          from pg_catalog.pg_locks held_lock
         where held_lock.pid = pg_backend_pid()
           and held_lock.locktype = 'advisory'
           and held_lock.mode = 'ExclusiveLock'
           and held_lock.granted
           and held_lock.classid = ((v_lock_key >> 32) & 4294967295)::oid
           and held_lock.objid = (v_lock_key & 4294967295)::oid
           and held_lock.objsubid = 1
      ) into v_lock_held;
      if not v_lock_held then
        raise exception 'manager_tree_lock_required' using errcode = '55000';
      end if;
    end if;
    perform target.id
    from public.employee_profiles target
    where target.tenant_id = v_member.tenant_id
      and target.organization_id = v_member.organization_id
      and target.manager_employee_id is not null
      and (
        target.organization_member_id = v_member.id
        or target.manager_employee_id in (
          select manager.id
          from public.employee_profiles manager
          where manager.tenant_id = v_member.tenant_id
            and manager.organization_id = v_member.organization_id
            and manager.organization_member_id = v_member.id
        )
      )
    order by target.id
    for update of target;
    update public.employee_profiles target
    set manager_employee_id = null,
        manager_source = 'unassigned',
        manager_version = target.manager_version + 1,
        updated_at = clock_timestamp()
    where target.tenant_id = v_member.tenant_id
      and target.organization_id = v_member.organization_id
      and target.manager_employee_id is not null
      and (
        target.organization_member_id = v_member.id
        or target.manager_employee_id in (
          select manager.id
          from public.employee_profiles manager
          where manager.tenant_id = v_member.tenant_id
            and manager.organization_id = v_member.organization_id
            and manager.organization_member_id = v_member.id
        )
      );
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists organization_members_manager_status_cleanup
  on public.organization_members;
create trigger organization_members_manager_status_cleanup
before update of status on public.organization_members
for each row execute function public.cleanup_employee_managers_for_member_status();
drop trigger if exists organization_members_manager_delete_cleanup
  on public.organization_members;
create trigger organization_members_manager_delete_cleanup
before delete on public.organization_members
for each row execute function public.cleanup_employee_managers_for_member_status();

create or replace function public.enforce_employee_manager_invariants()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.employee_profiles%rowtype;
  v_manager public.employee_profiles%rowtype;
begin
  for target in
    select candidate.*
    from public.employee_profiles candidate
    where candidate.tenant_id = new.tenant_id
      and candidate.organization_id = new.organization_id
      and candidate.manager_employee_id is not null
      and (candidate.id = new.id or candidate.manager_employee_id = new.id)
    order by candidate.id
  loop
    if target.deleted_at is not null
       or target.employment_status not in ('probation', 'active', 'on_leave') then
      raise exception 'target_manager_inactive' using errcode = '23514';
    end if;

    select manager.* into v_manager
    from public.employee_profiles manager
    join public.organization_members manager_member
      on manager_member.tenant_id = manager.tenant_id
     and manager_member.organization_id = manager.organization_id
     and manager_member.id = manager.organization_member_id
     and manager_member.status = 'active'
    where manager.tenant_id = target.tenant_id
      and manager.organization_id = target.organization_id
      and manager.id = target.manager_employee_id
      and manager.deleted_at is null
      and manager.employment_status in ('probation', 'active', 'on_leave');
    if not found then
      raise exception 'Manager must be an active employee in the same tenant and organization'
        using errcode = '23514';
    end if;

    if target.manager_source = 'manual'
       and (target.department_id is null
         or v_manager.department_id is distinct from target.department_id) then
      raise exception 'manager_department_forbidden' using errcode = '23514';
    end if;

    if target.manager_source = 'directory' and not exists (
      with recursive department_chain as (
        select department.id, department.parent_department_id
        from public.departments department
        where department.tenant_id = target.tenant_id
          and department.organization_id = target.organization_id
          and department.id = target.department_id
          and department.deleted_at is null

        union all

        select parent.id, parent.parent_department_id
        from public.departments parent
        join department_chain child on child.parent_department_id = parent.id
        where parent.tenant_id = target.tenant_id
          and parent.organization_id = target.organization_id
          and parent.deleted_at is null
      )
      select 1
      from department_chain chain
      join public.departments department
        on department.tenant_id = target.tenant_id
       and department.organization_id = target.organization_id
       and department.id = chain.id
      where department.leader_member_id = v_manager.organization_member_id
    ) then
      raise exception 'directory_manager_invalid' using errcode = '23514';
    end if;

    if exists (
      with recursive reporting_chain(id, manager_employee_id, path) as (
        select manager.id, manager.manager_employee_id, array[manager.id]::bigint[]
        from public.employee_profiles manager
        where manager.tenant_id = target.tenant_id
          and manager.organization_id = target.organization_id
          and manager.id = target.manager_employee_id

        union all

        select next_manager.id,
          next_manager.manager_employee_id,
          chain.path || next_manager.id
        from reporting_chain chain
        join public.employee_profiles next_manager
          on next_manager.tenant_id = target.tenant_id
         and next_manager.organization_id = target.organization_id
         and next_manager.id = chain.manager_employee_id
        where not next_manager.id = any (chain.path)
      )
      select 1 from reporting_chain where id = target.id
    ) then
      raise exception 'manager_cycle' using errcode = '23514';
    end if;
  end loop;
  return null;
end;
$$;

drop trigger if exists employee_profiles_manager_invariants
  on public.employee_profiles;
create constraint trigger employee_profiles_manager_invariants
after insert or update on public.employee_profiles
deferrable initially deferred
for each row execute function public.enforce_employee_manager_invariants();

create or replace function public.current_workspace_access()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'tenantId', tenant.public_id,
    'authUserId', member.user_id,
    'organizationId', organization.public_id,
    'organizationName', organization.name,
    'memberId', member.id,
    'employeeProfileId', profile.public_id,
    'memberStatus', member.status,
    'displayName', profile.display_name,
    'avatarUrl', profile.avatar_url,
    'departmentName', coalesce(department.name, '未分配部门'),
    'jobTitle', profile.job_title,
    'salaryGradeCode', profile.salary_grade_code,
    'jobLevel', profile.job_level,
    'employmentStatus', profile.employment_status,
    'skills', profile.skills,
    'providerCode', provider.provider_code,
    'authProvider', provider.auth_provider,
    'providerSubject', external.provider_subject,
    'roleCodes', coalesce((
      select array_agg(distinct role.code)
      from public.member_roles assignment
      join public.roles role
        on role.tenant_id = assignment.tenant_id and role.id = assignment.role_id
      where assignment.tenant_id = member.tenant_id
        and assignment.member_id = member.id
        and role.is_enabled
        and role.is_system
        and role.organization_id is null
        and public.is_canonical_workspace_role_code(role.code)
    ), '{}'::text[]),
    'customRoleCodes', coalesce((
      select array_agg(distinct role.code)
      from public.member_roles assignment
      join public.roles role
        on role.tenant_id = assignment.tenant_id and role.id = assignment.role_id
      where assignment.tenant_id = member.tenant_id
        and assignment.member_id = member.id
        and role.is_enabled
        and (role.organization_id is null or role.organization_id = member.organization_id)
        and not public.is_canonical_workspace_role_code(role.code)
    ), '{}'::text[]),
    'permissionCodes', coalesce((
      select array_agg(distinct permission.code)
      from public.member_roles assignment
      join public.roles role
        on role.tenant_id = assignment.tenant_id and role.id = assignment.role_id
      join public.role_permissions role_permission
        on role_permission.tenant_id = assignment.tenant_id
       and role_permission.role_id = assignment.role_id
      join public.permissions permission on permission.id = role_permission.permission_id
      where assignment.tenant_id = member.tenant_id
        and assignment.member_id = member.id
        and role.is_enabled
        and (role.organization_id is null or role.organization_id = member.organization_id)
        and (
          not public.is_canonical_workspace_role_code(role.code)
          or (role.is_system and role.organization_id is null)
        )
    ), '{}'::text[]),
    'supervisorScopeEmployeeIds', coalesce((
      select array_agg(distinct scope_target.public_id order by scope_target.public_id)
      from public.employee_profiles scope_target
      join public.organization_members scope_target_member
        on scope_target_member.tenant_id = scope_target.tenant_id
       and scope_target_member.organization_id = scope_target.organization_id
       and scope_target_member.id = scope_target.organization_member_id
       and scope_target_member.status = 'active'
      where scope_target.tenant_id = member.tenant_id
        and scope_target.organization_id = member.organization_id
        and scope_target.deleted_at is null
        and scope_target.employment_status in ('probation', 'active', 'on_leave')
        and (
          (
            scope_target.manager_employee_id = profile.id
            and exists (
              select 1
              from public.member_roles scope_assignment
              join public.roles scope_role
                on scope_role.tenant_id = scope_assignment.tenant_id
               and scope_role.id = scope_assignment.role_id
              where scope_assignment.tenant_id = member.tenant_id
                and scope_assignment.member_id = member.id
                and scope_role.code = 'supervisor'
                and scope_role.is_enabled
                and scope_role.is_system
                and scope_role.organization_id is null
            )
          )
          or (
            scope_target.department_id = profile.department_id
            and profile.department_id is not null
            and exists (
              select 1
              from public.member_roles scope_assignment
              join public.roles scope_role
                on scope_role.tenant_id = scope_assignment.tenant_id
               and scope_role.id = scope_assignment.role_id
              where scope_assignment.tenant_id = member.tenant_id
                and scope_assignment.member_id = member.id
                and scope_role.code = 'department_head'
                and scope_role.is_enabled
                and scope_role.is_system
                and scope_role.organization_id is null
            )
          )
        )
    ), '{}'::uuid[])
  )
  from public.external_identities external
  join public.identity_providers provider
    on provider.tenant_id = external.tenant_id
   and provider.id = external.identity_provider_id
   and provider.status = 'active'
  join public.tenants tenant
    on tenant.id = external.tenant_id and tenant.status = 'active'
  join public.organizations organization
    on organization.tenant_id = external.tenant_id
   and organization.id = external.organization_id
  join public.organization_members member
    on member.tenant_id = external.tenant_id
   and member.id = external.organization_member_id
   and member.organization_id = external.organization_id
  join public.employee_profiles profile
    on profile.tenant_id = external.tenant_id
   and profile.organization_id = external.organization_id
   and profile.organization_member_id = member.id
   and profile.deleted_at is null
  left join public.departments department
    on department.tenant_id = profile.tenant_id
   and department.organization_id = profile.organization_id
   and department.id = profile.department_id
   and department.deleted_at is null
  where external.auth_user_id = (select auth.uid())
    and external.status = 'active'
    and member.status = 'active'
    and profile.employment_status in ('probation', 'active', 'on_leave')
  limit 1;
$$;

create or replace function public.current_supervisor_employee_projection(
  p_employee_public_id uuid
)
returns table (
  employee_public_id uuid,
  display_name text,
  department_name text,
  job_title text,
  manager_employee_public_id uuid,
  manager_version bigint,
  manager_source text
)
language sql
stable
security definer
set search_path = ''
as $$
  select target.public_id,
    target.display_name,
    coalesce(target_department.name, '未分配部门'),
    target.job_title,
    manager.public_id,
    target.manager_version,
    target.manager_source
  from public.external_identities external
  join public.tenants active_tenant
    on active_tenant.id = external.tenant_id
   and active_tenant.status = 'active'
  join public.identity_providers provider
    on provider.tenant_id = external.tenant_id
   and provider.id = external.identity_provider_id
   and provider.status = 'active'
  join public.organization_members actor
    on actor.tenant_id = external.tenant_id
   and actor.organization_id = external.organization_id
   and actor.id = external.organization_member_id
   and actor.status = 'active'
  join public.employee_profiles actor_profile
    on actor_profile.tenant_id = actor.tenant_id
   and actor_profile.organization_id = actor.organization_id
   and actor_profile.organization_member_id = actor.id
   and actor_profile.deleted_at is null
   and actor_profile.employment_status in ('probation', 'active', 'on_leave')
  join public.employee_profiles target
    on target.tenant_id = actor.tenant_id
   and target.organization_id = actor.organization_id
   and target.public_id = p_employee_public_id
   and target.deleted_at is null
   and target.employment_status in ('probation', 'active', 'on_leave')
  join public.organization_members target_member
    on target_member.tenant_id = target.tenant_id
   and target_member.organization_id = target.organization_id
   and target_member.id = target.organization_member_id
   and target_member.status = 'active'
  left join public.departments target_department
    on target_department.tenant_id = target.tenant_id
   and target_department.organization_id = target.organization_id
   and target_department.id = target.department_id
   and target_department.deleted_at is null
  left join public.employee_profiles manager
    on manager.tenant_id = target.tenant_id
   and manager.organization_id = target.organization_id
   and manager.id = target.manager_employee_id
   and manager.deleted_at is null
  where external.auth_user_id = (select auth.uid())
    and external.status = 'active'
    and (
      (
        target.manager_employee_id = actor_profile.id
        and exists (
          select 1
          from public.member_roles scope_assignment
          join public.roles scope_role
            on scope_role.tenant_id = scope_assignment.tenant_id
           and scope_role.id = scope_assignment.role_id
          where scope_assignment.tenant_id = actor.tenant_id
            and scope_assignment.member_id = actor.id
            and scope_role.code = 'supervisor'
            and scope_role.is_enabled
            and scope_role.is_system
            and scope_role.organization_id is null
        )
      )
      or (
        target.department_id = actor_profile.department_id
        and actor_profile.department_id is not null
        and exists (
          select 1
          from public.member_roles scope_assignment
          join public.roles scope_role
            on scope_role.tenant_id = scope_assignment.tenant_id
           and scope_role.id = scope_assignment.role_id
          where scope_assignment.tenant_id = actor.tenant_id
            and scope_assignment.member_id = actor.id
            and scope_role.code = 'department_head'
            and scope_role.is_enabled
            and scope_role.is_system
            and scope_role.organization_id is null
        )
      )
    )
  limit 1;
$$;

create or replace function public.assign_current_member_manager(
  p_target_employee_public_id uuid,
  p_manager_employee_public_id uuid,
  p_expected_manager_version bigint,
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
  v_claimed boolean;
  v_existing_org bigint;
  v_existing jsonb;
  v_key uuid := idempotency_key;
  v_target public.employee_profiles%rowtype;
  v_manager public.employee_profiles%rowtype;
  v_before jsonb;
  v_after jsonb;
begin
  select * into v_tenant, v_org, v_actor, v_user
  from public.current_organization_command_context('organization.manage');

  if p_target_employee_public_id is null
     or p_manager_employee_public_id is null
     or p_expected_manager_version is null
     or p_expected_manager_version < 1
     or p_reason is null
     or length(btrim(p_reason)) not between 1 and 500
     or request_id is null
     or idempotency_key is null
     or request_id = idempotency_key then
    raise exception 'Manager command is invalid' using errcode = '22023';
  end if;

  insert into public.organization_command_idempotency (
    tenant_id, organization_id, operation, idempotency_key, request_id
  ) values (
    v_tenant, v_org, 'assign_current_member_manager', idempotency_key, request_id
  )
  on conflict do nothing
  returning true into v_claimed;

  if not coalesce(v_claimed, false) then
    select organization_id, result
    into v_existing_org, v_existing
    from public.organization_command_idempotency ledger
    where ledger.tenant_id = v_tenant
      and ledger.operation = 'assign_current_member_manager'
      and ledger.idempotency_key = v_key;
    if v_existing_org is distinct from v_org then
      return public.audit_organization_command_scope_conflict(
        v_tenant, v_org, v_user, v_actor,
        'assign_current_member_manager', 'employee_profile',
        request_id, idempotency_key, 'organization.manage', btrim(p_reason)
      );
    end if;
    return v_existing;
  end if;

  -- One organization-scoped tree lock serializes manual commands with
  -- directory completion. Profile rows are then locked in ascending ID order.
  perform pg_advisory_xact_lock(
    hashtextextended('manager-tree:' || v_tenant::text || ':' || v_org::text, 0)
  );
  perform profile.id
  from public.employee_profiles profile
  where profile.tenant_id = v_tenant
    and profile.organization_id = v_org
    and profile.public_id in (p_target_employee_public_id, p_manager_employee_public_id)
  order by profile.id for update;

  select target.* into v_target
  from public.employee_profiles target
  join public.organization_members target_member
    on target_member.tenant_id = target.tenant_id
   and target_member.organization_id = target.organization_id
   and target_member.id = target.organization_member_id
   and target_member.status = 'active'
  where target.tenant_id = v_tenant
    and target.organization_id = v_org
    and target.public_id = p_target_employee_public_id
    and target.deleted_at is null
    and target.employment_status in ('probation', 'active', 'on_leave');

  select manager.* into v_manager
  from public.employee_profiles manager
  join public.organization_members manager_member
    on manager_member.tenant_id = manager.tenant_id
   and manager_member.organization_id = manager.organization_id
   and manager_member.id = manager.organization_member_id
   and manager_member.status = 'active'
  where manager.tenant_id = v_tenant
    and manager.organization_id = v_org
    and manager.public_id = p_manager_employee_public_id
    and manager.deleted_at is null
    and manager.employment_status in ('probation', 'active', 'on_leave');

  if v_target.id is null or v_manager.id is null then
    return public.complete_organization_command(
      v_tenant, v_org, v_user, v_actor,
      'assign_current_member_manager', 'organization.manager_assigned',
      'employee_profile', p_target_employee_public_id::text,
      request_id, idempotency_key, 'organization.manage', btrim(p_reason),
      'failure', 'not_found', null, null
    );
  end if;
  if v_target.id = v_manager.id then
    return public.complete_organization_command(
      v_tenant, v_org, v_user, v_actor,
      'assign_current_member_manager', 'organization.manager_assigned',
      'employee_profile', v_target.public_id::text,
      request_id, idempotency_key, 'organization.manage', btrim(p_reason),
      'failure', 'manager_cycle', null, null
    );
  end if;
  if v_target.manager_source = 'directory' then
    return public.complete_organization_command(
      v_tenant, v_org, v_user, v_actor,
      'assign_current_member_manager', 'organization.manager_assigned',
      'employee_profile', v_target.public_id::text,
      request_id, idempotency_key, 'organization.manage', btrim(p_reason),
      'failure', 'directory_manager_owned', null, null
    );
  end if;
  if v_target.manager_version <> p_expected_manager_version then
    return public.complete_organization_command(
      v_tenant, v_org, v_user, v_actor,
      'assign_current_member_manager', 'organization.manager_assigned',
      'employee_profile', v_target.public_id::text,
      request_id, idempotency_key, 'organization.manage', btrim(p_reason),
      'failure', 'stale_version', null, null
    );
  end if;
  if v_target.department_id is null
     or v_manager.department_id is distinct from v_target.department_id then
    return public.complete_organization_command(
      v_tenant, v_org, v_user, v_actor,
      'assign_current_member_manager', 'organization.manager_assigned',
      'employee_profile', v_target.public_id::text,
      request_id, idempotency_key, 'organization.manage', btrim(p_reason),
      'failure', 'forbidden', null, null
    );
  end if;
  if exists (
    with recursive reporting_chain(id, manager_employee_id, path) as (
      select v_manager.id, v_manager.manager_employee_id, array[v_manager.id]::bigint[]
      union all
      select next_manager.id, next_manager.manager_employee_id,
        chain.path || next_manager.id
      from reporting_chain chain
      join public.employee_profiles next_manager
        on next_manager.tenant_id = v_tenant
       and next_manager.organization_id = v_org
       and next_manager.id = chain.manager_employee_id
      where not next_manager.id = any (chain.path)
    )
    select 1 from reporting_chain where id = v_target.id
  ) then
    return public.complete_organization_command(
      v_tenant, v_org, v_user, v_actor,
      'assign_current_member_manager', 'organization.manager_assigned',
      'employee_profile', v_target.public_id::text,
      request_id, idempotency_key, 'organization.manage', btrim(p_reason),
      'failure', 'manager_cycle', null, null
    );
  end if;

  v_before := jsonb_build_object(
    'employeeRef', v_target.public_id,
    'managerEmployeeRef', (
      select current_manager.public_id
      from public.employee_profiles current_manager
      where current_manager.tenant_id = v_tenant
        and current_manager.organization_id = v_org
        and current_manager.id = v_target.manager_employee_id
    ),
    'managerSource', v_target.manager_source,
    'version', v_target.manager_version
  );
  update public.employee_profiles
  set manager_employee_id = v_manager.id,
      manager_source = 'manual',
      manager_version = manager_version + 1,
      updated_at = clock_timestamp()
  where tenant_id = v_tenant
    and organization_id = v_org
    and id = v_target.id
  returning * into v_target;
  v_after := jsonb_build_object(
    'employeeRef', v_target.public_id,
    'managerEmployeeRef', v_manager.public_id,
    'managerSource', v_target.manager_source,
    'version', v_target.manager_version
  );
  return public.complete_organization_command(
    v_tenant, v_org, v_user, v_actor,
    'assign_current_member_manager', 'organization.manager_assigned',
    'employee_profile', v_target.public_id::text,
    request_id, idempotency_key, 'organization.manage', btrim(p_reason),
    'success', null, v_before, v_after
  );
end;
$$;

create or replace function public.assign_current_member_role(
  p_member_id bigint,
  p_role_name text,
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
  v_claimed boolean;
  v_existing_org bigint;
  v_existing jsonb;
  v_key uuid := idempotency_key;
  v_target public.organization_members%rowtype;
  v_role_id bigint;
  v_before jsonb;
  v_after jsonb;
begin
  select * into v_tenant, v_org, v_actor, v_user
  from public.current_organization_command_context('role.manage');
  if request_id is null or idempotency_key is null or request_id = idempotency_key
     or p_reason is null or length(btrim(p_reason)) not between 1 and 500
     or p_member_id is null or p_version is null or p_version < 1
     or p_role_name not in (
       'admin', 'department_head', 'supervisor', 'employee', 'finance', 'hr'
     ) then
    raise exception 'Role command is invalid' using errcode = '22023';
  end if;
  insert into public.organization_command_idempotency (
    tenant_id, organization_id, operation, idempotency_key, request_id
  ) values (
    v_tenant, v_org, 'assign_current_member_role', idempotency_key, request_id
  ) on conflict do nothing returning true into v_claimed;
  if not coalesce(v_claimed, false) then
    select organization_id, result into v_existing_org, v_existing
    from public.organization_command_idempotency ledger
    where ledger.tenant_id = v_tenant
      and ledger.operation = 'assign_current_member_role'
      and ledger.idempotency_key = v_key;
    if v_existing_org is distinct from v_org then
      return public.audit_organization_command_scope_conflict(
        v_tenant, v_org, v_user, v_actor, 'assign_current_member_role',
        'organization_member', request_id, idempotency_key,
        'role.manage', btrim(p_reason)
      );
    end if;
    return v_existing;
  end if;
  select * into v_target
  from public.organization_members member
  where member.tenant_id = v_tenant
    and member.organization_id = v_org
    and member.id = p_member_id
    and member.status in ('active', 'invited')
  for update;
  if not found then
    return public.complete_organization_command(
      v_tenant, v_org, v_user, v_actor, 'assign_current_member_role',
      'organization.role_assigned', 'organization_member', p_member_id::text,
      request_id, idempotency_key, 'role.manage', btrim(p_reason),
      'failure', 'not_found', null, null
    );
  end if;
  if exists (
    select 1 from public.member_roles assignment
    where assignment.tenant_id = v_tenant
      and assignment.member_id = v_target.id
      and assignment.assignment_source = 'directory'
  ) then
    return public.complete_organization_command(
      v_tenant, v_org, v_user, v_actor, 'assign_current_member_role',
      'organization.role_assigned', 'organization_member', v_target.id::text,
      request_id, idempotency_key, 'role.manage', btrim(p_reason),
      'failure', 'directory_role_owned', null, null
    );
  end if;
  if exists (
    select 1
    from public.member_roles assignment
    join public.roles role
      on role.tenant_id = assignment.tenant_id and role.id = assignment.role_id
    where assignment.tenant_id = v_tenant
      and assignment.member_id = v_target.id
      and role.code = 'owner'
  ) then
    return public.complete_organization_command(
      v_tenant, v_org, v_user, v_actor, 'assign_current_member_role',
      'organization.role_assigned', 'organization_member', v_target.id::text,
      request_id, idempotency_key, 'role.manage', btrim(p_reason),
      'failure', 'forbidden', null, null
    );
  end if;
  if v_target.role_version <> p_version then
    return public.complete_organization_command(
      v_tenant, v_org, v_user, v_actor, 'assign_current_member_role',
      'organization.role_assigned', 'organization_member', v_target.id::text,
      request_id, idempotency_key, 'role.manage', btrim(p_reason),
      'failure', 'stale_version', null, null
    );
  end if;
  select role.id into v_role_id
  from public.roles role
  where role.tenant_id = v_tenant
    and role.organization_id is null
    and role.code = p_role_name
    and role.is_system
    and role.is_enabled
  limit 1;
  if v_role_id is null then
    return public.complete_organization_command(
      v_tenant, v_org, v_user, v_actor, 'assign_current_member_role',
      'organization.role_assigned', 'organization_member', v_target.id::text,
      request_id, idempotency_key, 'role.manage', btrim(p_reason),
      'failure', 'not_found', null, null
    );
  end if;
  select coalesce(jsonb_agg(role.name order by role.name), '[]'::jsonb)
  into v_before
  from public.member_roles assignment
  join public.roles role
    on role.tenant_id = assignment.tenant_id and role.id = assignment.role_id
  where assignment.tenant_id = v_tenant and assignment.member_id = v_target.id;
  delete from public.member_roles assignment
  where assignment.tenant_id = v_tenant
    and assignment.member_id = v_target.id
    and assignment.assignment_source = 'manual';
  insert into public.member_roles (tenant_id, member_id, role_id, assignment_source)
  values (v_tenant, v_target.id, v_role_id, 'manual')
  on conflict (tenant_id, member_id, role_id) do nothing;
  update public.organization_members
  set role_version = role_version + 1
  where id = v_target.id
  returning * into v_target;
  select coalesce(jsonb_agg(role.name order by role.name), '[]'::jsonb)
  into v_after
  from public.member_roles assignment
  join public.roles role
    on role.tenant_id = assignment.tenant_id and role.id = assignment.role_id
  where assignment.tenant_id = v_tenant and assignment.member_id = v_target.id;
  return public.complete_organization_command(
    v_tenant, v_org, v_user, v_actor, 'assign_current_member_role',
    'organization.role_assigned', 'organization_member', v_target.id::text,
    request_id, idempotency_key, 'role.manage', btrim(p_reason), 'success', null,
    jsonb_build_object('roleSet', v_before, 'version', p_version),
    jsonb_build_object('roleSet', v_after, 'version', v_target.role_version)
  );
end;
$$;

create or replace function public.apply_directory_manager_hierarchy(
  p_tenant_id bigint,
  p_organization_id bigint,
  p_connection_id bigint,
  p_run_id uuid,
  p_actor_member_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target public.employee_profiles%rowtype;
  v_manager_id bigint;
  v_actor_auth_user_id uuid;
  v_mapped integer := 0;
  v_cleared integer := 0;
  v_conflicts integer := 0;
begin
  if not exists (
    select 1
    from public.directory_connections connection
    join public.identity_providers provider
      on provider.tenant_id = connection.tenant_id
     and provider.id = connection.identity_provider_id
     and provider.provider_code = 'feishu'
     and provider.status = 'active'
    where connection.tenant_id = p_tenant_id
      and connection.organization_id = p_organization_id
      and connection.id = p_connection_id
      and connection.provider_type = 'feishu'
  ) then
    raise exception 'directory_manager_scope_invalid' using errcode = '42501';
  end if;
  select member.user_id into v_actor_auth_user_id
  from public.organization_members member
  where member.tenant_id = p_tenant_id
    and member.organization_id = p_organization_id
    and member.id = p_actor_member_id
    and member.status = 'active';
  if v_actor_auth_user_id is null then
    raise exception 'directory_manager_actor_invalid' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'manager-tree:' || p_tenant_id::text || ':' || p_organization_id::text,
      0
    )
  );

  for v_target in
    select profile.*
    from public.directory_entity_links link
    join public.employee_profiles profile
      on profile.tenant_id = link.tenant_id
     and profile.organization_id = link.organization_id
     and profile.id = link.employee_profile_id
    join public.organization_members member
      on member.tenant_id = profile.tenant_id
     and member.organization_id = profile.organization_id
     and member.id = profile.organization_member_id
     and member.status = 'active'
    where link.tenant_id = p_tenant_id
      and link.organization_id = p_organization_id
      and link.connection_id = p_connection_id
      and link.entity_type = 'employee'
      and profile.deleted_at is null
      and profile.employment_status in ('probation', 'active', 'on_leave')
    order by profile.id
    for update of profile
  loop
    v_manager_id := null;
    with recursive department_chain(id, parent_department_id, depth) as (
      select department.id, department.parent_department_id, 0
      from public.departments department
      where department.tenant_id = p_tenant_id
        and department.organization_id = p_organization_id
        and department.id = v_target.department_id
        and department.deleted_at is null

      union all

      select parent.id, parent.parent_department_id, child.depth + 1
      from public.departments parent
      join department_chain child on child.parent_department_id = parent.id
      where parent.tenant_id = p_tenant_id
        and parent.organization_id = p_organization_id
        and parent.deleted_at is null
    )
    select manager_profile.id into v_manager_id
    from department_chain chain
    join public.departments department
      on department.tenant_id = p_tenant_id
     and department.organization_id = p_organization_id
     and department.id = chain.id
    join public.directory_entity_links department_link
      on department_link.tenant_id = department.tenant_id
     and department_link.organization_id = department.organization_id
     and department_link.connection_id = p_connection_id
     and department_link.entity_type = 'department'
     and department_link.department_id = department.id
    join public.employee_profiles manager_profile
      on manager_profile.tenant_id = v_target.tenant_id
     and manager_profile.organization_id = v_target.organization_id
     and manager_profile.organization_member_id = department.leader_member_id
     and manager_profile.deleted_at is null
     and manager_profile.employment_status in ('probation', 'active', 'on_leave')
    join public.organization_members manager_member
      on manager_member.tenant_id = manager_profile.tenant_id
     and manager_member.organization_id = manager_profile.organization_id
     and manager_member.id = manager_profile.organization_member_id
     and manager_member.status = 'active'
    join public.directory_entity_links manager_link
      on manager_link.tenant_id = manager_profile.tenant_id
     and manager_link.organization_id = manager_profile.organization_id
     and manager_link.connection_id = p_connection_id
     and manager_link.entity_type = 'employee'
     and manager_link.employee_profile_id = manager_profile.id
    where manager_profile.id <> v_target.id
    order by chain.depth, manager_profile.id
    limit 1;

    if v_manager_id is not null then
      if v_target.manager_source = 'manual'
         and v_target.manager_employee_id is not null
         and v_target.manager_employee_id is distinct from v_manager_id then
        v_conflicts := v_conflicts + 1;
      end if;
      if v_target.manager_employee_id is distinct from v_manager_id
         or v_target.manager_source <> 'directory' then
        update public.employee_profiles
        set manager_employee_id = v_manager_id,
            manager_source = 'directory',
            manager_version = manager_version + 1,
            updated_at = clock_timestamp()
        where tenant_id = p_tenant_id
          and organization_id = p_organization_id
          and id = v_target.id;
        v_mapped := v_mapped + 1;
      end if;
    elsif v_target.manager_source = 'directory'
       or (
         v_target.manager_source = 'manual'
         and v_target.manager_employee_id is not null
         and exists (
           select 1
           from public.employee_profiles current_manager
           where current_manager.tenant_id = p_tenant_id
             and current_manager.organization_id = p_organization_id
             and current_manager.id = v_target.manager_employee_id
             and current_manager.department_id is distinct from v_target.department_id
         )
       ) then
      if v_target.manager_source = 'manual' then
        v_conflicts := v_conflicts + 1;
      end if;
      update public.employee_profiles
      set manager_employee_id = null,
          manager_source = 'unassigned',
          manager_version = manager_version + 1,
          updated_at = clock_timestamp()
      where tenant_id = p_tenant_id
        and organization_id = p_organization_id
        and id = v_target.id;
      v_cleared := v_cleared + 1;
    end if;
  end loop;

  if v_conflicts > 0 then
    insert into public.feishu_sync_conflicts (
      tenant_id, organization_id, code, severity, entity_type
    ) values (
      p_tenant_id, p_organization_id,
      'RECONCILIATION_DIFFERENCE', 'warning', 'user'
    );
  end if;

  perform public.append_audit_log(
    p_tenant_id, p_organization_id, v_actor_auth_user_id, p_actor_member_id,
    'directory.manager_mapped', 'directory_sync_run', p_run_id::text,
    p_run_id, null, jsonb_build_object(
      'outcome', 'success',
      'mappedCount', v_mapped,
      'clearedCount', v_cleared,
      'conflictCount', v_conflicts,
      'managerSource', 'directory'
    )
  );
  return jsonb_build_object(
    'mappedCount', v_mapped,
    'clearedCount', v_cleared,
    'conflictCount', v_conflicts
  );
end;
$$;

create or replace function public.apply_directory_manager_hierarchy_on_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'running' and new.status = 'completed' and exists (
    select 1
    from public.directory_connections connection
    join public.identity_providers provider
      on provider.tenant_id = connection.tenant_id
     and provider.id = connection.identity_provider_id
     and provider.provider_code = 'feishu'
     and provider.status = 'active'
    where connection.tenant_id = new.tenant_id
      and connection.organization_id = new.organization_id
      and connection.id = new.connection_id
      and connection.provider_type = 'feishu'
  ) then
    perform public.apply_directory_manager_hierarchy(
      new.tenant_id,
      new.organization_id,
      new.connection_id,
      new.public_id,
      new.actor_member_id
    );
  end if;
  return new;
end;
$$;

drop trigger if exists directory_sync_runs_apply_manager_hierarchy
  on public.directory_sync_runs;
create trigger directory_sync_runs_apply_manager_hierarchy
after update of status on public.directory_sync_runs
for each row
when (old.status = 'running' and new.status = 'completed')
execute function public.apply_directory_manager_hierarchy_on_completion();

revoke all on function public.is_canonical_workspace_role_code(text)
  from public, anon, authenticated, service_role;
revoke all on function public.quarantine_legacy_supervisor_roles()
  from public, anon, authenticated, service_role;
revoke all on function public.ensure_supervisor_role_for_tenant(bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.provision_supervisor_role_for_new_tenant()
  from public, anon, authenticated, service_role;
revoke all on function public.guard_employee_profile_relations()
  from public, anon, authenticated, service_role;
revoke all on function public.classify_legacy_directory_manager_relationships()
  from public, anon, authenticated, service_role;
revoke all on function public.repair_legacy_manager_relationships()
  from public, anon, authenticated, service_role;
revoke all on function public.require_employee_manager_tree_lock()
  from public, anon, authenticated, service_role;
revoke all on function public.task8_legacy_revoke_departed_member_access(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.task8_legacy_apply_feishu_directory_sync(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.task8_legacy_apply_feishu_directory_sync_observed(uuid, uuid, jsonb, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.task8_legacy_apply_feishu_directory_sync_exact(uuid, uuid, uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.task8_legacy_apply_feishu_directory_sync_fenced(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.revoke_departed_member_access(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.revoke_departed_member_access(uuid, text)
  to service_role;
revoke all on function public.apply_feishu_directory_sync(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.apply_feishu_directory_sync_observed(uuid, uuid, jsonb, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.apply_feishu_directory_sync_observed(uuid, uuid, jsonb, uuid)
  to service_role;
revoke all on function public.apply_feishu_directory_sync_exact(uuid, uuid, uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.apply_feishu_directory_sync_fenced(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.apply_feishu_directory_sync_fenced(uuid, uuid, uuid, jsonb)
  to service_role;
revoke all on function public.reconcile_employee_manager_lifecycle_changes()
  from public, anon, authenticated, service_role;
revoke all on function public.cleanup_employee_managers_for_member_status()
  from public, anon, authenticated, service_role;
revoke all on function public.enforce_employee_manager_invariants()
  from public, anon, authenticated, service_role;
revoke all on function public.current_workspace_access()
  from public, anon, authenticated, service_role;
grant execute on function public.current_workspace_access() to authenticated;
revoke all on function public.current_supervisor_employee_projection(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.current_supervisor_employee_projection(uuid) to authenticated;
revoke all on function public.assign_current_member_manager(uuid, uuid, bigint, text, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.assign_current_member_manager(uuid, uuid, bigint, text, uuid, uuid)
  to authenticated;
revoke all on function public.assign_current_member_role(bigint, text, bigint, text, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.assign_current_member_role(bigint, text, bigint, text, uuid, uuid)
  to authenticated;
revoke all on function public.apply_directory_manager_hierarchy(bigint, bigint, bigint, uuid, bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.apply_directory_manager_hierarchy_on_completion()
  from public, anon, authenticated, service_role;

revoke update (manager_employee_id, manager_source, manager_version)
  on table public.employee_profiles from public, anon, authenticated;
grant select (manager_source, manager_version)
  on table public.employee_profiles to authenticated;
