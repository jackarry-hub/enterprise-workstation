create unique index if not exists tasks_organization_id_id_uidx
  on public.tasks (organization_id, id);

create table public.task_notifications (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete cascade,
  organization_id bigint not null,
  task_id bigint not null,
  recipient_member_id bigint not null,
  event_type text not null default 'task.assigned'
    check (event_type = 'task.assigned'),
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  feishu_message_id text,
  last_error_code text,
  created_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  sent_at timestamptz,
  constraint task_notifications_delivery_once_idx
    unique (tenant_id, task_id, recipient_member_id, event_type),
  foreign key (tenant_id, organization_id)
    references public.organizations (tenant_id, id) on delete cascade,
  foreign key (organization_id, task_id)
    references public.tasks (organization_id, id) on delete cascade,
  foreign key (organization_id, recipient_member_id)
    references public.organization_members (organization_id, id) on delete cascade
);

create or replace function public.enqueue_task_assigned_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id bigint;
begin
  if new.assignee_member_id is null then return new; end if;
  select organization.tenant_id into strict v_tenant_id
  from public.organizations organization
  where organization.id = new.organization_id;

  insert into public.task_notifications (
    tenant_id, organization_id, task_id, recipient_member_id, event_type, status
  ) values (
    v_tenant_id, new.organization_id, new.id,
    new.assignee_member_id, 'task.assigned', 'pending'
  ) on conflict (tenant_id, task_id, recipient_member_id, event_type) do nothing;
  return new;
end;
$$;

create trigger queue_task_assigned_notification
after insert on public.tasks
for each row execute function public.enqueue_task_assigned_notification();

create or replace function public.get_task_notification_delivery_context(
  p_tenant_public_id uuid,
  p_organization_public_id uuid,
  p_task_public_id uuid
)
returns table (
  notification_public_id uuid,
  task_public_id uuid,
  recipient_open_id text,
  task_title text,
  project_name text,
  reporter_name text,
  priority text,
  due_date date,
  acceptance_criteria text,
  status text,
  attempt_count integer
)
language sql
security definer
set search_path = ''
as $$
  select notification.public_id,
         task.public_id,
         case when identity.provider_subject like 'open_id:%'
           then substring(identity.provider_subject from 9) end,
         task.title,
         project.name,
         reporter.display_name,
         task.priority,
         task.due_date,
         task.acceptance_criteria,
         notification.status,
         notification.attempt_count
  from public.tenants tenant
  join public.organizations organization
    on organization.tenant_id = tenant.id
  join public.tasks task
    on task.organization_id = organization.id
   and task.public_id = p_task_public_id
   and task.deleted_at is null
  join public.task_notifications notification
    on notification.tenant_id = tenant.id
   and notification.organization_id = organization.id
   and notification.task_id = task.id
   and notification.recipient_member_id = task.assignee_member_id
   and notification.event_type = 'task.assigned'
  join public.projects project on project.id = task.project_id
  join public.employee_profiles reporter
    on reporter.organization_member_id = task.reporter_member_id
   and reporter.deleted_at is null
  left join public.identity_providers provider
    on provider.tenant_id = tenant.id
   and provider.provider_code = 'feishu'
   and provider.status = 'active'
  left join public.external_identities identity
    on identity.tenant_id = tenant.id
   and identity.organization_id = organization.id
   and identity.organization_member_id = task.assignee_member_id
   and identity.identity_provider_id = provider.id
   and identity.status in ('invited', 'active')
  where tenant.public_id = p_tenant_public_id
    and organization.public_id = p_organization_public_id
  limit 1;
$$;

create or replace function public.record_task_notification_delivery(
  p_tenant_public_id uuid,
  p_organization_public_id uuid,
  p_notification_public_id uuid,
  p_status text,
  p_feishu_message_id text,
  p_last_error_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('sent', 'failed') then
    raise exception 'Notification status is invalid' using errcode = '22023';
  end if;

  update public.task_notifications notification
  set status = p_status,
      attempt_count = notification.attempt_count + 1,
      feishu_message_id = case when p_status = 'sent' then p_feishu_message_id else null end,
      last_error_code = case when p_status = 'failed' then p_last_error_code else null end,
      last_attempt_at = now(),
      sent_at = case when p_status = 'sent' then now() else notification.sent_at end
  from public.tenants tenant, public.organizations organization
  where notification.public_id = p_notification_public_id
    and notification.tenant_id = tenant.id
    and notification.organization_id = organization.id
    and organization.tenant_id = tenant.id
    and tenant.public_id = p_tenant_public_id
    and organization.public_id = p_organization_public_id;

  if not found then
    raise exception 'Notification does not exist' using errcode = 'P0002';
  end if;
end;
$$;

alter table public.task_notifications enable row level security;

create policy task_notifications_authorized_select
on public.task_notifications
for select to authenticated
using (
  exists (
    select 1 from public.tasks task
    where task.id = task_notifications.task_id
      and task.organization_id = task_notifications.organization_id
      and task.deleted_at is null
      and (select public.can_view_project(task.project_id))
  )
);

revoke all on function public.get_task_notification_delivery_context(uuid,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.get_task_notification_delivery_context(uuid,uuid,uuid)
  to service_role;
revoke all on function public.record_task_notification_delivery(uuid,uuid,uuid,text,text,text)
  from public, anon, authenticated;
grant execute on function public.record_task_notification_delivery(uuid,uuid,uuid,text,text,text)
  to service_role;
