-- Forward-only commercial closure for project membership, acceptance history,
-- archive/restore, and recipient notification state. This migration builds on
-- the exact-identity and durable delivery contracts in 202608270005-010.

alter table public.audit_logs drop constraint if exists audit_logs_action_check;
alter table public.audit_logs add constraint audit_logs_action_check check (action in (
  'identity.provisioned', 'identity.claimed', 'identity.revoked', 'member.status_changed',
  'member.role_changed', 'profile.updated', 'roster.imported', 'tenant.bootstrap_owner',
  'enterprise.initialized', 'directory.sync_started', 'directory.sync_completed',
  'directory.sync_failed', 'directory.role_mapped', 'project.created', 'project.updated',
  'project.archived', 'project.restored', 'project.member_added',
  'project.member_role_changed', 'project.member_removed', 'project.command_failed',
  'project.milestone_created', 'project.risk_created', 'project.activity_recorded',
  'project.report_submitted', 'project.execution_failed', 'task.created',
  'task.batch_created', 'task.claimed', 'task.progress_updated', 'task.submitted',
  'task.reviewed', 'task.reopened', 'task.acceptance_recorded',
  'task.command_failed', 'task.comment_created', 'task.dependency_created',
  'notification.read', 'notification.retried',
  'file.upload_reserved', 'file.upload_completed', 'file.upload_failed',
  'file.upload_expired', 'file.download_authorized',
  'payroll_policy.activated', 'payroll.calculated', 'payroll.confirmed',
  'ai.config.updated', 'organization.department_created',
  'organization.department_updated', 'organization.position_upserted',
  'organization.role_assigned', 'organization.command_failed',
  'organization.manager_assigned', 'directory.manager_mapped',
  'employee_skill.verified', 'employee_skill.verification_failed',
  'directory.sync_issue_resolved'
));

alter table public.project_execution_command_idempotency
  drop constraint if exists project_execution_command_idempotency_operation_check;
alter table public.project_execution_command_idempotency
  add constraint project_execution_command_idempotency_operation_check check (operation in (
    'create_current_project_milestone', 'create_current_project_risk',
    'record_current_project_activity', 'submit_current_project_report',
    'create_current_task_comment', 'create_current_task_dependency',
    'mutate_current_project_member', 'archive_current_project_v2', 'restore_current_project',
    'retry_current_task_notification'
  ));

alter table public.task_command_idempotency
  drop constraint if exists task_command_idempotency_operation_check;
alter table public.task_command_idempotency
  add constraint task_command_idempotency_operation_check check (operation in (
    'create_current_task_batch_v2', 'create_current_task_batch_v3', 'transition_current_task'
  ));

alter table public.project_activities
  drop constraint if exists project_activities_action_type_check;
alter table public.project_activities
  add constraint project_activities_action_type_check check (action_type in (
    'project_created', 'project_updated', 'project_note_added', 'member_added',
    'member_role_changed', 'member_removed', 'project_archived', 'project_restored',
    'milestone_updated', 'task_updated', 'file_uploaded',
    'daily_report_submitted', 'risk_updated'
  ));

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
    case when p_operation in ('create_current_task_batch_v2','create_current_task_batch_v3')
      then 'task_batch' else 'task' end,
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
    case when p_operation in ('create_current_task_batch_v2','create_current_task_batch_v3')
      then 'task_batch' else 'task' end,
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

alter table public.projects
  add column archived_from_status text;
alter table public.projects
  add constraint projects_archived_from_status_check check (
    archived_from_status is null
    or archived_from_status in ('planning', 'active', 'on_hold', 'completed', 'cancelled')
  );
alter table public.projects
  add constraint projects_archive_pair_check check (
    (archived_at is null and deleted_at is null and archived_from_status is null)
    or (archived_at is not null and deleted_at is not null)
  );

alter table public.task_notifications
  add column version bigint not null default 1,
  add column read_at timestamptz,
  add column read_by_member_id bigint,
  add column next_retry_at timestamptz,
  add column updated_at timestamptz not null default clock_timestamp(),
  add column event_public_id uuid not null default gen_random_uuid(),
  add column acceptance_event_id bigint,
  add column actor_name_snapshot text,
  add column event_key text;

update public.task_notifications notification
set event_key = task.public_id::text || ':' || notification.event_type || ':1'
from public.tasks task
where task.id = notification.task_id;

update public.task_notifications notification
set actor_name_snapshot = profile.display_name
from public.tasks task
join public.employee_profiles profile
  on profile.tenant_id=task.tenant_id
 and profile.organization_id=task.organization_id
 and profile.organization_member_id=task.reporter_member_id
where task.id=notification.task_id
  and notification.event_type='task.assigned';

alter table public.task_notifications
  alter column event_key set not null,
  add constraint task_notifications_version_check check (version > 0),
  add constraint task_notifications_read_pair_check check (
     (read_at is null and read_by_member_id is null)
     or (read_at is not null and read_by_member_id = recipient_member_id
       and ((status = 'sent' and sent_at is not null) or status = 'failed'))
  ),
  add constraint task_notifications_reader_exact_member_fkey
    foreign key (tenant_id, read_by_member_id)
    references public.organization_members(tenant_id, id) on delete restrict;

alter table public.task_notifications drop constraint if exists task_notifications_status_check;
alter table public.task_notifications add constraint task_notifications_status_check
  check (status in ('pending', 'sending', 'sent', 'failed'));
alter table public.task_notifications drop constraint if exists task_notifications_event_type_check;
alter table public.task_notifications add constraint task_notifications_event_type_check
  check (event_type in ('task.assigned', 'task.submitted', 'task.review_passed', 'task.review_rejected', 'task.reopened'));
alter table public.task_notifications drop constraint if exists task_notifications_delivery_once_idx;
create unique index task_notifications_recipient_event_uidx
  on public.task_notifications(tenant_id, organization_id, recipient_member_id, event_key);
create unique index task_notifications_event_public_id_uidx
  on public.task_notifications(event_public_id);
create index task_notifications_due_retry_idx
  on public.task_notifications(status, next_retry_at, id)
  where status = 'failed';

alter table public.task_notifications enable row level security;
alter table public.task_notifications force row level security;
drop policy if exists task_notifications_authorized_select on public.task_notifications;
create policy task_notifications_recipient_select on public.task_notifications
for select to authenticated using (
  exists (
    select 1
    from public.external_identities identity
    join public.tenants tenant
      on tenant.id = identity.tenant_id
     and tenant.status = 'active'
    join public.organizations organization
      on organization.tenant_id = identity.tenant_id
     and organization.id = identity.organization_id
    join public.identity_providers provider
      on provider.tenant_id = identity.tenant_id
     and provider.id = identity.identity_provider_id
     and provider.status = 'active'
    join public.organization_members member
      on member.tenant_id = identity.tenant_id
     and member.organization_id = identity.organization_id
     and member.id = identity.organization_member_id
     and member.status = 'active'
    join public.employee_profiles profile
      on profile.tenant_id = member.tenant_id
     and profile.organization_id = member.organization_id
     and profile.organization_member_id = member.id
     and profile.deleted_at is null
     and profile.employment_status in ('probation', 'active', 'on_leave')
    where identity.auth_user_id = (select auth.uid())
      and identity.status = 'active'
      and identity.tenant_id = task_notifications.tenant_id
      and identity.organization_id = task_notifications.organization_id
      and identity.organization_member_id = task_notifications.recipient_member_id
  )
);
revoke insert, update, delete, truncate, references, trigger
  on public.task_notifications from public, anon, authenticated, service_role;
grant select on public.task_notifications to authenticated;
revoke all on sequence public.task_notifications_id_seq
  from public, anon, authenticated, service_role;

create table public.task_acceptance_events (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null,
  organization_id bigint not null,
  project_id bigint not null,
  task_id bigint not null,
  task_version_after bigint not null check (task_version_after > 0),
  event_type text not null check (event_type in (
    'submitted', 'review_passed', 'review_rejected', 'reopened'
  )),
  actor_member_id bigint not null,
  actor_employee_public_id_snapshot uuid not null,
  actor_name_snapshot text not null check (length(btrim(actor_name_snapshot)) >= 1),
  request_id uuid,
  result_text text,
  result_link text,
  result_files jsonb not null default '[]'::jsonb check (jsonb_typeof(result_files) = 'array'),
  decision text check (decision is null or decision in ('pass', 'reject')),
  note text,
  occurred_at timestamptz not null default clock_timestamp(),
  unique(task_id, task_version_after),
  unique(tenant_id, organization_id, id),
  unique(tenant_id, organization_id, task_id, id),
  foreign key (tenant_id, organization_id, project_id)
    references public.projects(tenant_id, organization_id, id) on delete restrict,
  foreign key (tenant_id, organization_id, project_id, task_id)
    references public.tasks(tenant_id, organization_id, project_id, id) on delete restrict,
  foreign key (tenant_id, actor_member_id)
    references public.organization_members(tenant_id, id) on delete restrict,
  foreign key (organization_id, actor_member_id)
    references public.organization_members(organization_id, id) on delete restrict
);
create index task_acceptance_events_task_time_idx
  on public.task_acceptance_events(task_id, occurred_at desc, id desc);
alter table public.task_acceptance_events enable row level security;
alter table public.task_acceptance_events force row level security;
alter table public.task_notifications
  add constraint task_notifications_acceptance_event_fkey
    foreign key (tenant_id, organization_id, task_id, acceptance_event_id)
    references public.task_acceptance_events(tenant_id, organization_id, task_id, id) on delete restrict,
  add constraint task_notifications_event_snapshot_check check (
    (event_type = 'task.assigned' and acceptance_event_id is null)
    or (event_type <> 'task.assigned' and acceptance_event_id is not null)
  );
create policy task_acceptance_events_project_select on public.task_acceptance_events
for select to authenticated using (
  (select public.can_view_project(project_id))
  and exists (
    select 1
    from public.external_identities identity
    join public.tenants tenant
      on tenant.id=identity.tenant_id
     and tenant.status='active'
    join public.organizations organization
      on organization.tenant_id=identity.tenant_id
     and organization.id=identity.organization_id
    join public.identity_providers provider
      on provider.tenant_id=identity.tenant_id
     and provider.id=identity.identity_provider_id
     and provider.status='active'
    join public.organization_members member
      on member.tenant_id=identity.tenant_id
     and member.organization_id=identity.organization_id
     and member.id=identity.organization_member_id
     and member.status='active'
    join public.employee_profiles profile
      on profile.tenant_id=member.tenant_id
     and profile.organization_id=member.organization_id
     and profile.organization_member_id=member.id
     and profile.deleted_at is null
     and profile.employment_status in ('probation','active','on_leave')
    where identity.auth_user_id=(select auth.uid())
      and identity.status='active'
      and identity.tenant_id=task_acceptance_events.tenant_id
      and identity.organization_id=task_acceptance_events.organization_id
  )
);
revoke insert, update, delete, truncate, references, trigger
  on public.task_acceptance_events from public, anon, authenticated, service_role;
grant select on public.task_acceptance_events to authenticated;
revoke all on sequence public.task_acceptance_events_id_seq
  from public, anon, authenticated, service_role;

create or replace function public.reject_task_acceptance_event_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Task acceptance history is append-only' using errcode = '42501';
end;
$$;
create trigger task_acceptance_events_append_only
before update or delete on public.task_acceptance_events
for each row execute function public.reject_task_acceptance_event_mutation();

create or replace function public.capture_task_acceptance_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_type text;
  v_decision text;
  v_actor bigint;
  v_actor_employee_public_id uuid;
  v_actor_name text;
  v_request_id uuid;
