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
    select connection.id, connection.tenant_id, connection.organization_id,
           connection.identity_provider_id
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
    if not found then
      select event.id, event.disposition into v_event_id, v_disposition
        from public.feishu_webhook_events event
       where event.tenant_id = v_connection.tenant_id
         and event.organization_id = v_connection.organization_id
         and event.provider_event_id = p_provider_event_id;
      v_cursor := greatest(v_cursor, coalesce(v_event_id, 0));
      continue;
    end if;
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
         and identity.identity_provider_id = v_connection.identity_provider_id
         and identity.provider_subject = 'open_id:' || lower(btrim(p_entity_external_id))
       limit 1;
      if v_profile_public_id is not null then
        if not public.revoke_departed_member_access(v_profile_public_id, p_provider_event_id) then
          raise exception 'offboarding_not_applied' using errcode = 'P0001';
        end if;
      else
        update public.feishu_webhook_events set disposition = 'reconcile' where id = v_event_id;
        insert into public.feishu_sync_conflicts (
          tenant_id, organization_id, webhook_event_id, code, entity_type
        ) values (
          v_connection.tenant_id, v_connection.organization_id, v_event_id,
          'AMBIGUOUS_EVENT', p_entity_type
        );
      end if;
    end if;
    v_cursor := greatest(v_cursor, v_event_id);
  end loop;
  if v_matched = 0 then
    raise exception 'webhook_tenant_unknown' using errcode = '42501';
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

