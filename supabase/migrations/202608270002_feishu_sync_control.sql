-- Forward-only controls for Feishu OAuth, signed events and resilient directory work.

create table public.feishu_oauth_attempts (
  attempt_id uuid primary key,
  nonce_digest text not null check (nonce_digest ~ '^[0-9a-f]{64}$'),
  return_path text check (
    return_path is null or (
      return_path like '/%' and return_path not like '//%' and
      return_path not like '%\\%' and length(return_path) <= 1000
    )
  ),
  status text not null default 'pending' check (status in ('pending', 'consumed', 'expired')),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  check ((status = 'consumed') = (consumed_at is not null))
);
create index feishu_oauth_attempts_expiry_idx
  on public.feishu_oauth_attempts (expires_at) where status = 'pending';

create or replace function public.create_feishu_oauth_attempt(
  p_attempt_id uuid,
  p_nonce_digest text,
  p_return_path text,
  p_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_attempt_id is null or p_nonce_digest !~ '^[0-9a-f]{64}$'
     or p_expires_at <= now() or p_expires_at > now() + interval '15 minutes'
     or (p_return_path is not null and (
       p_return_path not like '/%' or p_return_path like '//%'
       or p_return_path like '%\\%' or length(p_return_path) > 1000
     )) then
    raise exception 'oauth_attempt_invalid' using errcode = '22023';
  end if;
  insert into public.feishu_oauth_attempts (
    attempt_id, nonce_digest, return_path, expires_at
  ) values (p_attempt_id, p_nonce_digest, p_return_path, p_expires_at);
end;
$$;

create or replace function public.consume_feishu_oauth_attempt(
  p_attempt_id uuid,
  p_nonce_digest text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_return_path text;
begin
  update public.feishu_oauth_attempts
     set status = 'consumed', consumed_at = now()
   where attempt_id = p_attempt_id
     and nonce_digest = p_nonce_digest
     and status = 'pending'
     and expires_at > now()
  returning return_path into v_return_path;
  if not found then
    update public.feishu_oauth_attempts
       set status = 'expired'
     where attempt_id = p_attempt_id and status = 'pending' and expires_at <= now();
    return jsonb_build_object('valid', false, 'returnPath', null);
  end if;
  return jsonb_build_object('valid', true, 'returnPath', v_return_path);
end;
$$;

alter table public.organization_members drop constraint if exists organization_members_status_check;
alter table public.organization_members add constraint organization_members_status_check
  check (status in ('invited', 'active', 'suspended', 'revoked'));

-- Immediate provider offboarding must win over workflow ownership guards.
create or replace function public.guard_organization_risk_owner_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'active' and new.status = 'suspended' and exists (
    select 1 from public.project_risks risk
    where risk.organization_id = old.organization_id
      and risk.owner_member_id = old.id and risk.deleted_at is null
  ) then
    raise exception 'Reassign project risks before suspending their owner' using errcode = '23514';
  end if;
  return new;
end;
$$;

create table public.feishu_access_grants (
  id bigint generated always as identity primary key,
  tenant_id bigint not null references public.tenants(id) on delete cascade,
  organization_id bigint not null,
  organization_member_id bigint not null,
  status text not null default 'queued' check (status in ('queued', 'applied', 'cancelled')),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  foreign key (tenant_id, organization_id)
    references public.organizations (tenant_id, id) on delete cascade,
  foreign key (tenant_id, organization_member_id)
    references public.organization_members (tenant_id, id) on delete cascade
);

create table public.feishu_webhook_events (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete cascade,
  organization_id bigint not null,
  connection_id bigint not null,
  provider_event_id text not null check (length(provider_event_id) between 1 and 200),
  event_type text not null check (event_type in (
    'contact.user.created_v3', 'contact.user.updated_v3', 'contact.user.deleted_v3',
    'contact.department.created_v3', 'contact.department.updated_v3', 'contact.department.deleted_v3'
  )),
  entity_type text not null check (entity_type in ('user', 'department')),
  entity_external_id text not null check (length(entity_external_id) between 1 and 200),
  entity_sequence bigint not null check (entity_sequence > 0),
  payload_digest text not null check (payload_digest ~ '^[0-9a-f]{64}$'),
  disposition text not null check (disposition in ('applied', 'reconcile')),
  created_at timestamptz not null default now(),
  unique (tenant_id, organization_id, provider_event_id),
  foreign key (tenant_id, organization_id)
    references public.organizations (tenant_id, id) on delete cascade,
  foreign key (tenant_id, connection_id)
    references public.directory_connections (tenant_id, id) on delete cascade
);
create index feishu_webhook_events_cursor_idx on public.feishu_webhook_events (connection_id, id);

create table public.feishu_entity_sequences (
  tenant_id bigint not null references public.tenants(id) on delete cascade,
  organization_id bigint not null,
  connection_id bigint not null,
  entity_type text not null check (entity_type in ('user', 'department')),
  entity_external_id text not null,
  last_sequence bigint not null check (last_sequence > 0),
  last_event_id text not null,
  updated_at timestamptz not null default now(),
  primary key (connection_id, entity_type, entity_external_id),
  foreign key (tenant_id, organization_id)
    references public.organizations (tenant_id, id) on delete cascade,
  foreign key (tenant_id, connection_id)
    references public.directory_connections (tenant_id, id) on delete cascade
);

create table public.feishu_sync_conflicts (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete cascade,
  organization_id bigint not null,
  webhook_event_id bigint references public.feishu_webhook_events(id) on delete cascade,
  code text not null check (code in ('OUT_OF_ORDER_EVENT', 'AMBIGUOUS_EVENT', 'APPLY_FAILED', 'RECONCILIATION_DIFFERENCE')),
  severity text not null default 'warning' check (severity in ('warning', 'error')),
  entity_type text check (entity_type in ('user', 'department')),
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolved_at timestamptz,
  resolved_by_auth_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, organization_id)
    references public.organizations (tenant_id, id) on delete cascade
);
create index feishu_sync_conflicts_org_open_idx
  on public.feishu_sync_conflicts (organization_id, created_at desc) where status = 'open';

create table public.feishu_sync_leases (
  connection_id bigint primary key,
  tenant_id bigint not null references public.tenants(id) on delete cascade,
  organization_id bigint not null,
  run_id uuid not null unique,
  mode text not null check (mode in ('full', 'incremental', 'reconcile')),
  cursor text,
  status text not null check (status in ('running', 'completed', 'retry')),
  attempt integer not null default 1 check (attempt between 1 and 9),
  lease_expires_at timestamptz not null,
  retry_after timestamptz,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  foreign key (tenant_id, organization_id)
    references public.organizations (tenant_id, id) on delete cascade,
  foreign key (tenant_id, connection_id)
    references public.directory_connections (tenant_id, id) on delete cascade
);

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
  v_profile public.employee_profiles%rowtype;
  v_user_id uuid;
begin
  if p_member_public_id is null or nullif(btrim(p_event_id), '') is null then
    raise exception 'offboarding_invalid' using errcode = '22023';
  end if;
  select * into v_profile from public.employee_profiles
   where public_id = p_member_public_id and deleted_at is null for update;
  if not found or v_profile.organization_member_id is null then return false; end if;

  select user_id into v_user_id from public.organization_members
   where tenant_id = v_profile.tenant_id and id = v_profile.organization_member_id for update;
  update public.employee_profiles set employment_status = 'departed', departure_date = current_date
   where tenant_id = v_profile.tenant_id and id = v_profile.id;
  update public.external_identities set status = 'revoked', auth_user_id = null
   where tenant_id = v_profile.tenant_id and organization_member_id = v_profile.organization_member_id;
  update public.organization_members set status = 'revoked'
   where tenant_id = v_profile.tenant_id and id = v_profile.organization_member_id;
  update public.feishu_access_grants set status = 'cancelled', cancelled_at = now()
   where tenant_id = v_profile.tenant_id and organization_member_id = v_profile.organization_member_id and status = 'queued';
  if v_user_id is not null then
    delete from auth.refresh_tokens refresh using auth.sessions session
     where refresh.session_id = session.id and session.user_id = v_user_id;
    delete from auth.sessions where user_id = v_user_id;
  end if;
  insert into public.audit_logs (
    tenant_id, organization_id, action, target_type, target_id, metadata
  ) values (
    v_profile.tenant_id, v_profile.organization_id, 'identity.revoked',
    'employee_profile', p_member_public_id::text,
    jsonb_build_object('source', 'feishu_webhook', 'eventIdDigest', encode(digest(p_event_id, 'sha256'), 'hex'))
  );
  return true;
end;
$$;

create or replace function public.ingest_feishu_webhook_event(
  p_app_id text,
  p_tenant_key text,
  p_provider_event_id text,
  p_event_type text,
  p_entity_type text,
  p_entity_external_id text,
  p_entity_sequence bigint,
  p_payload_digest text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection record;
  v_event_id bigint;
  v_previous bigint;
  v_disposition text;
  v_cursor bigint := 0;
  v_profile_public_id uuid;
  v_inserted integer := 0;
  v_matched integer := 0;
begin
  if nullif(btrim(p_app_id), '') is null or nullif(btrim(p_tenant_key), '') is null or p_provider_event_id is null
     or p_event_type not in (
       'contact.user.created_v3', 'contact.user.updated_v3', 'contact.user.deleted_v3',
       'contact.department.created_v3', 'contact.department.updated_v3', 'contact.department.deleted_v3'
     ) or p_entity_type not in ('user', 'department') or p_entity_sequence <= 0
     or p_payload_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'webhook_event_invalid' using errcode = '22023';
  end if;

  for v_connection in
    select connection.id, connection.tenant_id, connection.organization_id
      from public.directory_connections connection
      join public.identity_providers provider
        on provider.tenant_id = connection.tenant_id
       and provider.id = connection.identity_provider_id
     where provider.provider_code = 'feishu' and provider.status = 'active'
       and provider.provider_tenant_key = p_tenant_key
       and connection.status = 'active'
     for update of connection
  loop
    v_matched := v_matched + 1;
    insert into public.feishu_webhook_events (
      tenant_id, organization_id, connection_id, provider_event_id, event_type,
      entity_type, entity_external_id, entity_sequence, payload_digest, disposition
    ) values (
      v_connection.tenant_id, v_connection.organization_id, v_connection.id,
      p_provider_event_id, p_event_type, p_entity_type, p_entity_external_id,
      p_entity_sequence, p_payload_digest, 'applied'
    ) on conflict (tenant_id, organization_id, provider_event_id) do nothing
    returning id into v_event_id;
    if not found then continue; end if;
    v_inserted := v_inserted + 1;
    select last_sequence into v_previous from public.feishu_entity_sequences
     where connection_id = v_connection.id and entity_type = p_entity_type
       and entity_external_id = p_entity_external_id for update;
    v_disposition := case when v_previous is null or p_entity_sequence > v_previous then 'applied' else 'reconcile' end;
    update public.feishu_webhook_events set disposition = v_disposition where id = v_event_id;
    if v_disposition = 'applied' then
      insert into public.feishu_entity_sequences (
        tenant_id, organization_id, connection_id, entity_type, entity_external_id,
        last_sequence, last_event_id
      ) values (
        v_connection.tenant_id, v_connection.organization_id, v_connection.id,
        p_entity_type, p_entity_external_id, p_entity_sequence, p_provider_event_id
      ) on conflict (connection_id, entity_type, entity_external_id) do update
        set last_sequence = excluded.last_sequence, last_event_id = excluded.last_event_id, updated_at = now();
    else
      insert into public.feishu_sync_conflicts (
        tenant_id, organization_id, webhook_event_id, code, entity_type
      ) values (
        v_connection.tenant_id, v_connection.organization_id, v_event_id,
        'OUT_OF_ORDER_EVENT', p_entity_type
      );
    end if;
    if v_disposition = 'applied' and p_event_type = 'contact.user.deleted_v3' then
      select profile.public_id into v_profile_public_id
        from public.external_identities identity
        join public.employee_profiles profile
          on profile.tenant_id = identity.tenant_id
         and profile.organization_member_id = identity.organization_member_id
       where identity.tenant_id = v_connection.tenant_id
         and identity.organization_id = v_connection.organization_id
         and identity.provider_subject = p_entity_external_id
       limit 1;
      if v_profile_public_id is not null then
        perform public.revoke_departed_member_access(v_profile_public_id, p_provider_event_id);
      end if;
    end if;
    v_cursor := greatest(v_cursor, v_event_id);
  end loop;
  if v_matched = 0 then
    raise exception 'webhook_tenant_unknown' using errcode = '42501';
  end if;
  if v_inserted = 0 then
    return jsonb_build_object('status', 'duplicate', 'cursor', '0');
  end if;
  return jsonb_build_object(
    'status', case when exists (
      select 1 from public.feishu_webhook_events where id <= v_cursor and provider_event_id = p_provider_event_id and disposition = 'reconcile'
    ) then 'reconcile' else 'applied' end,
    'cursor', v_cursor::text
  );
end;
$$;

create or replace function public.claim_feishu_sync_work(
  p_mode text,
  p_cursor text,
  p_provider_tenant_key text,
  p_lease_seconds integer default 120
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection record;
  v_run_id uuid := gen_random_uuid();
  v_attempt integer := 1;
  v_actor uuid;
  v_previous_cursor text;
begin
  if p_mode not in ('full', 'incremental', 'reconcile') or p_lease_seconds not between 30 and 600
     or nullif(btrim(p_provider_tenant_key), '') is null
     or (p_cursor is not null and length(p_cursor) > 200) then
    raise exception 'sync_claim_invalid' using errcode = '22023';
  end if;
  select connection.id, connection.tenant_id, connection.organization_id
    into v_connection
    from public.directory_connections connection
    join public.identity_providers provider
      on provider.tenant_id = connection.tenant_id
     and provider.id = connection.identity_provider_id
   where connection.status = 'active'
     and provider.provider_code = 'feishu'
     and provider.provider_tenant_key = p_provider_tenant_key
     and connection.external_tenant_key = p_provider_tenant_key
     and (
       p_mode <> 'incremental' or exists (
         select 1 from public.feishu_webhook_events event
         where event.connection_id = connection.id and event.id::text = p_cursor
       )
     )
     and not exists (
       select 1 from public.feishu_sync_leases lease
       where lease.connection_id = connection.id and lease.status = 'running'
         and lease.lease_expires_at > now()
     )
     and not exists (
       select 1 from public.feishu_sync_leases lease
       where lease.connection_id = connection.id and lease.status = 'retry'
         and lease.retry_after > now()
     )
   order by connection.last_sync_at nulls first, connection.id
   for update skip locked limit 1;
  if not found then
    return jsonb_build_object('acquired', false, 'runId', v_run_id, 'cursor', p_cursor, 'attempt', 1);
  end if;
  select member.user_id into v_actor
    from public.organization_members member
    join public.member_roles assignment on assignment.member_id = member.id
    join public.roles role on role.id = assignment.role_id and role.code in ('owner', 'admin')
   where member.tenant_id = v_connection.tenant_id
     and member.organization_id = v_connection.organization_id
     and member.status = 'active' and member.user_id is not null
   order by case role.code when 'owner' then 0 else 1 end, member.id limit 1;
  if v_actor is null then raise exception 'sync_actor_missing' using errcode = '42501'; end if;
  select least(attempt + 1, 9), cursor into v_attempt, v_previous_cursor from public.feishu_sync_leases
   where connection_id = v_connection.id;
  v_attempt := coalesce(v_attempt, 1);
  insert into public.feishu_sync_leases (
    connection_id, tenant_id, organization_id, run_id, mode, cursor, status,
    attempt, lease_expires_at, retry_after, started_at, completed_at
  ) values (
    v_connection.id, v_connection.tenant_id, v_connection.organization_id,
    v_run_id, p_mode, coalesce(p_cursor, v_previous_cursor), 'running', v_attempt,
    now() + make_interval(secs => p_lease_seconds), null, now(), null
  ) on conflict (connection_id) do update set
    run_id = excluded.run_id, mode = excluded.mode, cursor = coalesce(excluded.cursor, public.feishu_sync_leases.cursor),
    status = 'running', attempt = excluded.attempt,
    lease_expires_at = excluded.lease_expires_at, retry_after = null,
    started_at = now(), completed_at = null;
  return jsonb_build_object(
    'acquired', true, 'runId', v_run_id, 'cursor', coalesce(p_cursor, v_previous_cursor), 'attempt', v_attempt,
    'tenantId', (select public_id from public.tenants where id = v_connection.tenant_id),
    'actorAuthUserId', v_actor
  );
end;
$$;

create or replace function public.next_feishu_sync_cursor(p_provider_tenant_key text)
returns text
language sql
security definer
set search_path = ''
as $$
  select event.id::text
  from public.feishu_webhook_events event
  join public.directory_connections connection on connection.id = event.connection_id
  left join public.feishu_sync_leases lease on lease.connection_id = event.connection_id
  where connection.external_tenant_key = p_provider_tenant_key
    and event.id > case when lease.cursor ~ '^\d+$' then lease.cursor::bigint else 0 end
    and (lease.retry_after is null or lease.retry_after <= now())
  order by event.id
  limit 1
$$;

create or replace function public.finish_feishu_sync_work(
  p_run_id uuid,
  p_cursor text,
  p_status text,
  p_retry_after timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_lease public.feishu_sync_leases%rowtype;
begin
  if p_status not in ('completed', 'retry')
     or (p_status = 'retry') <> (p_retry_after is not null) then
    raise exception 'sync_finish_invalid' using errcode = '22023';
  end if;
  update public.feishu_sync_leases set
    cursor = p_cursor, status = p_status, retry_after = p_retry_after,
    completed_at = now(), lease_expires_at = now()
   where run_id = p_run_id and status = 'running'
  returning * into v_lease;
  if not found then raise exception 'sync_lease_missing' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'runId', v_lease.run_id, 'cursor', v_lease.cursor, 'status', v_lease.status,
    'retryAfter', v_lease.retry_after
  );
end;
$$;

create or replace function public.resolve_feishu_sync_issue(
  p_organization_public_id uuid,
  p_actor_auth_user_id uuid,
  p_issue_public_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v_scope record;
begin
  select organization.tenant_id, organization.id as organization_id, member.id as member_id
    into v_scope
    from public.organizations organization
    join public.organization_members member
      on member.tenant_id = organization.tenant_id and member.organization_id = organization.id
    join public.member_roles assignment on assignment.member_id = member.id
    join public.roles role on role.id = assignment.role_id
    join public.role_permissions rp on rp.role_id = role.id
    join public.permissions permission on permission.id = rp.permission_id and permission.code = 'organization.manage'
   where organization.public_id = p_organization_public_id
     and member.user_id = p_actor_auth_user_id and member.status = 'active'
   limit 1;
  if not found then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.feishu_sync_conflicts set
    status = 'resolved', resolved_at = now(), resolved_by_auth_user_id = p_actor_auth_user_id
   where public_id = p_issue_public_id and tenant_id = v_scope.tenant_id
     and organization_id = v_scope.organization_id and status = 'open';
  if not found then return 'not_found'; end if;
  insert into public.audit_logs (
    tenant_id, organization_id, actor_auth_user_id, actor_member_id, action,
    target_type, target_id, metadata
  ) values (
    v_scope.tenant_id, v_scope.organization_id, p_actor_auth_user_id, v_scope.member_id,
    'directory.sync_issue_resolved', 'feishu_sync_conflict', p_issue_public_id::text,
    jsonb_build_object('resolution', 'acknowledged_for_reconcile')
  );
  return 'resolved';
end;
$$;

alter table public.audit_logs drop constraint if exists audit_logs_action_check;
alter table public.audit_logs add constraint audit_logs_action_check check (action in (
  'identity.provisioned', 'identity.claimed', 'identity.revoked', 'member.status_changed',
  'member.role_changed', 'profile.updated', 'roster.imported', 'tenant.bootstrap_owner',
  'enterprise.initialized', 'directory.sync_started', 'directory.sync_completed',
  'directory.sync_failed', 'directory.role_mapped', 'project.created', 'task.created',
  'payroll_policy.activated', 'payroll.calculated', 'payroll.confirmed', 'ai.config.updated',
  'organization.department_created', 'organization.department_updated',
  'organization.position_upserted', 'organization.role_assigned', 'organization.command_failed',
  'employee_skill.verified', 'employee_skill.verification_failed',
  'directory.sync_issue_resolved'
));

alter table public.feishu_oauth_attempts enable row level security;
alter table public.feishu_oauth_attempts force row level security;
alter table public.feishu_access_grants enable row level security;
alter table public.feishu_access_grants force row level security;
alter table public.feishu_webhook_events enable row level security;
alter table public.feishu_webhook_events force row level security;
alter table public.feishu_entity_sequences enable row level security;
alter table public.feishu_entity_sequences force row level security;
alter table public.feishu_sync_conflicts enable row level security;
alter table public.feishu_sync_conflicts force row level security;
alter table public.feishu_sync_leases enable row level security;
alter table public.feishu_sync_leases force row level security;

create policy feishu_sync_conflicts_manager_select on public.feishu_sync_conflicts
for select to authenticated using (
  tenant_id = (select public.current_tenant_id())
  and organization_id in (
    select member.organization_id from public.organization_members member
    join public.member_roles assignment on assignment.member_id = member.id
    join public.role_permissions rp on rp.role_id = assignment.role_id
    join public.permissions permission on permission.id = rp.permission_id
    where member.user_id = (select auth.uid()) and member.status = 'active'
      and permission.code = 'organization.manage'
  )
);

create policy feishu_webhook_events_manager_select on public.feishu_webhook_events
for select to authenticated using (
  tenant_id = (select public.current_tenant_id())
  and organization_id in (
    select member.organization_id from public.organization_members member
    join public.member_roles assignment on assignment.member_id = member.id
    join public.role_permissions rp on rp.role_id = assignment.role_id
    join public.permissions permission on permission.id = rp.permission_id
    where member.user_id = (select auth.uid()) and member.status = 'active'
      and permission.code = 'organization.manage'
  )
);

create policy directory_sync_runs_org_manager_select on public.directory_sync_runs
for select to authenticated using (
  tenant_id = (select public.current_tenant_id())
  and organization_id in (
    select member.organization_id from public.organization_members member
    join public.member_roles assignment on assignment.member_id = member.id
    join public.role_permissions rp on rp.role_id = assignment.role_id
    join public.permissions permission on permission.id = rp.permission_id
    where member.user_id = (select auth.uid()) and member.status = 'active'
      and permission.code = 'organization.manage'
  )
);

create or replace view public.current_feishu_sync_issues
with (security_invoker = true)
as
select conflict.public_id, organization.public_id as organization_public_id,
       conflict.code, conflict.severity, conflict.entity_type, conflict.status,
       conflict.created_at, conflict.resolved_at
from public.feishu_sync_conflicts conflict
join public.organizations organization
  on organization.tenant_id = conflict.tenant_id
 and organization.id = conflict.organization_id;

revoke all on table public.feishu_oauth_attempts, public.feishu_access_grants,
  public.feishu_webhook_events, public.feishu_entity_sequences,
  public.feishu_sync_conflicts, public.feishu_sync_leases
from public, anon, authenticated, service_role;
grant select on table public.feishu_sync_conflicts to authenticated;
grant select on table public.feishu_webhook_events to authenticated;
revoke all on table public.current_feishu_sync_issues from public, anon, authenticated, service_role;
grant select on table public.current_feishu_sync_issues to authenticated;

revoke all on function public.create_feishu_oauth_attempt(uuid, text, text, timestamptz)
from public, anon, authenticated, service_role;
grant execute on function public.create_feishu_oauth_attempt(uuid, text, text, timestamptz) to service_role;
revoke all on function public.consume_feishu_oauth_attempt(uuid, text)
from public, anon, authenticated, service_role;
grant execute on function public.consume_feishu_oauth_attempt(uuid, text) to service_role;
revoke all on function public.revoke_departed_member_access(uuid, text)
from public, anon, authenticated, service_role;
grant execute on function public.revoke_departed_member_access(uuid, text) to service_role;
revoke all on function public.ingest_feishu_webhook_event(text, text, text, text, text, text, bigint, text)
from public, anon, authenticated, service_role;
grant execute on function public.ingest_feishu_webhook_event(text, text, text, text, text, text, bigint, text) to service_role;
revoke all on function public.claim_feishu_sync_work(text, text, text, integer)
from public, anon, authenticated, service_role;
grant execute on function public.claim_feishu_sync_work(text, text, text, integer) to service_role;
revoke all on function public.finish_feishu_sync_work(uuid, text, text, timestamptz)
from public, anon, authenticated, service_role;
grant execute on function public.finish_feishu_sync_work(uuid, text, text, timestamptz) to service_role;
revoke all on function public.next_feishu_sync_cursor(text)
from public, anon, authenticated, service_role;
grant execute on function public.next_feishu_sync_cursor(text) to service_role;
revoke all on function public.resolve_feishu_sync_issue(uuid, uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.resolve_feishu_sync_issue(uuid, uuid, uuid) to service_role;