begin
  if old.status is distinct from new.status then
    if new.status = 'in_review' then
      v_event_type := 'submitted';
    elsif old.status = 'in_review' and new.status = 'done' then
      v_event_type := 'review_passed'; v_decision := 'pass';
    elsif old.status = 'in_review' and new.status = 'in_progress' then
      v_event_type := 'review_rejected'; v_decision := 'reject';
    elsif old.status = 'done' and new.status = 'in_progress' then
      v_event_type := 'reopened';
    end if;
  end if;
  if v_event_type is null then return new; end if;

  v_actor := new.updated_by_member_id;
  if v_actor is null then
    raise exception 'Task acceptance actor is unavailable' using errcode = '23502';
  end if;
  select profile.public_id,profile.display_name
    into strict v_actor_employee_public_id,v_actor_name
  from public.employee_profiles profile
  where profile.tenant_id=new.tenant_id and profile.organization_id=new.organization_id
    and profile.organization_member_id=v_actor and profile.deleted_at is null;
  select ledger.request_id into v_request_id
  from public.task_command_idempotency ledger
  where ledger.tenant_id=new.tenant_id and ledger.organization_id=new.organization_id
    and ledger.actor_member_id=v_actor and ledger.operation='transition_current_task'
    and ledger.target_public_id=new.public_id and ledger.result is null
  order by ledger.created_at desc limit 1;

  insert into public.task_acceptance_events(
    tenant_id, organization_id, project_id, task_id, task_version_after,
    event_type, actor_member_id, actor_employee_public_id_snapshot, actor_name_snapshot,
    request_id, result_text, result_link, result_files,
    decision, note
  ) values (
    new.tenant_id, new.organization_id, new.project_id, new.id, new.version,
    v_event_type, v_actor, v_actor_employee_public_id, v_actor_name,
    v_request_id, nullif(new.result_summary, ''),
    nullif(new.result_link, ''), coalesce(new.result_files, '[]'::jsonb),
    v_decision, case when v_event_type='submitted' then null else nullif(new.review_note, '') end
  );
  perform public.append_audit_log(
    new.tenant_id, new.organization_id, (select auth.uid()), v_actor,
    'task.acceptance_recorded', 'task_acceptance_event', new.public_id::text,
    v_request_id, null, jsonb_build_object(
      'taskId', new.public_id, 'taskVersion', new.version,
      'eventType', v_event_type
    )
  );
  return new;
end;
$$;
create trigger capture_task_acceptance_event
after update of status on public.tasks
for each row execute function public.capture_task_acceptance_event();

create or replace function public.enqueue_task_transition_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_type text;
  v_recipient bigint;
  v_event_key text;
  v_acceptance_event_id bigint;
  v_actor_name text;
begin
  if old.status is not distinct from new.status then return new; end if;
  if new.status = 'in_review' then
    v_event_type := 'task.submitted'; v_recipient := new.reporter_member_id;
  elsif old.status = 'in_review' and new.status = 'done' then
    v_event_type := 'task.review_passed'; v_recipient := new.assignee_member_id;
  elsif old.status = 'in_review' and new.status = 'in_progress' then
    v_event_type := 'task.review_rejected'; v_recipient := new.assignee_member_id;
  elsif old.status = 'done' and new.status = 'in_progress' then
    v_event_type := 'task.reopened'; v_recipient := new.assignee_member_id;
  end if;
  if v_event_type is null or v_recipient is null then return new; end if;
  select event.id,event.actor_name_snapshot into strict v_acceptance_event_id,v_actor_name
  from public.task_acceptance_events event
  where event.tenant_id=new.tenant_id and event.organization_id=new.organization_id
    and event.task_id=new.id and event.task_version_after=new.version;
  v_event_key := new.public_id::text || ':' || v_event_type || ':' || new.version::text;
  insert into public.task_notifications(
    tenant_id, organization_id, task_id, recipient_member_id,
    event_type, event_key, acceptance_event_id, actor_name_snapshot, status
  ) values (
    new.tenant_id, new.organization_id, new.id, v_recipient,
    v_event_type, v_event_key, v_acceptance_event_id, v_actor_name, 'pending'
  ) on conflict (tenant_id, organization_id, recipient_member_id, event_key) do nothing;
  return new;
end;
$$;
create trigger queue_task_transition_notification
after update of status on public.tasks
for each row execute function public.enqueue_task_transition_notification();

create or replace function public.capture_project_owner_transfer()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid;
  v_old_employee uuid;
  v_new_employee uuid;
begin
  if old.owner_member_id is not distinct from new.owner_member_id then return new; end if;
  select member.user_id into strict v_user
  from public.organization_members member
  where member.tenant_id=new.tenant_id and member.organization_id=new.organization_id
    and member.id=new.updated_by_member_id;
  select profile.public_id into v_old_employee from public.employee_profiles profile
  where profile.tenant_id=new.tenant_id and profile.organization_id=new.organization_id
    and profile.organization_member_id=old.owner_member_id and profile.deleted_at is null;
  select profile.public_id into strict v_new_employee from public.employee_profiles profile
  where profile.tenant_id=new.tenant_id and profile.organization_id=new.organization_id
    and profile.organization_member_id=new.owner_member_id and profile.deleted_at is null;
  insert into public.project_activities(
    tenant_id,organization_id,project_id,user_id,actor_member_id,action_type,content
  ) values(
    new.tenant_id,new.organization_id,new.id,v_user,new.updated_by_member_id,
    'member_role_changed','项目负责人已完成交接'
  );
  perform public.append_audit_log(
    new.tenant_id,new.organization_id,v_user,new.updated_by_member_id,
    'project.member_role_changed','project',new.public_id::text,null,null,
    jsonb_build_object('oldOwnerEmployeePublicId',v_old_employee,
      'newOwnerEmployeePublicId',v_new_employee,'projectVersion',new.version)
  );
  return new;
end;
$$;
create trigger capture_project_owner_transfer
after update of owner_member_id on public.projects
for each row execute function public.capture_project_owner_transfer();

create or replace function public.enqueue_task_assigned_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id bigint;
  v_event_key text;
  v_reporter_name text;
begin
  if new.assignee_member_id is null then return new; end if;
  select organization.tenant_id,profile.display_name into strict v_tenant_id,v_reporter_name
  from public.organizations organization
  join public.employee_profiles profile on profile.tenant_id=organization.tenant_id
    and profile.organization_id=organization.id
    and profile.organization_member_id=new.reporter_member_id
    and profile.deleted_at is null
  where organization.id = new.organization_id;
  v_event_key := new.public_id::text || ':task.assigned:' || new.version::text;
  insert into public.task_notifications(
    tenant_id, organization_id, task_id, recipient_member_id,
    event_type, event_key, actor_name_snapshot, status
  ) values (
    v_tenant_id, new.organization_id, new.id, new.assignee_member_id,
    'task.assigned', v_event_key, v_reporter_name, 'pending'
  ) on conflict (tenant_id, organization_id, recipient_member_id, event_key) do nothing;
  return new;
end;
$$;

create or replace function public.guard_project_archive_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.archived_at is null and new.archived_at is not null then
    if exists (
      select 1 from public.task_notification_delivery_attempts attempt
      join public.task_notifications notification on notification.id = attempt.notification_id
      join public.tasks task on task.id = notification.task_id
      where task.project_id = old.id
        and attempt.state in ('claimed', 'provider_accepted')
    ) then
      raise exception 'Project has an active notification delivery lease' using errcode = '40001';
    end if;
    new.archived_from_status := old.status;
    update public.task_notifications notification
    set status = 'failed', last_error_code = 'project_archived',
        next_retry_at = null, version = notification.version + 1,
        updated_at = clock_timestamp()
    from public.tasks task
    where task.id = notification.task_id and task.project_id = old.id
      and notification.status in ('pending', 'sending', 'failed');
  elsif old.archived_at is not null and new.archived_at is null then
    new.archived_from_status := null;
  end if;
  return new;
end;
$$;
create trigger guard_project_archive_state
before update of archived_at on public.projects
for each row execute function public.guard_project_archive_state();

create or replace function public.enforce_explicit_project_member_lifecycle()
returns trigger language plpgsql set search_path='' as $$
declare
  v_explicit boolean:=coalesce(current_setting('quantxy.explicit_project_member_mutation',true),'')='on';
  v_initial_member boolean:=false;
  v_owner_transfer boolean:=false;
begin
  if v_explicit then return new; end if;
  if tg_op='INSERT' then
    select exists(
      select 1 from public.projects project
      where project.tenant_id=new.tenant_id and project.organization_id=new.organization_id
        and project.id=new.project_id and project.version=1
        and ((new.role='owner' and new.member_id=project.owner_member_id)
          or (new.role='manager' and new.member_id=project.created_by_member_id
            and project.created_by_member_id<>project.owner_member_id))
        and not exists(
          select 1 from public.project_members membership
          where membership.tenant_id=new.tenant_id
            and membership.organization_id=new.organization_id
            and membership.project_id=new.project_id and membership.member_id=new.member_id
        )
    ) into v_initial_member;
    if v_initial_member then return new; end if;
    if new.role='owner' then
      select exists(
        select 1 from public.projects project
        where project.tenant_id=new.tenant_id and project.organization_id=new.organization_id
          and project.id=new.project_id
          and not exists(
            select 1 from public.project_members owner_membership
            where owner_membership.tenant_id=new.tenant_id
              and owner_membership.organization_id=new.organization_id
              and owner_membership.project_id=new.project_id
              and owner_membership.left_at is null and owner_membership.role='owner'
          )
      ) into v_owner_transfer;
      if v_owner_transfer then return new; end if;
    end if;
    if exists(
      select 1 from public.project_members membership
      where membership.tenant_id=new.tenant_id
        and membership.organization_id=new.organization_id
        and membership.project_id=new.project_id
        and membership.member_id=new.member_id
        and membership.left_at is null
        and membership.role in ('owner','manager','member')
    ) then
      -- Legacy task commands still issue an INSERT ... ON CONFLICT for assignees.
      -- Skip that redundant insert before conflict handling so an explicitly
      -- managed contributor remains unchanged; never create, revive or promote.
      return null;
    end if;
    raise exception 'Project membership must be changed through its lifecycle command' using errcode='42501';
  end if;
  if tg_op='UPDATE' then
    if old.role='owner' and new.role in ('manager','member') and new.left_at is null
       and exists(
         select 1 from public.projects project
         where project.tenant_id=old.tenant_id and project.organization_id=old.organization_id
           and project.id=old.project_id and project.owner_member_id=old.member_id
       ) then
      return new;
    end if;
    if old.role<>'owner' and new.role='owner' and new.left_at is null
       and not exists(
         select 1 from public.project_members owner_membership
         where owner_membership.tenant_id=new.tenant_id
           and owner_membership.organization_id=new.organization_id
           and owner_membership.project_id=new.project_id
           and owner_membership.member_id<>new.member_id
           and owner_membership.left_at is null and owner_membership.role='owner'
       ) then
      return new;
    end if;
    if old.left_at is null and new.left_at is null
       and old.role=new.role and old.allocation_percent=new.allocation_percent then
      return old;
    end if;
  end if;
  raise exception 'Project membership must be changed through its lifecycle command' using errcode='42501';
