-- Forward-only project execution commands. This migration deliberately follows
-- 202608270004 so the hardened project tenant/version model remains authoritative.
alter table public.audit_logs drop constraint if exists audit_logs_action_check;
alter table public.audit_logs add constraint audit_logs_action_check check (action in (
  'identity.provisioned', 'identity.claimed', 'identity.revoked', 'member.status_changed',
  'member.role_changed', 'profile.updated', 'roster.imported', 'tenant.bootstrap_owner',
  'enterprise.initialized', 'directory.sync_started', 'directory.sync_completed',
  'directory.sync_failed', 'directory.role_mapped', 'project.created', 'project.updated',
  'project.archived', 'project.command_failed', 'project.milestone_created',
  'project.risk_created', 'project.activity_recorded', 'project.report_submitted',
  'project.execution_failed', 'task.created', 'task.comment_created',
  'task.dependency_created', 'payroll_policy.activated', 'payroll.calculated',
  'payroll.confirmed', 'ai.config.updated', 'organization.department_created',
  'organization.department_updated', 'organization.position_upserted',
  'organization.role_assigned', 'organization.command_failed',
  'organization.manager_assigned', 'directory.manager_mapped',
  'employee_skill.verified', 'employee_skill.verification_failed',
  'directory.sync_issue_resolved'
));

alter table public.milestones
  add column tenant_id bigint,
  add column created_by_member_id bigint,
  add column updated_by_member_id bigint,
  add column version bigint not null default 1;
alter table public.project_risks
  add column tenant_id bigint,
  add column created_by_member_id bigint,
  add column updated_by_member_id bigint,
  add column version bigint not null default 1;
alter table public.project_activities
  add column tenant_id bigint,
  add column actor_member_id bigint,
  add column version bigint not null default 1;
alter table public.daily_reports
  add column tenant_id bigint,
  add column created_by_member_id bigint,
  add column updated_by_member_id bigint,
  add column version bigint not null default 1;
alter table public.task_comments
  add column tenant_id bigint,
  add column created_by_member_id bigint,
  add column updated_by_member_id bigint,
  add column version bigint not null default 1;
alter table public.task_dependencies
  add column public_id uuid not null default gen_random_uuid(),
  add column tenant_id bigint,
  add column project_id bigint,
  add column created_by_member_id bigint,
  add column version bigint not null default 1;

update public.milestones milestone
set tenant_id = project.tenant_id,
    created_by_member_id = coalesce(milestone.owner_member_id, project.created_by_member_id),
    updated_by_member_id = coalesce(milestone.owner_member_id, project.updated_by_member_id)
from public.projects project
where project.id = milestone.project_id
  and project.organization_id = milestone.organization_id;

update public.project_risks risk
set tenant_id = project.tenant_id,
    created_by_member_id = project.created_by_member_id,
    updated_by_member_id = project.updated_by_member_id
from public.projects project
where project.id = risk.project_id
  and project.organization_id = risk.organization_id;

update public.project_activities activity
set tenant_id = project.tenant_id,
    actor_member_id = coalesce(
      (
        select member.id
        from public.organization_members member
        where member.organization_id = activity.organization_id
          and member.user_id = activity.user_id
        order by member.id
        limit 1
      ),
      project.created_by_member_id
    )
from public.projects project
where project.id = activity.project_id
  and project.organization_id = activity.organization_id;

update public.daily_reports report
set tenant_id = project.tenant_id,
    created_by_member_id = report.author_member_id,
    updated_by_member_id = report.author_member_id
from public.projects project
where project.id = report.project_id
  and project.organization_id = report.organization_id;

update public.task_comments comment
set tenant_id = project.tenant_id,
    created_by_member_id = comment.author_member_id,
    updated_by_member_id = comment.author_member_id
from public.projects project
where project.id = comment.project_id
  and project.organization_id = comment.organization_id;

do $project_dependency_preflight$
begin
  if exists (
    select 1
    from public.task_dependencies dependency
    join public.tasks task on task.id = dependency.task_id
    join public.tasks required_task on required_task.id = dependency.depends_on_task_id
    where task.organization_id <> dependency.organization_id
       or required_task.organization_id <> dependency.organization_id
       or task.project_id <> required_task.project_id
  ) then
    raise exception 'Historical task dependency crosses organization or project';
  end if;
  if exists (
    with recursive dependency_walk(
      organization_id, origin_task_id, current_task_id, visited_task_ids, has_cycle
    ) as (
      select dependency.organization_id, dependency.task_id,
             dependency.depends_on_task_id,
             array[dependency.task_id, dependency.depends_on_task_id]::bigint[],
             dependency.task_id = dependency.depends_on_task_id
      from public.task_dependencies dependency
      union all
      select walk.organization_id, walk.origin_task_id,
             dependency.depends_on_task_id,
             walk.visited_task_ids || dependency.depends_on_task_id,
             dependency.depends_on_task_id = any(walk.visited_task_ids)
      from dependency_walk walk
      join public.task_dependencies dependency
        on dependency.organization_id = walk.organization_id
       and dependency.task_id = walk.current_task_id
      where not walk.has_cycle
    )
    select 1 from dependency_walk where has_cycle
  ) then
    raise exception 'Historical task dependency cycle must be resolved before upgrade';
  end if;
end;
$project_dependency_preflight$;

update public.task_dependencies dependency
set tenant_id = project.tenant_id,
    project_id = task.project_id,
    created_by_member_id = coalesce(task.reporter_member_id, project.created_by_member_id)
from public.tasks task
join public.projects project
  on project.id = task.project_id
 and project.organization_id = task.organization_id
where task.id = dependency.task_id
  and task.organization_id = dependency.organization_id;

alter table public.milestones
  alter column tenant_id set not null,
  alter column created_by_member_id set not null,
  alter column updated_by_member_id set not null,
  add constraint milestones_exact_project_fkey foreign key (tenant_id, organization_id, project_id)
    references public.projects(tenant_id, organization_id, id) on delete cascade,
  add constraint milestones_creator_tenant_fkey foreign key (tenant_id, created_by_member_id)
    references public.organization_members(tenant_id, id) on delete restrict,
  add constraint milestones_creator_organization_fkey foreign key (organization_id, created_by_member_id)
    references public.organization_members(organization_id, id) on delete restrict,
  add constraint milestones_updater_tenant_fkey foreign key (tenant_id, updated_by_member_id)
    references public.organization_members(tenant_id, id) on delete restrict,
  add constraint milestones_updater_organization_fkey foreign key (organization_id, updated_by_member_id)
    references public.organization_members(organization_id, id) on delete restrict,
  add constraint milestones_version_check check (version > 0);

alter table public.project_risks
  alter column tenant_id set not null,
  alter column created_by_member_id set not null,
  alter column updated_by_member_id set not null,
  add constraint project_risks_exact_project_fkey foreign key (tenant_id, organization_id, project_id)
    references public.projects(tenant_id, organization_id, id) on delete cascade,
  add constraint project_risks_creator_tenant_fkey foreign key (tenant_id, created_by_member_id)
    references public.organization_members(tenant_id, id) on delete restrict,
  add constraint project_risks_creator_organization_fkey foreign key (organization_id, created_by_member_id)
    references public.organization_members(organization_id, id) on delete restrict,
  add constraint project_risks_updater_tenant_fkey foreign key (tenant_id, updated_by_member_id)
    references public.organization_members(tenant_id, id) on delete restrict,
  add constraint project_risks_updater_organization_fkey foreign key (organization_id, updated_by_member_id)
    references public.organization_members(organization_id, id) on delete restrict,
  add constraint project_risks_version_check check (version > 0);

