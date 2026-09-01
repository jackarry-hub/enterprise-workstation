-- Durable, service-role-only Feishu notification delivery attempts.
-- attempt_token/provider_request_id are stable provider identities. lease_token
-- changes on recovery so an expired worker cannot mutate the recovered attempt.

create unique index if not exists task_notifications_scope_id_uidx
  on public.task_notifications (tenant_id, organization_id, id);

create table public.task_notification_delivery_attempts (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null,
  organization_id bigint not null,
  notification_id bigint not null,
  attempt_token uuid not null unique,
  provider_request_id uuid not null,
  lease_token uuid not null,
  lease_generation integer not null default 1 check (lease_generation > 0),
  state text not null default 'claimed'
    check (state in ('claimed', 'provider_accepted', 'sent', 'failed')),
  lease_expires_at timestamptz not null,
  provider_message_id text,
  error_code text,
  claimed_at timestamptz not null default clock_timestamp(),
  provider_accepted_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (tenant_id, organization_id, notification_id)
    references public.task_notifications (tenant_id, organization_id, id)
    on delete cascade,
  constraint task_notification_attempt_message_ck check (
    provider_message_id is null
    or (
      length(provider_message_id) between 1 and 512
      and provider_message_id !~ '[[:cntrl:]]'
    )
  ),
  constraint task_notification_attempt_error_ck check (
    error_code is null
    or error_code in (
      'token_unavailable', 'recipient_unavailable', 'send_failed',
      'configuration_unavailable', 'queue_unavailable',
      'delivery_unconfirmed'
    )
  ),
  constraint task_notification_attempt_state_payload_ck check (
    (state = 'claimed'
      and provider_message_id is null and error_code is null
      and provider_accepted_at is null and completed_at is null)
    or (state = 'provider_accepted'
      and provider_message_id is not null and error_code is null
      and provider_accepted_at is not null and completed_at is null)
    or (state = 'sent'
      and provider_message_id is not null and error_code is null
      and provider_accepted_at is not null and completed_at is not null)
    or (state = 'failed'
      and provider_message_id is null and error_code is not null
      and provider_accepted_at is null and completed_at is not null)
  )
);

create unique index task_notification_one_active_attempt_uidx
  on public.task_notification_delivery_attempts (notification_id)
  where state in ('claimed', 'provider_accepted');

create index task_notification_attempt_recovery_idx
  on public.task_notification_delivery_attempts (state, lease_expires_at, id);

create index task_notification_attempt_notification_scope_idx
  on public.task_notification_delivery_attempts (tenant_id, organization_id, notification_id);

alter table public.task_notification_delivery_attempts enable row level security;
alter table public.task_notification_delivery_attempts force row level security;
revoke all on table public.task_notification_delivery_attempts
  from public, anon, authenticated, service_role;
revoke all on sequence public.task_notification_delivery_attempts_id_seq
  from public, anon, authenticated, service_role;