end;
$$;
create trigger project_members_explicit_lifecycle_guard
before insert or update on public.project_members
for each row execute function public.enforce_explicit_project_member_lifecycle();
create or replace function public.create_current_task_batch_v3(
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
  v_item jsonb;
  v_project_public_id uuid;
  v_project_id bigint;
  v_access_state text;
  v_assignee bigint;
  v_due_date date;
  v_assignee_missing boolean := false;
  v_membership_missing boolean := false;
  v_replay boolean := false;
  v_result jsonb;
  v_tasks jsonb := '[]'::jsonb;
  v_task_ids jsonb := '[]'::jsonb;
  v_task public.tasks%rowtype;
  v_index integer := 0;
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
       or (v_item ->> 'priority') not in ('low', 'medium', 'high', 'urgent') then
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
    v_tenant, v_org, v_actor, 'create_current_task_batch_v3', null,
    items, idempotency_key, request_id
  );
  if v_claim ->> 'state' = 'scope_conflict' then
    return public.audit_task_command_denied(
      v_tenant, v_org, v_user, v_actor, 'create_current_task_batch_v3', null,
      request_id, idempotency_key, 'scope_conflict', false
    );
  end if;
  v_replay := v_claim ->> 'state' = 'replay';

  -- Project rows are locked in canonical order before every actor/assignee row.
  perform 1
  from public.projects project
  join (
    select distinct (item.value ->> 'projectId')::uuid as public_id
    from jsonb_array_elements(items) as item(value)
  ) requested on requested.public_id = project.public_id
  where project.tenant_id = v_tenant and project.organization_id = v_org
    and project.deleted_at is null
  order by project.public_id
  for update of project;

  -- Lock every actor/assignee in one global order before access helpers re-lock
  -- the actor. Missing assignees are evaluated only after replay authorization.
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
    if not found and v_assignee <> v_actor then v_assignee_missing := true; end if;
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
          v_tenant, v_org, v_user, v_actor, 'create_current_task_batch_v3',
          v_project_public_id::text, request_id, idempotency_key, v_access_state, true
        );
      end if;
      return public.complete_task_command(
        v_tenant, v_org, v_user, v_actor, 'create_current_task_batch_v3',
        'task.batch_created', v_project_public_id::text, request_id, idempotency_key,
        'failure', v_access_state, null
      );
    end if;
  end loop;

  if v_replay then return v_claim -> 'result'; end if;

  if v_assignee_missing then
    return public.complete_task_command(
      v_tenant, v_org, v_user, v_actor, 'create_current_task_batch_v3',
      'task.batch_created', null, request_id, idempotency_key,
      'failure', 'not_found', null
    );
  end if;

  for v_item in select item.value from jsonb_array_elements(items) as item(value) loop
    v_project_public_id := (v_item ->> 'projectId')::uuid;
    v_assignee := (v_item ->> 'assigneeMemberId')::bigint;
    select project.id into strict v_project_id
    from public.projects project
    where project.tenant_id = v_tenant and project.organization_id = v_org
      and project.public_id = v_project_public_id and project.deleted_at is null;
    if not exists (
      select 1 from public.project_members membership
      where membership.tenant_id = v_tenant and membership.organization_id = v_org
        and membership.project_id = v_project_id and membership.member_id = v_assignee
        and membership.left_at is null and membership.role in ('owner','manager','member')
    ) then
      v_membership_missing := true;
    end if;
  end loop;
  if v_membership_missing then
    return public.complete_task_command(
      v_tenant, v_org, v_user, v_actor, 'create_current_task_batch_v3',
      'task.batch_created', null, request_id, idempotency_key,
      'failure', 'conflict', null
    );
  end if;

  begin
    for v_item in select item.value from jsonb_array_elements(items) as item(value) loop
      v_index:=v_index+1;
      v_project_public_id:=(v_item ->> 'projectId')::uuid;
      v_assignee:=(v_item ->> 'assigneeMemberId')::bigint;
      v_due_date:=(v_item ->> 'dueDate')::date;
      select project.id into strict v_project_id
      from public.projects project
      where project.tenant_id=v_tenant and project.organization_id=v_org
        and project.public_id=v_project_public_id and project.deleted_at is null;
      insert into public.tasks(
        tenant_id,organization_id,project_id,title,description,
        assignee_member_id,reporter_member_id,status,priority,
        start_date,due_date,progress,acceptance_criteria,
        created_by_member_id,updated_by_member_id,version
      ) values(
        v_tenant,v_org,v_project_id,btrim(v_item ->> 'title'),
        btrim(v_item ->> 'description'),v_assignee,v_actor,'todo',
        v_item ->> 'priority',current_date,v_due_date,0,
        btrim(v_item ->> 'acceptanceCriteria'),v_actor,v_actor,1
      ) returning * into strict v_task;
      insert into public.project_activities(
        tenant_id,organization_id,project_id,user_id,actor_member_id,
        action_type,content,version
      ) values(
        v_tenant,v_org,v_project_id,v_user,v_actor,
        'task_updated','创建任务：' || v_task.title,1
      );
      perform public.append_audit_log(
        v_tenant,v_org,v_user,v_actor,'task.created','task',v_task.public_id::text,
        request_id,null,jsonb_build_object(
          'batchIdempotencyKey',idempotency_key,'batchIndex',v_index,
          'projectId',v_project_public_id,'assigneeMemberId',v_assignee,
          'priority',v_task.priority
        )
      );
      v_task_ids:=v_task_ids || jsonb_build_array(v_task.public_id);
      v_tasks:=v_tasks || jsonb_build_array(public.task_command_entity(v_task.id));
    end loop;
    v_result:=jsonb_build_object(
      'outcome','success','resource','task_batch','id',idempotency_key,
      'version',1,'taskIds',v_task_ids,'tasks',v_tasks
    );
    return public.complete_task_command(
      v_tenant,v_org,v_user,v_actor,'create_current_task_batch_v3',
      'task.batch_created',idempotency_key::text,request_id,idempotency_key,
      'success',null,v_result
    );
  exception when others then
    return public.complete_task_command(
      v_tenant, v_org, v_user, v_actor, 'create_current_task_batch_v3',
      'task.batch_created', idempotency_key::text, request_id, idempotency_key,
      'failure', 'command_failed', null
    );
  end;
end;
$$;

create or replace function public.enforce_task_acceptance_file_references()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_expected integer;v_verified integer;
begin
  if old.status is distinct from new.status and new.status='in_review' then
    v_expected:=jsonb_array_length(coalesce(new.result_files,'[]'::jsonb));
    if exists(
      select 1 from jsonb_array_elements_text(coalesce(new.result_files,'[]'::jsonb)) value
      where value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    ) then
      raise exception 'Task evidence file reference is invalid' using errcode='23514';
    end if;
    select count(distinct file.id) into v_verified
    from jsonb_array_elements_text(coalesce(new.result_files,'[]'::jsonb)) value
    join public.files file on file.tenant_id=new.tenant_id
      and file.organization_id=new.organization_id and file.project_id=new.project_id
      and file.public_id=value::uuid and file.deleted_at is null and file.verified_at is not null
    join public.file_relations relation on relation.tenant_id=file.tenant_id
      and relation.organization_id=file.organization_id and relation.project_id=new.project_id
      and relation.file_id=file.id and relation.relation_type='project';
    if v_verified<>v_expected then
      raise exception 'Task evidence file is not a verified project file' using errcode='23514';
    end if;
  end if;
  return new;
end;
$$;
create trigger enforce_task_acceptance_file_references
before update of status,result_files on public.tasks
for each row execute function public.enforce_task_acceptance_file_references();
comment on column public.tasks.result_files is 'Public UUIDs of verified project files attached as acceptance evidence.';

