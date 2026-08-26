alter table public.audit_logs drop constraint if exists audit_logs_action_check;
alter table public.audit_logs add constraint audit_logs_action_check check (action in (
  'identity.provisioned', 'identity.claimed', 'identity.revoked', 'member.status_changed',
  'member.role_changed', 'profile.updated', 'roster.imported', 'tenant.bootstrap_owner',
  'enterprise.initialized', 'directory.sync_started', 'directory.sync_completed',
  'directory.sync_failed', 'directory.role_mapped', 'project.created', 'task.created',
  'payroll_policy.activated', 'payroll.calculated', 'payroll.confirmed', 'ai.config.updated',
  'organization.department_created', 'organization.department_updated',
  'organization.position_upserted', 'organization.role_assigned', 'organization.command_failed',
  'employee_skill.verified', 'employee_skill.verification_failed'
));

alter table public.employee_skills
  add column if not exists public_id uuid not null default gen_random_uuid(),
  add column if not exists verified_by_member_id bigint,
  add column if not exists verified_at timestamptz,
  add column if not exists verification_reason text,
  add column if not exists verification_request_id uuid,
  add constraint employee_skills_verification_reason_check check (
    verification_reason is null or length(btrim(verification_reason)) between 1 and 500
  );

create unique index if not exists employee_skills_public_id_uidx
  on public.employee_skills (public_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'employee_skills_verified_by_member_fkey'
      and conrelid = 'public.employee_skills'::regclass
  ) then
    alter table public.employee_skills
      add constraint employee_skills_verified_by_member_fkey
      foreign key (tenant_id, verified_by_member_id)
      references public.organization_members (tenant_id, id) on delete restrict;
  end if;
end $$;

create or replace function public.verify_current_employee_skill(
  skill_public_id uuid,
  decision text,
  reason text,
  request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_tenant_id bigint;
  v_organization_id bigint;
  v_verifier_member_id bigint;
  v_skill public.employee_skills%rowtype;
  v_previous_status text;
  v_timestamp timestamptz := clock_timestamp();
begin
  if (select auth.uid()) is null
     or skill_public_id is null
     or decision <> 'verified'
     or reason is null
     or length(btrim(reason)) not between 1 and 500
     or request_id is null then
    raise exception 'Employee skill verification request is invalid' using errcode = '22023';
  end if;

  select member.tenant_id, member.organization_id, member.id
  into v_tenant_id, v_organization_id, v_verifier_member_id
  from public.external_identities external
  join public.identity_providers provider
    on provider.tenant_id = external.tenant_id
   and provider.id = external.identity_provider_id
   and provider.status = 'active'
  join public.tenants tenant
    on tenant.id = external.tenant_id
   and tenant.status = 'active'
  join public.organization_members member
    on member.tenant_id = external.tenant_id
   and member.organization_id = external.organization_id
   and member.id = external.organization_member_id
   and member.status = 'active'
  join public.employee_profiles verifier_profile
    on verifier_profile.tenant_id = member.tenant_id
   and verifier_profile.organization_id = member.organization_id
   and verifier_profile.organization_member_id = member.id
   and verifier_profile.deleted_at is null
   and verifier_profile.employment_status in ('probation', 'active', 'on_leave')
  where external.auth_user_id = (select auth.uid())
    and external.status = 'active'
  limit 1;

  if not found or not public.has_organization_permission(v_organization_id, 'hr.manage') then
    raise exception 'Employee skill verification permission required' using errcode = '42501';
  end if;

  select * into v_skill
  from public.employee_skills skill
  where skill.tenant_id = v_tenant_id
    and skill.organization_id = v_organization_id
    and skill.public_id = skill_public_id
  for update;
  if not found then
    perform public.append_audit_log(
      v_tenant_id, v_organization_id, (select auth.uid()), v_verifier_member_id,
      'employee_skill.verification_failed', 'employee_skill', skill_public_id::text, request_id, null,
      jsonb_build_object(
        'outcome', 'failure', 'requestId', request_id, 'permissionScope', 'hr.manage',
        'businessReason', btrim(reason), 'decision', decision,
        'before', 'null'::jsonb, 'after', 'null'::jsonb, 'failure', 'not_found'
      )
    );
    raise exception 'Employee skill was not found' using errcode = 'P0002';
  end if;

  v_previous_status := v_skill.verification_status;
  update public.employee_skills
  set verification_status = 'verified',
      verified_by_member_id = v_verifier_member_id,
      verified_at = v_timestamp,
      verification_reason = btrim(reason),
      verification_request_id = request_id,
      updated_at = v_timestamp
  where id = v_skill.id
    and tenant_id = v_tenant_id
    and organization_id = v_organization_id;

  perform public.append_audit_log(
    v_tenant_id, v_organization_id, (select auth.uid()), v_verifier_member_id,
    'employee_skill.verified', 'employee_skill', v_skill.public_id::text, request_id, null,
    jsonb_build_object(
      'outcome', 'success', 'requestId', request_id, 'permissionScope', 'hr.manage',
      'businessReason', btrim(reason), 'decision', decision,
      'before', jsonb_build_object('verificationStatus', v_previous_status),
      'after', jsonb_build_object('verificationStatus', 'verified'),
      'verifiedAt', v_timestamp, 'verifierMemberRef', v_verifier_member_id
    )
  );
  return jsonb_build_object(
    'outcome', 'success', 'skillId', v_skill.public_id,
    'verificationStatus', 'verified'
  );
end;
$$;

revoke all on function public.verify_current_employee_skill(uuid,text,text,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.verify_current_employee_skill(uuid,text,text,uuid)
  to authenticated;
