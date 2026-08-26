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
     or decision is distinct from 'verified'
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
    return jsonb_build_object('outcome', 'failure', 'error', 'not_found');
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

-- Employee skills remain self-editable only for declared skill facts. Verification
-- state and its evidence are RPC-owned and are never writable from browser SQL.
revoke insert, update on table public.employee_skills from authenticated;
grant insert (tenant_id, organization_id, employee_profile_id, skill_tag_id, proficiency_level, years_experience)
  on table public.employee_skills to authenticated;
grant update (proficiency_level, years_experience)
  on table public.employee_skills to authenticated;

revoke select on table public.employee_skills from authenticated;
grant select (
  id, public_id, tenant_id, organization_id, employee_profile_id, skill_tag_id,
  proficiency_level, verification_status, years_experience, created_at, updated_at
) on table public.employee_skills to authenticated;

revoke insert, update on table public.employee_work_profiles from authenticated;

drop policy if exists employee_skills_member_select on public.employee_skills;
create policy employee_skills_member_select
on public.employee_skills for select to authenticated
using (
  tenant_id = (select public.current_tenant_id())
  and (select public.is_organization_member(organization_id))
);

alter table public.organization_members
  drop constraint if exists organization_members_tenant_organization_id_key,
  add constraint organization_members_tenant_organization_id_key
    unique (tenant_id, organization_id, id);

alter table public.employee_skills
  drop constraint if exists employee_skills_verified_by_member_fkey,
  add constraint employee_skills_verified_by_member_fkey
    foreign key (tenant_id, organization_id, verified_by_member_id)
    references public.organization_members (tenant_id, organization_id, id)
    on delete restrict;