alter table public.project_activities
  alter column tenant_id set not null,
  alter column actor_member_id set not null,
  add constraint project_activities_exact_project_fkey foreign key (tenant_id, organization_id, project_id)
    references public.projects(tenant_id, organization_id, id) on delete cascade,
  add constraint project_activities_actor_tenant_fkey foreign key (tenant_id, actor_member_id)
    references public.organization_members(tenant_id, id) on delete restrict,
  add constraint project_activities_actor_organization_fkey foreign key (organization_id, actor_member_id)
    references public.organization_members(organization_id, id) on delete restrict,
  add constraint project_activities_version_check check (version = 1);

alter table public.daily_reports
  alter column tenant_id set not null,
  alter column created_by_member_id set not null,
  alter column updated_by_member_id set not null,
  add constraint daily_reports_exact_project_fkey foreign key (tenant_id, organization_id, project_id)
    references public.projects(tenant_id, organization_id, id) on delete cascade,
  add constraint daily_reports_creator_tenant_fkey foreign key (tenant_id, created_by_member_id)
    references public.organization_members(tenant_id, id) on delete restrict,
  add constraint daily_reports_creator_organization_fkey foreign key (organization_id, created_by_member_id)
    references public.organization_members(organization_id, id) on delete restrict,
  add constraint daily_reports_updater_tenant_fkey foreign key (tenant_id, updated_by_member_id)
    references public.organization_members(tenant_id, id) on delete restrict,
  add constraint daily_reports_updater_organization_fkey foreign key (organization_id, updated_by_member_id)
    references public.organization_members(organization_id, id) on delete restrict,
  add constraint daily_reports_version_check check (version > 0);

alter table public.task_comments
  alter column tenant_id set not null,
  alter column created_by_member_id set not null,
  alter column updated_by_member_id set not null,
  add constraint task_comments_exact_project_fkey foreign key (tenant_id, organization_id, project_id)
    references public.projects(tenant_id, organization_id, id) on delete cascade,
  add constraint task_comments_creator_tenant_fkey foreign key (tenant_id, created_by_member_id)
    references public.organization_members(tenant_id, id) on delete restrict,
  add constraint task_comments_creator_organization_fkey foreign key (organization_id, created_by_member_id)
    references public.organization_members(organization_id, id) on delete restrict,
  add constraint task_comments_updater_tenant_fkey foreign key (tenant_id, updated_by_member_id)
    references public.organization_members(tenant_id, id) on delete restrict,
  add constraint task_comments_updater_organization_fkey foreign key (organization_id, updated_by_member_id)
    references public.organization_members(organization_id, id) on delete restrict,
  add constraint task_comments_version_check check (version > 0);

alter table public.task_dependencies
  alter column tenant_id set not null,
  alter column project_id set not null,
  alter column created_by_member_id set not null,
  add constraint task_dependencies_public_id_key unique (public_id),
  add constraint task_dependencies_exact_project_fkey foreign key (tenant_id, organization_id, project_id)
    references public.projects(tenant_id, organization_id, id) on delete cascade,
  add constraint task_dependencies_task_same_project_fkey foreign key (organization_id, project_id, task_id)
    references public.tasks(organization_id, project_id, id) on delete cascade,
  add constraint task_dependencies_required_task_same_project_fkey foreign key (organization_id, project_id, depends_on_task_id)
    references public.tasks(organization_id, project_id, id) on delete cascade,
  add constraint task_dependencies_creator_tenant_fkey foreign key (tenant_id, created_by_member_id)
    references public.organization_members(tenant_id, id) on delete restrict,
  add constraint task_dependencies_creator_organization_fkey foreign key (organization_id, created_by_member_id)
    references public.organization_members(organization_id, id) on delete restrict,
  add constraint task_dependencies_version_check check (version = 1);

alter table public.project_activities drop constraint if exists project_activities_action_type_check;
alter table public.project_activities add constraint project_activities_action_type_check check (
  action_type in (
    'project_created', 'project_updated', 'project_note_added', 'member_added',
    'milestone_updated', 'task_updated', 'file_uploaded',
    'daily_report_submitted', 'risk_updated'
  )
);

create table public.project_execution_command_idempotency (
  tenant_id bigint not null references public.tenants(id) on delete restrict,
  organization_id bigint not null,
  actor_member_id bigint not null,
  operation text not null check (operation in (
    'create_current_project_milestone', 'create_current_project_risk',
    'record_current_project_activity', 'submit_current_project_report',
    'create_current_task_comment', 'create_current_task_dependency'
  )),
  idempotency_key uuid not null,
  target_public_id uuid not null,
  payload_digest text not null check (payload_digest ~ '^[0-9a-f]{64}$'),
  request_id uuid not null,
  result jsonb,
  created_at timestamptz not null default clock_timestamp(),
  primary key (tenant_id, operation, idempotency_key),
  foreign key (tenant_id, organization_id)
    references public.organizations(tenant_id, id) on delete restrict,
  foreign key (tenant_id, actor_member_id)
    references public.organization_members(tenant_id, id) on delete restrict,
  foreign key (organization_id, actor_member_id)
    references public.organization_members(organization_id, id) on delete restrict
);

alter table public.milestones enable row level security;
alter table public.milestones force row level security;
alter table public.project_risks enable row level security;
alter table public.project_risks force row level security;
alter table public.project_activities enable row level security;
alter table public.project_activities force row level security;
alter table public.daily_reports enable row level security;
alter table public.daily_reports force row level security;
alter table public.task_comments enable row level security;
alter table public.task_comments force row level security;
alter table public.task_dependencies enable row level security;
alter table public.task_dependencies force row level security;
alter table public.project_execution_command_idempotency enable row level security;
alter table public.project_execution_command_idempotency force row level security;