create or replace function public.mutate_current_project_member(
  p_project_public_id uuid,
  p_employee_public_id uuid,
  p_command text,
  p_role text,
  p_allocation_percent numeric,
  p_expected_project_version bigint,
  p_expected_membership_version bigint,
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
  v_tenant bigint; v_org bigint; v_actor bigint; v_user uuid; v_actor_employee uuid;
  v_access record; v_claim jsonb; v_project public.projects%rowtype;
  v_target bigint; v_target_name text; v_membership public.project_members%rowtype;
  v_locked_member bigint; v_lock_count integer := 0;
  v_entity jsonb; v_activity text; v_action text; v_now timestamptz := clock_timestamp();
begin
  select * into v_tenant, v_org, v_actor, v_user, v_actor_employee
  from public.current_project_execution_identity();
  if p_project_public_id is null or p_employee_public_id is null
     or p_command is null or p_command not in ('add', 'change_role', 'remove')
     or (p_command <> 'remove' and (p_role is null or p_role not in ('manager', 'member', 'viewer')))
     or p_allocation_percent is null or p_allocation_percent < 0 or p_allocation_percent > 100
     or p_allocation_percent <> trunc(p_allocation_percent, 2)
     or p_expected_project_version is null or p_expected_project_version < 1
     or p_expected_membership_version is null or p_expected_membership_version < 0
     or p_reason is null or length(btrim(p_reason)) not between 1 and 500
     or request_id is null or idempotency_key is null or request_id = idempotency_key then
    raise exception 'Project member command is invalid' using errcode = '22023';
  end if;
  v_claim := public.claim_project_execution_command(
    v_tenant, v_org, v_actor, 'mutate_current_project_member', p_project_public_id,
    jsonb_build_object('employeePublicId', p_employee_public_id, 'command', p_command,
      'role', p_role, 'allocationPercent', p_allocation_percent,
      'projectVersion', p_expected_project_version,
      'membershipVersion', p_expected_membership_version, 'reason', btrim(p_reason)),
    idempotency_key, request_id
  );
  if v_claim ->> 'state' = 'replay' then
    select * into strict v_access from public.lock_current_project_execution_access(
      v_tenant,v_org,v_actor,p_project_public_id,'manage');
    if v_access.access_state='allowed' then return v_claim -> 'result'; end if;
    return public.audit_project_execution_replay_denied(
      v_tenant,v_org,v_user,v_actor,'mutate_current_project_member','project_member',
      p_project_public_id::text,request_id,idempotency_key,p_reason,v_access.access_state);
  end if;
  if v_claim ->> 'state' <> 'claimed' then
    return public.audit_project_execution_scope_conflict(
      v_tenant,v_org,v_user,v_actor,'mutate_current_project_member','project_member',
      p_project_public_id::text,request_id,idempotency_key,p_reason);
  end if;
  v_action := case p_command when 'add' then 'project.member_added'
    when 'change_role' then 'project.member_role_changed' else 'project.member_removed' end;
  begin
  select profile.organization_member_id, profile.display_name into v_target, v_target_name
  from public.employee_profiles profile
  join public.organization_members member
    on member.tenant_id = profile.tenant_id and member.organization_id = profile.organization_id
   and member.id = profile.organization_member_id
  where profile.tenant_id = v_tenant and profile.organization_id = v_org
    and profile.public_id = p_employee_public_id
    and (p_command='remove' or (
      member.status='active' and profile.deleted_at is null
      and profile.employment_status in ('probation','active','on_leave')
    ));
  if not found then
    return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,
      'mutate_current_project_member','project_member',v_action,
      p_project_public_id::text,request_id,idempotency_key,p_reason,
      'failure','not_found',null);
  end if;
  select * into v_project from public.projects project
  where project.tenant_id=v_tenant and project.organization_id=v_org
    and project.public_id=p_project_public_id and project.deleted_at is null
  for update;
  if not found then
    return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,
      'mutate_current_project_member','project_member',v_action,
      p_project_public_id::text,request_id,idempotency_key,p_reason,
      'failure','not_found',null);
  end if;
  for v_locked_member in
    select member.id
    from public.organization_members member
    join public.employee_profiles profile
      on profile.tenant_id=member.tenant_id and profile.organization_id=member.organization_id
     and profile.organization_member_id=member.id
    where member.tenant_id=v_tenant and member.organization_id=v_org
      and member.id in (v_actor,v_target)
      and (
        (member.id=v_actor and member.status='active' and profile.deleted_at is null
          and profile.employment_status in ('probation','active','on_leave'))
        or (member.id=v_target and p_command='remove')
        or (member.id=v_target and member.status='active' and profile.deleted_at is null
          and profile.employment_status in ('probation','active','on_leave'))
      )
    order by member.id
    for update of member,profile
  loop
    v_lock_count:=v_lock_count+1;
  end loop;
  if v_lock_count <> case when v_actor=v_target then 1 else 2 end then
    return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,
      'mutate_current_project_member','project_member',v_action,
      p_project_public_id::text,request_id,idempotency_key,p_reason,
      'failure','forbidden',null);
  end if;
  if not (v_project.owner_member_id=v_actor or exists(
    select 1 from public.project_members membership
    where membership.tenant_id=v_tenant and membership.organization_id=v_org
      and membership.project_id=v_project.id and membership.member_id=v_actor
      and membership.left_at is null and membership.role in ('owner','manager')
  ) or exists(
    select 1 from public.member_roles assignment
    join public.roles role on role.tenant_id=assignment.tenant_id and role.id=assignment.role_id
    where assignment.tenant_id=v_tenant and assignment.member_id=v_actor
      and role.is_enabled and role.code='admin'
      and (role.organization_id is null or role.organization_id=v_org)
  )) then
    return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,
      'mutate_current_project_member','project_member',v_action,
      p_project_public_id::text,request_id,idempotency_key,p_reason,
      'failure','forbidden',null);
  end if;
  if v_project.version <> p_expected_project_version then
    return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,
      'mutate_current_project_member','project_member',v_action,
      p_project_public_id::text,request_id,idempotency_key,p_reason,
      'failure','stale_version',null);
  end if;
  select * into v_membership from public.project_members membership
  where membership.tenant_id = v_tenant and membership.organization_id = v_org
    and membership.project_id = v_project.id and membership.member_id = v_target
  for update;
  if v_target = v_project.owner_member_id
     or (found and v_membership.role = 'owner') then
    return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,
      'mutate_current_project_member','project_member','project.member_role_changed',
      p_project_public_id::text,request_id,idempotency_key,p_reason,
      'failure','conflict',null);
  end if;
  if p_command = 'add' then
    if found and v_membership.left_at is null then
      return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,
        'mutate_current_project_member','project_member','project.member_added',
        v_membership.public_id::text,request_id,idempotency_key,p_reason,
        'failure','conflict',null);
    end if;
    if (found and p_expected_membership_version not in (0,v_membership.version))
       or (not found and p_expected_membership_version <> 0) then
      return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,
        'mutate_current_project_member','project_member','project.member_added',
        coalesce(v_membership.public_id,p_project_public_id)::text,request_id,idempotency_key,p_reason,
        'failure','stale_version',null);
    end if;
    perform set_config('quantxy.explicit_project_member_mutation','on',true);
    insert into public.project_members as membership(
      tenant_id, organization_id, project_id, member_id, role, allocation_percent,
      created_by_member_id, updated_by_member_id, version, left_at, joined_at
    ) values (v_tenant,v_org,v_project.id,v_target,p_role,p_allocation_percent,
      v_actor,v_actor,1,null,v_now)
    on conflict(project_id,member_id) do update set
      role = excluded.role, allocation_percent = excluded.allocation_percent,
      left_at = null, joined_at = v_now, updated_by_member_id = v_actor,
      version = membership.version + 1, updated_at = v_now
    returning * into strict v_membership;
    perform set_config('quantxy.explicit_project_member_mutation','off',true);
    v_activity := v_target_name || ' 已加入项目'; v_action := 'project.member_added';
  elsif p_command = 'change_role' then
    if not found or v_membership.left_at is not null then
      return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,
        'mutate_current_project_member','project_member','project.member_role_changed',
        p_project_public_id::text,request_id,idempotency_key,p_reason,
        'failure','not_found',null);
    end if;
    if v_membership.version <> p_expected_membership_version then
      return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,
        'mutate_current_project_member','project_member','project.member_role_changed',
        v_membership.public_id::text,request_id,idempotency_key,p_reason,
        'failure','stale_version',null);
    end if;
    if p_role='viewer' and (
      exists(select 1 from public.tasks task where task.tenant_id=v_tenant
        and task.organization_id=v_org and task.project_id=v_project.id
        and task.assignee_member_id=v_target and task.deleted_at is null
        and task.status in ('backlog','todo','in_progress','blocked','in_review'))
      or exists(select 1 from public.milestones milestone where milestone.tenant_id=v_tenant
        and milestone.organization_id=v_org and milestone.project_id=v_project.id
        and milestone.owner_member_id=v_target and milestone.deleted_at is null
        and milestone.status <> 'completed')
      or exists(select 1 from public.project_risks risk where risk.tenant_id=v_tenant
        and risk.organization_id=v_org and risk.project_id=v_project.id
        and risk.owner_member_id=v_target and risk.deleted_at is null
        and risk.status not in ('mitigated','closed'))
      or exists(select 1 from public.task_notification_delivery_attempts attempt
        join public.task_notifications notification on notification.id=attempt.notification_id
        join public.tasks task on task.id=notification.task_id
        where task.project_id=v_project.id and notification.recipient_member_id=v_target
          and attempt.state in ('claimed','provider_accepted'))
    ) then
      return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,
        'mutate_current_project_member','project_member','project.member_role_changed',
        v_membership.public_id::text,request_id,idempotency_key,p_reason,
        'failure','conflict',null);
    end if;
    perform set_config('quantxy.explicit_project_member_mutation','on',true);
    update public.project_members membership set role=p_role,
      allocation_percent=p_allocation_percent, updated_by_member_id=v_actor,
      version=membership.version+1, updated_at=v_now
    where membership.id=v_membership.id returning * into strict v_membership;
    perform set_config('quantxy.explicit_project_member_mutation','off',true);
    if p_role='viewer' then
      update public.task_notifications notification set status='failed',
        last_error_code='recipient_read_only',next_retry_at=null,
        version=notification.version+1,updated_at=v_now
      from public.tasks task where task.id=notification.task_id
        and task.project_id=v_project.id and notification.recipient_member_id=v_target
        and notification.status in ('pending','sending','failed');
    end if;
    v_activity := v_target_name || ' 的项目角色已调整'; v_action := 'project.member_role_changed';
  else
    if not found or v_membership.left_at is not null then
      return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,
        'mutate_current_project_member','project_member','project.member_removed',
        p_project_public_id::text,request_id,idempotency_key,p_reason,
        'failure','not_found',null);
    end if;
    if v_membership.version <> p_expected_membership_version then
      return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,
        'mutate_current_project_member','project_member','project.member_removed',
        v_membership.public_id::text,request_id,idempotency_key,p_reason,
        'failure','stale_version',null);
    end if;
    if exists(select 1 from public.tasks task where task.tenant_id=v_tenant
      and task.organization_id=v_org and task.project_id=v_project.id
      and task.assignee_member_id=v_target and task.deleted_at is null
      and task.status in ('backlog','todo','in_progress','blocked','in_review'))
      or exists(select 1 from public.milestones milestone where milestone.tenant_id=v_tenant
      and milestone.organization_id=v_org and milestone.project_id=v_project.id
      and milestone.owner_member_id=v_target and milestone.deleted_at is null
      and milestone.status <> 'completed')
      or exists(select 1 from public.project_risks risk where risk.tenant_id=v_tenant
      and risk.organization_id=v_org and risk.project_id=v_project.id
      and risk.owner_member_id=v_target and risk.deleted_at is null
      and risk.status not in ('mitigated','closed'))
      or exists(select 1 from public.task_notification_delivery_attempts attempt
      join public.task_notifications notification on notification.id=attempt.notification_id
      join public.tasks task on task.id=notification.task_id
      where task.project_id=v_project.id and notification.recipient_member_id=v_target
      and attempt.state in ('claimed','provider_accepted')) then
      return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,
        'mutate_current_project_member','project_member','project.member_removed',
        v_membership.public_id::text,request_id,idempotency_key,p_reason,
        'failure','conflict',null);
    end if;
    perform set_config('quantxy.explicit_project_member_mutation','on',true);
    update public.project_members membership set left_at=v_now,
      updated_by_member_id=v_actor, version=membership.version+1, updated_at=v_now
    where membership.id=v_membership.id returning * into strict v_membership;
    perform set_config('quantxy.explicit_project_member_mutation','off',true);
    update public.task_notifications notification set status='failed',
      last_error_code='recipient_removed',next_retry_at=null,
      version=notification.version+1,updated_at=v_now
    from public.tasks task where task.id=notification.task_id
      and task.project_id=v_project.id and notification.recipient_member_id=v_target
      and notification.status in ('pending','sending','failed');
    v_activity := v_target_name || ' 已退出项目'; v_action := 'project.member_removed';
  end if;
  update public.projects project set version=project.version+1,
    updated_by_member_id=v_actor,updated_at=v_now where project.id=v_project.id
    returning * into strict v_project;
  insert into public.project_activities(
    tenant_id,organization_id,project_id,user_id,actor_member_id,action_type,content
  ) values(v_tenant,v_org,v_project.id,v_user,v_actor,
    case p_command when 'add' then 'member_added' when 'change_role' then 'member_role_changed' else 'member_removed' end,
    v_activity);
  v_entity := jsonb_build_object(
    'id',v_membership.public_id,'projectId',v_project.public_id,
    'employeePublicId',p_employee_public_id,'role',v_membership.role,
    'allocationPercent',v_membership.allocation_percent,
    'version',v_membership.version,'projectVersion',v_project.version,
    'leftAt',v_membership.left_at
  );
  return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,
    'mutate_current_project_member','project_member',v_action,
    v_membership.public_id::text,request_id,idempotency_key,p_reason,
    'success',null,v_entity);
  exception when others then
    return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,
      'mutate_current_project_member','project_member',v_action,
      coalesce(v_membership.public_id,p_project_public_id)::text,
      request_id,idempotency_key,p_reason,'failure','command_failed',null);
  end;
end;
$$;

create or replace function public.archive_current_project_v2(
  p_project_public_id uuid,p_expected_version bigint,p_reason text,
  request_id uuid,idempotency_key uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_tenant bigint;v_org bigint;v_actor bigint;v_user uuid;v_employee uuid;
  v_access record;v_project public.projects%rowtype;v_claim jsonb;v_entity jsonb;
  v_failure text;v_now timestamptz:=clock_timestamp();
begin
  select * into v_tenant,v_org,v_actor,v_user,v_employee
  from public.current_project_execution_identity();
  if p_project_public_id is null or p_expected_version is null or p_expected_version<1
     or p_reason is null or length(btrim(p_reason)) not between 1 and 500
     or request_id is null or idempotency_key is null or request_id=idempotency_key then
    raise exception 'Project archive command is invalid' using errcode='22023';
  end if;
  v_claim:=public.claim_project_execution_command(v_tenant,v_org,v_actor,
    'archive_current_project_v2',p_project_public_id,
    jsonb_build_object('version',p_expected_version,'reason',btrim(p_reason)),
    idempotency_key,request_id);
  if v_claim->>'state'='replay' then
    select project.* into v_project from public.projects project
    where project.tenant_id=v_tenant and project.organization_id=v_org
      and project.public_id=p_project_public_id for update;
    if not found then
      return public.audit_project_execution_replay_denied(
        v_tenant,v_org,v_user,v_actor,'archive_current_project_v2','project',
        p_project_public_id::text,request_id,idempotency_key,p_reason,'not_found');
    end if;
    if v_project.owner_member_id=v_actor or exists(
      select 1 from public.project_members membership
      where membership.tenant_id=v_tenant and membership.organization_id=v_org
        and membership.project_id=v_project.id and membership.member_id=v_actor
        and membership.left_at is null and membership.role in ('owner','manager')
    ) or exists(
      select 1 from public.member_roles assignment
      join public.roles role on role.tenant_id=assignment.tenant_id and role.id=assignment.role_id
      where assignment.tenant_id=v_tenant and assignment.member_id=v_actor
        and role.is_enabled and role.code='admin'
        and (role.organization_id is null or role.organization_id=v_org)
    ) then
      return v_claim->'result';
    end if;
    return public.audit_project_execution_replay_denied(
      v_tenant,v_org,v_user,v_actor,'archive_current_project_v2','project',
      p_project_public_id::text,request_id,idempotency_key,p_reason,'forbidden');
  end if;
  if v_claim->>'state'<>'claimed' then
    return public.audit_project_execution_scope_conflict(
      v_tenant,v_org,v_user,v_actor,'archive_current_project_v2','project',
      p_project_public_id::text,request_id,idempotency_key,p_reason);
  end if;
  select * into strict v_access from public.lock_current_project_execution_access(
    v_tenant,v_org,v_actor,p_project_public_id,'manage');
  if v_access.access_state<>'allowed' then
    return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,
      'archive_current_project_v2','project','project.archived',p_project_public_id::text,
      request_id,idempotency_key,p_reason,'failure',v_access.access_state,null);
  end if;
  select project.* into strict v_project from public.projects project
  where project.id=v_access.project_id;
  if v_project.version<>p_expected_version then
    return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,
      'archive_current_project_v2','project','project.archived',p_project_public_id::text,
      request_id,idempotency_key,p_reason,'failure','stale_version',null);
  end if;
  begin
    update public.projects project set status='cancelled',archived_at=v_now,deleted_at=v_now,
      updated_by_member_id=v_actor,version=project.version+1,updated_at=v_now
    where project.id=v_project.id returning * into strict v_project;
    insert into public.project_activities(
      tenant_id,organization_id,project_id,user_id,actor_member_id,action_type,content
    ) values(v_tenant,v_org,v_project.id,v_user,v_actor,'project_archived','项目已归档');
  exception when serialization_failure then
    v_failure:='conflict';
  when others then
    v_failure:='command_failed';
  end;
  if v_failure is not null then
    return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,
      'archive_current_project_v2','project','project.archived',p_project_public_id::text,
      request_id,idempotency_key,p_reason,'failure',v_failure,null);
  end if;
  v_entity:=jsonb_build_object('id',v_project.public_id,'version',v_project.version,
    'status',v_project.status,'archivedAt',v_project.archived_at,
    'statusBeforeArchive',v_project.archived_from_status);
  return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,
    'archive_current_project_v2','project','project.archived',p_project_public_id::text,
    request_id,idempotency_key,p_reason,'success',null,v_entity);