-- Exact-organization variant used only behind the durable fenced worker.
+create or replace function public.apply_feishu_directory_sync_exact(
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
  v_actor_member_id bigint;
  v_provider_id bigint;
  v_provider_tenant_key text;
  v_connection_id bigint;
  v_sync_run_id bigint;
  v_started_at timestamptz := clock_timestamp();
  v_item jsonb;
  v_external_id text;
  v_department_id bigint;
  v_parent_department_id bigint;
  v_position_id bigint;
  v_member_id bigint;
  v_profile_id bigint;
  v_role_id bigint;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_deactivated integer := 0;
  v_departments integer;
  v_employees integer;
  v_positions integer;
  v_complete boolean;
  v_is_active boolean;
  v_open_id text;
  v_user_id text;
  v_email text;
  v_department_external_id text;
  v_job_title_external_id text;
begin
  if p_tenant_public_id is null or p_organization_public_id is null or p_actor_auth_user_id is null
     or jsonb_typeof(p_snapshot) <> 'object'
     or jsonb_typeof(p_snapshot -> 'departments') <> 'array'
     or jsonb_typeof(p_snapshot -> 'positions') <> 'array'
     or jsonb_typeof(p_snapshot -> 'employees') <> 'array'
     or jsonb_typeof(p_snapshot -> 'complete') <> 'boolean' then
    raise exception 'Directory snapshot is invalid' using errcode = '22023';
  end if;

  v_departments := jsonb_array_length(p_snapshot -> 'departments');
  v_positions := jsonb_array_length(p_snapshot -> 'positions');
  v_employees := jsonb_array_length(p_snapshot -> 'employees');
  v_complete := (p_snapshot ->> 'complete')::boolean;
  if v_departments > 10000 or v_positions > 10000 or v_employees > 50000 then
    raise exception 'Directory snapshot is too large' using errcode = '22023';
  end if;

  select tenant.id, organization.id
  into strict v_tenant_id, v_organization_id
  from public.tenants tenant
  join public.organizations organization on organization.tenant_id = tenant.id
  where tenant.public_id = p_tenant_public_id
    and organization.public_id = p_organization_public_id
    and tenant.status = 'active'
  order by organization.id
  limit 1;

  select member.id into v_actor_member_id
  from public.organization_members member
  where member.tenant_id = v_tenant_id
    and member.organization_id = v_organization_id
    and member.user_id = p_actor_auth_user_id
    and member.status = 'active';
  if v_actor_member_id is null then
    raise exception 'Directory actor does not belong to this tenant'
      using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.member_roles assignment
    join public.roles role
      on role.tenant_id = assignment.tenant_id and role.id = assignment.role_id
    where assignment.tenant_id = v_tenant_id
      and assignment.member_id = v_actor_member_id
      and role.code in ('owner', 'admin')
      and role.is_enabled
  ) then
    raise exception 'Only an owner or administrator can synchronize the directory'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('directory-sync:' || v_tenant_id::text, 0)
  );

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
    v_provider_tenant_key, 'manual', 'active'
  )
  on conflict (tenant_id, identity_provider_id) do update set
    organization_id = excluded.organization_id,
    external_tenant_key = excluded.external_tenant_key,
    status = 'active',
    updated_at = clock_timestamp()
  returning id into v_connection_id;

  insert into public.directory_sync_runs (
    tenant_id, organization_id, connection_id, actor_member_id,
    status, snapshot_complete, departments_seen, employees_seen,
    positions_seen, started_at
  ) values (
    v_tenant_id, v_organization_id, v_connection_id, v_actor_member_id,
    'running', v_complete, v_departments, v_employees, v_positions, v_started_at
  ) returning id into v_sync_run_id;

  perform public.append_audit_log(
    v_tenant_id, v_organization_id, p_actor_auth_user_id, v_actor_member_id,
    'directory.sync_started', 'directory_sync_run', v_sync_run_id::text,
    null, null, jsonb_build_object(
      'departments', v_departments, 'employees', v_employees,
      'positions', v_positions, 'complete', v_complete
    )
  );

  for v_item in select value from jsonb_array_elements(p_snapshot -> 'departments')
  loop
    v_external_id := nullif(btrim(v_item ->> 'externalId'), '');
    if v_external_id is null or nullif(btrim(v_item ->> 'name'), '') is null then
      raise exception 'Directory department is invalid' using errcode = '22023';
    end if;

    select link.department_id into v_department_id
    from public.directory_entity_links link
    where link.tenant_id = v_tenant_id and link.connection_id = v_connection_id
      and link.entity_type = 'department' and link.external_id = v_external_id;
    if v_department_id is null then
      select department.id into v_department_id
      from public.departments department
      where department.tenant_id = v_tenant_id
        and department.organization_id = v_organization_id
        and department.name = btrim(v_item ->> 'name')
        and department.deleted_at is null
      order by department.id limit 1;
    end if;
    if v_department_id is null then
      insert into public.departments (
        tenant_id, organization_id, code, name, description,
        status, sort_order
      ) values (
        v_tenant_id, v_organization_id,
        'FS_' || upper(substr(md5(v_external_id), 1, 20)),
        btrim(v_item ->> 'name'), '飞书通讯录同步', 'active', 1000
      ) returning id into v_department_id;
      v_inserted := v_inserted + 1;
    else
      update public.departments set
        name = btrim(v_item ->> 'name'), status = 'active',
        deleted_at = null, updated_at = clock_timestamp()
      where tenant_id = v_tenant_id and id = v_department_id;
      v_updated := v_updated + 1;
    end if;

    insert into public.directory_entity_links (
      tenant_id, organization_id, connection_id, entity_type,
      external_id, external_identifiers, department_id, last_seen_at
    ) values (
      v_tenant_id, v_organization_id, v_connection_id, 'department',
      v_external_id,
      jsonb_strip_nulls(jsonb_build_object(
        'openDepartmentId', v_external_id,
        'departmentId', nullif(btrim(v_item ->> 'departmentId'), '')
      )),
      v_department_id, clock_timestamp()
    )
    on conflict (tenant_id, connection_id, entity_type, external_id)
    do update set department_id = excluded.department_id,
      external_identifiers = excluded.external_identifiers,
      last_seen_at = excluded.last_seen_at, updated_at = clock_timestamp();
  end loop;

  for v_item in select value from jsonb_array_elements(p_snapshot -> 'departments')
  loop
    v_external_id := nullif(btrim(v_item ->> 'externalId'), '');
    select link.department_id into v_department_id
    from public.directory_entity_links link
    where link.tenant_id = v_tenant_id and link.connection_id = v_connection_id
      and link.entity_type = 'department' and link.external_id = v_external_id;
    v_parent_department_id := null;
    if nullif(btrim(v_item ->> 'parentExternalId'), '') is not null then
      select link.department_id into v_parent_department_id
      from public.directory_entity_links link
      where link.tenant_id = v_tenant_id and link.connection_id = v_connection_id
        and link.entity_type = 'department'
        and link.external_id = btrim(v_item ->> 'parentExternalId');
    end if;
    update public.departments set parent_department_id = v_parent_department_id,
      updated_at = clock_timestamp()
    where tenant_id = v_tenant_id and id = v_department_id;
  end loop;

  for v_item in select value from jsonb_array_elements(p_snapshot -> 'positions')
  loop
    v_external_id := nullif(btrim(v_item ->> 'externalId'), '');
    if v_external_id is null or nullif(btrim(v_item ->> 'name'), '') is null then
      raise exception 'Directory position is invalid' using errcode = '22023';
    end if;
    select link.position_template_id into v_position_id
    from public.directory_entity_links link
    where link.tenant_id = v_tenant_id and link.connection_id = v_connection_id
      and link.entity_type = 'position' and link.external_id = v_external_id;
    if v_position_id is null then
      select position.id into v_position_id
      from public.position_templates position
      where position.tenant_id = v_tenant_id
        and position.organization_id = v_organization_id
        and position.name = btrim(v_item ->> 'name')
        and position.deleted_at is null
      order by position.id limit 1;
    end if;
    if v_position_id is null then
      insert into public.position_templates (
        tenant_id, organization_id, code, name, category,
        description, source, status
      ) values (
        v_tenant_id, v_organization_id,
        'FS_' || upper(substr(md5(v_external_id), 1, 20)),
        btrim(v_item ->> 'name'), '飞书职位', '飞书通讯录同步',
        'feishu', 'active'
      ) returning id into v_position_id;
      v_inserted := v_inserted + 1;
    else
      update public.position_templates set
        name = btrim(v_item ->> 'name'), status = 'active',
        deleted_at = null, updated_at = clock_timestamp()
      where tenant_id = v_tenant_id and id = v_position_id;
      v_updated := v_updated + 1;
    end if;
    insert into public.directory_entity_links (
      tenant_id, organization_id, connection_id, entity_type,
      external_id, external_identifiers, position_template_id, last_seen_at
    ) values (
      v_tenant_id, v_organization_id, v_connection_id, 'position',
      v_external_id, jsonb_build_object('jobTitleId', v_external_id),
      v_position_id, clock_timestamp()
    ) on conflict (tenant_id, connection_id, entity_type, external_id)
    do update set position_template_id = excluded.position_template_id,
      external_identifiers = excluded.external_identifiers,
      last_seen_at = excluded.last_seen_at, updated_at = clock_timestamp();
  end loop;

  for v_item in select value from jsonb_array_elements(p_snapshot -> 'employees')
  loop
    v_open_id := nullif(lower(btrim(v_item ->> 'openId')), '');
    if v_open_id is null or nullif(btrim(v_item ->> 'name'), '') is null then
      raise exception 'Directory employee is invalid' using errcode = '22023';
    end if;
    v_user_id := nullif(btrim(v_item ->> 'userId'), '');
    v_email := nullif(lower(btrim(v_item ->> 'email')), '');
    v_department_external_id := nullif(btrim(v_item ->> 'primaryDepartmentExternalId'), '');
    v_job_title_external_id := nullif(btrim(v_item ->> 'jobTitleExternalId'), '');
    v_is_active := coalesce((v_item ->> 'isActive')::boolean, true);
    v_department_id := null;
    v_position_id := null;
    if v_department_external_id is not null then
      select link.department_id into v_department_id
      from public.directory_entity_links link
      where link.tenant_id = v_tenant_id and link.connection_id = v_connection_id
        and link.entity_type = 'department' and link.external_id = v_department_external_id;
    end if;
    if v_job_title_external_id is not null then
      select link.position_template_id into v_position_id
      from public.directory_entity_links link
      where link.tenant_id = v_tenant_id and link.connection_id = v_connection_id
        and link.entity_type = 'position' and link.external_id = v_job_title_external_id;
    end if;

    select link.employee_profile_id into v_profile_id
    from public.directory_entity_links link
    where link.tenant_id = v_tenant_id and link.connection_id = v_connection_id
      and link.entity_type = 'employee' and link.external_id = v_open_id;
    if v_profile_id is null then
      select profile.id into v_profile_id
      from public.external_identities identity
      join public.employee_profiles profile
        on profile.tenant_id = identity.tenant_id
       and profile.organization_member_id = identity.organization_member_id
       and profile.deleted_at is null
      where identity.tenant_id = v_tenant_id
        and identity.identity_provider_id = v_provider_id
        and identity.provider_subject = 'open_id:' || v_open_id
      limit 1;
    end if;

    if v_profile_id is null then
      insert into public.organization_members (
        tenant_id, organization_id, user_id, status
      ) values (
        v_tenant_id, v_organization_id, null,
        case when v_is_active then 'invited' else 'suspended' end
      ) returning id into v_member_id;
      insert into public.employee_profiles (
        tenant_id, organization_id, organization_member_id, employee_no,
        display_name, work_email, department_id, job_title,
        position_template_id, employment_status, skills
      ) values (
        v_tenant_id, v_organization_id, v_member_id,
        coalesce(v_user_id, v_open_id), btrim(v_item ->> 'name'), v_email,
        v_department_id, coalesce(nullif(btrim(v_item ->> 'jobTitle'), ''), '员工'),
        v_position_id, case when v_is_active then 'active' else 'departed' end,
        '{}'
      ) returning id into v_profile_id;
      v_inserted := v_inserted + 1;
    else
      select profile.organization_member_id into v_member_id
      from public.employee_profiles profile
      where profile.tenant_id = v_tenant_id and profile.id = v_profile_id;
      update public.employee_profiles set
        display_name = btrim(v_item ->> 'name'),
        work_email = coalesce(v_email, work_email),
        department_id = coalesce(v_department_id, department_id),
        job_title = coalesce(nullif(btrim(v_item ->> 'jobTitle'), ''), job_title),
        position_template_id = coalesce(v_position_id, position_template_id),
        employment_status = case when v_is_active then 'active' else 'departed' end,
        departure_date = case when v_is_active then null else current_date end,
        updated_at = clock_timestamp()
      where tenant_id = v_tenant_id and id = v_profile_id;
      update public.organization_members set
        status = case
          when v_is_active and user_id is null then 'invited'
          when v_is_active then 'active'
          else 'suspended'
        end
      where tenant_id = v_tenant_id and id = v_member_id;
      v_updated := v_updated + 1;
    end if;

    insert into public.external_identities (
      tenant_id, organization_id, organization_member_id,
      identity_provider_id, provider_subject, provider_tenant_key,
      provider_match_keys, verified_email, status
    ) values (
      v_tenant_id, v_organization_id, v_member_id, v_provider_id,
      'open_id:' || v_open_id, v_provider_tenant_key,
      array_remove(array['open_id:' || v_open_id,
        case when v_email is not null then 'email:' || v_email end], null),
      v_email, case when v_is_active then 'invited' else 'revoked' end
    )
    on conflict (tenant_id, identity_provider_id, organization_member_id)
    do update set
      provider_subject = excluded.provider_subject,
      provider_match_keys = excluded.provider_match_keys,
      verified_email = coalesce(excluded.verified_email, public.external_identities.verified_email),
      status = case
        when not v_is_active then 'revoked'
        when public.external_identities.auth_user_id is not null then 'active'
        else 'invited'
      end;

    insert into public.directory_entity_links (
      tenant_id, organization_id, connection_id, entity_type,
      external_id, external_identifiers, employee_profile_id, last_seen_at
    ) values (
      v_tenant_id, v_organization_id, v_connection_id, 'employee', v_open_id,
      jsonb_strip_nulls(jsonb_build_object('openId', v_open_id, 'userId', v_user_id)),
      v_profile_id, clock_timestamp()
    ) on conflict (tenant_id, connection_id, entity_type, external_id)
    do update set employee_profile_id = excluded.employee_profile_id,
      external_identifiers = excluded.external_identifiers,
      last_seen_at = excluded.last_seen_at, updated_at = clock_timestamp();

    delete from public.member_roles assignment
    where assignment.tenant_id = v_tenant_id
      and assignment.member_id = v_member_id
      and assignment.assignment_source = 'directory';
    if v_is_active and not exists (
      select 1 from public.member_roles assignment
      join public.roles role
        on role.tenant_id = assignment.tenant_id and role.id = assignment.role_id
      where assignment.tenant_id = v_tenant_id
        and assignment.member_id = v_member_id
        and role.code in ('owner', 'admin')
    ) then
      select role.id into strict v_role_id
      from public.roles role
      where role.tenant_id = v_tenant_id and role.is_enabled
        and role.code = case when exists (
          select 1 from jsonb_array_elements(p_snapshot -> 'departments') department
          where lower(btrim(department ->> 'leaderOpenId')) = v_open_id
        ) then 'department_head' else 'employee' end
      order by role.organization_id nulls last limit 1;
      insert into public.member_roles (
        tenant_id, member_id, role_id, assignment_source
      ) values (v_tenant_id, v_member_id, v_role_id, 'directory')
      on conflict (tenant_id, member_id, role_id) do nothing;
    end if;
  end loop;

  for v_item in select value from jsonb_array_elements(p_snapshot -> 'departments')
  loop
    select department_link.department_id, member.id
    into v_department_id, v_member_id
    from public.directory_entity_links department_link
    left join public.directory_entity_links employee_link
      on employee_link.tenant_id = department_link.tenant_id
     and employee_link.connection_id = department_link.connection_id
     and employee_link.entity_type = 'employee'
     and employee_link.external_id = lower(btrim(v_item ->> 'leaderOpenId'))
    left join public.employee_profiles profile
      on profile.tenant_id = employee_link.tenant_id
     and profile.id = employee_link.employee_profile_id
    left join public.organization_members member
      on member.tenant_id = profile.tenant_id
     and member.id = profile.organization_member_id
    where department_link.tenant_id = v_tenant_id
      and department_link.connection_id = v_connection_id
      and department_link.entity_type = 'department'
      and department_link.external_id = btrim(v_item ->> 'externalId');
    update public.departments set leader_member_id = v_member_id,
      updated_at = clock_timestamp()
    where tenant_id = v_tenant_id and id = v_department_id;
  end loop;

  if v_complete then
    update public.employee_profiles profile set
      employment_status = 'departed', departure_date = current_date,
      updated_at = clock_timestamp()
    from public.directory_entity_links link
    where link.tenant_id = v_tenant_id
      and link.connection_id = v_connection_id
      and link.entity_type = 'employee'
      and link.employee_profile_id = profile.id
      and link.last_seen_at < v_started_at
      and not exists (
        select 1 from public.member_roles assignment
        join public.roles role
          on role.tenant_id = assignment.tenant_id and role.id = assignment.role_id
        where assignment.tenant_id = v_tenant_id
          and assignment.member_id = profile.organization_member_id
          and role.code in ('owner', 'admin')
      );
    get diagnostics v_deactivated = row_count;

    update public.organization_members member set status = 'suspended'
    from public.employee_profiles profile
    where profile.tenant_id = v_tenant_id
      and profile.organization_member_id = member.id
      and profile.employment_status = 'departed'
      and profile.updated_at >= v_started_at;
    update public.external_identities identity set status = 'revoked',
      updated_at = clock_timestamp()
    from public.employee_profiles profile
    where profile.tenant_id = v_tenant_id
      and profile.organization_member_id = identity.organization_member_id
      and identity.identity_provider_id = v_provider_id
      and profile.employment_status = 'departed'
      and profile.updated_at >= v_started_at;
  end if;

  update public.directory_sync_runs set
    status = 'completed', inserted_count = v_inserted,
    updated_count = v_updated, deactivated_count = v_deactivated,
    completed_at = clock_timestamp()
  where tenant_id = v_tenant_id and id = v_sync_run_id;
  update public.directory_connections set
    last_sync_at = clock_timestamp(), status = 'active', updated_at = clock_timestamp()
  where tenant_id = v_tenant_id and id = v_connection_id;

  perform public.append_audit_log(
    v_tenant_id, v_organization_id, p_actor_auth_user_id, v_actor_member_id,
    'directory.sync_completed', 'directory_sync_run', v_sync_run_id::text,
    null, null, jsonb_build_object(
      'departments', v_departments, 'employees', v_employees,
      'positions', v_positions, 'inserted', v_inserted,
      'updated', v_updated, 'deactivated', v_deactivated
    )
  );

  return jsonb_build_object(
    'status', 'completed',
    'departmentCount', v_departments,
    'employeeCount', v_employees,
    'positionCount', v_positions,
    'insertedCount', v_inserted,
    'updatedCount', v_updated,
    'deactivatedCount', v_deactivated
  );
