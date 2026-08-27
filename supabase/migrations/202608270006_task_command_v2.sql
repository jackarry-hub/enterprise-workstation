-- Forward-only task command hardening. This migration follows 202608270005
-- and keeps the existing project/RBAC model authoritative.
alter table public.audit_logs drop constraint if exists audit_logs_action_check;
alter table public.audit_logs add constraint audit_logs_action_check check (action in (
  'identity.provisioned', 'identity.claimed', 'identity.revoked', 'member.status_changed',
  'member.role_changed', 'profile.updated', 'roster.imported', 'tenant.bootstrap_owner',
  'enterprise.initialized', 'directory.sync_started', 'directory.sync_completed',
  'directory.sync_failed', 'directory.role_mapped', 'project.created', 'project.updated',
  'project.archived', 'project.command_failed', 'project.milestone_created',
  'project.risk_created', 'project.activity_recorded', 'project.report_submitted',
  'project.execution_failed', 'task.created', 'task.batch_created', 'task.claimed',
  'task.progress_updated', 'task.submitted', 'task.reviewed', 'task.reopened',
  'task.command_failed', 'task.comment_created', 'task.dependency_created',
  'payroll_policy.activated', 'payroll.calculated', 'payroll.confirmed',
  'ai.config.updated', 'organization.department_created',
  'organization.department_updated', 'organization.position_upserted',
  'organization.role_assigned', 'organization.command_failed',
  'organization.manager_assigned', 'directory.manager_mapped',
  'employee_skill.verified', 'employee_skill.verification_failed',
  'directory.sync_issue_resolved'
));

alter table public.tasks
  add column tenant_id bigint,
  add column created_by_member_id bigint,
  add column updated_by_member_id bigint,
  add column version bigint not null default 1;

-- The legacy guard authorizes browser-driven execution updates. It must not
-- run while migration-owned tenant/actor fields are backfilled, and the new
-- version guard below is intentionally installed only after the backfill.
drop trigger if exists tasks_member_execution_fields_guard on public.tasks;

update public.tasks task
set tenant_id = project.tenant_id,
    created_by_member_id = task.reporter_member_id,
    updated_by_member_id = task.reporter_member_id
from public.projects project
where project.organization_id = task.organization_id
  and project.id = task.project_id;

do $$
begin
  if exists (
    select 1 from public.tasks task
    where task.tenant_id is null
       or task.created_by_member_id is null
       or task.updated_by_member_id is null
  ) then
    raise exception 'Task tenant and actor backfill must be resolved before upgrade';
  end if;
end;
$$;

alter table public.tasks
  alter column tenant_id set not null,
  alter column created_by_member_id set not null,
  alter column updated_by_member_id set not null,
  add constraint tasks_tenant_fkey foreign key (tenant_id)
    references public.tenants(id) on delete restrict,
  add constraint tasks_exact_project_fkey foreign key (tenant_id, organization_id, project_id)
    references public.projects(tenant_id, organization_id, id) on delete cascade,
  add constraint tasks_creator_tenant_fkey foreign key (tenant_id, created_by_member_id)
    references public.organization_members(tenant_id, id) on delete restrict,
  add constraint tasks_creator_organization_fkey foreign key (organization_id, created_by_member_id)
    references public.organization_members(organization_id, id) on delete restrict,
  add constraint tasks_updater_tenant_fkey foreign key (tenant_id, updated_by_member_id)
    references public.organization_members(tenant_id, id) on delete restrict,
  add constraint tasks_updater_organization_fkey foreign key (organization_id, updated_by_member_id)
    references public.organization_members(organization_id, id) on delete restrict,
  add constraint tasks_version_check check (version > 0);

create unique index tasks_tenant_organization_project_id_uidx
  on public.tasks(tenant_id, organization_id, project_id, id);

alter table public.task_comments
  add constraint task_comments_exact_task_fkey
    foreign key (tenant_id, organization_id, project_id, task_id)
    references public.tasks(tenant_id, organization_id, project_id, id) on delete cascade;
alter table public.task_dependencies
  add constraint task_dependencies_exact_task_fkey
    foreign key (tenant_id, organization_id, project_id, task_id)
    references public.tasks(tenant_id, organization_id, project_id, id) on delete cascade,
  add constraint task_dependencies_exact_required_task_fkey
    foreign key (tenant_id, organization_id, project_id, depends_on_task_id)
    references public.tasks(tenant_id, organization_id, project_id, id) on delete cascade;