end;
$$;

create or replace function public.restore_current_project(
  p_project_public_id uuid,
  p_expected_version bigint,
  p_restore_status text,
  p_reason text,
  request_id uuid,
  idempotency_key uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_tenant bigint; v_org bigint; v_actor bigint; v_user uuid; v_actor_employee uuid;
  v_project public.projects%rowtype; v_status text; v_claim jsonb; v_entity jsonb;
  v_authorized boolean;
begin
  select * into v_tenant,v_org,v_actor,v_user,v_actor_employee
  from public.current_project_execution_identity();
  if p_project_public_id is null or p_expected_version is null or p_expected_version < 1
     or p_restore_status is not null and p_restore_status not in ('planning','active','on_hold','completed')
     or p_reason is null or length(btrim(p_reason)) not between 1 and 500
     or request_id is null or idempotency_key is null or request_id=idempotency_key then
    raise exception 'Project restore command is invalid' using errcode='22023';
  end if;
  v_claim := public.claim_project_execution_command(v_tenant,v_org,v_actor,
    'restore_current_project',p_project_public_id,
    jsonb_build_object('version',p_expected_version,'restoreStatus',p_restore_status,'reason',btrim(p_reason)),
    idempotency_key,request_id);
  if v_claim->>'state'='replay' then
    select project.* into v_project from public.projects project
    where project.tenant_id=v_tenant and project.organization_id=v_org
      and project.public_id=p_project_public_id for update;
    if not found then
      return public.audit_project_execution_replay_denied(
        v_tenant,v_org,v_user,v_actor,'restore_current_project','project',
        p_project_public_id::text,request_id,idempotency_key,p_reason,'not_found');
    end if;
    v_authorized:=v_project.owner_member_id=v_actor or exists(
      select 1 from public.project_members membership where membership.tenant_id=v_tenant
      and membership.organization_id=v_org and membership.project_id=v_project.id
      and membership.member_id=v_actor and membership.left_at is null
      and membership.role in ('owner','manager')) or exists(
      select 1 from public.member_roles assignment join public.roles role
        on role.tenant_id=assignment.tenant_id and role.id=assignment.role_id
      where assignment.tenant_id=v_tenant and assignment.member_id=v_actor
        and role.is_enabled and role.code='admin'
        and (role.organization_id is null or role.organization_id=v_org));
    if v_authorized then return v_claim->'result'; end if;
    return public.audit_project_execution_replay_denied(
      v_tenant,v_org,v_user,v_actor,'restore_current_project','project',
      p_project_public_id::text,request_id,idempotency_key,p_reason,'forbidden');
  end if;
  if v_claim->>'state'<>'claimed' then
    return public.audit_project_execution_scope_conflict(
      v_tenant,v_org,v_user,v_actor,'restore_current_project','project',
      p_project_public_id::text,request_id,idempotency_key,p_reason);
  end if;
  begin
  select project.* into v_project from public.projects project
  where project.tenant_id=v_tenant and project.organization_id=v_org
    and project.public_id=p_project_public_id for update;
  if not found then
    return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,
      'restore_current_project','project','project.restored',p_project_public_id::text,
      request_id,idempotency_key,p_reason,'failure','not_found',null);
  end if;
  v_authorized:=v_project.owner_member_id=v_actor or exists(
    select 1 from public.project_members membership where membership.tenant_id=v_tenant
    and membership.organization_id=v_org and membership.project_id=v_project.id
    and membership.member_id=v_actor and membership.left_at is null
    and membership.role in ('owner','manager')) or exists(
    select 1 from public.member_roles assignment join public.roles role
      on role.tenant_id=assignment.tenant_id and role.id=assignment.role_id
    where assignment.tenant_id=v_tenant and assignment.member_id=v_actor
      and role.is_enabled and role.code='admin'
      and (role.organization_id is null or role.organization_id=v_org));
  if not v_authorized then
    return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,
      'restore_current_project','project','project.restored',p_project_public_id::text,
      request_id,idempotency_key,p_reason,'failure','forbidden',null);
  end if;
  if v_project.archived_at is null or v_project.deleted_at is null then
    return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,
      'restore_current_project','project','project.restored',p_project_public_id::text,
      request_id,idempotency_key,p_reason,'failure','not_found',null);
  end if;
  if v_project.version<>p_expected_version then
    return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,
      'restore_current_project','project','project.restored',p_project_public_id::text,
      request_id,idempotency_key,p_reason,'failure','stale_version',null);
  end if;
  v_status := case when v_project.archived_from_status is null
    or v_project.archived_from_status='cancelled'
    then p_restore_status else v_project.archived_from_status end;
  if v_status is null or v_status='cancelled' then
    return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,
      'restore_current_project','project','project.restored',p_project_public_id::text,
      request_id,idempotency_key,p_reason,'failure','restore_status_required',null);
  end if;
  begin
    update public.projects project set status=v_status,archived_at=null,deleted_at=null,
      archived_from_status=null,updated_by_member_id=v_actor,version=project.version+1,
      updated_at=clock_timestamp() where project.id=v_project.id returning * into strict v_project;
  exception when unique_violation then
    return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,
      'restore_current_project','project','project.restored',p_project_public_id::text,
      request_id,idempotency_key,p_reason,'failure','conflict',null);
  end;
  insert into public.project_activities(
    tenant_id,organization_id,project_id,user_id,actor_member_id,action_type,content
  ) values(v_tenant,v_org,v_project.id,v_user,v_actor,'project_restored','项目已从归档恢复');
  v_entity:=jsonb_build_object('id',v_project.public_id,'version',v_project.version,
    'status',v_project.status,'restoredAt',v_project.updated_at);
  return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,
    'restore_current_project','project','project.restored',p_project_public_id::text,
    request_id,idempotency_key,p_reason,'success',null,v_entity);
  exception when others then
    return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,
      'restore_current_project','project','project.restored',p_project_public_id::text,
      request_id,idempotency_key,p_reason,'failure','command_failed',null);
  end;
end;
$$;

create or replace function public.current_archived_projects()
returns table(project_public_id uuid, code text, name text, status_before_archive text,
  version bigint, archived_at timestamptz, owner_employee_public_id uuid, owner_name text)
language sql stable security definer set search_path='' as $$
  with viewer as (
    select distinct identity.tenant_id,identity.organization_id,identity.organization_member_id member_id
    from public.external_identities identity
    join public.tenants tenant on tenant.id=identity.tenant_id and tenant.status='active'
    join public.organizations organization on organization.tenant_id=identity.tenant_id
      and organization.id=identity.organization_id
    join public.identity_providers provider on provider.tenant_id=identity.tenant_id
      and provider.id=identity.identity_provider_id and provider.status='active'
    join public.organization_members member on member.tenant_id=identity.tenant_id
      and member.organization_id=identity.organization_id
      and member.id=identity.organization_member_id and member.status='active'
    join public.employee_profiles profile on profile.tenant_id=member.tenant_id
      and profile.organization_id=member.organization_id
      and profile.organization_member_id=member.id and profile.deleted_at is null
      and profile.employment_status in ('probation','active','on_leave')
    where identity.auth_user_id=(select auth.uid()) and identity.status='active'
  )
  select project.public_id,project.code,project.name,project.archived_from_status,
    project.version,project.archived_at,owner.public_id,
    coalesce(owner.display_name,'原负责人已离职')
  from viewer
  join public.projects project on project.tenant_id=viewer.tenant_id
    and project.organization_id=viewer.organization_id and project.archived_at is not null
    and project.deleted_at is not null
  left join public.employee_profiles owner on owner.tenant_id=project.tenant_id
    and owner.organization_id=project.organization_id
    and owner.organization_member_id=project.owner_member_id
  where project.owner_member_id=viewer.member_id or exists(
    select 1 from public.project_members membership where membership.tenant_id=viewer.tenant_id
    and membership.organization_id=viewer.organization_id and membership.project_id=project.id
    and membership.member_id=viewer.member_id and membership.left_at is null
    and membership.role in ('owner','manager')) or exists(
    select 1 from public.member_roles assignment join public.roles role
      on role.tenant_id=assignment.tenant_id and role.id=assignment.role_id
    where assignment.tenant_id=viewer.tenant_id and assignment.member_id=viewer.member_id
      and role.is_enabled and role.code='admin'
      and (role.organization_id is null or role.organization_id=viewer.organization_id))
  order by project.archived_at desc;
$$;