exception when others then
  if v_sync_run_id is not null then
    update public.directory_sync_runs set status = 'failed', error_count = 1,
      completed_at = clock_timestamp()
    where tenant_id = v_tenant_id and id = v_sync_run_id;
  end if;
  raise;
end;
$$;


revoke all on function public.apply_feishu_directory_sync_exact(uuid, uuid, uuid, jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.apply_feishu_directory_sync_exact(uuid, uuid, uuid, jsonb) to service_role;

-- A durable command ledger makes deleted-user processing retry-safe. The row,
-- revocations and audit record commit atomically, so a lost response can be
-- retried without creating a second audit event.
create table public.feishu_offboarding_commands (
  id bigint generated always as identity primary key,
  tenant_id bigint not null references public.tenants(id) on delete cascade,
  organization_id bigint not null,
  member_public_id uuid not null,
  offboarding_event_id text not null check (length(btrim(offboarding_event_id)) between 1 and 200),
  status text not null default 'pending' check (status in ('pending', 'completed')),
  result boolean,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (tenant_id, organization_id, offboarding_event_id),
  unique (tenant_id, organization_id, member_public_id),
  foreign key (tenant_id, organization_id)
    references public.organizations (tenant_id, id) on delete cascade
);
alter table public.feishu_offboarding_commands enable row level security;
alter table public.feishu_offboarding_commands force row level security;
revoke all on table public.feishu_offboarding_commands from public, anon, authenticated, service_role;

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
  v_command public.feishu_offboarding_commands%rowtype;
begin
  if p_member_public_id is null or nullif(btrim(p_event_id), '') is null
     or length(btrim(p_event_id)) > 200 then
    raise exception 'offboarding_invalid' using errcode = '22023';
  end if;

  select * into v_profile from public.employee_profiles
   where public_id = p_member_public_id and deleted_at is null for update;
  if not found or v_profile.organization_member_id is null then return false; end if;

  insert into public.feishu_offboarding_commands (
    tenant_id, organization_id, member_public_id, offboarding_event_id
  ) values (
    v_profile.tenant_id, v_profile.organization_id, p_member_public_id, btrim(p_event_id)
  ) on conflict do nothing
  returning * into v_command;

  if not found then
    select * into v_command from public.feishu_offboarding_commands command
     where command.tenant_id = v_profile.tenant_id
       and command.organization_id = v_profile.organization_id
       and (command.offboarding_event_id = btrim(p_event_id)
            or command.member_public_id = p_member_public_id)
     for update;
    if not found or v_command.status <> 'completed' or v_command.result is distinct from true then
      raise exception 'offboarding_in_progress' using errcode = '40001';
    end if;
    return true;
  end if;

  select user_id into v_user_id from public.organization_members
   where tenant_id = v_profile.tenant_id and id = v_profile.organization_member_id for update;
  update public.employee_profiles
     set employment_status = 'departed', departure_date = current_date, updated_at = clock_timestamp()
   where tenant_id = v_profile.tenant_id and id = v_profile.id;
  update public.external_identities
     set status = 'revoked', auth_user_id = null, updated_at = clock_timestamp()
   where tenant_id = v_profile.tenant_id
     and organization_id = v_profile.organization_id
     and organization_member_id = v_profile.organization_member_id;
  update public.organization_members set status = 'revoked'
   where tenant_id = v_profile.tenant_id and id = v_profile.organization_member_id;
  update public.feishu_access_grants set status = 'cancelled', cancelled_at = clock_timestamp()
   where tenant_id = v_profile.tenant_id
     and organization_id = v_profile.organization_id
     and organization_member_id = v_profile.organization_member_id
     and status = 'queued';
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
    jsonb_build_object(
      'source', 'feishu_webhook',
      'eventIdDigest', encode(digest(btrim(p_event_id), 'sha256'), 'hex')
    )
  );
  update public.feishu_offboarding_commands
     set status = 'completed', result = true, completed_at = clock_timestamp()
   where id = v_command.id;
  return true;