create or replace function public.enforce_task_member_execution_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if row(
    new.id, new.public_id, new.tenant_id, new.organization_id, new.project_id,
    new.milestone_id, new.parent_task_id, new.created_by_member_id, new.created_at
  ) is distinct from row(
    old.id, old.public_id, old.tenant_id, old.organization_id, old.project_id,
    old.milestone_id, old.parent_task_id, old.created_by_member_id, old.created_at
  ) then
    raise exception 'Task identity and ownership fields are immutable' using errcode = '42501';
  end if;
  if new.version <> old.version + 1 then
    raise exception 'Task version must advance exactly once' using errcode = '40001';
  end if;
  return new;
end;
$$;

create trigger tasks_member_execution_fields_guard
before update on public.tasks
for each row execute function public.enforce_task_member_execution_fields();

create table public.task_command_idempotency (
  tenant_id bigint not null references public.tenants(id) on delete restrict,
  organization_id bigint not null,
  actor_member_id bigint not null,
  operation text not null check (operation in ('create_current_task_batch_v2', 'transition_current_task')),
  idempotency_key uuid not null,
  target_public_id uuid,
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

alter table public.tasks enable row level security;
alter table public.tasks force row level security;
alter table public.task_command_idempotency enable row level security;
alter table public.task_command_idempotency force row level security;
drop policy if exists tasks_manager_insert on public.tasks;
drop policy if exists tasks_manager_or_assignee_update on public.tasks;

create or replace function public.claim_task_command(
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
  v_org bigint;
  v_actor bigint;
  v_target uuid;
  v_digest text;
  v_expected text := encode(
    public.digest(convert_to(coalesce(p_payload, '{}'::jsonb)::text, 'UTF8'), 'sha256'), 'hex'
  );
  v_result jsonb;
begin
  insert into public.task_command_idempotency(
    tenant_id, organization_id, actor_member_id, operation, idempotency_key,
    target_public_id, payload_digest, request_id
  ) values (
    p_tenant_id, p_organization_id, p_actor_member_id, p_operation,
    p_idempotency_key, p_target_public_id, v_expected, p_request_id
  ) on conflict (tenant_id, operation, idempotency_key) do nothing;

  select ledger.organization_id, ledger.actor_member_id, ledger.target_public_id,
         ledger.payload_digest, ledger.result
    into strict v_org, v_actor, v_target, v_digest, v_result
  from public.task_command_idempotency ledger
  where ledger.tenant_id = p_tenant_id
    and ledger.operation = p_operation
    and ledger.idempotency_key = p_idempotency_key
  for update;

  if v_org <> p_organization_id or v_actor <> p_actor_member_id
     or v_target is distinct from p_target_public_id or v_digest <> v_expected then
    return jsonb_build_object('state', 'scope_conflict');
  end if;
  if v_result is not null then
    return jsonb_build_object('state', 'replay', 'result', v_result);
  end if;
  return jsonb_build_object('state', 'claimed');
end;
$$;

create or replace function public.complete_task_command(
  p_tenant_id bigint,
  p_organization_id bigint,
  p_actor_auth_user_id uuid,
  p_actor_member_id bigint,
  p_operation text,
  p_action text,
  p_target_id text,
  p_request_id uuid,
  p_idempotency_key uuid,
  p_outcome text,
  p_error text,
  p_result jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb := case when p_outcome = 'success' then p_result
    else jsonb_build_object('outcome', 'failure', 'error', p_error) end;
begin
  update public.task_command_idempotency ledger
  set result = v_result
  where ledger.tenant_id = p_tenant_id
    and ledger.organization_id = p_organization_id
    and ledger.operation = p_operation
    and ledger.idempotency_key = p_idempotency_key;

  perform public.append_audit_log(
    p_tenant_id, p_organization_id, p_actor_auth_user_id, p_actor_member_id,
    case when p_outcome = 'success' then p_action else 'task.command_failed' end,
    case when p_operation = 'create_current_task_batch_v2' then 'task_batch' else 'task' end,
    p_target_id, p_request_id, null,
    jsonb_build_object(
      'outcome', p_outcome, 'operation', p_operation,
      'requestId', p_request_id, 'idempotencyKey', p_idempotency_key,
      'resultDigest', case when p_outcome = 'success' then encode(
        public.digest(convert_to(coalesce(v_result, '{}'::jsonb)::text, 'UTF8'), 'sha256'), 'hex'
      ) else null end,
      'failure', case when p_outcome = 'failure' then p_error else null end
    )
  );
  return v_result;
end;
$$;

create or replace function public.audit_task_command_denied(
  p_tenant_id bigint,
  p_organization_id bigint,
  p_actor_auth_user_id uuid,
  p_actor_member_id bigint,
  p_operation text,
  p_target_id text,
  p_request_id uuid,
  p_idempotency_key uuid,
  p_error text,
  p_replay boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.append_audit_log(
    p_tenant_id, p_organization_id, p_actor_auth_user_id, p_actor_member_id,
    'task.command_failed',
    case when p_operation = 'create_current_task_batch_v2' then 'task_batch' else 'task' end,
    p_target_id, p_request_id, null,
    jsonb_build_object(
      'outcome', 'failure', 'operation', p_operation,
      'requestId', p_request_id, 'idempotencyKey', p_idempotency_key,
      'failure', p_error, 'replayDenied', p_replay
    )
  );
  return jsonb_build_object('outcome', 'failure', 'error', p_error);
end;
$$;

create or replace function public.task_command_entity(p_task_id bigint)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', task.public_id,
    'projectId', project.public_id,
    'assigneeMemberId', task.assignee_member_id::text,
    'reporterMemberId', task.reporter_member_id::text,
    'title', task.title,
    'description', task.description,
    'acceptanceCriteria', task.acceptance_criteria,
    'status', task.status,
    'priority', task.priority,
    'startDate', task.start_date,
    'dueDate', task.due_date,
    'progress', task.progress,
    'blocker', coalesce(task.blocker, ''),
    'nextStep', coalesce(task.next_step, ''),
    'resultText', coalesce(task.result_summary, ''),
    'resultLink', coalesce(task.result_link, ''),
    'resultFiles', coalesce(task.result_files, '[]'::jsonb),
    'reviewNote', coalesce(task.review_note, ''),
    'acceptedAt', task.accepted_at,
    'submittedAt', task.submitted_at,
    'reviewedAt', task.reviewed_at,
    'completedAt', task.completed_at,
    'version', task.version,
    'createdAt', task.created_at,
    'updatedAt', task.updated_at
  )
  from public.tasks task
  join public.projects project
    on project.tenant_id = task.tenant_id
   and project.organization_id = task.organization_id
   and project.id = task.project_id
  where task.id = p_task_id;
$$;

create or replace function public.create_current_task_batch_v2(
  items jsonb,
  idempotency_key uuid,
  request_id uuid
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
  v_claim jsonb;
  v_replay boolean;
  v_item jsonb;
  v_index integer := 0;
  v_project_public_id uuid;
  v_project_id bigint;
  v_access_state text;
  v_assignee bigint;
  v_due_date date;
  v_task public.tasks%rowtype;
  v_tasks jsonb := '[]'::jsonb;
  v_task_ids jsonb := '[]'::jsonb;
  v_result jsonb;
  v_assignee_missing boolean := false;
begin
  if items is null or jsonb_typeof(items) <> 'array'
     or jsonb_array_length(items) < 1 or jsonb_array_length(items) > 20
     or idempotency_key is null or request_id is null or idempotency_key = request_id then
    raise exception 'Task batch input is invalid' using errcode = '22023';
  end if;

  for v_item in select item.value from jsonb_array_elements(items) as item(value) loop
    if jsonb_typeof(v_item) <> 'object'
       or (select count(*) from jsonb_object_keys(v_item)) <> 7
       or exists (
         select 1 from jsonb_object_keys(v_item) as item_key(key)
         where item_key.key not in ('projectId', 'assigneeMemberId', 'title', 'description',
                           'acceptanceCriteria', 'dueDate', 'priority')
       )
       or jsonb_typeof(v_item -> 'projectId') <> 'string'
       or (v_item ->> 'projectId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       or jsonb_typeof(v_item -> 'assigneeMemberId') <> 'number'
       or (v_item ->> 'assigneeMemberId') !~ '^[1-9][0-9]*$'
       or jsonb_typeof(v_item -> 'title') <> 'string'
       or length(btrim(v_item ->> 'title')) not between 1 and 240
       or jsonb_typeof(v_item -> 'description') <> 'string'
       or length(v_item ->> 'description') > 4000
       or jsonb_typeof(v_item -> 'acceptanceCriteria') <> 'string'
       or length(btrim(v_item ->> 'acceptanceCriteria')) not between 1 and 2000
       or jsonb_typeof(v_item -> 'dueDate') <> 'string'
       or (v_item ->> 'dueDate') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
       or jsonb_typeof(v_item -> 'priority') <> 'string'
       or (v_item ->> 'priority') not in ('medium', 'high', 'urgent') then
      raise exception 'Task batch item is invalid' using errcode = '22023';
    end if;
    begin
      v_project_public_id := (v_item ->> 'projectId')::uuid;
      v_assignee := (v_item ->> 'assigneeMemberId')::bigint;
      v_due_date := (v_item ->> 'dueDate')::date;
      if v_due_date::text <> v_item ->> 'dueDate' then
        raise exception 'Task date is invalid' using errcode = '22023';
      end if;
    exception when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then
      raise exception 'Task batch item is invalid' using errcode = '22023';
    end;
  end loop;

  select * into strict v_tenant, v_org, v_actor, v_user, v_actor_employee
  from public.current_project_execution_identity();
  v_claim := public.claim_task_command(
    v_tenant, v_org, v_actor, 'create_current_task_batch_v2', null,
    items, idempotency_key, request_id
  );
  if v_claim ->> 'state' = 'scope_conflict' then
    return public.audit_task_command_denied(
      v_tenant, v_org, v_user, v_actor, 'create_current_task_batch_v2', null,
      request_id, idempotency_key, 'scope_conflict', false
    );
  end if;
  v_replay := v_claim ->> 'state' = 'replay';

  -- Establish one global lock order before any authorization helper can
  -- interleave actor locks between project locks. This also prevents two
  -- disjoint-project batches from cross-locking each other's assignees.
  perform 1
  from public.projects project
  join (
    select distinct (item.value ->> 'projectId')::uuid as public_id
    from jsonb_array_elements(items) as item(value)
  ) requested on requested.public_id = project.public_id
  where project.tenant_id = v_tenant
    and project.organization_id = v_org
    and project.deleted_at is null
  order by project.public_id
  for update of project;

  for v_assignee in
    select distinct candidate.member_id
    from (
      select v_actor::bigint as member_id
      union all
      select (item.value ->> 'assigneeMemberId')::bigint
      from jsonb_array_elements(items) as item(value)
    ) candidate
    order by candidate.member_id
  loop
    perform 1
    from public.organization_members member
    join public.employee_profiles profile
      on profile.tenant_id = member.tenant_id
     and profile.organization_id = member.organization_id
     and profile.organization_member_id = member.id
     and profile.deleted_at is null
     and profile.employment_status in ('probation', 'active', 'on_leave')
    where member.tenant_id = v_tenant and member.organization_id = v_org
      and member.id = v_assignee and member.status = 'active'
    for update of member, profile;
    if not found and v_assignee <> v_actor then
      v_assignee_missing := true;
    end if;
  end loop;

  for v_project_public_id in
    select distinct (item.value ->> 'projectId')::uuid
    from jsonb_array_elements(items) as item(value)
    order by 1
  loop
    select access.project_id, access.access_state
      into strict v_project_id, v_access_state
    from public.lock_current_project_execution_access(
      v_tenant, v_org, v_actor, v_project_public_id, 'manage'
    ) access;
    if v_access_state <> 'allowed' then
      if v_replay then
        return public.audit_task_command_denied(
          v_tenant, v_org, v_user, v_actor, 'create_current_task_batch_v2',
          v_project_public_id::text, request_id, idempotency_key, v_access_state, true
        );
      end if;
      return public.complete_task_command(
        v_tenant, v_org, v_user, v_actor, 'create_current_task_batch_v2',
        'task.batch_created', v_project_public_id::text, request_id, idempotency_key,
        'failure', v_access_state, null
      );
    end if;
  end loop;
  if v_replay then return v_claim -> 'result'; end if;

  if v_assignee_missing then
    return public.complete_task_command(
      v_tenant, v_org, v_user, v_actor, 'create_current_task_batch_v2',
      'task.batch_created', null, request_id, idempotency_key,
      'failure', 'not_found', null
    );
  end if;

  begin
    for v_item in select item.value from jsonb_array_elements(items) as item(value) loop
      v_index := v_index + 1;
      v_project_public_id := (v_item ->> 'projectId')::uuid;
      v_assignee := (v_item ->> 'assigneeMemberId')::bigint;
      v_due_date := (v_item ->> 'dueDate')::date;
      select project.id into strict v_project_id
      from public.projects project
      where project.tenant_id = v_tenant and project.organization_id = v_org
        and project.public_id = v_project_public_id and project.deleted_at is null;

      insert into public.project_members as membership(
        tenant_id, organization_id, project_id, member_id, role, allocation_percent,
        created_by_member_id, updated_by_member_id, version
      ) values (
        v_tenant, v_org, v_project_id, v_assignee, 'member', 100,
        v_actor, v_actor, 1
      ) on conflict (project_id, member_id) do update set
        left_at = null,
        role = case when membership.role = 'viewer' then 'member' else membership.role end,
        allocation_percent = case when membership.role = 'viewer' then 100 else membership.allocation_percent end,
        updated_by_member_id = v_actor,
        version = membership.version + 1,
        updated_at = clock_timestamp();

      insert into public.tasks(
        tenant_id, organization_id, project_id, title, description,
        assignee_member_id, reporter_member_id, status, priority,
        start_date, due_date, progress, acceptance_criteria,
        created_by_member_id, updated_by_member_id, version
      ) values (
        v_tenant, v_org, v_project_id, btrim(v_item ->> 'title'),
        btrim(v_item ->> 'description'), v_assignee, v_actor, 'todo',
        v_item ->> 'priority', current_date, v_due_date, 0,
        btrim(v_item ->> 'acceptanceCriteria'), v_actor, v_actor, 1
      ) returning * into strict v_task;

      insert into public.project_activities(
        tenant_id, organization_id, project_id, user_id, actor_member_id,
        action_type, content, version
      ) values (
        v_tenant, v_org, v_project_id, v_user, v_actor,
        'task_updated', '创建任务：' || v_task.title, 1
      );
      perform public.append_audit_log(
        v_tenant, v_org, v_user, v_actor, 'task.created', 'task',
        v_task.public_id::text, request_id, null,
        jsonb_build_object(
          'batchIdempotencyKey', idempotency_key, 'batchIndex', v_index,
          'projectId', v_project_public_id, 'assigneeMemberId', v_assignee
        )
      );
      v_task_ids := v_task_ids || jsonb_build_array(v_task.public_id);
      v_tasks := v_tasks || jsonb_build_array(public.task_command_entity(v_task.id));
    end loop;
    v_result := jsonb_build_object(
      'outcome', 'success', 'resource', 'task_batch',
      'id', idempotency_key, 'version', 1,
      'taskIds', v_task_ids, 'tasks', v_tasks
    );
    return public.complete_task_command(
      v_tenant, v_org, v_user, v_actor, 'create_current_task_batch_v2',
      'task.batch_created', idempotency_key::text, request_id, idempotency_key,
      'success', null, v_result
    );
  exception when others then
    return public.complete_task_command(
      v_tenant, v_org, v_user, v_actor, 'create_current_task_batch_v2',
      'task.batch_created', idempotency_key::text, request_id, idempotency_key,
      'failure', 'command_failed', null
    );
  end;
end;
$$;

create or replace function public.transition_current_task(
  task_public_id uuid,
  command text,
  expected_version integer,
  payload jsonb,
  request_id uuid
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
  v_claim jsonb;
  v_replay boolean;
  v_project_id bigint;
  v_project_public_id uuid;
  v_access_state text;
  v_task public.tasks%rowtype;
  v_can_manage boolean := false;
  v_now timestamptz := clock_timestamp();
  v_action text;
  v_activity text;
  v_entity jsonb;
  v_result jsonb;
  v_files jsonb;
begin
  payload := coalesce(payload, '{}'::jsonb);
  if task_public_id is null or command is null
     or command not in ('claim', 'progress', 'submit', 'review', 'reopen')
     or expected_version is null or expected_version < 1
     or jsonb_typeof(payload) <> 'object' or request_id is null then
    raise exception 'Task transition input is invalid' using errcode = '22023';
  end if;
  if command = 'claim' and payload <> '{}'::jsonb then
    raise exception 'Task claim payload is invalid' using errcode = '22023';
  elsif command = 'progress' and (
    (select count(*) from jsonb_object_keys(payload)) <> 3
    or exists(select 1 from jsonb_object_keys(payload) as payload_key(key) where payload_key.key not in ('progress','blocker','nextStep'))
    or jsonb_typeof(payload -> 'progress') <> 'number'
    or (payload ->> 'progress')::numeric < 0 or (payload ->> 'progress')::numeric > 100
    or jsonb_typeof(payload -> 'blocker') <> 'string' or length(payload ->> 'blocker') > 2000
    or jsonb_typeof(payload -> 'nextStep') <> 'string' or length(payload ->> 'nextStep') > 2000
  ) then
    raise exception 'Task progress payload is invalid' using errcode = '22023';
  elsif command = 'submit' then
    if (select count(*) from jsonb_object_keys(payload)) <> 3
       or exists(select 1 from jsonb_object_keys(payload) as payload_key(key) where payload_key.key not in ('resultText','resultLink','resultFiles'))
       or jsonb_typeof(payload -> 'resultText') <> 'string'
       or length(btrim(payload ->> 'resultText')) not between 1 and 4000
       or jsonb_typeof(payload -> 'resultLink') <> 'string'
       or length(payload ->> 'resultLink') > 2000
       or ((payload ->> 'resultLink') <> '' and (payload ->> 'resultLink') !~* '^https?://')
       or jsonb_typeof(payload -> 'resultFiles') <> 'array'
       or jsonb_array_length(payload -> 'resultFiles') > 10
       or exists(
         select 1 from jsonb_array_elements(payload -> 'resultFiles') as result_file(file)
         where jsonb_typeof(result_file.file) <> 'string'
            or length(btrim(result_file.file #>> '{}')) not between 1 and 240
       )
       or ((payload ->> 'resultLink') = '' and jsonb_array_length(payload -> 'resultFiles') = 0) then
      raise exception 'Task submit payload is invalid' using errcode = '22023';
    end if;
  elsif command = 'review' and (
    (select count(*) from jsonb_object_keys(payload)) <> 2
    or exists(select 1 from jsonb_object_keys(payload) as payload_key(key) where payload_key.key not in ('decision','note'))
    or jsonb_typeof(payload -> 'decision') <> 'string'
    or (payload ->> 'decision') not in ('pass','reject')
    or jsonb_typeof(payload -> 'note') <> 'string' or length(payload ->> 'note') > 2000
    or ((payload ->> 'decision') = 'reject' and nullif(btrim(payload ->> 'note'), '') is null)
  ) then
    raise exception 'Task review payload is invalid' using errcode = '22023';
  elsif command = 'reopen' and (
    (select count(*) from jsonb_object_keys(payload)) <> 1
    or exists(select 1 from jsonb_object_keys(payload) as payload_key(key) where payload_key.key <> 'note')
    or jsonb_typeof(payload -> 'note') <> 'string' or length(payload ->> 'note') > 2000
  ) then
    raise exception 'Task reopen payload is invalid' using errcode = '22023';
  end if;

  select * into strict v_tenant, v_org, v_actor, v_user, v_actor_employee
  from public.current_project_execution_identity();
  v_claim := public.claim_task_command(
    v_tenant, v_org, v_actor, 'transition_current_task', task_public_id,
    jsonb_build_object('command', command, 'expectedVersion', expected_version, 'payload', payload),
    request_id, request_id
  );
  if v_claim ->> 'state' = 'scope_conflict' then
    return public.audit_task_command_denied(
      v_tenant, v_org, v_user, v_actor, 'transition_current_task',
      task_public_id::text, request_id, request_id, 'scope_conflict', false
    );
  end if;
  v_replay := v_claim ->> 'state' = 'replay';

  select project.public_id into v_project_public_id
  from public.tasks task
  join public.projects project
    on project.tenant_id = task.tenant_id
   and project.organization_id = task.organization_id
   and project.id = task.project_id
  where task.tenant_id = v_tenant and task.organization_id = v_org
    and task.public_id = task_public_id and task.deleted_at is null
    and project.deleted_at is null;
  if not found then
    if v_replay then
      return public.audit_task_command_denied(
        v_tenant, v_org, v_user, v_actor, 'transition_current_task',
        task_public_id::text, request_id, request_id, 'not_found', true
      );
    end if;
    return public.complete_task_command(
      v_tenant, v_org, v_user, v_actor, 'transition_current_task',
      'task.command_failed', task_public_id::text, request_id, request_id,
      'failure', 'not_found', null
    );
  end if;

  select access.project_id, access.access_state into strict v_project_id, v_access_state
  from public.lock_current_project_execution_access(
    v_tenant, v_org, v_actor, v_project_public_id, 'contribute'
  ) access;
  if v_access_state <> 'allowed' then
    if v_replay then
      return public.audit_task_command_denied(
        v_tenant, v_org, v_user, v_actor, 'transition_current_task',
        task_public_id::text, request_id, request_id, v_access_state, true
      );
    end if;
    return public.complete_task_command(
      v_tenant, v_org, v_user, v_actor, 'transition_current_task',
      'task.command_failed', task_public_id::text, request_id, request_id,
      'failure', v_access_state, null
    );
  end if;

  select * into v_task from public.tasks task
  where task.tenant_id = v_tenant and task.organization_id = v_org
    and task.project_id = v_project_id and task.public_id = task_public_id
    and task.deleted_at is null
  for update;
  if not found then
    return public.complete_task_command(
      v_tenant, v_org, v_user, v_actor, 'transition_current_task',
      'task.command_failed', task_public_id::text, request_id, request_id,
      'failure', 'not_found', null
    );
  end if;

  if command in ('claim','progress','submit') then
    if v_task.assignee_member_id is distinct from v_actor then
      if v_replay then
        return public.audit_task_command_denied(
          v_tenant, v_org, v_user, v_actor, 'transition_current_task',
          task_public_id::text, request_id, request_id, 'forbidden', true
        );
      end if;
      return public.complete_task_command(
        v_tenant, v_org, v_user, v_actor, 'transition_current_task',
        'task.command_failed', task_public_id::text, request_id, request_id,
        'failure', 'forbidden', null
      );
    end if;
  else
    v_can_manage := v_task.reporter_member_id = v_actor;
    if not v_can_manage then
      select access.access_state = 'allowed' into strict v_can_manage
      from public.lock_current_project_execution_access(
        v_tenant, v_org, v_actor, v_project_public_id, 'manage'
      ) access;
    end if;
    if not v_can_manage then
      if v_replay then
        return public.audit_task_command_denied(
          v_tenant, v_org, v_user, v_actor, 'transition_current_task',
          task_public_id::text, request_id, request_id, 'forbidden', true
        );
      end if;
      return public.complete_task_command(
        v_tenant, v_org, v_user, v_actor, 'transition_current_task',
        'task.command_failed', task_public_id::text, request_id, request_id,
        'failure', 'forbidden', null
      );
    end if;
  end if;
  if v_replay then return v_claim -> 'result'; end if;
  if v_task.version <> expected_version then
    return public.complete_task_command(
      v_tenant, v_org, v_user, v_actor, 'transition_current_task',
      'task.command_failed', task_public_id::text, request_id, request_id,
      'failure', 'version_conflict', null
    );
  end if;

  if (command = 'claim' and v_task.status not in ('backlog','todo'))
     or (command in ('progress','submit') and v_task.status <> 'in_progress')
     or (command = 'review' and v_task.status <> 'in_review')
     or (command = 'reopen' and v_task.status <> 'done') then
    return public.complete_task_command(
      v_tenant, v_org, v_user, v_actor, 'transition_current_task',
      'task.command_failed', task_public_id::text, request_id, request_id,
      'failure', 'invalid_transition', null
    );
  end if;

  begin
    if command = 'claim' then
      update public.tasks task set
        status = 'in_progress', accepted_at = v_now,
        updated_by_member_id = v_actor, version = task.version + 1, updated_at = v_now
      where task.id = v_task.id returning * into strict v_task;
      v_action := 'task.claimed'; v_activity := '领取任务';
    elsif command = 'progress' then
      update public.tasks task set
        progress = (payload ->> 'progress')::numeric,
        blocker = nullif(btrim(payload ->> 'blocker'), ''),
        next_step = btrim(payload ->> 'nextStep'),
        updated_by_member_id = v_actor, version = task.version + 1, updated_at = v_now
      where task.id = v_task.id returning * into strict v_task;
      v_action := 'task.progress_updated'; v_activity := '更新任务进度';
    elsif command = 'submit' then
      select coalesce(jsonb_agg(to_jsonb(btrim(result_file.file #>> '{}'))), '[]'::jsonb)
        into v_files
      from jsonb_array_elements(payload -> 'resultFiles') as result_file(file);
      update public.tasks task set
        status = 'in_review', result_summary = btrim(payload ->> 'resultText'),
        result_link = btrim(payload ->> 'resultLink'), result_files = v_files,
        submitted_at = v_now, updated_by_member_id = v_actor,
        version = task.version + 1, updated_at = v_now
      where task.id = v_task.id returning * into strict v_task;
      v_action := 'task.submitted'; v_activity := '提交任务验收';
    elsif command = 'review' then
      update public.tasks task set
        status = case when payload ->> 'decision' = 'pass' then 'done' else 'in_progress' end,
        progress = case when payload ->> 'decision' = 'pass' then 100 else task.progress end,
        review_note = btrim(payload ->> 'note'), reviewed_at = v_now,
        completed_at = case when payload ->> 'decision' = 'pass' then v_now else null end,
        updated_by_member_id = v_actor, version = task.version + 1, updated_at = v_now
      where task.id = v_task.id returning * into strict v_task;
      v_action := 'task.reviewed';
      v_activity := case when payload ->> 'decision' = 'pass' then '任务验收通过' else '任务驳回修改' end;
    else
      update public.tasks task set
        status = 'in_progress', progress = least(95, task.progress),
        review_note = btrim(payload ->> 'note'), reviewed_at = v_now,
        completed_at = null, updated_by_member_id = v_actor,
        version = task.version + 1, updated_at = v_now
      where task.id = v_task.id returning * into strict v_task;
      v_action := 'task.reopened'; v_activity := '重新打开任务';
    end if;

    insert into public.project_activities(
      tenant_id, organization_id, project_id, user_id, actor_member_id,
      action_type, content, version
    ) values (
      v_tenant, v_org, v_project_id, v_user, v_actor,
      'task_updated', v_activity || '：' || v_task.title, 1
    );
    v_entity := public.task_command_entity(v_task.id);
    v_result := jsonb_build_object(
      'outcome', 'success', 'resource', 'task', 'id', v_task.public_id,
      'version', v_task.version, 'entity', v_entity
    );
    return public.complete_task_command(
      v_tenant, v_org, v_user, v_actor, 'transition_current_task',
      v_action, v_task.public_id::text, request_id, request_id,
      'success', null, v_result
    );
  exception when others then
    return public.complete_task_command(
      v_tenant, v_org, v_user, v_actor, 'transition_current_task',
      'task.command_failed', task_public_id::text, request_id, request_id,
      'failure', 'command_failed', null
    );
  end;
end;
$$;

revoke all on table public.task_command_idempotency
  from public, anon, authenticated, service_role;
revoke insert, update, delete, truncate, references, trigger on table public.tasks
  from public, anon, authenticated, service_role;
grant select on table public.tasks to authenticated;

revoke all on function public.enforce_task_member_execution_fields()
  from public, anon, authenticated, service_role;
revoke all on function public.claim_task_command(bigint,bigint,bigint,text,uuid,jsonb,uuid,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_task_command(bigint,bigint,uuid,bigint,text,text,text,uuid,uuid,text,text,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.audit_task_command_denied(bigint,bigint,uuid,bigint,text,text,uuid,uuid,text,boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.task_command_entity(bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.create_current_project_task_v2(uuid,text,text,bigint,date,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.create_current_project_task(uuid,text,text,bigint,date,text)
  from public, anon, authenticated, service_role;
revoke all on function public.create_current_task_batch_v2(jsonb,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.create_current_task_batch_v2(jsonb,uuid,uuid)
  to authenticated;
revoke all on function public.transition_current_task(uuid,text,integer,jsonb,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.transition_current_task(uuid,text,integer,jsonb,uuid)
  to authenticated;
