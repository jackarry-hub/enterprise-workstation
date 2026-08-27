-- Bind approval and workspace reads to the exact active external identity.
-- An auth user may have memberships in several organizations, but only the
-- organization/member pair selected by external_identities is the workspace.

create or replace function public.is_approval_participant(
  target_approval_id bigint,
  target_organization_id bigint
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with viewer as (
    select profile.id as employee_id, identity.organization_id
    from public.external_identities identity
    join public.identity_providers provider
      on provider.tenant_id = identity.tenant_id
     and provider.id = identity.identity_provider_id
     and provider.status = 'active'
    join public.tenants tenant
      on tenant.id = identity.tenant_id
     and tenant.status = 'active'
    join public.organizations organization
      on organization.tenant_id = identity.tenant_id
     and organization.id = identity.organization_id
    join public.organization_members member
      on member.tenant_id = identity.tenant_id
     and member.organization_id = identity.organization_id
     and member.id = identity.organization_member_id
     and member.user_id = (select auth.uid())
     and member.status = 'active'
    join public.employee_profiles profile
      on profile.tenant_id = identity.tenant_id
     and profile.organization_id = identity.organization_id
     and profile.organization_member_id = identity.organization_member_id
     and profile.deleted_at is null
     and profile.employment_status in ('probation', 'active', 'on_leave')
    where identity.tenant_id = (select public.current_tenant_id())
      and identity.auth_user_id = (select auth.uid())
      and identity.status = 'active'
  )
  select exists (
    select 1
    from viewer
    join public.approvals approval
      on approval.organization_id = viewer.organization_id
     and approval.id = target_approval_id
    where approval.organization_id = target_organization_id
      and approval.deleted_at is null
      and (
        viewer.employee_id = approval.applicant_employee_id
        or viewer.employee_id = approval.owner_employee_id
        or exists (
          select 1
          from public.approval_steps step
          where step.approval_id = approval.id
            and step.organization_id = viewer.organization_id
            and step.approver_employee_id = viewer.employee_id
        )
      )
  );
$$;

revoke all on function public.is_approval_participant(bigint, bigint) from public, anon;
grant execute on function public.is_approval_participant(bigint, bigint) to authenticated;

create or replace function public.current_actionable_approval_inbox()
returns table (
  public_id uuid,
  title text,
  current_step text,
  submitted_at timestamptz,
  total_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with viewer as (
    select profile.id as employee_id, identity.organization_id
    from public.external_identities identity
    join public.identity_providers provider
      on provider.tenant_id = identity.tenant_id
     and provider.id = identity.identity_provider_id
     and provider.status = 'active'
    join public.tenants tenant
      on tenant.id = identity.tenant_id
     and tenant.status = 'active'
    join public.organizations organization
      on organization.tenant_id = identity.tenant_id
     and organization.id = identity.organization_id
    join public.organization_members member
      on member.tenant_id = identity.tenant_id
     and member.organization_id = identity.organization_id
     and member.id = identity.organization_member_id
     and member.user_id = (select auth.uid())
     and member.status = 'active'
    join public.employee_profiles profile
      on profile.tenant_id = identity.tenant_id
     and profile.organization_id = identity.organization_id
     and profile.organization_member_id = identity.organization_member_id
     and profile.deleted_at is null
     and profile.employment_status in ('probation', 'active', 'on_leave')
    where identity.tenant_id = (select public.current_tenant_id())
      and identity.auth_user_id = (select auth.uid())
      and identity.status = 'active'
  ),
  current_pending_step as (
    select distinct on (step.approval_id)
      step.approval_id,
      step.organization_id,
      step.approver_employee_id,
      step.name
    from public.approval_steps step
    join viewer on viewer.organization_id = step.organization_id
    where step.status = 'pending'
    order by step.approval_id, step.step_order
  ),
  actionable as (
    select approval.public_id, approval.title, approval.current_step, approval.submitted_at
    from public.approvals approval
    join viewer on viewer.organization_id = approval.organization_id
    join current_pending_step step
      on step.organization_id = approval.organization_id
     and step.approval_id = approval.id
     and step.approver_employee_id = viewer.employee_id
    where approval.status = 'pending'
      and approval.deleted_at is null
      and approval.current_step = step.name
  )
  select actionable.public_id, actionable.title, actionable.current_step,
    actionable.submitted_at, count(*) over ()::bigint as total_count
  from actionable
  order by actionable.submitted_at desc nulls last, actionable.public_id
  limit 100;
$$;

revoke all on function public.current_actionable_approval_inbox() from public, anon;
grant execute on function public.current_actionable_approval_inbox() to authenticated;

create or replace function public.current_submitted_daily_report(p_report_date date)
returns table (
  project_id uuid,
  summary text,
  next_plan text,
  blockers text
)
language sql
stable
security definer
set search_path = ''
as $$
  with viewer as (
    select identity.tenant_id, identity.organization_id, identity.organization_member_id as member_id
    from public.external_identities identity
    join public.identity_providers provider
      on provider.tenant_id = identity.tenant_id
     and provider.id = identity.identity_provider_id
     and provider.status = 'active'
    join public.tenants tenant
      on tenant.id = identity.tenant_id
     and tenant.status = 'active'
    join public.organizations organization
      on organization.tenant_id = identity.tenant_id
     and organization.id = identity.organization_id
    join public.organization_members member
      on member.tenant_id = identity.tenant_id
     and member.organization_id = identity.organization_id
     and member.id = identity.organization_member_id
     and member.user_id = (select auth.uid())
     and member.status = 'active'
    join public.employee_profiles profile
      on profile.tenant_id = identity.tenant_id
     and profile.organization_id = identity.organization_id
     and profile.organization_member_id = identity.organization_member_id
     and profile.deleted_at is null
     and profile.employment_status in ('probation', 'active', 'on_leave')
    where identity.tenant_id = (select public.current_tenant_id())
      and identity.auth_user_id = (select auth.uid())
      and identity.status = 'active'
  )
  select project.public_id as project_id, report.summary, report.next_plan, coalesce(report.blockers, '') as blockers
  from viewer
  join public.daily_reports report
    on report.organization_id = viewer.organization_id
   and report.author_member_id = viewer.member_id
  join public.projects project
    on project.tenant_id = viewer.tenant_id
   and project.organization_id = viewer.organization_id
   and project.id = report.project_id
  where report.report_date = p_report_date
    and report.status = 'submitted'
    and report.deleted_at is null
    and project.deleted_at is null
    and (
      project.owner_member_id = viewer.member_id
      or exists (
        select 1
        from public.project_members membership
        where membership.tenant_id = viewer.tenant_id
          and membership.organization_id = viewer.organization_id
          and membership.project_id = project.id
          and membership.member_id = viewer.member_id
          and membership.left_at is null
      )
    )
  order by report.submitted_at desc, report.id desc
  limit 1;
$$;

revoke all on function public.current_submitted_daily_report(date) from public, anon;
grant execute on function public.current_submitted_daily_report(date) to authenticated;