end;
$$;

alter table public.feishu_sync_leases
  add column actor_auth_user_id uuid references auth.users(id) on delete set null;

create or replace function public.current_active_workspace_organization_id()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select identity.organization_id
    from public.external_identities identity
    join public.organization_members member
      on member.tenant_id = identity.tenant_id
     and member.id = identity.organization_member_id
     and member.organization_id = identity.organization_id
   where identity.auth_user_id = auth.uid()
     and identity.status = 'active'
     and member.status = 'active'
   limit 1
$$;

create or replace function public.active_workspace_organization_id(p_auth_user_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select identity.organization_id
    from public.external_identities identity
    join public.organization_members member
      on member.tenant_id = identity.tenant_id
     and member.id = identity.organization_member_id
     and member.organization_id = identity.organization_id
   where identity.auth_user_id = p_auth_user_id
     and identity.status = 'active'
     and member.status = 'active'
   limit 1
$$;

drop policy if exists feishu_sync_conflicts_manager_select on public.feishu_sync_conflicts;
create policy feishu_sync_conflicts_manager_select on public.feishu_sync_conflicts
for select to authenticated using (
  organization_id = (select public.current_active_workspace_organization_id())
  and exists (
    select 1 from public.organization_members member
    join public.member_roles assignment on assignment.member_id = member.id
    join public.role_permissions rp on rp.role_id = assignment.role_id
    join public.permissions permission on permission.id = rp.permission_id
    where member.user_id = (select auth.uid()) and member.status = 'active'
      and member.organization_id = feishu_sync_conflicts.organization_id
      and permission.code = 'organization.manage'
  )
);

drop policy if exists feishu_webhook_events_manager_select on public.feishu_webhook_events;
create policy feishu_webhook_events_manager_select on public.feishu_webhook_events
for select to authenticated using (
  organization_id = (select public.current_active_workspace_organization_id())
  and exists (
    select 1 from public.organization_members member
    join public.member_roles assignment on assignment.member_id = member.id
    join public.role_permissions rp on rp.role_id = assignment.role_id
    join public.permissions permission on permission.id = rp.permission_id
    where member.user_id = (select auth.uid()) and member.status = 'active'
      and member.organization_id = feishu_webhook_events.organization_id
      and permission.code = 'organization.manage'
  )
);

drop policy if exists directory_sync_runs_org_manager_select on public.directory_sync_runs;
create policy directory_sync_runs_org_manager_select on public.directory_sync_runs
for select to authenticated using (
  organization_id = (select public.current_active_workspace_organization_id())
  and exists (
    select 1 from public.organization_members member
    join public.member_roles assignment on assignment.member_id = member.id
    join public.role_permissions rp on rp.role_id = assignment.role_id
    join public.permissions permission on permission.id = rp.permission_id
    where member.user_id = (select auth.uid()) and member.status = 'active'
      and member.organization_id = directory_sync_runs.organization_id
      and permission.code = 'organization.manage'
  )
);

drop function if exists public.claim_feishu_sync_work(text, text, text, integer);
create function public.claim_feishu_sync_work(
  p_mode text,
  p_cursor text,
  p_provider_tenant_key text,
  p_lease_seconds integer default 120,
  p_organization_public_id uuid default null,
  p_actor_auth_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection record;
  v_lease public.feishu_sync_leases%rowtype;
  v_run_id uuid;
  v_attempt integer := 1;
  v_actor uuid;
  v_previous_cursor text;
begin
  if p_mode not in ('full', 'incremental', 'reconcile')
     or p_lease_seconds not between 30 and 600
     or nullif(btrim(p_provider_tenant_key), '') is null
     or ((p_organization_public_id is null) <> (p_actor_auth_user_id is null)) then
    raise exception 'sync_claim_invalid' using errcode = '22023';
  end if;
  if p_mode = 'incremental' and (p_cursor is null or p_cursor !~ '^[1-9][0-9]{0,18}$') then
    return jsonb_build_object(
      'acquired', false, 'runId', null, 'cursor', null, 'attempt', 0,
      'reason', 'invalid_cursor', 'retryAfter', null
    );
  end if;

  select connection.id, connection.tenant_id, connection.organization_id,
         tenant.public_id as tenant_public_id,
         organization.public_id as organization_public_id
    into v_connection
    from public.directory_connections connection
    join public.identity_providers provider
      on provider.tenant_id = connection.tenant_id
     and provider.id = connection.identity_provider_id
    join public.tenants tenant on tenant.id = connection.tenant_id and tenant.status = 'active'
    join public.organizations organization
      on organization.tenant_id = connection.tenant_id
     and organization.id = connection.organization_id
   where connection.status = 'active'
     and provider.provider_code = 'feishu' and provider.status = 'active'
     and provider.provider_tenant_key = p_provider_tenant_key
     and connection.external_tenant_key = p_provider_tenant_key
     and (p_organization_public_id is null or organization.public_id = p_organization_public_id)
   order by connection.last_sync_at nulls first, connection.id
   for update of connection limit 1;
  if not found then
    return jsonb_build_object(
      'acquired', false, 'runId', null, 'cursor', p_cursor, 'attempt', 0,
      'reason', 'no_connection', 'retryAfter', null
    );
  end if;

  if p_actor_auth_user_id is not null then
    if public.active_workspace_organization_id(p_actor_auth_user_id) is distinct from v_connection.organization_id
       or not exists (
         select 1 from public.organization_members member
         join public.member_roles assignment on assignment.member_id = member.id
         join public.role_permissions rp on rp.role_id = assignment.role_id
         join public.permissions permission on permission.id = rp.permission_id
        where member.user_id = p_actor_auth_user_id and member.status = 'active'
          and member.organization_id = v_connection.organization_id
          and permission.code = 'organization.manage'
       ) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    v_actor := p_actor_auth_user_id;
  else
    select member.user_id into v_actor
      from public.organization_members member
      join public.external_identities identity
        on identity.tenant_id = member.tenant_id and identity.organization_member_id = member.id
       and identity.organization_id = member.organization_id and identity.status = 'active'
       and identity.auth_user_id = member.user_id
      join public.member_roles assignment on assignment.member_id = member.id
      join public.role_permissions rp on rp.role_id = assignment.role_id
      join public.permissions permission on permission.id = rp.permission_id
     where member.tenant_id = v_connection.tenant_id
       and member.organization_id = v_connection.organization_id
       and member.status = 'active' and member.user_id is not null
       and permission.code = 'organization.manage'
     order by member.id limit 1;
    if v_actor is null then raise exception 'sync_actor_missing' using errcode = '42501'; end if;
  end if;

  select * into v_lease from public.feishu_sync_leases
   where connection_id = v_connection.id for update;
  if found and v_lease.status = 'running' and v_lease.lease_expires_at > now() then
    return jsonb_build_object(
      'acquired', false, 'runId', v_lease.run_id, 'cursor', v_lease.cursor,
      'attempt', v_lease.attempt, 'reason', 'active_lease',
      'retryAfter', v_lease.lease_expires_at
    );
  end if;
  if found and v_lease.status = 'retry' and v_lease.retry_after > now() then
    return jsonb_build_object(
      'acquired', false, 'runId', v_lease.run_id, 'cursor', v_lease.cursor,
      'attempt', v_lease.attempt, 'reason', 'backoff',
      'retryAfter', v_lease.retry_after
    );
  end if;
  if p_mode = 'incremental' and not exists (
    select 1 from public.feishu_webhook_events event
     where event.connection_id = v_connection.id and event.id::text = p_cursor
  ) then
    return jsonb_build_object(
      'acquired', false, 'runId', null, 'cursor', null, 'attempt', 0,
      'reason', 'invalid_cursor', 'retryAfter', null
    );
  end if;

  v_run_id := gen_random_uuid();
  v_previous_cursor := v_lease.cursor;
  v_attempt := case when v_lease.status = 'retry' then least(v_lease.attempt + 1, 9) else 1 end;
  insert into public.feishu_sync_leases (
    connection_id, tenant_id, organization_id, run_id, mode, cursor, status,
    attempt, lease_expires_at, retry_after, started_at, completed_at, actor_auth_user_id
  ) values (
    v_connection.id, v_connection.tenant_id, v_connection.organization_id,
    v_run_id, p_mode, coalesce(p_cursor, v_previous_cursor), 'running', v_attempt,
    now() + make_interval(secs => p_lease_seconds), null, now(), null, v_actor
  ) on conflict (connection_id) do update set
    run_id = excluded.run_id, mode = excluded.mode,
    cursor = coalesce(excluded.cursor, public.feishu_sync_leases.cursor),
    status = 'running', attempt = excluded.attempt,
    lease_expires_at = excluded.lease_expires_at, retry_after = null,
    started_at = now(), completed_at = null, actor_auth_user_id = excluded.actor_auth_user_id;
  return jsonb_build_object(
    'acquired', true, 'runId', v_run_id,
    'cursor', coalesce(p_cursor, v_previous_cursor), 'attempt', v_attempt,
    'tenantId', v_connection.tenant_public_id,
    'organizationId', v_connection.organization_public_id,
    'actorAuthUserId', v_actor, 'retryAfter', null
  );
end;
$$;

create or replace function public.heartbeat_feishu_sync_work(
  p_run_id uuid,
  p_organization_public_id uuid,
  p_lease_seconds integer default 120
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_lease_seconds not between 30 and 600 then
    raise exception 'sync_heartbeat_invalid' using errcode = '22023';
  end if;
  update public.feishu_sync_leases lease
     set lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds)
    from public.organizations organization
   where lease.organization_id = organization.id
     and lease.tenant_id = organization.tenant_id
     and lease.run_id = p_run_id
     and organization.public_id = p_organization_public_id
     and lease.status = 'running'
     and lease.lease_expires_at > now();
  return found;
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
  v_lease public.feishu_sync_leases%rowtype;
  v_tenant_public_id uuid;
begin
  select lease, tenant.public_id into strict v_lease, v_tenant_public_id
    from public.feishu_sync_leases lease
    join public.organizations organization
      on organization.tenant_id = lease.tenant_id and organization.id = lease.organization_id
    join public.tenants tenant on tenant.id = lease.tenant_id
   where lease.run_id = p_run_id
     and organization.public_id = p_organization_public_id
     and lease.actor_auth_user_id = p_actor_auth_user_id
     and lease.status = 'running'
     and lease.lease_expires_at > now()
   for update of lease;
  return public.apply_feishu_directory_sync_exact(
    v_tenant_public_id, p_organization_public_id, p_actor_auth_user_id, p_snapshot
  );
exception
  when no_data_found then
    raise exception 'sync_lease_stale' using errcode = '55000';
end;
$$;

drop function if exists public.finish_feishu_sync_work(uuid, text, text, timestamptz);
create function public.finish_feishu_sync_work(
  p_run_id uuid,
  p_cursor text,
  p_status text,
  p_retry_after timestamptz,
  p_organization_public_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_lease public.feishu_sync_leases%rowtype;
begin
  if p_status not in ('completed', 'retry')
     or (p_status = 'retry') <> (p_retry_after is not null)
     or p_organization_public_id is null then
    raise exception 'sync_finish_invalid' using errcode = '22023';
  end if;
  update public.feishu_sync_leases lease set
    cursor = p_cursor, status = p_status, retry_after = p_retry_after,
    completed_at = clock_timestamp(), lease_expires_at = clock_timestamp()
   from public.organizations organization
   where lease.organization_id = organization.id
     and lease.tenant_id = organization.tenant_id
     and lease.run_id = p_run_id and lease.status = 'running'
     and organization.public_id = p_organization_public_id
  returning lease.* into v_lease;
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
declare
  v_scope record;
  v_issue public.feishu_sync_conflicts%rowtype;
begin
  select organization.tenant_id, organization.id as organization_id, member.id as member_id
    into v_scope
    from public.organizations organization
    join public.organization_members member
      on member.tenant_id = organization.tenant_id and member.organization_id = organization.id
    join public.member_roles assignment on assignment.member_id = member.id
    join public.role_permissions rp on rp.role_id = assignment.role_id
    join public.permissions permission on permission.id = rp.permission_id
   where organization.public_id = p_organization_public_id
     and organization.id = public.active_workspace_organization_id(p_actor_auth_user_id)
     and member.user_id = p_actor_auth_user_id and member.status = 'active'
     and permission.code = 'organization.manage'
   limit 1;
  if not found then raise exception 'forbidden' using errcode = '42501'; end if;

  select * into v_issue from public.feishu_sync_conflicts
   where public_id = p_issue_public_id and tenant_id = v_scope.tenant_id
     and organization_id = v_scope.organization_id for update;
  if not found then return 'not_found'; end if;
  if v_issue.status = 'resolved' then return 'resolved'; end if;
  update public.feishu_sync_conflicts set
    status = 'resolved', resolved_at = clock_timestamp(),
    resolved_by_auth_user_id = p_actor_auth_user_id
   where id = v_issue.id;
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

revoke all on function public.current_active_workspace_organization_id() from public, anon, authenticated, service_role;
grant execute on function public.current_active_workspace_organization_id() to authenticated;
revoke all on function public.active_workspace_organization_id(uuid) from public, anon, authenticated, service_role;
revoke all on function public.apply_feishu_directory_sync_exact(uuid, uuid, uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.claim_feishu_sync_work(text, text, text, integer, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.claim_feishu_sync_work(text, text, text, integer, uuid, uuid) to service_role;
revoke all on function public.heartbeat_feishu_sync_work(uuid, uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.heartbeat_feishu_sync_work(uuid, uuid, integer) to service_role;
revoke all on function public.apply_feishu_directory_sync_fenced(uuid, uuid, uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.apply_feishu_directory_sync_fenced(uuid, uuid, uuid, jsonb) to service_role;
revoke all on function public.finish_feishu_sync_work(uuid, text, text, timestamptz, uuid) from public, anon, authenticated, service_role;
grant execute on function public.finish_feishu_sync_work(uuid, text, text, timestamptz, uuid) to service_role;
revoke all on function public.resolve_feishu_sync_issue(uuid, uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.resolve_feishu_sync_issue(uuid, uuid, uuid) to service_role;