create or replace function public.mark_current_task_notification_read(
  p_notification_public_id uuid,
  p_request_id uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_tenant bigint; v_org bigint; v_actor bigint; v_user uuid; v_employee uuid;
  v_notification public.task_notifications%rowtype;
begin
  select * into v_tenant,v_org,v_actor,v_user,v_employee
  from public.current_project_execution_identity();
  if p_notification_public_id is null or p_request_id is null then
    raise exception 'Notification read command is invalid' using errcode='22023';
  end if;
  select notification.* into v_notification from public.task_notifications notification
  where notification.tenant_id=v_tenant and notification.organization_id=v_org
    and notification.public_id=p_notification_public_id
    and notification.recipient_member_id=v_actor for update;
  if not found then return jsonb_build_object('outcome','failure','error','not_found'); end if;
  if v_notification.status not in ('sent','failed') then
    return jsonb_build_object('outcome','failure','error','invalid_state');
  end if;
  if v_notification.read_at is null then
    update public.task_notifications notification set read_at=clock_timestamp(),
      read_by_member_id=v_actor,version=notification.version+1,updated_at=clock_timestamp()
    where notification.id=v_notification.id returning * into strict v_notification;
    perform public.append_audit_log(v_tenant,v_org,v_user,v_actor,'notification.read',
      'task_notification',v_notification.public_id::text,p_request_id,null,
      jsonb_build_object('eventPublicId',v_notification.event_public_id,
        'eventType',v_notification.event_type));
  end if;
  return jsonb_build_object('outcome','success','id',v_notification.public_id,
    'state','read','readAt',v_notification.read_at,'version',v_notification.version);
end;
$$;

create or replace function public.retry_current_task_notification(
  p_notification_public_id uuid,
  p_expected_version bigint,
  p_reason text,
  request_id uuid,
  idempotency_key uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_tenant bigint; v_org bigint; v_actor bigint; v_user uuid; v_employee uuid;
  v_notification public.task_notifications%rowtype; v_project public.projects%rowtype;
  v_project_public_id uuid;
  v_recipient_member_id bigint; v_required_access text;
  v_access record; v_claim jsonb; v_entity jsonb;
begin
  select * into v_tenant,v_org,v_actor,v_user,v_employee
  from public.current_project_execution_identity();
  if p_notification_public_id is null or p_expected_version is null or p_expected_version<1
     or p_reason is null or length(btrim(p_reason)) not between 1 and 500
     or request_id is null or idempotency_key is null or request_id=idempotency_key then
    raise exception 'Notification retry command is invalid' using errcode='22023';
  end if;
  v_claim:=public.claim_project_execution_command(v_tenant,v_org,v_actor,
    'retry_current_task_notification',p_notification_public_id,
    jsonb_build_object('version',p_expected_version,'reason',btrim(p_reason)),
    idempotency_key,request_id);
  if v_claim->>'state'='replay' then
    select project,notification into v_project,v_notification
    from public.task_notifications notification
    join public.tasks task on task.tenant_id=notification.tenant_id
      and task.organization_id=notification.organization_id and task.id=notification.task_id
    join public.projects project on project.tenant_id=task.tenant_id
      and project.organization_id=task.organization_id and project.id=task.project_id
    where notification.tenant_id=v_tenant and notification.organization_id=v_org
      and notification.public_id=p_notification_public_id
    for update of project;
    if not found then
      return public.audit_project_execution_replay_denied(
        v_tenant,v_org,v_user,v_actor,'retry_current_task_notification','task_notification',
        p_notification_public_id::text,request_id,idempotency_key,p_reason,'not_found');
    end if;
    if (v_notification.recipient_member_id=v_actor
      and v_project.deleted_at is null and v_project.archived_at is null
      and exists(select 1 from public.project_members membership
        where membership.tenant_id=v_tenant and membership.organization_id=v_org
          and membership.project_id=v_project.id and membership.member_id=v_actor
          and membership.left_at is null and membership.role in ('owner','manager','member')))
    or v_project.owner_member_id=v_actor or exists(
      select 1 from public.project_members membership
      where membership.tenant_id=v_tenant and membership.organization_id=v_org
        and membership.project_id=v_project.id and membership.member_id=v_actor
        and membership.left_at is null and membership.role in ('owner','manager')
    ) or exists(
      select 1 from public.member_roles assignment
      join public.roles role on role.tenant_id=assignment.tenant_id and role.id=assignment.role_id
      where assignment.tenant_id=v_tenant and assignment.member_id=v_actor
        and role.is_enabled and role.code='admin'
        and (role.organization_id is null or role.organization_id=v_org)
    ) then
      return v_claim->'result';
    end if;
    return public.audit_project_execution_replay_denied(
      v_tenant,v_org,v_user,v_actor,'retry_current_task_notification','task_notification',
      p_notification_public_id::text,request_id,idempotency_key,p_reason,'forbidden');
  end if;
  if v_claim->>'state'<>'claimed' then
    return public.audit_project_execution_scope_conflict(
      v_tenant,v_org,v_user,v_actor,'retry_current_task_notification','task_notification',
      p_notification_public_id::text,request_id,idempotency_key,p_reason);
  end if;
  begin
  select project.public_id,notification.recipient_member_id
    into v_project_public_id,v_recipient_member_id
  from public.task_notifications notification
  join public.tasks task on task.tenant_id=notification.tenant_id
    and task.organization_id=notification.organization_id and task.id=notification.task_id
  join public.projects project on project.tenant_id=task.tenant_id
    and project.organization_id=task.organization_id and project.id=task.project_id
  where notification.tenant_id=v_tenant and notification.organization_id=v_org
    and notification.public_id=p_notification_public_id
    and project.deleted_at is null;
  if not found then
    return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,
      'retry_current_task_notification','task_notification','notification.retried',
      p_notification_public_id::text,request_id,idempotency_key,p_reason,
      'failure','not_found',null);
  end if;
  v_required_access:=case when v_recipient_member_id=v_actor then 'contribute' else 'manage' end;
  select * into strict v_access from public.lock_current_project_execution_access(
    v_tenant,v_org,v_actor,v_project_public_id,v_required_access);
  if v_access.access_state<>'allowed' then
    return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,
      'retry_current_task_notification','task_notification','notification.retried',
      p_notification_public_id::text,request_id,idempotency_key,p_reason,
      'failure',v_access.access_state,null);
  end if;
  select notification.* into strict v_notification
  from public.task_notifications notification
  where notification.tenant_id=v_tenant and notification.organization_id=v_org
    and notification.public_id=p_notification_public_id for update;
  if not exists(
    select 1 from public.tasks task
    join public.project_members membership on membership.tenant_id=task.tenant_id
      and membership.organization_id=task.organization_id
      and membership.project_id=task.project_id
      and membership.member_id=v_notification.recipient_member_id
      and membership.left_at is null and membership.role in ('owner','manager','member')
    where task.tenant_id=v_tenant and task.organization_id=v_org
      and task.id=v_notification.task_id
  ) then
    return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,
      'retry_current_task_notification','task_notification','notification.retried',
      p_notification_public_id::text,request_id,idempotency_key,p_reason,
      'failure','conflict',null);
  end if;
  if v_notification.version<>p_expected_version then
    return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,
      'retry_current_task_notification','task_notification','notification.retried',
      p_notification_public_id::text,request_id,idempotency_key,p_reason,
      'failure','stale_version',null);
  end if;
  if v_notification.status<>'failed' or exists(
    select 1 from public.task_notification_delivery_attempts attempt
    where attempt.notification_id=v_notification.id
      and attempt.state in ('claimed','provider_accepted')
    ) then
    return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,
      'retry_current_task_notification','task_notification','notification.retried',
      p_notification_public_id::text,request_id,idempotency_key,p_reason,
      'failure','conflict',null);
  end if;
  update public.task_notifications notification set status='pending',
    last_error_code=null,next_retry_at=null,read_at=null,read_by_member_id=null,
    attempt_count=0,last_attempt_at=null,version=notification.version+1,
    updated_at=clock_timestamp() where notification.id=v_notification.id
    returning * into strict v_notification;
  v_entity:=jsonb_build_object('id',v_notification.public_id,
    'version',v_notification.version,'state',v_notification.status,
    'eventPublicId',v_notification.event_public_id,'eventType',v_notification.event_type,
    'taskId',(select task.public_id from public.tasks task where task.id=v_notification.task_id));
  return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,
    'retry_current_task_notification','task_notification','notification.retried',
    p_notification_public_id::text,request_id,idempotency_key,p_reason,
    'success',null,v_entity);
  exception when others then
    return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,
      'retry_current_task_notification','task_notification','notification.retried',
      p_notification_public_id::text,request_id,idempotency_key,p_reason,
      'failure','command_failed',null);
  end;
end;
$$;