create or replace function public.update_current_employee_work_profile(
  p_summary text,
  p_preferred_task_types text[],
  p_growth_goals text[],
  p_weekly_capacity_hours smallint,
  p_self_skills jsonb,
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
  v_member_id bigint;
  v_profile_id bigint;
  v_profile_public_id uuid;
  v_before jsonb := 'null'::jsonb;
  v_profile public.employee_work_profiles%rowtype;
begin
  if (select auth.uid()) is null
     or request_id is null
     or p_summary is null
     or length(p_summary) > 240
     or not public.valid_employee_work_labels(p_preferred_task_types, 8)
     or not public.valid_employee_work_labels(p_growth_goals, 8)
     or p_weekly_capacity_hours is null
     or p_weekly_capacity_hours not between 1 and 80
     or not public.valid_employee_self_skills(p_self_skills) then
    raise exception 'Employee work profile request is invalid' using errcode = '22023';
  end if;

  select member.tenant_id, member.organization_id, member.id, profile.id, profile.public_id
  into v_tenant_id, v_organization_id, v_member_id, v_profile_id, v_profile_public_id
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
    return jsonb_build_object('outcome', 'failure', 'error', 'profile_not_found');
  end if;

  select jsonb_build_object(
    'summary', profile.summary,
    'preferredTaskTypes', profile.preferred_task_types,
    'growthGoals', profile.growth_goals,
    'weeklyCapacityHours', profile.weekly_capacity_hours,
    'selfSkills', profile.self_skills
  ) into v_before
  from public.employee_work_profiles profile
  where profile.tenant_id = v_tenant_id
    and profile.organization_id = v_organization_id
    and profile.employee_profile_id = v_profile_id
  for update;

  insert into public.employee_work_profiles (
    tenant_id, organization_id, employee_profile_id, summary, preferred_task_types,
    growth_goals, weekly_capacity_hours, self_skills
  ) values (
    v_tenant_id, v_organization_id, v_profile_id, p_summary, p_preferred_task_types,
    p_growth_goals, p_weekly_capacity_hours, p_self_skills
  ) on conflict (tenant_id, employee_profile_id) do update
  set summary = excluded.summary,
      preferred_task_types = excluded.preferred_task_types,
      growth_goals = excluded.growth_goals,
      weekly_capacity_hours = excluded.weekly_capacity_hours,
      self_skills = excluded.self_skills
  returning * into v_profile;

  perform public.append_audit_log(
    v_tenant_id, v_organization_id, (select auth.uid()), v_member_id,
    'profile.updated', 'employee_work_profile', v_profile_public_id::text, request_id, null,
    jsonb_build_object(
      'outcome', 'success', 'requestId', request_id,
      'before', v_before,
      'after', jsonb_build_object(
        'summary', v_profile.summary,
        'preferredTaskTypes', v_profile.preferred_task_types,
        'growthGoals', v_profile.growth_goals,
        'weeklyCapacityHours', v_profile.weekly_capacity_hours,
        'selfSkills', v_profile.self_skills
      )
    )
  );

  return jsonb_build_object(
    'outcome', 'success',
    'profile', jsonb_build_object(
      'summary', v_profile.summary,
      'preferredTaskTypes', v_profile.preferred_task_types,
      'growthGoals', v_profile.growth_goals,
      'weeklyCapacityHours', v_profile.weekly_capacity_hours,
      'selfSkills', v_profile.self_skills,
      'updatedAt', v_profile.updated_at
    )
  );
end;
$$;

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
     or decision is distinct from 'verified'
     or reason is null
     or length(btrim(reason)) not between 1 and 500
     or request_id is null then
    raise exception 'Employee skill verification request is invalid' using errcode = '22023';
  end if;

  select member.tenant_id, member.organization_id, member.id
  into v_tenant_id, v_organization_id, v_verifier_member_id
  from public.external_identities external
  join public.identity_providers provider
    on provider.tenant_id = external.tenant_id and provider.id = external.identity_provider_id
   and provider.status = 'active'
  join public.tenants tenant on tenant.id = external.tenant_id and tenant.status = 'active'
  join public.organization_members member
    on member.tenant_id = external.tenant_id and member.organization_id = external.organization_id
   and member.id = external.organization_member_id and member.status = 'active'
  join public.employee_profiles verifier_profile
    on verifier_profile.tenant_id = member.tenant_id and verifier_profile.organization_id = member.organization_id
   and verifier_profile.organization_member_id = member.id and verifier_profile.deleted_at is null
   and verifier_profile.employment_status in ('probation', 'active', 'on_leave')
  where external.auth_user_id = (select auth.uid()) and external.status = 'active'
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
    return jsonb_build_object('outcome', 'failure', 'error', 'not_found');
  end if;

  v_previous_status := v_skill.verification_status;
  update public.employee_skills
  set verification_status = 'verified', verified_by_member_id = v_verifier_member_id,
      verified_at = v_timestamp, verification_reason = btrim(reason),
      verification_request_id = request_id, updated_at = v_timestamp
  where id = v_skill.id and tenant_id = v_tenant_id and organization_id = v_organization_id;

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
  return jsonb_build_object('outcome', 'success', 'skillId', v_skill.public_id, 'verificationStatus', 'verified');
end;
$$;

create or replace function public.current_organization_skill_verifications()
returns table (
  skill_public_id uuid,
  verification_status text,
  verified_by_member_id bigint,
  verified_at timestamptz,
  verification_reason text,
  verification_request_id uuid
)
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select skill.public_id, skill.verification_status, skill.verified_by_member_id,
    skill.verified_at, skill.verification_reason, skill.verification_request_id
  from public.employee_skills skill
  where skill.tenant_id = (select public.current_tenant_id())
    and (select public.has_organization_permission(skill.organization_id, 'hr.manage'));
$$;

revoke all on function public.update_current_employee_work_profile(text,text[],text[],smallint,jsonb,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.verify_current_employee_skill(uuid,text,text,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.current_organization_skill_verifications()
  from public, anon, authenticated, service_role;
grant execute on function public.update_current_employee_work_profile(text,text[],text[],smallint,jsonb,uuid)
  to authenticated;
grant execute on function public.verify_current_employee_skill(uuid,text,text,uuid)
  to authenticated;
grant execute on function public.current_organization_skill_verifications()
  to authenticated;