create or replace function public.current_project_execution_identity()
returns table (
  tenant_id bigint,
  organization_id bigint,
  actor_member_id bigint,
  actor_auth_user_id uuid,
  actor_employee_public_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Project execution authentication required' using errcode = '42501';
  end if;
  return query
  select tenant.id, organization.id, member.id, (select auth.uid()), profile.public_id
  from public.external_identities external
  join public.identity_providers provider
    on provider.tenant_id = external.tenant_id
   and provider.id = external.identity_provider_id
   and provider.status = 'active'
  join public.tenants tenant
    on tenant.id = external.tenant_id
   and tenant.status = 'active'
  join public.organizations organization
    on organization.tenant_id = external.tenant_id
   and organization.id = external.organization_id
  join public.organization_members member
    on member.tenant_id = external.tenant_id
   and member.organization_id = external.organization_id
   and member.id = external.organization_member_id
   and member.status = 'active'
  join public.employee_profiles profile
    on profile.tenant_id = member.tenant_id
   and profile.organization_id = member.organization_id
   and profile.organization_member_id = member.id
   and profile.deleted_at is null
   and profile.employment_status in ('probation', 'active', 'on_leave')
  where external.auth_user_id = (select auth.uid())
    and external.status = 'active'
  limit 1;
  if not found then
    raise exception 'Project execution identity unavailable' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.lock_current_project_execution_access(
  p_tenant_id bigint,
  p_organization_id bigint,
  p_actor_member_id bigint,
  p_project_public_id uuid,
  p_required_access text
)
returns table (project_id bigint, project_public_id uuid, access_state text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project public.projects%rowtype;
  v_employment_status text;
  v_member_status text;
  v_membership_role text;
  v_has_admin_role boolean := false;
begin
  if p_required_access is null or p_required_access not in ('manage', 'contribute') then
    raise exception 'Project execution access mode is invalid' using errcode = '22023';
  end if;

  select * into v_project
  from public.projects project
  where project.tenant_id = p_tenant_id
    and project.organization_id = p_organization_id
    and project.public_id = p_project_public_id
    and project.deleted_at is null
  for update;
  if not found then
    return query select null::bigint, p_project_public_id, 'not_found'::text;
    return;
  end if;

  select profile.employment_status into v_employment_status
  from public.employee_profiles profile
  where profile.tenant_id = p_tenant_id
    and profile.organization_id = p_organization_id
    and profile.organization_member_id = p_actor_member_id
    and profile.deleted_at is null
  for update;
  if not found or v_employment_status not in ('probation', 'active', 'on_leave') then
    return query select v_project.id, v_project.public_id, 'forbidden'::text;
    return;
  end if;

  select member.status into v_member_status
  from public.organization_members member
  where member.tenant_id = p_tenant_id
    and member.organization_id = p_organization_id
    and member.id = p_actor_member_id
  for update;
  if not found or v_member_status <> 'active' then
    return query select v_project.id, v_project.public_id, 'forbidden'::text;
    return;
  end if;

  if v_project.owner_member_id = p_actor_member_id then
    return query select v_project.id, v_project.public_id, 'allowed'::text;
    return;
  end if;

  select membership.role into v_membership_role
  from public.project_members membership
  where membership.tenant_id = p_tenant_id
    and membership.organization_id = p_organization_id
    and membership.project_id = v_project.id
    and membership.member_id = p_actor_member_id
    and membership.left_at is null
  for update;
  if found and (
    v_membership_role in ('owner', 'manager')
    or (p_required_access = 'contribute' and v_membership_role = 'member')
  ) then
    return query select v_project.id, v_project.public_id, 'allowed'::text;
    return;
  end if;

  select true into v_has_admin_role
  from public.member_roles assignment
  join public.roles role
    on role.tenant_id = assignment.tenant_id
   and role.id = assignment.role_id
  where assignment.tenant_id = p_tenant_id
    and assignment.member_id = p_actor_member_id
    and role.is_enabled
    and role.code = 'admin'
    and (role.organization_id is null or role.organization_id = p_organization_id)
  order by assignment.role_id
  limit 1
  for update of assignment, role;
  if coalesce(v_has_admin_role, false) then
    return query select v_project.id, v_project.public_id, 'allowed'::text;
    return;
  end if;

  return query select v_project.id, v_project.public_id, 'forbidden'::text;
end;
$$;

create or replace function public.lock_current_task_execution_access(
  p_tenant_id bigint,
  p_organization_id bigint,
  p_actor_member_id bigint,
  p_task_public_id uuid,
  p_required_access text
)
returns table (
  task_id bigint,
  project_id bigint,
  project_public_id uuid,
  access_state text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_public_id uuid;
  v_project_id bigint;
  v_access_state text;
  v_task_id bigint;
begin
  select project.public_id into v_project_public_id
  from public.tasks task
  join public.projects project
    on project.organization_id = task.organization_id
   and project.id = task.project_id
  where project.tenant_id = p_tenant_id
    and project.organization_id = p_organization_id
    and task.public_id = p_task_public_id
    and task.deleted_at is null
    and project.deleted_at is null;
  if not found then
    return query select null::bigint, null::bigint, null::uuid, 'not_found'::text;
    return;
  end if;

  select access.project_id, access.access_state
    into strict v_project_id, v_access_state
  from public.lock_current_project_execution_access(
    p_tenant_id, p_organization_id, p_actor_member_id,
    v_project_public_id, p_required_access
  ) access;
  if v_access_state <> 'allowed' then
    return query select null::bigint, v_project_id, v_project_public_id, v_access_state;
    return;
  end if;

  select task.id into v_task_id
  from public.tasks task
  where task.organization_id = p_organization_id
    and task.project_id = v_project_id
    and task.public_id = p_task_public_id
    and task.deleted_at is null
  for update;
  if not found then
    return query select null::bigint, v_project_id, v_project_public_id, 'not_found'::text;
    return;
  end if;

  return query select v_task_id, v_project_id, v_project_public_id, 'allowed'::text;
end;
$$;

create or replace function public.claim_project_execution_command(
  p_tenant_id bigint,
  p_organization_id bigint,
  p_actor_member_id bigint,
  p_operation text,
  p_target_public_id uuid,
  p_payload jsonb,
  p_idempotency_key uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organization_id bigint;
  v_actor_member_id bigint;
  v_target_public_id uuid;
  v_payload_digest text;
  v_expected_digest text := encode(
    public.digest(convert_to(coalesce(p_payload, '{}'::jsonb)::text, 'UTF8'), 'sha256'),
    'hex'
  );
  v_result jsonb;
begin
  insert into public.project_execution_command_idempotency(
    tenant_id, organization_id, actor_member_id, operation, idempotency_key,
    target_public_id, payload_digest, request_id
  ) values (
    p_tenant_id, p_organization_id, p_actor_member_id, p_operation,
    p_idempotency_key, p_target_public_id, v_expected_digest, p_request_id
  ) on conflict (tenant_id, operation, idempotency_key) do nothing;

  select ledger.organization_id, ledger.actor_member_id, ledger.target_public_id,
         ledger.payload_digest, ledger.result
    into strict v_organization_id, v_actor_member_id, v_target_public_id,
                v_payload_digest, v_result
  from public.project_execution_command_idempotency ledger
  where ledger.tenant_id = p_tenant_id
    and ledger.operation = p_operation
    and ledger.idempotency_key = p_idempotency_key
  for update;

  if v_organization_id <> p_organization_id
     or v_actor_member_id <> p_actor_member_id
     or v_target_public_id <> p_target_public_id
     or v_payload_digest <> v_expected_digest then
    return jsonb_build_object('state', 'scope_conflict');
  end if;
  if v_result is not null then
    return jsonb_build_object('state', 'replay', 'result', v_result);
  end if;
  return jsonb_build_object('state', 'claimed');
end;
$$;

create or replace function public.complete_project_execution_command(
  p_tenant_id bigint,
  p_organization_id bigint,
  p_actor_auth_user_id uuid,
  p_actor_member_id bigint,
  p_operation text,
  p_resource text,
  p_action text,
  p_target_id text,
  p_request_id uuid,
  p_idempotency_key uuid,
  p_reason text,
  p_outcome text,
  p_error text,
  p_entity jsonb
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
    'outcome', 'success', 'resource', p_resource, 'id', p_target_id,
    'version', coalesce((p_entity ->> 'version')::bigint, 1),
    'entity', coalesce(p_entity, '{}'::jsonb)
  ) else jsonb_build_object('outcome', 'failure', 'error', p_error) end;

  update public.project_execution_command_idempotency ledger
     set result = v_result
   where ledger.tenant_id = p_tenant_id
     and ledger.organization_id = p_organization_id
     and ledger.operation = p_operation
     and ledger.idempotency_key = p_idempotency_key;

  perform public.append_audit_log(
    p_tenant_id, p_organization_id, p_actor_auth_user_id, p_actor_member_id,
    case when p_outcome = 'success' then p_action else 'project.execution_failed' end,
    p_resource, p_target_id, p_request_id, null,
    jsonb_build_object(
      'outcome', p_outcome, 'operation', p_operation, 'resource', p_resource,
      'requestId', p_request_id, 'idempotencyKey', p_idempotency_key,
      'businessReason', p_reason,
      'after', case when p_outcome = 'success' then jsonb_build_object(
        'id', p_entity -> 'id', 'projectId', p_entity -> 'projectId',
        'taskId', p_entity -> 'taskId', 'version', p_entity -> 'version',
        'entityDigest', encode(
          public.digest(convert_to(coalesce(p_entity, '{}'::jsonb)::text, 'UTF8'), 'sha256'),
          'hex'
        )
      ) else null end,
      'failure', case when p_outcome = 'failure' then p_error else null end
    )
  );
  return v_result;
end;
$$;

create or replace function public.audit_project_execution_replay_denied(
  p_tenant_id bigint,
  p_organization_id bigint,
  p_actor_auth_user_id uuid,
  p_actor_member_id bigint,
  p_operation text,
  p_resource text,
  p_target_id text,
  p_request_id uuid,
  p_idempotency_key uuid,
  p_reason text,
  p_error text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.append_audit_log(
    p_tenant_id, p_organization_id, p_actor_auth_user_id, p_actor_member_id,
    'project.execution_failed', p_resource, p_target_id, p_request_id, null,
    jsonb_build_object(
      'outcome', 'failure', 'operation', p_operation, 'resource', p_resource,
      'requestId', p_request_id, 'idempotencyKey', p_idempotency_key,
      'businessReason', p_reason, 'failure', p_error, 'replayDenied', true
    )
  );
  return jsonb_build_object('outcome', 'failure', 'error', p_error);
end;
$$;

create or replace function public.audit_project_execution_scope_conflict(
  p_tenant_id bigint,
  p_organization_id bigint,
  p_actor_auth_user_id uuid,
  p_actor_member_id bigint,
  p_operation text,
  p_resource text,
  p_target_id text,
  p_request_id uuid,
  p_idempotency_key uuid,
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
    'project.execution_failed', p_resource, p_target_id, p_request_id, null,
    jsonb_build_object(
      'outcome', 'failure', 'operation', p_operation, 'resource', p_resource,
      'requestId', p_request_id, 'idempotencyKey', p_idempotency_key,
      'businessReason', p_reason, 'failure', 'scope_conflict'
    )
  );
  return jsonb_build_object('outcome', 'failure', 'error', 'scope_conflict');
end;
$$;

create or replace function public.create_current_project_milestone(
  p_project_public_id uuid,
  p_name text,
  p_description text,
  p_owner_employee_public_id uuid,
  p_start_date date,
  p_due_date date,
  p_progress numeric,
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
  v_actor_employee uuid;
  v_project_id bigint;
  v_owner_member_id bigint;
  v_claim jsonb;
  v_access_state text;
  v_replay boolean;
  v_row public.milestones%rowtype;
  v_entity jsonb;
begin
  if p_project_public_id is null or p_owner_employee_public_id is null
     or nullif(btrim(p_name), '') is null or length(btrim(p_name)) > 160
     or length(coalesce(p_description, '')) > 4000
     or p_due_date is null or (p_start_date is not null and p_start_date > p_due_date)
     or p_progress is null or p_progress = 'NaN'::numeric or p_progress < 0 or p_progress > 100
     or nullif(btrim(p_reason), '') is null or length(btrim(p_reason)) > 500
     or request_id is null or idempotency_key is null or request_id = idempotency_key then
    raise exception 'Milestone command input is invalid' using errcode = '22023';
  end if;
  select * into strict v_tenant, v_org, v_actor, v_user, v_actor_employee
  from public.current_project_execution_identity();
  v_claim := public.claim_project_execution_command(
    v_tenant, v_org, v_actor, 'create_current_project_milestone',
    p_project_public_id,
    jsonb_build_object(
      'name', btrim(p_name), 'description', btrim(coalesce(p_description, '')),
      'ownerPublicId', p_owner_employee_public_id, 'startDate', p_start_date,
      'dueDate', p_due_date, 'progress', p_progress, 'reason', btrim(p_reason)
    ),
    idempotency_key, request_id
  );
  if v_claim ->> 'state' = 'scope_conflict' then
    return public.audit_project_execution_scope_conflict(
      v_tenant, v_org, v_user, v_actor, 'create_current_project_milestone',
      'milestone', p_project_public_id::text, request_id, idempotency_key, btrim(p_reason)
    );
  end if;
  v_replay := v_claim ->> 'state' = 'replay';
  select access.project_id, access.access_state
    into strict v_project_id, v_access_state
  from public.lock_current_project_execution_access(
    v_tenant, v_org, v_actor, p_project_public_id, 'manage'
  ) access;
  if v_access_state <> 'allowed' then
    if v_replay then
      return public.audit_project_execution_replay_denied(
        v_tenant, v_org, v_user, v_actor, 'create_current_project_milestone',
        'milestone', p_project_public_id::text, request_id, idempotency_key,
        btrim(p_reason), v_access_state
      );
    end if;
    return public.complete_project_execution_command(
      v_tenant, v_org, v_user, v_actor, 'create_current_project_milestone',
      'milestone', 'project.milestone_created', p_project_public_id::text,
      request_id, idempotency_key, btrim(p_reason), 'failure', v_access_state, null
    );
  end if;
  if v_replay then return v_claim -> 'result'; end if;
  begin
    select profile.organization_member_id into v_owner_member_id
    from public.employee_profiles profile
    join public.organization_members member
      on member.tenant_id = profile.tenant_id
     and member.organization_id = profile.organization_id
     and member.id = profile.organization_member_id
     and member.status = 'active'
    join public.project_members membership
      on membership.tenant_id = profile.tenant_id
     and membership.organization_id = profile.organization_id
     and membership.project_id = v_project_id
     and membership.member_id = profile.organization_member_id
     and membership.left_at is null
    where profile.tenant_id = v_tenant and profile.organization_id = v_org
      and profile.public_id = p_owner_employee_public_id
      and profile.deleted_at is null
      and profile.employment_status in ('probation', 'active', 'on_leave')
    for update of member, membership;
    if v_owner_member_id is null then
      return public.complete_project_execution_command(
        v_tenant, v_org, v_user, v_actor, 'create_current_project_milestone',
        'milestone', 'project.milestone_created', p_project_public_id::text,
        request_id, idempotency_key, btrim(p_reason), 'failure', 'not_found', null
      );
    end if;
    insert into public.milestones(
      tenant_id, organization_id, project_id, owner_member_id, name, description,
      status, start_date, due_date, completed_at, progress, sort_order,
      created_by_member_id, updated_by_member_id, version
    ) values (
      v_tenant, v_org, v_project_id, v_owner_member_id, btrim(p_name),
      btrim(coalesce(p_description, '')),
      case when p_progress = 100 then 'completed'
           when p_progress > 0 then 'in_progress' else 'pending' end,
      p_start_date, p_due_date,
      case when p_progress = 100 then clock_timestamp() else null end,
      p_progress,
      (select coalesce(max(milestone.sort_order), -1) + 1
       from public.milestones milestone where milestone.project_id = v_project_id),
      v_actor, v_actor, 1
    ) returning * into strict v_row;
    insert into public.project_activities(
      tenant_id, organization_id, project_id, user_id, actor_member_id,
      action_type, content, version
    ) values (
      v_tenant, v_org, v_project_id, v_user, v_actor,
      'milestone_updated', '新增里程碑：' || v_row.name, 1
    );
    v_entity := jsonb_build_object(
      'id', v_row.public_id, 'organizationId', v_org::text,
      'projectId', p_project_public_id,
      'ownerPublicId', p_owner_employee_public_id, 'name', v_row.name,
      'description', v_row.description, 'status', v_row.status,
      'startDate', v_row.start_date, 'dueDate', v_row.due_date,
      'progress', v_row.progress, 'sortOrder', v_row.sort_order,
      'version', v_row.version, 'createdAt', v_row.created_at,
      'updatedAt', v_row.updated_at
    );
    return public.complete_project_execution_command(
      v_tenant, v_org, v_user, v_actor, 'create_current_project_milestone',
      'milestone', 'project.milestone_created', v_row.public_id::text,
      request_id, idempotency_key, btrim(p_reason), 'success', null, v_entity
    );
  exception when others then
    return public.complete_project_execution_command(
      v_tenant, v_org, v_user, v_actor, 'create_current_project_milestone',
      'milestone', 'project.milestone_created', p_project_public_id::text,
      request_id, idempotency_key, btrim(p_reason), 'failure', 'command_failed', null
    );
  end;
end;
$$;

create or replace function public.create_current_project_risk(
  p_project_public_id uuid,
  p_title text,
  p_level text,
  p_owner_employee_public_id uuid,
  p_deadline date,
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
  v_actor_employee uuid;
  v_project_id bigint;
  v_owner_member_id bigint;
  v_claim jsonb;
  v_access_state text;
  v_replay boolean;
  v_row public.project_risks%rowtype;
  v_entity jsonb;
begin
  if p_project_public_id is null or p_owner_employee_public_id is null
     or nullif(btrim(p_title), '') is null or length(btrim(p_title)) > 200
     or p_level is null or p_level not in ('low', 'medium', 'high', 'critical')
     or p_deadline is null
     or nullif(btrim(p_reason), '') is null or length(btrim(p_reason)) > 500
     or request_id is null or idempotency_key is null or request_id = idempotency_key then
    raise exception 'Risk command input is invalid' using errcode = '22023';
  end if;
  select * into strict v_tenant, v_org, v_actor, v_user, v_actor_employee
  from public.current_project_execution_identity();
  v_claim := public.claim_project_execution_command(
    v_tenant, v_org, v_actor, 'create_current_project_risk',
    p_project_public_id,
    jsonb_build_object(
      'title', btrim(p_title), 'level', p_level,
      'ownerPublicId', p_owner_employee_public_id, 'deadline', p_deadline,
      'reason', btrim(p_reason)
    ),
    idempotency_key, request_id
  );
  if v_claim ->> 'state' = 'scope_conflict' then
    return public.audit_project_execution_scope_conflict(
      v_tenant, v_org, v_user, v_actor, 'create_current_project_risk',
      'risk', p_project_public_id::text, request_id, idempotency_key, btrim(p_reason)
    );
  end if;
  v_replay := v_claim ->> 'state' = 'replay';
  select access.project_id, access.access_state
    into strict v_project_id, v_access_state
  from public.lock_current_project_execution_access(
    v_tenant, v_org, v_actor, p_project_public_id, 'manage'
  ) access;
  if v_access_state <> 'allowed' then
    if v_replay then
      return public.audit_project_execution_replay_denied(
        v_tenant, v_org, v_user, v_actor, 'create_current_project_risk',
        'risk', p_project_public_id::text, request_id, idempotency_key,
        btrim(p_reason), v_access_state
      );
    end if;
    return public.complete_project_execution_command(
      v_tenant, v_org, v_user, v_actor, 'create_current_project_risk',
      'risk', 'project.risk_created', p_project_public_id::text,
      request_id, idempotency_key, btrim(p_reason), 'failure', v_access_state, null
    );
  end if;
  if v_replay then return v_claim -> 'result'; end if;
  begin
    select profile.organization_member_id into v_owner_member_id
    from public.employee_profiles profile
    join public.organization_members member
      on member.tenant_id = profile.tenant_id
     and member.organization_id = profile.organization_id
     and member.id = profile.organization_member_id
     and member.status = 'active'
    join public.project_members membership
      on membership.tenant_id = profile.tenant_id
     and membership.organization_id = profile.organization_id
     and membership.project_id = v_project_id
     and membership.member_id = profile.organization_member_id
     and membership.left_at is null
    where profile.tenant_id = v_tenant and profile.organization_id = v_org
      and profile.public_id = p_owner_employee_public_id
      and profile.deleted_at is null
      and profile.employment_status in ('probation', 'active', 'on_leave')
    for update of member, membership;
    if v_owner_member_id is null then
      return public.complete_project_execution_command(
        v_tenant, v_org, v_user, v_actor, 'create_current_project_risk',
        'risk', 'project.risk_created', p_project_public_id::text,
        request_id, idempotency_key, btrim(p_reason), 'failure', 'not_found', null
      );
    end if;
    insert into public.project_risks(
      tenant_id, organization_id, project_id, title, level, owner_member_id,
      status, deadline, created_by_member_id, updated_by_member_id, version
    ) values (
      v_tenant, v_org, v_project_id, btrim(p_title), p_level, v_owner_member_id,
      'open', p_deadline, v_actor, v_actor, 1
    ) returning * into strict v_row;
    insert into public.project_activities(
      tenant_id, organization_id, project_id, user_id, actor_member_id,
      action_type, content, version
    ) values (
      v_tenant, v_org, v_project_id, v_user, v_actor,
      'risk_updated', '新增风险：' || v_row.title, 1
    );
    v_entity := jsonb_build_object(
      'id', v_row.public_id, 'projectId', p_project_public_id,
      'ownerPublicId', p_owner_employee_public_id, 'title', v_row.title,
      'level', v_row.level, 'status', v_row.status, 'deadline', v_row.deadline,
      'version', v_row.version, 'updatedAt', v_row.updated_at
    );
    return public.complete_project_execution_command(
      v_tenant, v_org, v_user, v_actor, 'create_current_project_risk',
      'risk', 'project.risk_created', v_row.public_id::text,
      request_id, idempotency_key, btrim(p_reason), 'success', null, v_entity
    );
  exception when others then
    return public.complete_project_execution_command(
      v_tenant, v_org, v_user, v_actor, 'create_current_project_risk',
      'risk', 'project.risk_created', p_project_public_id::text,
      request_id, idempotency_key, btrim(p_reason), 'failure', 'command_failed', null
    );
  end;
end;
$$;

create or replace function public.record_current_project_activity(
  p_project_public_id uuid,
  p_content text,
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
  v_actor_employee uuid;
  v_project_id bigint;
  v_claim jsonb;
  v_access_state text;
  v_replay boolean;
  v_row public.project_activities%rowtype;
  v_entity jsonb;
begin
  if p_project_public_id is null
     or nullif(btrim(p_content), '') is null or length(btrim(p_content)) > 4000
     or nullif(btrim(p_reason), '') is null or length(btrim(p_reason)) > 500
     or request_id is null or idempotency_key is null or request_id = idempotency_key then
    raise exception 'Activity command input is invalid' using errcode = '22023';
  end if;
  select * into strict v_tenant, v_org, v_actor, v_user, v_actor_employee
  from public.current_project_execution_identity();
  v_claim := public.claim_project_execution_command(
    v_tenant, v_org, v_actor, 'record_current_project_activity',
    p_project_public_id,
    jsonb_build_object('content', btrim(p_content), 'reason', btrim(p_reason)),
    idempotency_key, request_id
  );
  if v_claim ->> 'state' = 'scope_conflict' then
    return public.audit_project_execution_scope_conflict(
      v_tenant, v_org, v_user, v_actor, 'record_current_project_activity',
      'activity', p_project_public_id::text, request_id, idempotency_key, btrim(p_reason)
    );
  end if;
  v_replay := v_claim ->> 'state' = 'replay';
  select access.project_id, access.access_state
    into strict v_project_id, v_access_state
  from public.lock_current_project_execution_access(
    v_tenant, v_org, v_actor, p_project_public_id, 'contribute'
  ) access;
  if v_access_state <> 'allowed' then
    if v_replay then
      return public.audit_project_execution_replay_denied(
        v_tenant, v_org, v_user, v_actor, 'record_current_project_activity',
        'activity', p_project_public_id::text, request_id, idempotency_key,
        btrim(p_reason), v_access_state
      );
    end if;
    return public.complete_project_execution_command(
      v_tenant, v_org, v_user, v_actor, 'record_current_project_activity',
      'activity', 'project.activity_recorded', p_project_public_id::text,
      request_id, idempotency_key, btrim(p_reason), 'failure', v_access_state, null
    );
  end if;
  if v_replay then return v_claim -> 'result'; end if;
  begin
    insert into public.project_activities(
      tenant_id, organization_id, project_id, user_id, actor_member_id,
      action_type, content, version
    ) values (
      v_tenant, v_org, v_project_id, v_user, v_actor,
      'project_note_added', btrim(p_content), 1
    ) returning * into strict v_row;
    v_entity := jsonb_build_object(
      'id', v_row.public_id, 'projectId', p_project_public_id,
      'content', v_row.content, 'version', v_row.version,
      'createdAt', v_row.created_at
    );
    return public.complete_project_execution_command(
      v_tenant, v_org, v_user, v_actor, 'record_current_project_activity',
      'activity', 'project.activity_recorded', v_row.public_id::text,
      request_id, idempotency_key, btrim(p_reason), 'success', null, v_entity
    );
  exception when others then
    return public.complete_project_execution_command(
      v_tenant, v_org, v_user, v_actor, 'record_current_project_activity',
      'activity', 'project.activity_recorded', p_project_public_id::text,
      request_id, idempotency_key, btrim(p_reason), 'failure', 'command_failed', null
    );
  end;
end;
$$;

create or replace function public.submit_current_project_report(
  p_project_public_id uuid,
  p_report_date date,
  p_summary text,
  p_next_plan text,
  p_blockers text,
  p_support_needed text,
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
  v_actor_employee uuid;
  v_project_id bigint;
  v_claim jsonb;
  v_access_state text;
  v_replay boolean;
  v_row public.daily_reports%rowtype;
  v_entity jsonb;
begin
  if p_project_public_id is null or p_report_date is null
     or nullif(btrim(p_summary), '') is null or length(btrim(p_summary)) > 8000
     or nullif(btrim(p_next_plan), '') is null or length(btrim(p_next_plan)) > 8000
     or length(coalesce(p_blockers, '')) > 8000
     or length(coalesce(p_support_needed, '')) > 8000
     or nullif(btrim(p_reason), '') is null or length(btrim(p_reason)) > 500
     or request_id is null or idempotency_key is null or request_id = idempotency_key then
    raise exception 'Report command input is invalid' using errcode = '22023';
  end if;
  select * into strict v_tenant, v_org, v_actor, v_user, v_actor_employee
  from public.current_project_execution_identity();
  v_claim := public.claim_project_execution_command(
    v_tenant, v_org, v_actor, 'submit_current_project_report',
    p_project_public_id,
    jsonb_build_object(
      'reportDate', p_report_date, 'summary', btrim(p_summary),
      'nextPlan', btrim(p_next_plan),
      'blockers', btrim(coalesce(p_blockers, '')),
      'supportNeeded', btrim(coalesce(p_support_needed, '')),
      'reason', btrim(p_reason)
    ),
    idempotency_key, request_id
  );
  if v_claim ->> 'state' = 'scope_conflict' then
    return public.audit_project_execution_scope_conflict(
      v_tenant, v_org, v_user, v_actor, 'submit_current_project_report',
      'report', p_project_public_id::text, request_id, idempotency_key, btrim(p_reason)
    );
  end if;
  v_replay := v_claim ->> 'state' = 'replay';
  select access.project_id, access.access_state
    into strict v_project_id, v_access_state
  from public.lock_current_project_execution_access(
    v_tenant, v_org, v_actor, p_project_public_id, 'contribute'
  ) access;
  if v_access_state <> 'allowed' then
    if v_replay then
      return public.audit_project_execution_replay_denied(
        v_tenant, v_org, v_user, v_actor, 'submit_current_project_report',
        'report', p_project_public_id::text, request_id, idempotency_key,
        btrim(p_reason), v_access_state
      );
    end if;
    return public.complete_project_execution_command(
      v_tenant, v_org, v_user, v_actor, 'submit_current_project_report',
      'report', 'project.report_submitted', p_project_public_id::text,
      request_id, idempotency_key, btrim(p_reason), 'failure', v_access_state, null
    );
  end if;
  if v_replay then return v_claim -> 'result'; end if;
  begin
    insert into public.daily_reports(
      tenant_id, organization_id, project_id, author_member_id, report_date,
      status, summary, next_plan, blockers, support_needed, submitted_at,
      created_by_member_id, updated_by_member_id, version
    ) values (
      v_tenant, v_org, v_project_id, v_actor, p_report_date,
      'submitted', btrim(p_summary), btrim(p_next_plan),
      nullif(btrim(coalesce(p_blockers, '')), ''),
      nullif(btrim(coalesce(p_support_needed, '')), ''),
      clock_timestamp(), v_actor, v_actor, 1
    ) returning * into strict v_row;
    insert into public.project_activities(
      tenant_id, organization_id, project_id, user_id, actor_member_id,
      action_type, content, version
    ) values (
      v_tenant, v_org, v_project_id, v_user, v_actor,
      'daily_report_submitted', '提交项目日报：' || p_report_date::text, 1
    );
    v_entity := jsonb_build_object(
      'id', v_row.public_id, 'projectId', p_project_public_id,
      'authorPublicId', v_actor_employee, 'reportDate', v_row.report_date,
      'status', v_row.status, 'summary', v_row.summary, 'nextPlan', v_row.next_plan,
      'blockers', coalesce(v_row.blockers, ''),
      'supportNeeded', coalesce(v_row.support_needed, ''),
      'version', v_row.version, 'updatedAt', v_row.updated_at
    );
    return public.complete_project_execution_command(
      v_tenant, v_org, v_user, v_actor, 'submit_current_project_report',
      'report', 'project.report_submitted', v_row.public_id::text,
      request_id, idempotency_key, btrim(p_reason), 'success', null, v_entity
    );
  exception when unique_violation then
    return public.complete_project_execution_command(
      v_tenant, v_org, v_user, v_actor, 'submit_current_project_report',
      'report', 'project.report_submitted', p_project_public_id::text,
      request_id, idempotency_key, btrim(p_reason), 'failure', 'conflict', null
    );
  when others then
    return public.complete_project_execution_command(
      v_tenant, v_org, v_user, v_actor, 'submit_current_project_report',
      'report', 'project.report_submitted', p_project_public_id::text,
      request_id, idempotency_key, btrim(p_reason), 'failure', 'command_failed', null
    );
  end;
end;
$$;

create or replace function public.create_current_task_comment(
  p_task_public_id uuid,
  p_body text,
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
  v_actor_employee uuid;
  v_project_id bigint;
  v_project_public_id uuid;
  v_task_id bigint;
  v_claim jsonb;
  v_access_state text;
  v_replay boolean;
  v_row public.task_comments%rowtype;
  v_entity jsonb;
begin
  if p_task_public_id is null
     or nullif(btrim(p_body), '') is null or length(btrim(p_body)) > 8000
     or nullif(btrim(p_reason), '') is null or length(btrim(p_reason)) > 500
     or request_id is null or idempotency_key is null or request_id = idempotency_key then
    raise exception 'Comment command input is invalid' using errcode = '22023';
  end if;
  select * into strict v_tenant, v_org, v_actor, v_user, v_actor_employee
  from public.current_project_execution_identity();
  v_claim := public.claim_project_execution_command(
    v_tenant, v_org, v_actor, 'create_current_task_comment',
    p_task_public_id,
    jsonb_build_object('body', btrim(p_body), 'reason', btrim(p_reason)),
    idempotency_key, request_id
  );
  if v_claim ->> 'state' = 'scope_conflict' then
    return public.audit_project_execution_scope_conflict(
      v_tenant, v_org, v_user, v_actor, 'create_current_task_comment',
      'comment', p_task_public_id::text, request_id, idempotency_key, btrim(p_reason)
    );
  end if;
  v_replay := v_claim ->> 'state' = 'replay';
  select access.task_id, access.project_id, access.project_public_id, access.access_state
    into strict v_task_id, v_project_id, v_project_public_id, v_access_state
  from public.lock_current_task_execution_access(
    v_tenant, v_org, v_actor, p_task_public_id, 'contribute'
  ) access;
  if v_access_state <> 'allowed' then
    if v_replay then
      return public.audit_project_execution_replay_denied(
        v_tenant, v_org, v_user, v_actor, 'create_current_task_comment',
        'comment', p_task_public_id::text, request_id, idempotency_key,
        btrim(p_reason), v_access_state
      );
    end if;
    return public.complete_project_execution_command(
      v_tenant, v_org, v_user, v_actor, 'create_current_task_comment',
      'comment', 'task.comment_created', p_task_public_id::text,
      request_id, idempotency_key, btrim(p_reason), 'failure', v_access_state, null
    );
  end if;
  if v_replay then return v_claim -> 'result'; end if;
  begin
    insert into public.task_comments(
      tenant_id, organization_id, project_id, task_id, author_member_id, body,
      created_by_member_id, updated_by_member_id, version
    ) values (
      v_tenant, v_org, v_project_id, v_task_id, v_actor, btrim(p_body),
      v_actor, v_actor, 1
    ) returning * into strict v_row;
    insert into public.project_activities(
      tenant_id, organization_id, project_id, user_id, actor_member_id,
      action_type, content, version
    ) values (
      v_tenant, v_org, v_project_id, v_user, v_actor,
      'task_updated', '新增任务评论', 1
    );
    v_entity := jsonb_build_object(
      'id', v_row.public_id, 'taskId', p_task_public_id,
      'projectId', v_project_public_id, 'authorPublicId', v_actor_employee,
      'body', v_row.body, 'version', v_row.version,
      'createdAt', v_row.created_at, 'updatedAt', v_row.updated_at
    );
    return public.complete_project_execution_command(
      v_tenant, v_org, v_user, v_actor, 'create_current_task_comment',
      'comment', 'task.comment_created', v_row.public_id::text,
      request_id, idempotency_key, btrim(p_reason), 'success', null, v_entity
    );
  exception when others then
    return public.complete_project_execution_command(
      v_tenant, v_org, v_user, v_actor, 'create_current_task_comment',
      'comment', 'task.comment_created', p_task_public_id::text,
      request_id, idempotency_key, btrim(p_reason), 'failure', 'command_failed', null
    );
  end;
end;
$$;

create or replace function public.create_current_task_dependency(
  p_task_public_id uuid,
  p_depends_on_task_public_id uuid,
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
  v_actor_employee uuid;
  v_project_id bigint;
  v_project_public_id uuid;
  v_task_id bigint;
  v_required_task_id bigint;
  v_claim jsonb;
  v_access_state text;
  v_replay boolean;
  v_cycle boolean;
  v_row public.task_dependencies%rowtype;
  v_entity jsonb;
begin
  if p_task_public_id is null or p_depends_on_task_public_id is null
     or nullif(btrim(p_reason), '') is null or length(btrim(p_reason)) > 500
     or request_id is null or idempotency_key is null or request_id = idempotency_key then
    raise exception 'Dependency command input is invalid' using errcode = '22023';
  end if;
  select * into strict v_tenant, v_org, v_actor, v_user, v_actor_employee
  from public.current_project_execution_identity();
  v_claim := public.claim_project_execution_command(
    v_tenant, v_org, v_actor, 'create_current_task_dependency',
    p_task_public_id,
    jsonb_build_object(
      'dependsOnTaskId', p_depends_on_task_public_id, 'reason', btrim(p_reason)
    ),
    idempotency_key, request_id
  );
  if v_claim ->> 'state' = 'scope_conflict' then
    return public.audit_project_execution_scope_conflict(
      v_tenant, v_org, v_user, v_actor, 'create_current_task_dependency',
      'dependency', p_task_public_id::text, request_id, idempotency_key, btrim(p_reason)
    );
  end if;
  v_replay := v_claim ->> 'state' = 'replay';
  select access.task_id, access.project_id, access.project_public_id, access.access_state
    into strict v_task_id, v_project_id, v_project_public_id, v_access_state
  from public.lock_current_task_execution_access(
    v_tenant, v_org, v_actor, p_task_public_id, 'manage'
  ) access;
  if v_access_state <> 'allowed' then
    if v_replay then
      return public.audit_project_execution_replay_denied(
        v_tenant, v_org, v_user, v_actor, 'create_current_task_dependency',
        'dependency', p_task_public_id::text, request_id, idempotency_key,
        btrim(p_reason), v_access_state
      );
    end if;
    return public.complete_project_execution_command(
      v_tenant, v_org, v_user, v_actor, 'create_current_task_dependency',
      'dependency', 'task.dependency_created', p_task_public_id::text,
      request_id, idempotency_key, btrim(p_reason), 'failure', v_access_state, null
    );
  end if;
  if v_replay then return v_claim -> 'result'; end if;
  if p_task_public_id = p_depends_on_task_public_id then
    return public.complete_project_execution_command(
      v_tenant, v_org, v_user, v_actor, 'create_current_task_dependency',
      'dependency', 'task.dependency_created', p_task_public_id::text,
      request_id, idempotency_key, btrim(p_reason), 'failure', 'task_dependency_cycle', null
    );
  end if;
  begin
    select task.id into v_required_task_id
    from public.tasks task
    where task.organization_id = v_org and task.project_id = v_project_id
      and task.public_id = p_depends_on_task_public_id and task.deleted_at is null
    for update;
    if v_required_task_id is null then
      return public.complete_project_execution_command(
        v_tenant, v_org, v_user, v_actor, 'create_current_task_dependency',
        'dependency', 'task.dependency_created', p_task_public_id::text,
        request_id, idempotency_key, btrim(p_reason), 'failure', 'not_found', null
      );
    end if;
    with recursive dependency_chain(task_id) as (
      select dependency.depends_on_task_id
      from public.task_dependencies dependency
      where dependency.organization_id = v_org
        and dependency.project_id = v_project_id
        and dependency.task_id = v_required_task_id
      union
      select dependency.depends_on_task_id
      from public.task_dependencies dependency
      join dependency_chain chain on chain.task_id = dependency.task_id
      where dependency.organization_id = v_org
        and dependency.project_id = v_project_id
    )
    select exists(select 1 from dependency_chain where task_id = v_task_id)
      into strict v_cycle;
    if v_cycle then
      return public.complete_project_execution_command(
        v_tenant, v_org, v_user, v_actor, 'create_current_task_dependency',
        'dependency', 'task.dependency_created', p_task_public_id::text,
        request_id, idempotency_key, btrim(p_reason), 'failure', 'task_dependency_cycle', null
      );
    end if;
    insert into public.task_dependencies(
      tenant_id, organization_id, project_id, task_id, depends_on_task_id,
      created_by_member_id, version
    ) values (
      v_tenant, v_org, v_project_id, v_task_id, v_required_task_id, v_actor, 1
    ) returning * into strict v_row;
    insert into public.project_activities(
      tenant_id, organization_id, project_id, user_id, actor_member_id,
      action_type, content, version
    ) values (
      v_tenant, v_org, v_project_id, v_user, v_actor,
      'task_updated', '新增任务前置依赖', 1
    );
    v_entity := jsonb_build_object(
      'id', v_row.public_id, 'taskId', p_task_public_id,
      'projectId', v_project_public_id,
      'dependsOnTaskId', p_depends_on_task_public_id,
      'version', v_row.version, 'createdAt', v_row.created_at
    );
    return public.complete_project_execution_command(
      v_tenant, v_org, v_user, v_actor, 'create_current_task_dependency',
      'dependency', 'task.dependency_created', v_row.public_id::text,
      request_id, idempotency_key, btrim(p_reason), 'success', null, v_entity
    );
  exception when unique_violation then
    return public.complete_project_execution_command(
      v_tenant, v_org, v_user, v_actor, 'create_current_task_dependency',
      'dependency', 'task.dependency_created', p_task_public_id::text,
      request_id, idempotency_key, btrim(p_reason), 'failure', 'conflict', null
    );
  when others then
    return public.complete_project_execution_command(
      v_tenant, v_org, v_user, v_actor, 'create_current_task_dependency',
      'dependency', 'task.dependency_created', p_task_public_id::text,
      request_id, idempotency_key, btrim(p_reason), 'failure', 'command_failed', null
    );
  end;
end;
$$;

revoke all on table public.project_execution_command_idempotency
  from public, anon, authenticated, service_role;
revoke insert, update, delete, truncate, references, trigger on table public.milestones
  from public, anon, authenticated, service_role;
revoke insert, update, delete, truncate, references, trigger on table public.project_risks
  from public, anon, authenticated, service_role;
revoke insert, update, delete, truncate, references, trigger on table public.project_activities
  from public, anon, authenticated, service_role;
revoke insert, update, delete, truncate, references, trigger on table public.daily_reports
  from public, anon, authenticated, service_role;
revoke insert, update, delete, truncate, references, trigger on table public.task_comments
  from public, anon, authenticated, service_role;
revoke insert, update, delete, truncate, references, trigger on table public.task_dependencies
  from public, anon, authenticated, service_role;

grant select on table public.milestones, public.project_risks,
  public.project_activities, public.daily_reports, public.task_comments,
  public.task_dependencies to authenticated;

revoke all on function public.current_project_execution_identity()
  from public, anon, authenticated, service_role;
revoke all on function public.lock_current_project_execution_access(bigint,bigint,bigint,uuid,text)
  from public, anon, authenticated, service_role;
revoke all on function public.lock_current_task_execution_access(bigint,bigint,bigint,uuid,text)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_project_execution_command(bigint,bigint,bigint,text,uuid,jsonb,uuid,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_project_execution_command(bigint,bigint,uuid,bigint,text,text,text,text,uuid,uuid,text,text,text,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.audit_project_execution_replay_denied(bigint,bigint,uuid,bigint,text,text,text,uuid,uuid,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.audit_project_execution_scope_conflict(bigint,bigint,uuid,bigint,text,text,text,uuid,uuid,text)
  from public, anon, authenticated, service_role;

revoke all on function public.create_current_project_milestone(uuid,text,text,uuid,date,date,numeric,text,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.create_current_project_milestone(uuid,text,text,uuid,date,date,numeric,text,uuid,uuid)
  to authenticated;
revoke all on function public.create_current_project_risk(uuid,text,text,uuid,date,text,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.create_current_project_risk(uuid,text,text,uuid,date,text,uuid,uuid)
  to authenticated;
revoke all on function public.record_current_project_activity(uuid,text,text,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.record_current_project_activity(uuid,text,text,uuid,uuid)
  to authenticated;
revoke all on function public.submit_current_project_report(uuid,date,text,text,text,text,text,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.submit_current_project_report(uuid,date,text,text,text,text,text,uuid,uuid)
  to authenticated;
revoke all on function public.create_current_task_comment(uuid,text,text,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.create_current_task_comment(uuid,text,text,uuid,uuid)
  to authenticated;
revoke all on function public.create_current_task_dependency(uuid,uuid,text,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.create_current_task_dependency(uuid,uuid,text,uuid,uuid)
  to authenticated;