create or replace function public.claim_task_notification_delivery_v2(
  p_tenant_public_id uuid,
  p_organization_public_id uuid,
  p_task_public_id uuid,
  p_attempt_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant public.tenants%rowtype;
  v_organization public.organizations%rowtype;
  v_task public.tasks%rowtype;
  v_notification public.task_notifications%rowtype;
  v_attempt public.task_notification_delivery_attempts%rowtype;
  v_recipient_open_id text;
  v_project_name text;
  v_reporter_name text;
  v_lease_expires_at timestamptz := clock_timestamp() + interval '2 minutes';
  v_new_lease_token uuid;
  v_is_fresh boolean := false;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Notification delivery claim requires service role' using errcode = '42501';
  end if;
  if p_tenant_public_id is null or p_organization_public_id is null
     or p_task_public_id is null or p_attempt_token is null then
    return jsonb_build_object('outcome', 'failure', 'error', 'invalid_request');
  end if;

  select notification.*
    into v_notification
  from public.tenants tenant
  join public.organizations organization on organization.tenant_id = tenant.id
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
  where tenant.public_id = p_tenant_public_id
    and organization.public_id = p_organization_public_id
  for update of notification;

  if not found then
    return jsonb_build_object('outcome', 'failure', 'error', 'not_found');
  end if;

  select tenant.* into strict v_tenant
  from public.tenants tenant
  where tenant.public_id = p_tenant_public_id;
  select organization.* into strict v_organization
  from public.organizations organization
  where organization.tenant_id = v_tenant.id
    and organization.public_id = p_organization_public_id;
  select task.* into strict v_task
  from public.tasks task
  where task.organization_id = v_organization.id
    and task.id = v_notification.task_id;

  if v_notification.status = 'sent' then
    if v_notification.feishu_message_id is null then
      return jsonb_build_object('outcome', 'failure', 'error', 'inconsistent_state');
    end if;
    return jsonb_build_object(
      'outcome', 'success', 'action', 'sent',
      'notificationId', v_notification.public_id,
      'messageId', v_notification.feishu_message_id
    );
  end if;

  select case when identity.provider_subject like 'open_id:%'
           then substring(identity.provider_subject from 9) end,
         project.name,
         reporter.display_name
    into v_recipient_open_id, v_project_name, v_reporter_name
  from public.projects project
  join public.employee_profiles reporter
    on reporter.organization_member_id = v_task.reporter_member_id
   and reporter.deleted_at is null
  left join public.identity_providers provider
    on provider.tenant_id = v_tenant.id
   and provider.provider_code = 'feishu'
   and provider.status = 'active'
  left join public.external_identities identity
    on identity.tenant_id = v_tenant.id
   and identity.organization_id = v_organization.id
   and identity.organization_member_id = v_notification.recipient_member_id
   and identity.identity_provider_id = provider.id
   and identity.status in ('invited', 'active')
  where project.id = v_task.project_id;

  if not found then
    return jsonb_build_object('outcome', 'failure', 'error', 'not_found');
  end if;

  select attempt.* into v_attempt
  from public.task_notification_delivery_attempts attempt
  where attempt.notification_id = v_notification.id
    and attempt.state in ('claimed', 'provider_accepted')
  order by attempt.id desc
  limit 1
  for update;

  if found and v_attempt.lease_expires_at > clock_timestamp() then
    return jsonb_build_object(
      'outcome', 'success', 'action', 'in_progress',
      'notificationId', v_notification.public_id,
      'leaseExpiresAt', v_attempt.lease_expires_at
    );
  end if;

  v_new_lease_token := gen_random_uuid();
  while v_new_lease_token = p_attempt_token loop
    v_new_lease_token := gen_random_uuid();
  end loop;
  if found then
    while v_new_lease_token = v_attempt.lease_token loop
      v_new_lease_token := gen_random_uuid();
    end loop;
    update public.task_notification_delivery_attempts attempt
    set lease_token = v_new_lease_token,
        lease_generation = attempt.lease_generation + 1,
        lease_expires_at = v_lease_expires_at,
        updated_at = clock_timestamp()
    where attempt.id = v_attempt.id
    returning * into strict v_attempt;
  else
    insert into public.task_notification_delivery_attempts (
      tenant_id, organization_id, notification_id, attempt_token,
      provider_request_id, lease_token, lease_generation, state, lease_expires_at
    ) values (
      v_tenant.id, v_organization.id, v_notification.id, p_attempt_token,
      p_attempt_token, v_new_lease_token, 1, 'claimed', v_lease_expires_at
    ) returning * into strict v_attempt;
    v_is_fresh := true;
    update public.task_notifications notification
    set status = 'pending',
        attempt_count = notification.attempt_count + 1,
        last_attempt_at = clock_timestamp(),
        last_error_code = null
    where notification.id = v_notification.id;
  end if;

  if v_attempt.state = 'provider_accepted' then
    return jsonb_build_object(
      'outcome', 'success', 'action', 'finalize',
      'notificationId', v_notification.public_id,
      'attemptToken', v_attempt.attempt_token,
      'providerRequestId', v_attempt.provider_request_id,
      'leaseToken', v_attempt.lease_token,
      'leaseGeneration', v_attempt.lease_generation,
      'messageId', v_attempt.provider_message_id
    );
  end if;

  return jsonb_build_object(
    'outcome', 'success', 'action', 'send',
    'notificationId', v_notification.public_id,
    'attemptToken', v_attempt.attempt_token,
    'providerRequestId', v_attempt.provider_request_id,
    'leaseToken', v_attempt.lease_token,
    'leaseGeneration', v_attempt.lease_generation,
    'leaseExpiresAt', v_attempt.lease_expires_at,
    'isFresh', v_is_fresh,
    'taskId', v_task.public_id,
    'recipientOpenId', v_recipient_open_id,
    'taskTitle', v_task.title,
    'projectName', v_project_name,
    'reporterName', v_reporter_name,
    'priority', v_task.priority,
    'dueDate', v_task.due_date,
    'acceptanceCriteria', v_task.acceptance_criteria,
    'attemptCount', v_notification.attempt_count + case when v_is_fresh then 1 else 0 end
  );
end;
$$;

create or replace function public.record_task_notification_provider_acceptance_v2(
  p_tenant_public_id uuid,
  p_organization_public_id uuid,
  p_notification_public_id uuid,
  p_attempt_token uuid,
  p_lease_token uuid,
  p_lease_generation integer,
  p_provider_request_id uuid,
  p_provider_message_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.task_notification_delivery_attempts%rowtype;
  v_notification public.task_notifications%rowtype;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Notification provider acceptance requires service role' using errcode = '42501';
  end if;
  if p_attempt_token is null or p_lease_token is null
     or p_lease_generation is null or p_lease_generation < 1
     or p_provider_request_id is null
     or p_provider_message_id is null or length(p_provider_message_id) not between 1 and 512
     or p_provider_message_id ~ '[[:cntrl:]]' then
    return jsonb_build_object('outcome', 'failure', 'error', 'invalid_request');
  end if;

  select notification.* into v_notification
  from public.task_notifications notification
  join public.tenants tenant on tenant.id = notification.tenant_id
  join public.organizations organization
    on organization.id = notification.organization_id and organization.tenant_id = tenant.id
  where tenant.public_id = p_tenant_public_id
    and organization.public_id = p_organization_public_id
    and notification.public_id = p_notification_public_id
  for update of notification;
  if not found then
    return jsonb_build_object('outcome', 'failure', 'error', 'not_found');
  end if;

  select attempt.* into v_attempt
  from public.task_notification_delivery_attempts attempt
  where attempt.notification_id = v_notification.id
    and attempt.attempt_token = p_attempt_token
  for update;
  if not found then
    return jsonb_build_object('outcome', 'failure', 'error', 'not_found');
  end if;
  if v_attempt.provider_request_id is distinct from p_provider_request_id then
    return jsonb_build_object('outcome', 'failure', 'error', 'claim_conflict');
  end if;
  if v_attempt.state in ('provider_accepted', 'sent') then
    if v_attempt.provider_message_id is distinct from p_provider_message_id then
      return jsonb_build_object('outcome', 'failure', 'error', 'provider_result_conflict');
    end if;
    return jsonb_build_object(
      'outcome', 'success', 'state', v_attempt.state,
      'messageId', v_attempt.provider_message_id
    );
  end if;
  if v_attempt.state <> 'claimed'
     or v_attempt.lease_token is distinct from p_lease_token
     or v_attempt.lease_generation is distinct from p_lease_generation
     or v_attempt.lease_expires_at <= clock_timestamp() then
    return jsonb_build_object('outcome', 'failure', 'error', 'claim_conflict');
  end if;

  update public.task_notification_delivery_attempts attempt
  set state = 'provider_accepted',
      provider_message_id = p_provider_message_id,
      provider_accepted_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where attempt.id = v_attempt.id;
  update public.task_notifications notification
  set feishu_message_id = p_provider_message_id,
      last_error_code = null
  where notification.id = v_notification.id;
  return jsonb_build_object(
    'outcome', 'success', 'state', 'provider_accepted',
    'messageId', p_provider_message_id
  );
end;
$$;

create or replace function public.complete_task_notification_delivery_v2(
  p_tenant_public_id uuid,
  p_organization_public_id uuid,
  p_notification_public_id uuid,
  p_attempt_token uuid,
  p_lease_token uuid,
  p_lease_generation integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.task_notification_delivery_attempts%rowtype;
  v_notification public.task_notifications%rowtype;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Notification completion requires service role' using errcode = '42501';
  end if;
  if p_attempt_token is null or p_lease_token is null
     or p_lease_generation is null or p_lease_generation < 1 then
    return jsonb_build_object('outcome', 'failure', 'error', 'invalid_request');
  end if;

  select notification.* into v_notification
  from public.task_notifications notification
  join public.tenants tenant on tenant.id = notification.tenant_id
  join public.organizations organization
    on organization.id = notification.organization_id and organization.tenant_id = tenant.id
  where tenant.public_id = p_tenant_public_id
    and organization.public_id = p_organization_public_id
    and notification.public_id = p_notification_public_id
  for update of notification;
  if not found then
    return jsonb_build_object('outcome', 'failure', 'error', 'not_found');
  end if;

  select attempt.* into v_attempt
  from public.task_notification_delivery_attempts attempt
  where attempt.notification_id = v_notification.id
    and attempt.attempt_token = p_attempt_token
  for update;
  if not found then
    return jsonb_build_object('outcome', 'failure', 'error', 'not_found');
  end if;
  if v_attempt.state = 'sent' and v_notification.status = 'sent' then
    return jsonb_build_object('outcome', 'success', 'state', 'sent', 'messageId', v_attempt.provider_message_id);
  end if;
  if v_attempt.state <> 'provider_accepted' or v_attempt.provider_message_id is null
     or v_attempt.lease_token is distinct from p_lease_token
     or v_attempt.lease_generation is distinct from p_lease_generation
     or v_attempt.lease_expires_at <= clock_timestamp() then
    return jsonb_build_object('outcome', 'failure', 'error', 'claim_conflict');
  end if;

  update public.task_notification_delivery_attempts attempt
  set state = 'sent', completed_at = clock_timestamp(), updated_at = clock_timestamp()
  where attempt.id = v_attempt.id;
  update public.task_notifications notification
  set status = 'sent',
      feishu_message_id = v_attempt.provider_message_id,
      last_error_code = null,
      sent_at = coalesce(notification.sent_at, clock_timestamp())
  where notification.id = v_notification.id;
  return jsonb_build_object('outcome', 'success', 'state', 'sent', 'messageId', v_attempt.provider_message_id);
end;
$$;

create or replace function public.fail_task_notification_delivery_v2(
  p_tenant_public_id uuid,
  p_organization_public_id uuid,
  p_notification_public_id uuid,
  p_attempt_token uuid,
  p_lease_token uuid,
  p_lease_generation integer,
  p_error_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.task_notification_delivery_attempts%rowtype;
  v_notification public.task_notifications%rowtype;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Notification failure recording requires service role' using errcode = '42501';
  end if;
  if p_attempt_token is null or p_lease_token is null
     or p_lease_generation is null or p_lease_generation < 1
     or p_error_code is null
     or p_error_code not in (
       'token_unavailable', 'recipient_unavailable', 'send_failed',
       'configuration_unavailable', 'queue_unavailable', 'delivery_unconfirmed'
     ) then
    return jsonb_build_object('outcome', 'failure', 'error', 'invalid_request');
  end if;

  select notification.* into v_notification
  from public.task_notifications notification
  join public.tenants tenant on tenant.id = notification.tenant_id
  join public.organizations organization
    on organization.id = notification.organization_id and organization.tenant_id = tenant.id
  where tenant.public_id = p_tenant_public_id
    and organization.public_id = p_organization_public_id
    and notification.public_id = p_notification_public_id
  for update of notification;
  if not found then
    return jsonb_build_object('outcome', 'failure', 'error', 'not_found');
  end if;

  select attempt.* into v_attempt
  from public.task_notification_delivery_attempts attempt
  where attempt.notification_id = v_notification.id
    and attempt.attempt_token = p_attempt_token
  for update;
  if not found then
    return jsonb_build_object('outcome', 'failure', 'error', 'not_found');
  end if;
  if v_attempt.state = 'sent' and v_notification.status = 'sent' then
    return jsonb_build_object(
      'outcome', 'success', 'state', 'sent', 'messageId', v_attempt.provider_message_id
    );
  end if;
  if v_attempt.state = 'failed' then
    return jsonb_build_object('outcome', 'success', 'state', 'failed', 'error', v_attempt.error_code);
  end if;
  if v_attempt.lease_token is distinct from p_lease_token
     or v_attempt.lease_generation is distinct from p_lease_generation
     or v_attempt.lease_expires_at <= clock_timestamp() then
    return jsonb_build_object('outcome', 'failure', 'error', 'claim_conflict');
  end if;
  if v_attempt.state = 'provider_accepted' then
    return jsonb_build_object(
      'outcome', 'success', 'state', 'provider_accepted',
      'messageId', v_attempt.provider_message_id
    );
  end if;
  if v_attempt.state <> 'claimed' then
    return jsonb_build_object('outcome', 'failure', 'error', 'claim_conflict');
  end if;

  update public.task_notification_delivery_attempts attempt
  set state = 'failed', error_code = p_error_code,
      completed_at = clock_timestamp(), updated_at = clock_timestamp()
  where attempt.id = v_attempt.id;
  update public.task_notifications notification
  set status = 'failed', last_error_code = p_error_code
  where notification.id = v_notification.id;
  return jsonb_build_object('outcome', 'success', 'state', 'failed', 'error', p_error_code);
end;
$$;

create or replace function public.authorize_current_task_notification_retry(
  p_task_public_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_task public.tasks%rowtype;
begin
  if (select auth.uid()) is null or p_task_public_id is null then
    return jsonb_build_object('outcome', 'failure', 'error', 'not_found');
  end if;

  select task.* into v_task
  from public.tasks task
  where task.public_id = p_task_public_id
    and task.deleted_at is null;
  if not found or not public.can_manage_project(v_task.project_id) then
    return jsonb_build_object('outcome', 'failure', 'error', 'not_found');
  end if;
  return jsonb_build_object('outcome', 'success', 'taskId', v_task.public_id);
end;
$$;

revoke all on function public.get_task_notification_delivery_context(uuid,uuid,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.record_task_notification_delivery(uuid,uuid,uuid,text,text,text)
  from public, anon, authenticated, service_role;

revoke all on function public.claim_task_notification_delivery_v2(uuid,uuid,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_task_notification_delivery_v2(uuid,uuid,uuid,uuid)
  to service_role;
revoke all on function public.record_task_notification_provider_acceptance_v2(uuid,uuid,uuid,uuid,uuid,integer,uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function public.record_task_notification_provider_acceptance_v2(uuid,uuid,uuid,uuid,uuid,integer,uuid,text)
  to service_role;
revoke all on function public.complete_task_notification_delivery_v2(uuid,uuid,uuid,uuid,uuid,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.complete_task_notification_delivery_v2(uuid,uuid,uuid,uuid,uuid,integer)
  to service_role;
revoke all on function public.fail_task_notification_delivery_v2(uuid,uuid,uuid,uuid,uuid,integer,text)
  from public, anon, authenticated, service_role;
grant execute on function public.fail_task_notification_delivery_v2(uuid,uuid,uuid,uuid,uuid,integer,text)
  to service_role;

revoke all on function public.authorize_current_task_notification_retry(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.authorize_current_task_notification_retry(uuid)
  to authenticated;
