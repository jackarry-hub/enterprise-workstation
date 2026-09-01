-- Forward-only verified business file delivery. This migration follows
-- 202608270006 and preserves the existing tenant, project ACL, and audit model.
alter table public.organization_members
  add column if not exists public_id uuid not null default gen_random_uuid();

create unique index if not exists organization_members_public_id_idx
  on public.organization_members(public_id);

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

alter table public.files
  add column tenant_id bigint,
  add column uploaded_by_member_id bigint,
  add column sha256 text,
  add column storage_object_id uuid,
  add column storage_object_version text,
  add column storage_etag text,
  add column verified_at timestamptz,
  add column version bigint not null default 1;

update public.files file
set tenant_id = organization.tenant_id,
    uploaded_by_member_id = member.id
from public.organizations organization
join public.organization_members member
  on member.tenant_id = organization.tenant_id
 and member.organization_id = organization.id
where organization.id = file.organization_id
  and member.user_id = file.uploaded_by;

do $file_backfill_preflight$
begin
  if exists (
    select 1 from public.files file
    where file.tenant_id is null or file.uploaded_by_member_id is null
  ) then
    raise exception 'Historical file tenant or uploader membership must be resolved before upgrade';
  end if;
end;
$file_backfill_preflight$;

do $legacy_file_verification_preflight$
begin
  if exists (select 1 from public.files) then
    raise exception using
      message = 'Historical files require an offline byte-hash and storage-object verification migration before enabling verified file delivery',
      hint = 'Run the documented legacy file re-verification procedure, then apply this migration to an empty legacy-file backlog';
  end if;
end;
$legacy_file_verification_preflight$;

alter table public.files
  alter column tenant_id set not null,
  alter column uploaded_by_member_id set not null,
  add constraint files_tenant_organization_id_key unique (tenant_id, organization_id, id),
  add constraint files_exact_organization_fkey foreign key (tenant_id, organization_id)
    references public.organizations(tenant_id, id) on delete restrict,
  add constraint files_exact_project_fkey foreign key (tenant_id, organization_id, project_id)
    references public.projects(tenant_id, organization_id, id) on delete cascade,
  add constraint files_uploader_tenant_fkey foreign key (tenant_id, uploaded_by_member_id)
    references public.organization_members(tenant_id, id) on delete restrict,
  add constraint files_uploader_organization_fkey foreign key (organization_id, uploaded_by_member_id)
    references public.organization_members(organization_id, id) on delete restrict,
  add constraint files_sha256_check check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  add constraint files_version_check check (version > 0),
  add constraint files_verified_object_check check (
    verified_at is null
    or (sha256 is not null and storage_object_id is not null and size_bytes > 0)
  );

alter table public.file_relations add column tenant_id bigint;

update public.file_relations relation
set tenant_id = project.tenant_id
from public.projects project
where project.organization_id = relation.organization_id
  and project.id = relation.project_id;

do $file_relation_backfill_preflight$
begin
  if exists (select 1 from public.file_relations relation where relation.tenant_id is null) then
    raise exception 'Historical file relation tenant must be resolved before upgrade';
  end if;
end;
$file_relation_backfill_preflight$;

alter table public.file_relations
  alter column tenant_id set not null,
  add constraint file_relations_tenant_organization_id_key unique (tenant_id, organization_id, id),
  add constraint file_relations_exact_project_fkey foreign key (tenant_id, organization_id, project_id)
    references public.projects(tenant_id, organization_id, id) on delete cascade,
  add constraint file_relations_exact_file_fkey foreign key (tenant_id, organization_id, file_id)
    references public.files(tenant_id, organization_id, id) on delete cascade,
  add constraint file_relations_creator_tenant_fkey foreign key (tenant_id, created_by_member_id)
    references public.organization_members(tenant_id, id) on delete restrict;

create or replace function public.enforce_file_actor_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.organization_members member
    where member.tenant_id = new.tenant_id
      and member.organization_id = new.organization_id
      and member.id = new.uploaded_by_member_id
      and member.user_id = new.uploaded_by
  ) then
    raise exception 'File uploader identity is inconsistent' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger files_actor_identity_guard
before insert or update of tenant_id, organization_id, uploaded_by_member_id, uploaded_by
on public.files
for each row execute function public.enforce_file_actor_identity();