create or replace function public.claim_task_notification_delivery_v2(
  p_tenant_public_id uuid,
  p_organization_public_id uuid,
  p_task_public_id uuid,
  p_attempt_token uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_tenant public.tenants%rowtype; v_organization public.organizations%rowtype;
  v_task public.tasks%rowtype; v_notification public.task_notifications%rowtype;
  v_attempt public.task_notification_delivery_attempts%rowtype;
  v_recipient_open_id text; v_project_name text; v_reporter_name text;
  v_lease_expires_at timestamptz:=clock_timestamp()+interval '2 minutes';
  v_new_lease_token uuid; v_is_fresh boolean:=false;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Notification delivery claim requires service role' using errcode='42501';
  end if;
  if p_tenant_public_id is null or p_organization_public_id is null
     or p_task_public_id is null or p_attempt_token is null then
    return jsonb_build_object('outcome','failure','error','invalid_request');
  end if;
  select tenant,organization,task,project.name
  into v_tenant,v_organization,v_task,v_project_name
  from public.tenants tenant
  join public.organizations organization on organization.tenant_id=tenant.id
  join public.tasks task on task.organization_id=organization.id
    and task.public_id=p_task_public_id and task.deleted_at is null
  join public.organization_members recipient on recipient.tenant_id=tenant.id
    and recipient.organization_id=organization.id and recipient.id=task.assignee_member_id
    and recipient.status='active'
  join public.employee_profiles recipient_profile on recipient_profile.tenant_id=tenant.id
    and recipient_profile.organization_id=organization.id
    and recipient_profile.organization_member_id=recipient.id
    and recipient_profile.deleted_at is null
    and recipient_profile.employment_status in ('probation','active','on_leave')
  join public.projects project on project.tenant_id=tenant.id
    and project.organization_id=organization.id and project.id=task.project_id
    and project.deleted_at is null and project.archived_at is null
  join public.project_members recipient_membership on recipient_membership.tenant_id=tenant.id
    and recipient_membership.organization_id=organization.id
    and recipient_membership.project_id=project.id
    and recipient_membership.member_id=recipient.id
    and recipient_membership.left_at is null
    and recipient_membership.role in ('owner','manager','member')
  where tenant.public_id=p_tenant_public_id and tenant.status='active'
    and organization.public_id=p_organization_public_id
  for update of project;
  if not found then return jsonb_build_object('outcome','failure','error','not_found'); end if;
  select notification.* into v_notification
  from public.task_notifications notification
  where notification.tenant_id=v_tenant.id
    and notification.organization_id=v_organization.id
    and notification.task_id=v_task.id
    and notification.recipient_member_id=v_task.assignee_member_id
    and notification.event_type='task.assigned'
  for update;
  if not found then return jsonb_build_object('outcome','failure','error','not_found'); end if;
  if v_notification.status='sent' then
    if v_notification.feishu_message_id is null then
      return jsonb_build_object('outcome','failure','error','inconsistent_state');
    end if;
    return jsonb_build_object('outcome','success','action','sent',
      'notificationId',v_notification.public_id,'messageId',v_notification.feishu_message_id);
  end if;
  if v_notification.status='failed' then
    return jsonb_build_object('outcome','failure','error','retry_required',
      'notificationId',v_notification.public_id,'nextRetryAt',v_notification.next_retry_at);
  end if;
  select case when identity.provider_subject like 'open_id:%'
      then substring(identity.provider_subject from 9) end
  into v_recipient_open_id
  from public.identity_providers provider
  join public.external_identities identity on identity.tenant_id=v_tenant.id
    and identity.organization_id=v_organization.id
    and identity.organization_member_id=v_notification.recipient_member_id
    and identity.identity_provider_id=provider.id and identity.status in ('invited','active')
  where provider.tenant_id=v_tenant.id and provider.provider_code='feishu'
    and provider.status='active'
  limit 1;
  v_reporter_name:=v_notification.actor_name_snapshot;
  if v_reporter_name is null then
    select profile.display_name into v_reporter_name
    from public.employee_profiles profile
    where profile.tenant_id=v_tenant.id and profile.organization_id=v_organization.id
      and profile.organization_member_id=v_task.reporter_member_id;
  end if;
  v_reporter_name:=coalesce(v_reporter_name,'项目发起人');
  select attempt.* into v_attempt from public.task_notification_delivery_attempts attempt
  where attempt.notification_id=v_notification.id
    and attempt.state in ('claimed','provider_accepted')
  order by attempt.id desc limit 1 for update;
  if found and v_attempt.lease_expires_at>clock_timestamp() then
    return jsonb_build_object('outcome','success','action','in_progress',
      'notificationId',v_notification.public_id,'leaseExpiresAt',v_attempt.lease_expires_at);
  end if;
  v_new_lease_token:=gen_random_uuid();
  while v_new_lease_token=p_attempt_token loop v_new_lease_token:=gen_random_uuid(); end loop;
  if found then
    while v_new_lease_token=v_attempt.lease_token loop v_new_lease_token:=gen_random_uuid(); end loop;
    update public.task_notification_delivery_attempts attempt set lease_token=v_new_lease_token,
      lease_generation=attempt.lease_generation+1,lease_expires_at=v_lease_expires_at,
      updated_at=clock_timestamp() where attempt.id=v_attempt.id returning * into strict v_attempt;
  else
    insert into public.task_notification_delivery_attempts(tenant_id,organization_id,
      notification_id,attempt_token,provider_request_id,lease_token,lease_generation,state,lease_expires_at)
    values(v_tenant.id,v_organization.id,v_notification.id,p_attempt_token,p_attempt_token,
      v_new_lease_token,1,'claimed',v_lease_expires_at) returning * into strict v_attempt;
    v_is_fresh:=true;
    update public.task_notifications notification set status='sending',
      attempt_count=notification.attempt_count+1,last_attempt_at=clock_timestamp(),
      last_error_code=null,version=notification.version+1,updated_at=clock_timestamp()
    where notification.id=v_notification.id returning * into strict v_notification;
  end if;
  if v_attempt.state='provider_accepted' then
    return jsonb_build_object('outcome','success','action','finalize',
      'notificationId',v_notification.public_id,'attemptToken',v_attempt.attempt_token,
      'providerRequestId',v_attempt.provider_request_id,'leaseToken',v_attempt.lease_token,
      'leaseGeneration',v_attempt.lease_generation,'messageId',v_attempt.provider_message_id);
  end if;
  return jsonb_build_object('outcome','success','action','send',
    'notificationId',v_notification.public_id,'attemptToken',v_attempt.attempt_token,
    'providerRequestId',v_attempt.provider_request_id,'leaseToken',v_attempt.lease_token,
    'leaseGeneration',v_attempt.lease_generation,'leaseExpiresAt',v_attempt.lease_expires_at,
    'isFresh',v_is_fresh,'taskId',v_task.public_id,'recipientOpenId',v_recipient_open_id,
    'taskTitle',v_task.title,'projectName',v_project_name,'reporterName',v_reporter_name,
    'priority',v_task.priority,'dueDate',v_task.due_date,
    'acceptanceCriteria',v_task.acceptance_criteria,'attemptCount',v_notification.attempt_count);
end;
$$;

create or replace function public.sync_task_notification_attempt_state()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.state is not distinct from new.state then return new; end if;
  if new.state='provider_accepted' then
    update public.task_notifications notification set status='sending',
      feishu_message_id=new.provider_message_id,last_error_code=null,
      version=notification.version+1,updated_at=clock_timestamp()
    where notification.id=new.notification_id;
  elsif new.state='sent' then
    update public.task_notifications notification set status='sent',
      feishu_message_id=new.provider_message_id,last_error_code=null,
      sent_at=coalesce(notification.sent_at,clock_timestamp()),next_retry_at=null,
      version=notification.version+1,updated_at=clock_timestamp()
    where notification.id=new.notification_id;
  elsif new.state='failed' then
    update public.task_notifications notification set status='failed',
      last_error_code=new.error_code,
      next_retry_at=clock_timestamp()+make_interval(secs=>least(
        3600,30*power(2,least(notification.attempt_count,7))
      )::integer),version=notification.version+1,updated_at=clock_timestamp()
    where notification.id=new.notification_id;
  end if;
  return new;
end;
$$;
create trigger sync_task_notification_attempt_state
after update of state on public.task_notification_delivery_attempts
for each row execute function public.sync_task_notification_attempt_state();

create or replace function public.pending_task_notification_events_for_delivery(
  p_tenant_public_id uuid,p_organization_public_id uuid,p_task_public_id uuid
)
returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_ids jsonb;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Notification event enumeration requires service role' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(notification.public_id order by notification.id),'[]'::jsonb) into v_ids
  from public.tenants tenant
  join public.organizations organization on organization.tenant_id=tenant.id
  join public.tasks task on task.tenant_id=tenant.id and task.organization_id=organization.id
    and task.public_id=p_task_public_id and task.deleted_at is null
  join public.projects project on project.tenant_id=tenant.id
    and project.organization_id=organization.id and project.id=task.project_id
    and project.deleted_at is null and project.archived_at is null
  join public.task_notifications notification on notification.tenant_id=tenant.id
    and notification.organization_id=organization.id and notification.task_id=task.id
  join public.organization_members recipient on recipient.tenant_id=tenant.id
    and recipient.organization_id=organization.id and recipient.id=notification.recipient_member_id
    and recipient.status='active'
  join public.employee_profiles recipient_profile on recipient_profile.tenant_id=tenant.id
    and recipient_profile.organization_id=organization.id
    and recipient_profile.organization_member_id=recipient.id
    and recipient_profile.deleted_at is null
    and recipient_profile.employment_status in ('probation','active','on_leave')
  join public.project_members recipient_membership on recipient_membership.tenant_id=tenant.id
    and recipient_membership.organization_id=organization.id
    and recipient_membership.project_id=project.id
    and recipient_membership.member_id=recipient.id
    and recipient_membership.left_at is null
    and recipient_membership.role in ('owner','manager','member')
  where tenant.public_id=p_tenant_public_id and tenant.status='active'
    and organization.public_id=p_organization_public_id
    and notification.event_type<>'task.assigned'
    and (notification.status='pending' or (
      notification.status='failed' and notification.next_retry_at<=clock_timestamp()
      and notification.attempt_count<5
    ))
  ;
  return jsonb_build_object('outcome','success','notificationIds',v_ids);
end;
$$;

create or replace function public.claim_task_notification_event_delivery_v3(
  p_tenant_public_id uuid,p_organization_public_id uuid,
  p_notification_public_id uuid,p_attempt_token uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_notification public.task_notifications%rowtype;
  v_attempt public.task_notification_delivery_attempts%rowtype;
  v_task public.tasks%rowtype; v_project public.projects%rowtype;
  v_recipient_open_id text;v_actor_name text;v_review_note text;v_lease_token uuid;
  v_lease_expires timestamptz:=clock_timestamp()+interval '2 minutes';v_fresh boolean:=false;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Notification event claim requires service role' using errcode='42501';
  end if;
  if p_notification_public_id is null or p_attempt_token is null then
    return jsonb_build_object('outcome','failure','error','invalid_request');
  end if;
  select task,project into v_task,v_project
  from public.tenants tenant
  join public.organizations organization on organization.tenant_id=tenant.id
  join public.task_notifications notification on notification.tenant_id=tenant.id
    and notification.organization_id=organization.id and notification.public_id=p_notification_public_id
  join public.organization_members recipient on recipient.tenant_id=tenant.id
    and recipient.organization_id=organization.id and recipient.id=notification.recipient_member_id
    and recipient.status='active'
  join public.employee_profiles recipient_profile on recipient_profile.tenant_id=tenant.id
    and recipient_profile.organization_id=organization.id
    and recipient_profile.organization_member_id=recipient.id
    and recipient_profile.deleted_at is null
    and recipient_profile.employment_status in ('probation','active','on_leave')
  join public.tasks task on task.tenant_id=tenant.id and task.organization_id=organization.id
    and task.id=notification.task_id and task.deleted_at is null
  join public.projects project on project.tenant_id=tenant.id
    and project.organization_id=organization.id and project.id=task.project_id
    and project.deleted_at is null and project.archived_at is null
  join public.project_members recipient_membership on recipient_membership.tenant_id=tenant.id
    and recipient_membership.organization_id=organization.id
    and recipient_membership.project_id=project.id
    and recipient_membership.member_id=recipient.id
    and recipient_membership.left_at is null
    and recipient_membership.role in ('owner','manager','member')
  where tenant.public_id=p_tenant_public_id and tenant.status='active'
    and organization.public_id=p_organization_public_id
  for update of project;
  if not found then return jsonb_build_object('outcome','failure','error','not_found'); end if;
  select notification.* into v_notification
  from public.task_notifications notification
  where notification.tenant_id=v_task.tenant_id
    and notification.organization_id=v_task.organization_id
    and notification.task_id=v_task.id
    and notification.public_id=p_notification_public_id
  for update;
  if not found then return jsonb_build_object('outcome','failure','error','not_found'); end if;
  if v_notification.status='sent' then
    if v_notification.feishu_message_id is null then
      return jsonb_build_object('outcome','failure','error','inconsistent_state');
    end if;
    return jsonb_build_object('outcome','success','action','sent','notificationId',v_notification.public_id,
      'messageId',v_notification.feishu_message_id);
  end if;
  if v_notification.status='failed' then
    if v_notification.next_retry_at is null
       or v_notification.next_retry_at>clock_timestamp()
       or v_notification.attempt_count>=5 then
      return jsonb_build_object('outcome','failure','error','retry_required');
    end if;
    update public.task_notifications notification set status='pending',next_retry_at=null,
      last_error_code=null,read_at=null,read_by_member_id=null,
      version=notification.version+1,updated_at=clock_timestamp()
    where notification.id=v_notification.id returning * into strict v_notification;
  end if;
  select case when identity.provider_subject like 'open_id:%' then substring(identity.provider_subject from 9) end
  into v_recipient_open_id
  from public.external_identities identity
  join public.identity_providers provider on provider.tenant_id=identity.tenant_id
    and provider.id=identity.identity_provider_id and provider.provider_code='feishu' and provider.status='active'
  where identity.tenant_id=v_notification.tenant_id and identity.organization_id=v_notification.organization_id
    and identity.organization_member_id=v_notification.recipient_member_id
    and identity.status in ('invited','active') limit 1;
  if v_notification.event_type='task.assigned' then
    v_actor_name:=coalesce(v_notification.actor_name_snapshot,'项目发起人');
    v_review_note:='';
  else
    select coalesce(v_notification.actor_name_snapshot,event.actor_name_snapshot),
      coalesce(event.note,event.result_text,'')
    into v_actor_name,v_review_note
    from public.task_acceptance_events event
    where event.tenant_id=v_notification.tenant_id
      and event.organization_id=v_notification.organization_id
      and event.id=v_notification.acceptance_event_id;
  end if;
  if v_actor_name is null then
    return jsonb_build_object('outcome','failure','error','inconsistent_state');
  end if;
  select attempt.* into v_attempt from public.task_notification_delivery_attempts attempt
  where attempt.notification_id=v_notification.id and attempt.state in ('claimed','provider_accepted')
  order by attempt.id desc limit 1 for update;
  if found and v_attempt.lease_expires_at>clock_timestamp() then
    return jsonb_build_object('outcome','success','action','in_progress','notificationId',v_notification.public_id);
  end if;
  v_lease_token:=gen_random_uuid();
  while v_lease_token=p_attempt_token loop v_lease_token:=gen_random_uuid(); end loop;
  if found then
    while v_lease_token=v_attempt.lease_token loop v_lease_token:=gen_random_uuid(); end loop;
    update public.task_notification_delivery_attempts attempt set lease_token=v_lease_token,
      lease_generation=attempt.lease_generation+1,lease_expires_at=v_lease_expires,
      updated_at=clock_timestamp() where attempt.id=v_attempt.id returning * into strict v_attempt;
  else
    insert into public.task_notification_delivery_attempts(tenant_id,organization_id,notification_id,
      attempt_token,provider_request_id,lease_token,lease_generation,state,lease_expires_at)
    values(v_notification.tenant_id,v_notification.organization_id,v_notification.id,p_attempt_token,
      p_attempt_token,v_lease_token,1,'claimed',v_lease_expires) returning * into strict v_attempt;
    v_fresh:=true;
    update public.task_notifications notification set status='sending',
      attempt_count=notification.attempt_count+1,last_attempt_at=clock_timestamp(),last_error_code=null,
      version=notification.version+1,updated_at=clock_timestamp()
    where notification.id=v_notification.id returning * into strict v_notification;
  end if;
  if v_attempt.state='provider_accepted' then
    return jsonb_build_object('outcome','success','action','finalize','notificationId',v_notification.public_id,
      'attemptToken',v_attempt.attempt_token,'providerRequestId',v_attempt.provider_request_id,
      'leaseToken',v_attempt.lease_token,'leaseGeneration',v_attempt.lease_generation,
      'messageId',v_attempt.provider_message_id);
  end if;
  return jsonb_build_object('outcome','success','action','send','notificationId',v_notification.public_id,
    'attemptToken',v_attempt.attempt_token,'providerRequestId',v_attempt.provider_request_id,
    'leaseToken',v_attempt.lease_token,'leaseGeneration',v_attempt.lease_generation,
    'isFresh',v_fresh,'attemptCount',v_notification.attempt_count,
    'recipientOpenId',v_recipient_open_id,'eventType',v_notification.event_type,
    'taskId',v_task.public_id,'taskTitle',v_task.title,'projectName',v_project.name,
    'actorName',v_actor_name,'reviewNote',coalesce(v_review_note,''));
end;
$$;

create or replace function public.task_notification_delivery_state_v1(
  p_tenant_public_id uuid,p_organization_public_id uuid,p_notification_public_id uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_notification public.task_notifications%rowtype;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Notification delivery state requires service role' using errcode='42501';
  end if;
  select notification.* into v_notification
  from public.tenants tenant
  join public.organizations organization on organization.tenant_id=tenant.id
  join public.task_notifications notification on notification.tenant_id=tenant.id
    and notification.organization_id=organization.id
    and notification.public_id=p_notification_public_id
  where tenant.public_id=p_tenant_public_id and organization.public_id=p_organization_public_id;
  if not found then return jsonb_build_object('outcome','failure','error','not_found'); end if;
  return jsonb_build_object('outcome','success','notificationId',v_notification.public_id,
    'status',v_notification.status,'version',v_notification.version,
    'readAt',v_notification.read_at,'nextRetryAt',v_notification.next_retry_at,
    'lastErrorCode',v_notification.last_error_code);
end;
$$;

create or replace function public.due_task_notifications_for_delivery(p_limit integer default 50)
returns table(tenant_public_id uuid,organization_public_id uuid,notification_public_id uuid)
language plpgsql security definer set search_path='' as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Notification recovery enumeration requires service role' using errcode='42501';
  end if;
  if p_limit is null or p_limit<1 or p_limit>200 then
    raise exception 'Notification recovery limit is invalid' using errcode='22023';
  end if;
  return query
  select tenant.public_id,organization.public_id,notification.public_id
  from public.task_notifications notification
  join public.tenants tenant on tenant.id=notification.tenant_id and tenant.status='active'
  join public.organizations organization on organization.tenant_id=tenant.id
    and organization.id=notification.organization_id
  join public.tasks task on task.tenant_id=notification.tenant_id
    and task.organization_id=notification.organization_id
    and task.id=notification.task_id and task.deleted_at is null
  join public.projects project on project.tenant_id=task.tenant_id
    and project.organization_id=task.organization_id and project.id=task.project_id
    and project.deleted_at is null and project.archived_at is null
  join public.organization_members recipient on recipient.tenant_id=notification.tenant_id
    and recipient.organization_id=notification.organization_id
    and recipient.id=notification.recipient_member_id and recipient.status='active'
  join public.employee_profiles recipient_profile on recipient_profile.tenant_id=notification.tenant_id
    and recipient_profile.organization_id=notification.organization_id
    and recipient_profile.organization_member_id=recipient.id
    and recipient_profile.deleted_at is null
    and recipient_profile.employment_status in ('probation','active','on_leave')
  join public.project_members recipient_membership on recipient_membership.tenant_id=notification.tenant_id
    and recipient_membership.organization_id=notification.organization_id
    and recipient_membership.project_id=task.project_id
    and recipient_membership.member_id=recipient.id
    and recipient_membership.left_at is null
    and recipient_membership.role in ('owner','manager','member')
  where (
    (notification.status='pending' and notification.attempt_count<5)
    or (notification.status='failed' and notification.attempt_count<5
      and notification.next_retry_at<=clock_timestamp())
    or (notification.status='sending' and exists(
      select 1 from public.task_notification_delivery_attempts attempt
      where attempt.notification_id=notification.id
        and attempt.state in ('claimed','provider_accepted')
        and attempt.lease_expires_at<=clock_timestamp()
    ))
  )
  order by coalesce(notification.next_retry_at,notification.created_at),notification.id
  limit p_limit;
end;
$$;

create or replace function public.current_task_notification_inbox()
returns table(notification_public_id uuid,event_public_id uuid,event_type text,
  effective_status text,task_public_id uuid,task_title text,project_public_id uuid,
  project_name text,created_at timestamptz,sent_at timestamptz,read_at timestamptz,
  next_retry_at timestamptz,last_error_code text,version bigint,can_retry boolean)
language sql stable security definer set search_path='' as $$
  with viewer as (
    select distinct identity.tenant_id,identity.organization_id,identity.organization_member_id member_id
    from public.external_identities identity
    join public.tenants tenant on tenant.id=identity.tenant_id and tenant.status='active'
    join public.organizations organization on organization.tenant_id=identity.tenant_id
      and organization.id=identity.organization_id
    join public.identity_providers provider on provider.tenant_id=identity.tenant_id
      and provider.id=identity.identity_provider_id and provider.status='active'
    join public.organization_members member on member.tenant_id=identity.tenant_id
      and member.organization_id=identity.organization_id
      and member.id=identity.organization_member_id and member.status='active'
    join public.employee_profiles profile on profile.tenant_id=member.tenant_id
      and profile.organization_id=member.organization_id
      and profile.organization_member_id=member.id and profile.deleted_at is null
      and profile.employment_status in ('probation','active','on_leave')
    where identity.auth_user_id=(select auth.uid()) and identity.status='active'
  )
  select notification.public_id,notification.event_public_id,notification.event_type,
    case when notification.read_at is not null and notification.status='sent'
      then 'read' else notification.status end,
    task.public_id,task.title,project.public_id,project.name,notification.created_at,
    notification.sent_at,notification.read_at,notification.next_retry_at,
    notification.last_error_code,notification.version,
    (notification.status='failed' and project.deleted_at is null and project.archived_at is null
      and exists(select 1 from public.project_members membership
        where membership.tenant_id=viewer.tenant_id
          and membership.organization_id=viewer.organization_id
          and membership.project_id=project.id and membership.member_id=viewer.member_id
          and membership.left_at is null and membership.role in ('owner','manager','member')))
  from viewer
  join public.task_notifications notification on notification.tenant_id=viewer.tenant_id
    and notification.organization_id=viewer.organization_id
    and notification.recipient_member_id=viewer.member_id
  join public.tasks task on task.tenant_id=viewer.tenant_id
    and task.organization_id=viewer.organization_id and task.id=notification.task_id
  join public.projects project on project.tenant_id=viewer.tenant_id
    and project.organization_id=viewer.organization_id and project.id=task.project_id
  order by notification.created_at desc,notification.id desc limit 200;
$$;

create or replace function public.retry_current_task_assigned_notification(
  p_task_public_id uuid,
  p_reason text,
  request_id uuid,
  idempotency_key uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_notification public.task_notifications%rowtype;
begin
  if p_task_public_id is null then
    raise exception 'Task notification retry is invalid' using errcode='22023';
  end if;
  select notification.* into v_notification
  from public.task_notifications notification
  join public.tasks task on task.tenant_id=notification.tenant_id
    and task.organization_id=notification.organization_id and task.id=notification.task_id
  join public.projects project on project.tenant_id=task.tenant_id
    and project.organization_id=task.organization_id and project.id=task.project_id
    and project.deleted_at is null and project.archived_at is null
  where task.public_id=p_task_public_id and task.deleted_at is null
    and notification.event_type='task.assigned'
  order by notification.id desc limit 1;
  if not found then return jsonb_build_object('outcome','failure','error','not_found'); end if;
  return public.retry_current_task_notification(v_notification.public_id,v_notification.version,
    p_reason,request_id,idempotency_key);
end;
$$;

create or replace function public.current_task_acceptance_history(p_project_public_id uuid)
returns table(event_public_id uuid,task_public_id uuid,event_type text,
  actor_employee_public_id uuid,actor_name text,task_version bigint,
  result_text text,result_link text,result_files jsonb,decision text,note text,
  occurred_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare v_tenant bigint;v_org bigint;v_actor bigint;v_user uuid;v_employee uuid;v_project_id bigint;
begin
  select * into v_tenant,v_org,v_actor,v_user,v_employee from public.current_project_execution_identity();
  select project.id into v_project_id
  from public.projects project
  where project.tenant_id=v_tenant and project.organization_id=v_org
    and project.public_id=p_project_public_id and project.deleted_at is null
    and (select public.can_view_project(project.id));
  if not found then return; end if;
  return query select event.public_id,task.public_id,event.event_type,
    event.actor_employee_public_id_snapshot,event.actor_name_snapshot,
    event.task_version_after,event.result_text,event.result_link,
    event.result_files,event.decision,event.note,event.occurred_at
  from public.task_acceptance_events event
  join public.tasks task on task.tenant_id=event.tenant_id
    and task.organization_id=event.organization_id and task.project_id=event.project_id
    and task.id=event.task_id
  where event.tenant_id=v_tenant and event.organization_id=v_org
    and event.project_id=v_project_id
  order by event.occurred_at desc,event.id desc limit 500;
end;
$$;

revoke all on function public.reject_task_acceptance_event_mutation() from public,anon,authenticated,service_role;
revoke all on function public.capture_task_acceptance_event() from public,anon,authenticated,service_role;
revoke all on function public.enqueue_task_transition_notification() from public,anon,authenticated,service_role;
revoke all on function public.enqueue_task_assigned_notification() from public,anon,authenticated,service_role;
revoke all on function public.capture_project_owner_transfer() from public,anon,authenticated,service_role;
revoke all on function public.guard_project_archive_state() from public,anon,authenticated,service_role;
revoke all on function public.enforce_explicit_project_member_lifecycle() from public,anon,authenticated,service_role;
revoke all on function public.enforce_task_acceptance_file_references() from public,anon,authenticated,service_role;
revoke all on function public.create_current_task_batch_v2(jsonb,uuid,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.create_current_project_task(uuid,text,text,bigint,date,text)
  from public,anon,authenticated,service_role;
revoke all on function public.create_current_project_task_v2(uuid,text,text,bigint,date,text,text)
  from public,anon,authenticated,service_role;
revoke all on function public.create_current_task_batch_v3(jsonb,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.create_current_task_batch_v3(jsonb,uuid,uuid) to authenticated;
revoke all on function public.sync_task_notification_attempt_state() from public,anon,authenticated,service_role;
revoke all on function public.pending_task_notification_events_for_delivery(uuid,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.pending_task_notification_events_for_delivery(uuid,uuid,uuid) to service_role;
revoke all on function public.claim_task_notification_event_delivery_v3(uuid,uuid,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.claim_task_notification_event_delivery_v3(uuid,uuid,uuid,uuid) to service_role;
revoke all on function public.task_notification_delivery_state_v1(uuid,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.task_notification_delivery_state_v1(uuid,uuid,uuid) to service_role;
revoke all on function public.due_task_notifications_for_delivery(integer)
  from public,anon,authenticated,service_role;
grant execute on function public.due_task_notifications_for_delivery(integer) to service_role;
revoke all on function public.mutate_current_project_member(uuid,uuid,text,text,numeric,bigint,bigint,text,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.mutate_current_project_member(uuid,uuid,text,text,numeric,bigint,bigint,text,uuid,uuid)
  to authenticated;
revoke all on function public.restore_current_project(uuid,bigint,text,text,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.restore_current_project(uuid,bigint,text,text,uuid,uuid)
  to authenticated;
revoke all on function public.archive_current_project_v2(uuid,bigint,text,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.archive_current_project_v2(uuid,bigint,text,uuid,uuid)
  to authenticated;
revoke all on function public.archive_current_project(uuid,bigint,text,uuid,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.current_archived_projects() from public,anon,authenticated,service_role;
grant execute on function public.current_archived_projects() to authenticated;
revoke all on function public.mark_current_task_notification_read(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.mark_current_task_notification_read(uuid,uuid) to authenticated;
revoke all on function public.retry_current_task_notification(uuid,bigint,text,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.retry_current_task_notification(uuid,bigint,text,uuid,uuid)
  to authenticated;
revoke all on function public.current_task_notification_inbox() from public,anon,authenticated,service_role;
grant execute on function public.current_task_notification_inbox() to authenticated;
revoke all on function public.retry_current_task_assigned_notification(uuid,text,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.retry_current_task_assigned_notification(uuid,text,uuid,uuid)
  to authenticated;
revoke all on function public.current_task_acceptance_history(uuid) from public,anon,authenticated,service_role;
grant execute on function public.current_task_acceptance_history(uuid) to authenticated;
