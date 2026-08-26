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
  select exists (
    select 1
    from public.approvals approval
    join public.organizations organization
      on organization.id = approval.organization_id
    join public.employee_profiles viewer
      on viewer.organization_id = approval.organization_id
     and viewer.tenant_id = organization.tenant_id
    join public.organization_members member
      on member.id = viewer.organization_member_id
     and member.organization_id = approval.organization_id
     and member.tenant_id = organization.tenant_id
    where approval.id = target_approval_id
      and approval.organization_id = target_organization_id
      and organization.tenant_id = (select public.current_tenant_id())
      and approval.deleted_at is null
      and viewer.deleted_at is null
      and viewer.employment_status = 'active'
      and member.user_id = (select auth.uid())
      and member.status = 'active'
      and (
        viewer.id = approval.applicant_employee_id
        or viewer.id = approval.owner_employee_id
        or exists (
          select 1
          from public.approval_steps step
          where step.approval_id = approval.id
            and step.organization_id = approval.organization_id
            and step.approver_employee_id = viewer.id
        )
      )
  );
$$;

revoke all on function public.is_approval_participant(bigint, bigint) from public, anon;
grant execute on function public.is_approval_participant(bigint, bigint) to authenticated;

drop policy if exists approvals_member_select on public.approvals;
drop policy if exists approvals_manager_insert on public.approvals;
drop policy if exists approvals_requester_insert on public.approvals;
drop policy if exists approvals_manager_update on public.approvals;
drop policy if exists approval_steps_member_select on public.approval_steps;
drop policy if exists approval_steps_manager_insert on public.approval_steps;
drop policy if exists approval_steps_manager_update on public.approval_steps;
drop policy if exists approval_actions_member_select on public.approval_actions;
drop policy if exists approval_actions_member_insert on public.approval_actions;

create policy approvals_participant_select on public.approvals
  for select to authenticated
  using ((select public.is_approval_participant(id, organization_id)));

create policy approval_steps_participant_select on public.approval_steps
  for select to authenticated
  using ((select public.is_approval_participant(approval_id, organization_id)));

create policy approval_actions_participant_select on public.approval_actions
  for select to authenticated
  using ((select public.is_approval_participant(approval_id, organization_id)));

revoke all privileges on public.approvals, public.approval_steps, public.approval_actions from authenticated;
grant select on public.approvals, public.approval_steps, public.approval_actions to authenticated;
revoke usage, select on sequence public.approvals_id_seq, public.approval_steps_id_seq, public.approval_actions_id_seq from authenticated;