create table public.file_upload_reservations (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete restrict,
  organization_id bigint not null,
  project_id bigint not null,
  actor_auth_user_id uuid not null references auth.users(id) on delete restrict,
  actor_member_id bigint not null,
  idempotency_key uuid not null,
  request_id uuid not null,
  payload_digest text not null check (payload_digest ~ '^[0-9a-f]{64}$'),
  bucket text not null check (bucket = 'workbench-files'),
  object_path text not null,
  original_name text not null check (length(btrim(original_name)) between 1 and 180),
  mime_type text not null,
  expected_size_bytes bigint not null check (expected_size_bytes between 1 and 31457280),
  expected_sha256 text not null check (expected_sha256 ~ '^[0-9a-f]{64}$'),
  access_scope text not null check (access_scope in ('organization', 'restricted', 'private')),
  state text not null default 'pending' check (state in ('pending', 'completed', 'failed', 'expired')),
  failure_code text,
  expires_at timestamptz not null,
  signed_upload_expires_at timestamptz,
  verification_token uuid,
  verification_claimed_at timestamptz,
  verification_lease_expires_at timestamptz,
  storage_object_id uuid,
  storage_object_version text,
  storage_etag text,
  verified_at timestamptz,
  file_id bigint,
  result jsonb,
  cleanup_token uuid,
  cleanup_claimed_at timestamptz,
  cleaned_at timestamptz,
  cleanup_error text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (tenant_id, actor_member_id, idempotency_key),
  unique (bucket, object_path),
  foreign key (tenant_id, organization_id)
    references public.organizations(tenant_id, id) on delete restrict,
  foreign key (tenant_id, organization_id, project_id)
    references public.projects(tenant_id, organization_id, id) on delete cascade,
  foreign key (tenant_id, actor_member_id)
    references public.organization_members(tenant_id, id) on delete restrict,
  foreign key (organization_id, actor_member_id)
    references public.organization_members(organization_id, id) on delete restrict,
  foreign key (tenant_id, organization_id, file_id)
    references public.files(tenant_id, organization_id, id) on delete restrict,
  constraint file_upload_reservation_terminal_check check (
    (state = 'pending' and failure_code is null and file_id is null and result is null)
    or (state = 'completed' and failure_code is null and file_id is not null
      and verified_at is not null and storage_object_id is not null and result is not null)
    or (state in ('failed', 'expired') and failure_code is not null and file_id is null and result is null)
  )
);

create index file_upload_reservations_cleanup_idx
  on public.file_upload_reservations (state, expires_at, cleanup_claimed_at)
  where cleaned_at is null and state in ('pending', 'failed', 'expired');
create index file_upload_reservations_project_created_idx
  on public.file_upload_reservations (tenant_id, organization_id, project_id, created_at desc);

alter table public.files enable row level security;
alter table public.files force row level security;
alter table public.file_relations enable row level security;
alter table public.file_relations force row level security;
alter table public.file_upload_reservations enable row level security;
alter table public.file_upload_reservations force row level security;

drop policy if exists files_authorized_select on public.files;
drop policy if exists files_contributor_insert on public.files;
drop policy if exists files_uploader_or_manager_update on public.files;
create policy files_authorized_select_v2 on public.files
for select to authenticated
using (
  deleted_at is null
  and (
    (
      project_id is null
      and public.is_organization_member(organization_id)
      and (
        access_scope = 'organization'
        or uploaded_by = (select auth.uid())
        or public.has_organization_role(
          organization_id, array['owner', 'admin', 'department_head', 'hr', 'finance']
        )
      )
    )
    or (
      project_id is not null
      and public.can_view_project(project_id)
      and (
        access_scope <> 'private'
        or uploaded_by = (select auth.uid())
        or public.can_manage_project(project_id)
      )
    )
  )
);

drop policy if exists file_relations_insert on public.file_relations;
drop policy if exists file_relations_delete on public.file_relations;

-- Signed upload tokens and service-role verification replace direct browser
-- object access. A signed token does not require an objects-table policy.
drop policy if exists workbench_files_owner_insert on storage.objects;
drop policy if exists workbench_files_owner_read on storage.objects;
drop policy if exists workbench_files_owner_update on storage.objects;
drop policy if exists workbench_files_owner_delete on storage.objects;

create or replace function public.project_file_entity(p_file_id bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', file.public_id,
    'organizationId', organization.public_id,
    'projectId', project.public_id,
    'taskId', task.public_id,
    'bucket', file.bucket,
    'objectPath', file.object_path,
    'originalName', file.original_name,
    'mimeType', file.mime_type,
    'sizeBytes', file.size_bytes,
    'sha256', file.sha256,
    'accessScope', file.access_scope,
    'uploadedById', uploader.public_id,
    'verifiedAt', file.verified_at,
    'createdAt', file.created_at
  )
  from public.files file
  join public.organizations organization
    on organization.tenant_id = file.tenant_id
   and organization.id = file.organization_id
  join public.projects project
    on project.tenant_id = file.tenant_id
   and project.organization_id = file.organization_id
   and project.id = file.project_id
  join public.organization_members uploader
    on uploader.tenant_id = file.tenant_id
   and uploader.organization_id = file.organization_id
   and uploader.id = file.uploaded_by_member_id
  left join public.tasks task
    on task.tenant_id = file.tenant_id
   and task.organization_id = file.organization_id
   and task.id = file.task_id
  where file.id = p_file_id
    and file.deleted_at is null
    and file.verified_at is not null;
$$;

create or replace function public.file_upload_reservation_result(
  p_reservation public.file_upload_reservations
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_reservation.state = 'completed' then p_reservation.result
    when p_reservation.state = 'failed' then
      jsonb_build_object('outcome', 'failure', 'error', coalesce(p_reservation.failure_code, 'command_failed'))
    when p_reservation.state = 'expired' then
      jsonb_build_object('outcome', 'failure', 'error', 'upload_expired')
    else jsonb_build_object(
      'outcome', 'success',
      'state', 'pending',
      'uploadId', p_reservation.public_id,
      'projectId', project.public_id,
      'bucket', p_reservation.bucket,
      'objectPath', p_reservation.object_path,
      'originalName', p_reservation.original_name,
      'mimeType', p_reservation.mime_type,
      'sizeBytes', p_reservation.expected_size_bytes,
      'sha256', p_reservation.expected_sha256,
      'accessScope', p_reservation.access_scope,
      'expiresAt', p_reservation.expires_at
    )
  end
  from public.projects project
  where project.tenant_id = p_reservation.tenant_id
    and project.organization_id = p_reservation.organization_id
    and project.id = p_reservation.project_id;
$$;

create or replace function public.reserve_current_project_file_upload(
  p_project_public_id uuid,
  p_original_name text,
  p_mime_type text,
  p_size_bytes bigint,
  p_expected_sha256 text,
  p_access_scope text,
  p_idempotency_key uuid,
  p_request_id uuid
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
  v_access_state text;
  v_tenant_public_id uuid;
  v_org_public_id uuid;
  v_upload_public_id uuid := gen_random_uuid();
  v_extension text;
  v_object_path text;
  v_payload jsonb;
  v_digest text;
  v_inserted_id bigint;
  v_row public.file_upload_reservations%rowtype;
begin
  select identity.tenant_id, identity.organization_id, identity.actor_member_id,
         identity.actor_auth_user_id, identity.actor_employee_public_id
    into strict v_tenant, v_org, v_actor, v_user, v_actor_employee
  from public.current_project_execution_identity() identity;

  if p_project_public_id is null or p_idempotency_key is null or p_request_id is null
     or p_original_name is null or length(btrim(p_original_name)) not between 1 and 180
     or p_original_name ~ '[\\/[:cntrl:]]'
     or p_size_bytes is null or p_size_bytes not between 1 and 31457280
     or p_expected_sha256 is null or lower(p_expected_sha256) !~ '^[0-9a-f]{64}$'
     or p_mime_type is null
     or p_access_scope is null or p_access_scope not in ('organization', 'restricted', 'private') then
    return jsonb_build_object('outcome', 'failure', 'error', 'invalid_request');
  end if;
  v_extension := lower(substring(btrim(p_original_name) from '\.([^.]+)$'));
  if v_extension is null or not (
    (lower(p_mime_type) = 'application/pdf' and v_extension = 'pdf')
    or (lower(p_mime_type) = 'text/plain' and v_extension in ('txt', 'md'))
    or (lower(p_mime_type) = 'text/csv' and v_extension = 'csv')
    or (lower(p_mime_type) = 'image/jpeg' and v_extension in ('jpg', 'jpeg'))
    or (lower(p_mime_type) = 'image/png' and v_extension = 'png')
    or (lower(p_mime_type) = 'image/webp' and v_extension = 'webp')
    or (lower(p_mime_type) = 'application/zip' and v_extension = 'zip')
    or (lower(p_mime_type) = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' and v_extension = 'docx')
    or (lower(p_mime_type) = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' and v_extension = 'xlsx')
    or (lower(p_mime_type) = 'application/vnd.openxmlformats-officedocument.presentationml.presentation' and v_extension = 'pptx')
  ) then
    return jsonb_build_object('outcome', 'failure', 'error', 'invalid_request');
  end if;

  select access.project_id, access.project_public_id, access.access_state
    into strict v_project_id, v_project_public_id, v_access_state
  from public.lock_current_project_execution_access(
    v_tenant, v_org, v_actor, p_project_public_id, 'contribute'
  ) access;
  if v_access_state <> 'allowed' then
    perform public.append_audit_log(
      v_tenant, v_org, v_user, v_actor, 'file.upload_failed', 'project_file',
      p_project_public_id::text, p_request_id, null,
      jsonb_build_object('outcome', 'failure', 'failure', v_access_state)
    );
    return jsonb_build_object('outcome', 'failure', 'error', v_access_state);
  end if;

  select tenant.public_id, organization.public_id
    into strict v_tenant_public_id, v_org_public_id
  from public.tenants tenant
  join public.organizations organization
    on organization.tenant_id = tenant.id and organization.id = v_org
  where tenant.id = v_tenant;

  v_object_path := format(
    'tenants/%s/organizations/%s/projects/%s/uploads/%s/%s.%s',
    v_tenant_public_id, v_org_public_id, v_project_public_id,
    v_upload_public_id, v_upload_public_id, v_extension
  );
  v_payload := jsonb_build_object(
    'projectId', p_project_public_id, 'originalName', btrim(p_original_name),
    'mimeType', lower(p_mime_type), 'sizeBytes', p_size_bytes,
    'sha256', lower(p_expected_sha256), 'accessScope', p_access_scope
  );
  v_digest := encode(public.digest(convert_to(v_payload::text, 'UTF8'), 'sha256'), 'hex');

  insert into public.file_upload_reservations(
    public_id, tenant_id, organization_id, project_id,
    actor_auth_user_id, actor_member_id, idempotency_key, request_id,
    payload_digest, bucket, object_path, original_name, mime_type,
    expected_size_bytes, expected_sha256, access_scope, expires_at
  ) values (
    v_upload_public_id, v_tenant, v_org, v_project_id,
    v_user, v_actor, p_idempotency_key, p_request_id,
    v_digest, 'workbench-files', v_object_path, btrim(p_original_name), lower(p_mime_type),
    p_size_bytes, lower(p_expected_sha256), p_access_scope, clock_timestamp() + interval '2 hours 5 minutes'
  ) on conflict (tenant_id, actor_member_id, idempotency_key) do nothing
  returning id into v_inserted_id;

  select * into strict v_row
  from public.file_upload_reservations reservation
  where reservation.tenant_id = v_tenant
    and reservation.actor_member_id = v_actor
    and reservation.idempotency_key = p_idempotency_key
  for update;

  if v_row.organization_id <> v_org or v_row.project_id <> v_project_id
     or v_row.actor_auth_user_id <> v_user or v_row.payload_digest <> v_digest then
    perform public.append_audit_log(
      v_tenant, v_org, v_user, v_actor, 'file.upload_failed', 'project_file',
      p_project_public_id::text, p_request_id, null,
      jsonb_build_object('outcome', 'failure', 'failure', 'scope_conflict')
    );
    return jsonb_build_object('outcome', 'failure', 'error', 'scope_conflict');
  end if;

  if v_inserted_id is not null then
    perform public.append_audit_log(
      v_tenant, v_org, v_user, v_actor, 'file.upload_reserved', 'file_upload',
      v_row.public_id::text, p_request_id, null,
      jsonb_build_object(
        'outcome', 'success', 'projectId', p_project_public_id,
        'sizeBytes', p_size_bytes, 'mimeType', lower(p_mime_type),
        'accessScope', p_access_scope, 'expiresAt', v_row.expires_at
      )
    );
  end if;
  if v_row.state = 'pending' and v_row.expires_at <= clock_timestamp() then
    update public.file_upload_reservations reservation
    set state = 'expired', failure_code = 'upload_expired', updated_at = clock_timestamp()
    where reservation.id = v_row.id
    returning * into strict v_row;
    perform public.append_audit_log(
      v_tenant, v_org, v_user, v_actor, 'file.upload_expired', 'file_upload',
      v_row.public_id::text, p_request_id, null,
      jsonb_build_object('outcome', 'failure', 'failure', 'upload_expired')
    );
  end if;
  return public.file_upload_reservation_result(v_row);
exception when others then
  begin
    if v_tenant is not null and v_org is not null and v_user is not null and v_actor is not null then
      perform public.append_audit_log(
        v_tenant, v_org, v_user, v_actor, 'file.upload_failed', 'project_file',
        p_project_public_id::text, p_request_id, null,
        jsonb_build_object('outcome', 'failure', 'failure', 'command_failed')
      );
    end if;
  exception when others then
    null;
  end;
  return jsonb_build_object('outcome', 'failure', 'error', 'command_failed');
end;
$$;

create or replace function public.record_current_file_upload_signed(
  p_upload_public_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.file_upload_reservations%rowtype;
  v_token_expires_at timestamptz := clock_timestamp() + interval '2 hours';
  v_cleanup_not_before timestamptz := clock_timestamp() + interval '2 hours 5 minutes';
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Signed upload issuance requires service role' using errcode = '42501';
  end if;
  if p_upload_public_id is null or p_request_id is null then
    return jsonb_build_object('outcome', 'failure', 'error', 'invalid_request');
  end if;
  select * into v_row
  from public.file_upload_reservations reservation
  where reservation.public_id = p_upload_public_id
  for update;
  if not found then return jsonb_build_object('outcome', 'failure', 'error', 'not_found'); end if;
  if v_row.state = 'completed' then return v_row.result; end if;
  if v_row.state in ('failed', 'expired') then return public.file_upload_reservation_result(v_row); end if;
  if v_row.expires_at <= clock_timestamp() then
    update public.file_upload_reservations reservation
    set state = 'expired', failure_code = 'upload_expired', updated_at = clock_timestamp()
    where reservation.id = v_row.id returning * into strict v_row;
    perform public.append_audit_log(
      v_row.tenant_id, v_row.organization_id, v_row.actor_auth_user_id,
      v_row.actor_member_id, 'file.upload_expired', 'file_upload',
      v_row.public_id::text, p_request_id, null,
      jsonb_build_object('outcome', 'failure', 'failure', 'upload_expired')
    );
    return public.file_upload_reservation_result(v_row);
  end if;
  update public.file_upload_reservations reservation
  set signed_upload_expires_at = greatest(
        coalesce(reservation.signed_upload_expires_at, '-infinity'::timestamptz),
        v_token_expires_at
      ),
      expires_at = greatest(reservation.expires_at, v_cleanup_not_before),
      updated_at = clock_timestamp()
  where reservation.id = v_row.id
  returning * into strict v_row;
  return public.file_upload_reservation_result(v_row)
    || jsonb_build_object('uploadTokenExpiresAt', v_token_expires_at);
end;
$$;

create or replace function public.claim_current_file_upload_verification(
  p_upload_public_id uuid,
  p_verification_token uuid,
  p_request_id uuid
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
  v_project_public_id uuid;
  v_project_id bigint;
  v_access_state text;
  v_row public.file_upload_reservations%rowtype;
  v_lease_expires_at timestamptz := clock_timestamp() + interval '10 minutes';
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'File verification claim requires service role' using errcode = '42501';
  end if;
  if p_upload_public_id is null or p_verification_token is null or p_request_id is null then
    return jsonb_build_object('outcome', 'failure', 'error', 'invalid_request');
  end if;
  select reservation, project.public_id
    into v_row, v_project_public_id
  from public.file_upload_reservations reservation
  join public.projects project
    on project.tenant_id = reservation.tenant_id
   and project.organization_id = reservation.organization_id
   and project.id = reservation.project_id
  where reservation.public_id = p_upload_public_id;
  if not found then return jsonb_build_object('outcome', 'failure', 'error', 'not_found'); end if;
  v_tenant := v_row.tenant_id;
  v_org := v_row.organization_id;
  v_actor := v_row.actor_member_id;
  v_user := v_row.actor_auth_user_id;
  select access.project_id, access.access_state into strict v_project_id, v_access_state
  from public.lock_current_project_execution_access(
    v_tenant, v_org, v_actor, v_project_public_id, 'contribute'
  ) access;
  if v_access_state <> 'allowed' then
    return jsonb_build_object('outcome', 'failure', 'error', v_access_state);
  end if;
  select * into strict v_row
  from public.file_upload_reservations reservation
  where reservation.tenant_id = v_tenant
    and reservation.organization_id = v_org
    and reservation.project_id = v_project_id
    and reservation.actor_member_id = v_actor
    and reservation.actor_auth_user_id = v_user
    and reservation.public_id = p_upload_public_id
  for update;
  if v_row.state = 'completed' then return v_row.result; end if;
  if v_row.state in ('failed', 'expired') then return public.file_upload_reservation_result(v_row); end if;
  if v_row.expires_at <= clock_timestamp() then
    update public.file_upload_reservations reservation
    set state = 'expired', failure_code = 'upload_expired',
        verification_token = null, verification_claimed_at = null,
        verification_lease_expires_at = null, updated_at = clock_timestamp()
    where reservation.id = v_row.id returning * into strict v_row;
    perform public.append_audit_log(
      v_tenant, v_org, v_user, v_actor, 'file.upload_expired', 'file_upload',
      p_upload_public_id::text, p_request_id, null,
      jsonb_build_object('outcome', 'failure', 'failure', 'upload_expired')
    );
    return public.file_upload_reservation_result(v_row);
  end if;
  if v_row.verification_token is not null
     and v_row.verification_token is distinct from p_verification_token
     and v_row.verification_lease_expires_at > clock_timestamp() then
    return jsonb_build_object('outcome', 'failure', 'error', 'verification_in_progress');
  end if;
  update public.file_upload_reservations reservation
  set verification_token = p_verification_token,
      verification_claimed_at = clock_timestamp(),
      verification_lease_expires_at = v_lease_expires_at,
      expires_at = greatest(reservation.expires_at, v_lease_expires_at),
      updated_at = clock_timestamp()
  where reservation.id = v_row.id
  returning * into strict v_row;
  return public.file_upload_reservation_result(v_row) || jsonb_build_object(
    'verificationToken', p_verification_token,
    'verificationLeaseExpiresAt', v_row.verification_lease_expires_at
  );
end;
$$;

create or replace function public.release_current_file_upload_verification(
  p_upload_public_id uuid,
  p_verification_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'File verification release requires service role' using errcode = '42501';
  end if;
  if p_upload_public_id is null or p_verification_token is null then
    raise exception 'Invalid verification release' using errcode = '22023';
  end if;
  update public.file_upload_reservations reservation
  set verification_token = null,
      verification_claimed_at = null,
      verification_lease_expires_at = null,
      updated_at = clock_timestamp()
  where reservation.public_id = p_upload_public_id
    and reservation.state = 'pending'
    and reservation.verification_token = p_verification_token;
  return found;
end;
$$;

create or replace function public.inspect_current_file_upload(p_upload_public_id uuid)
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
  v_project_public_id uuid;
  v_project_id bigint;
  v_access_state text;
  v_row public.file_upload_reservations%rowtype;
begin
  select identity.tenant_id, identity.organization_id, identity.actor_member_id,
         identity.actor_auth_user_id, identity.actor_employee_public_id
    into strict v_tenant, v_org, v_actor, v_user, v_actor_employee
  from public.current_project_execution_identity() identity;

  select project.public_id into v_project_public_id
  from public.file_upload_reservations reservation
  join public.projects project
    on project.tenant_id = reservation.tenant_id
   and project.organization_id = reservation.organization_id
   and project.id = reservation.project_id
  where reservation.tenant_id = v_tenant
    and reservation.organization_id = v_org
    and reservation.actor_member_id = v_actor
    and reservation.actor_auth_user_id = v_user
    and reservation.public_id = p_upload_public_id;
  if not found then return jsonb_build_object('outcome', 'failure', 'error', 'not_found'); end if;

  select access.project_id, access.access_state
    into strict v_project_id, v_access_state
  from public.lock_current_project_execution_access(
    v_tenant, v_org, v_actor, v_project_public_id, 'contribute'
  ) access;
  if v_access_state <> 'allowed' then
    return jsonb_build_object('outcome', 'failure', 'error', v_access_state);
  end if;

  select * into strict v_row
  from public.file_upload_reservations reservation
  where reservation.tenant_id = v_tenant
    and reservation.organization_id = v_org
    and reservation.project_id = v_project_id
    and reservation.actor_member_id = v_actor
    and reservation.actor_auth_user_id = v_user
    and reservation.public_id = p_upload_public_id
  for update;

  if v_row.state = 'pending' and v_row.expires_at <= clock_timestamp() then
    update public.file_upload_reservations reservation
    set state = 'expired', failure_code = 'upload_expired', updated_at = clock_timestamp()
    where reservation.id = v_row.id
    returning * into strict v_row;
    perform public.append_audit_log(
      v_tenant, v_org, v_user, v_actor, 'file.upload_expired', 'file_upload',
      v_row.public_id::text, v_row.request_id, null,
      jsonb_build_object('outcome', 'failure', 'failure', 'upload_expired')
    );
  end if;
  return public.file_upload_reservation_result(v_row);
end;
$$;

create or replace function public.fail_current_file_upload(
  p_upload_public_id uuid,
  p_verification_token uuid,
  p_failure text,
  p_request_id uuid
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
  v_project_public_id uuid;
  v_project_id bigint;
  v_access_state text;
  v_row public.file_upload_reservations%rowtype;
begin
  if p_verification_token is null
     or p_failure not in ('missing_object', 'object_mismatch')
     or p_request_id is null then
    return jsonb_build_object('outcome', 'failure', 'error', 'invalid_request');
  end if;
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Verified file failure requires service role' using errcode = '42501';
  end if;
  select reservation, project.public_id
    into v_row, v_project_public_id
  from public.file_upload_reservations reservation
  join public.projects project
    on project.tenant_id = reservation.tenant_id
   and project.organization_id = reservation.organization_id
   and project.id = reservation.project_id
  where reservation.public_id = p_upload_public_id;
  if not found then return jsonb_build_object('outcome', 'failure', 'error', 'not_found'); end if;
  v_tenant := v_row.tenant_id;
  v_org := v_row.organization_id;
  v_actor := v_row.actor_member_id;
  v_user := v_row.actor_auth_user_id;
  select access.project_id, access.access_state into strict v_project_id, v_access_state
  from public.lock_current_project_execution_access(
    v_tenant, v_org, v_actor, v_project_public_id, 'contribute'
  ) access;
  if v_access_state <> 'allowed' then
    return jsonb_build_object('outcome', 'failure', 'error', v_access_state);
  end if;
  select * into strict v_row from public.file_upload_reservations reservation
  where reservation.tenant_id = v_tenant
    and reservation.organization_id = v_org
    and reservation.project_id = v_project_id
    and reservation.actor_member_id = v_actor
    and reservation.actor_auth_user_id = v_user
    and reservation.public_id = p_upload_public_id
  for update;
  if v_row.state = 'completed' then return v_row.result; end if;
  if v_row.state in ('failed', 'expired') then return public.file_upload_reservation_result(v_row); end if;
  if v_row.verification_token is distinct from p_verification_token
     or v_row.verification_lease_expires_at is null
     or v_row.verification_lease_expires_at <= clock_timestamp() then
    return jsonb_build_object('outcome', 'failure', 'error', 'verification_in_progress');
  end if;
  update public.file_upload_reservations reservation
  set state = 'failed', failure_code = p_failure,
      verification_token = null, verification_claimed_at = null,
      verification_lease_expires_at = null, updated_at = clock_timestamp()
  where reservation.id = v_row.id
  returning * into strict v_row;
  perform public.append_audit_log(
    v_tenant, v_org, v_user, v_actor, 'file.upload_failed', 'file_upload',
    p_upload_public_id::text, p_request_id, null,
    jsonb_build_object('outcome', 'failure', 'failure', p_failure)
  );
  return public.file_upload_reservation_result(v_row);
end;
$$;

create or replace function public.complete_current_project_file_upload(
  p_upload_public_id uuid,
  p_verification_token uuid,
  p_storage_object_id uuid,
  p_storage_version text,
  p_storage_etag text,
  p_verified_size_bytes bigint,
  p_verified_mime_type text,
  p_verified_sha256 text,
  p_request_id uuid
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
  v_project_public_id uuid;
  v_project_id bigint;
  v_access_state text;
  v_row public.file_upload_reservations%rowtype;
  v_file_id bigint;
  v_file_entity jsonb;
  v_result jsonb;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Verified file completion requires service role' using errcode = '42501';
  end if;
  select reservation, project.public_id
    into v_row, v_project_public_id
  from public.file_upload_reservations reservation
  join public.projects project
    on project.tenant_id = reservation.tenant_id
   and project.organization_id = reservation.organization_id
   and project.id = reservation.project_id
  where reservation.public_id = p_upload_public_id;
  if not found then return jsonb_build_object('outcome', 'failure', 'error', 'not_found'); end if;
  v_tenant := v_row.tenant_id;
  v_org := v_row.organization_id;
  v_actor := v_row.actor_member_id;
  v_user := v_row.actor_auth_user_id;
  select access.project_id, access.access_state into strict v_project_id, v_access_state
  from public.lock_current_project_execution_access(
    v_tenant, v_org, v_actor, v_project_public_id, 'contribute'
  ) access;
  if v_access_state <> 'allowed' then
    return jsonb_build_object('outcome', 'failure', 'error', v_access_state);
  end if;
  select * into strict v_row from public.file_upload_reservations reservation
  where reservation.tenant_id = v_tenant
    and reservation.organization_id = v_org
    and reservation.project_id = v_project_id
    and reservation.actor_member_id = v_actor
    and reservation.actor_auth_user_id = v_user
    and reservation.public_id = p_upload_public_id
  for update;
  if v_row.state = 'completed' then return v_row.result; end if;
  if v_row.state in ('failed', 'expired') then return public.file_upload_reservation_result(v_row); end if;
  if v_row.verification_token is distinct from p_verification_token
     or v_row.verification_lease_expires_at is null
     or v_row.verification_lease_expires_at <= clock_timestamp() then
    return jsonb_build_object('outcome', 'failure', 'error', 'verification_in_progress');
  end if;
  if v_row.expires_at <= clock_timestamp() then
    update public.file_upload_reservations reservation
    set state = 'expired', failure_code = 'upload_expired', updated_at = clock_timestamp()
    where reservation.id = v_row.id returning * into strict v_row;
    perform public.append_audit_log(
      v_tenant, v_org, v_user, v_actor, 'file.upload_expired', 'file_upload',
      p_upload_public_id::text, p_request_id, null,
      jsonb_build_object('outcome', 'failure', 'failure', 'upload_expired')
    );
    return public.file_upload_reservation_result(v_row);
  end if;
  if p_request_id is null or p_storage_object_id is null
     or p_verified_size_bytes <> v_row.expected_size_bytes
     or lower(coalesce(p_verified_mime_type, '')) <> v_row.mime_type
     or lower(coalesce(p_verified_sha256, '')) <> v_row.expected_sha256 then
    update public.file_upload_reservations reservation
    set state = 'failed', failure_code = 'object_mismatch',
        verification_token = null, verification_claimed_at = null,
        verification_lease_expires_at = null, updated_at = clock_timestamp()
    where reservation.id = v_row.id;
    perform public.append_audit_log(
      v_tenant, v_org, v_user, v_actor, 'file.upload_failed', 'file_upload',
      p_upload_public_id::text, coalesce(p_request_id, v_row.request_id), null,
      jsonb_build_object('outcome', 'failure', 'failure', 'object_mismatch')
    );
    return jsonb_build_object('outcome', 'failure', 'error', 'object_mismatch');
  end if;

  begin
    insert into public.files(
      tenant_id, organization_id, project_id, task_id, bucket, object_path,
      original_name, mime_type, size_bytes, sha256, access_scope,
      uploaded_by, uploaded_by_member_id, entity_type, entity_public_id,
      storage_object_id, storage_object_version, storage_etag, verified_at, version
    ) values (
      v_tenant, v_org, v_project_id, null, v_row.bucket, v_row.object_path,
      v_row.original_name, v_row.mime_type, v_row.expected_size_bytes,
      v_row.expected_sha256, v_row.access_scope, v_user, v_actor,
      'project', v_project_public_id, p_storage_object_id,
      nullif(btrim(coalesce(p_storage_version, '')), ''),
      nullif(btrim(coalesce(p_storage_etag, '')), ''), clock_timestamp(), 1
    ) returning id into strict v_file_id;
    insert into public.file_relations(
      tenant_id, organization_id, project_id, file_id, relation_type, created_by_member_id
    ) values (v_tenant, v_org, v_project_id, v_file_id, 'project', v_actor);
    insert into public.project_activities(
      tenant_id, organization_id, project_id, user_id, actor_member_id,
      action_type, content, version
    ) values (
      v_tenant, v_org, v_project_id, v_user, v_actor,
      'file_uploaded', '上传项目文件：' || v_row.original_name, 1
    );
    v_file_entity := public.project_file_entity(v_file_id);
    if v_file_entity is null then raise exception 'Canonical file entity unavailable'; end if;
    v_result := jsonb_build_object(
      'outcome', 'success', 'state', 'completed', 'file', v_file_entity
    );
    update public.file_upload_reservations reservation
    set state = 'completed', failure_code = null,
        storage_object_id = p_storage_object_id,
        storage_object_version = nullif(btrim(coalesce(p_storage_version, '')), ''),
        storage_etag = nullif(btrim(coalesce(p_storage_etag, '')), ''),
        verified_at = clock_timestamp(), file_id = v_file_id,
        result = v_result, verification_token = null,
        verification_claimed_at = null, verification_lease_expires_at = null,
        updated_at = clock_timestamp()
    where reservation.id = v_row.id;
    perform public.append_audit_log(
      v_tenant, v_org, v_user, v_actor, 'file.upload_completed', 'file',
      (v_file_entity ->> 'id'), p_request_id, null,
      jsonb_build_object(
        'outcome', 'success', 'uploadId', p_upload_public_id,
        'projectId', v_project_public_id, 'sizeBytes', v_row.expected_size_bytes,
        'mimeType', v_row.mime_type, 'accessScope', v_row.access_scope
      )
    );
    return v_result;
  exception when others then
    raise;
  end;
end;
$$;

create or replace function public.authorize_current_project_file_download(
  p_file_public_id uuid,
  p_request_id uuid
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
  v_file public.files%rowtype;
begin
  select identity.tenant_id, identity.organization_id, identity.actor_member_id,
         identity.actor_auth_user_id, identity.actor_employee_public_id
    into strict v_tenant, v_org, v_actor, v_user, v_actor_employee
  from public.current_project_execution_identity() identity;
  if p_file_public_id is null or p_request_id is null then
    return jsonb_build_object('outcome', 'failure', 'error', 'invalid_request');
  end if;
  select * into v_file from public.files file
  where file.tenant_id = v_tenant
    and file.organization_id = v_org
    and file.public_id = p_file_public_id
    and file.project_id is not null
    and file.deleted_at is null
    and file.verified_at is not null;
  if not found or not public.can_view_project(v_file.project_id)
     or (
       v_file.access_scope = 'private'
       and v_file.uploaded_by <> v_user
       and not public.can_manage_project(v_file.project_id)
     ) then
    return jsonb_build_object('outcome', 'failure', 'error', 'not_found');
  end if;
  perform public.append_audit_log(
    v_tenant, v_org, v_user, v_actor, 'file.download_authorized', 'file',
    p_file_public_id::text, p_request_id, null,
    jsonb_build_object('outcome', 'success', 'projectId', v_file.entity_public_id)
  );
  return jsonb_build_object(
    'outcome', 'success', 'fileId', v_file.public_id,
    'bucket', v_file.bucket, 'objectPath', v_file.object_path,
    'originalName', v_file.original_name
  );
end;
$$;

create or replace function public.claim_file_upload_cleanup(
  p_limit integer,
  p_worker_token uuid
)
returns table ("uploadId" uuid, "bucket" text, "objectPath" text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.file_upload_reservations%rowtype;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'File cleanup requires service role' using errcode = '42501';
  end if;
  if p_worker_token is null or p_limit is null or p_limit not between 1 and 500 then
    raise exception 'Invalid file cleanup claim' using errcode = '22023';
  end if;
  for v_row in
    select reservation.*
    from public.file_upload_reservations reservation
    where reservation.cleaned_at is null
      and reservation.state in ('pending', 'failed', 'expired')
      and reservation.expires_at <= clock_timestamp()
      and (
        reservation.signed_upload_expires_at is null
        or reservation.signed_upload_expires_at <= clock_timestamp()
      )
      and (
        reservation.cleanup_claimed_at is null
        or reservation.cleanup_claimed_at < clock_timestamp() - interval '10 minutes'
      )
    order by reservation.created_at, reservation.id
    for update skip locked
    limit p_limit
  loop
    if v_row.state = 'pending' then
      update public.file_upload_reservations reservation
      set state = 'expired', failure_code = 'upload_expired',
          cleanup_token = p_worker_token, cleanup_claimed_at = clock_timestamp(),
          cleanup_error = null, updated_at = clock_timestamp()
      where reservation.id = v_row.id;
      perform public.append_audit_log(
        v_row.tenant_id, v_row.organization_id, null, null,
        'file.upload_expired', 'file_upload', v_row.public_id::text,
        v_row.request_id, null,
        jsonb_build_object('outcome', 'failure', 'failure', 'upload_expired', 'cleanup', true)
      );
    else
      update public.file_upload_reservations reservation
      set cleanup_token = p_worker_token, cleanup_claimed_at = clock_timestamp(),
          cleanup_error = null, updated_at = clock_timestamp()
      where reservation.id = v_row.id;
    end if;
    "uploadId" := v_row.public_id;
    "bucket" := v_row.bucket;
    "objectPath" := v_row.object_path;
    return next;
  end loop;
end;
$$;

create or replace function public.complete_file_upload_cleanup(
  p_upload_public_id uuid,
  p_worker_token uuid,
  p_removed boolean,
  p_error text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'File cleanup requires service role' using errcode = '42501';
  end if;
  if p_upload_public_id is null or p_worker_token is null or p_removed is null
     or (p_removed and p_error is not null)
     or (not p_removed and p_error is distinct from 'remove_failed') then
    raise exception 'Invalid file cleanup acknowledgement' using errcode = '22023';
  end if;
  update public.file_upload_reservations reservation
  set cleaned_at = case when p_removed then clock_timestamp() else null end,
      cleanup_error = case when p_removed then null else p_error end,
      cleanup_token = case when p_removed then p_worker_token else null end,
      cleanup_claimed_at = case when p_removed then reservation.cleanup_claimed_at else null end,
      updated_at = clock_timestamp()
  where reservation.public_id = p_upload_public_id
    and reservation.cleanup_token = p_worker_token
    and reservation.cleaned_at is null;
  return found;
end;
$$;

revoke all on public.files from public, anon, authenticated, service_role;
revoke all on public.file_relations from public, anon, authenticated, service_role;
revoke all on public.file_upload_reservations from public, anon, authenticated, service_role;
grant select on public.files, public.file_relations to authenticated;

revoke all on function public.enforce_file_actor_identity() from public, anon, authenticated, service_role;
revoke all on function public.project_file_entity(bigint) from public, anon, authenticated, service_role;
revoke all on function public.file_upload_reservation_result(public.file_upload_reservations) from public, anon, authenticated, service_role;
revoke all on function public.reserve_current_project_file_upload(uuid, text, text, bigint, text, text, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.inspect_current_file_upload(uuid) from public, anon, authenticated, service_role;
revoke all on function public.record_current_file_upload_signed(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.claim_current_file_upload_verification(uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.release_current_file_upload_verification(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.fail_current_file_upload(uuid, uuid, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.complete_current_project_file_upload(uuid, uuid, uuid, text, text, bigint, text, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.authorize_current_project_file_download(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.claim_file_upload_cleanup(integer, uuid) from public, anon, authenticated, service_role;
revoke all on function public.complete_file_upload_cleanup(uuid, uuid, boolean, text) from public, anon, authenticated, service_role;

grant execute on function public.reserve_current_project_file_upload(uuid, text, text, bigint, text, text, uuid, uuid) to authenticated;
grant execute on function public.inspect_current_file_upload(uuid) to authenticated;
grant execute on function public.record_current_file_upload_signed(uuid, uuid) to service_role;
grant execute on function public.claim_current_file_upload_verification(uuid, uuid, uuid) to service_role;
grant execute on function public.release_current_file_upload_verification(uuid, uuid) to service_role;
grant execute on function public.fail_current_file_upload(uuid, uuid, text, uuid) to service_role;
grant execute on function public.complete_current_project_file_upload(uuid, uuid, uuid, text, text, bigint, text, text, uuid) to service_role;
grant execute on function public.authorize_current_project_file_download(uuid, uuid) to authenticated;
grant execute on function public.claim_file_upload_cleanup(integer, uuid) to service_role;
grant execute on function public.complete_file_upload_cleanup(uuid, uuid, boolean, text) to service_role;
