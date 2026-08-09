create unique index if not exists employee_profiles_organization_id_id_uidx
  on public.employee_profiles (organization_id, id);

create table public.approvals (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  organization_id bigint not null references public.organizations(id) on delete cascade,
  applicant_employee_id bigint not null,
  owner_employee_id bigint,
  approval_code text not null check (length(btrim(approval_code)) > 0),
  approval_type text not null
    check (approval_type in ('leave', 'reimbursement', 'purchase', 'contract')),
  title text not null check (length(btrim(title)) > 0),
  summary text,
  form_data jsonb not null default '{}'::jsonb,
  current_step text,
  status text not null default 'draft'
    check (status in ('draft', 'pending', 'approved', 'rejected')),
  submitted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (organization_id, applicant_employee_id)
    references public.employee_profiles (organization_id, id) on delete restrict,
  foreign key (organization_id, owner_employee_id)
    references public.employee_profiles (organization_id, id) on delete restrict,
  check (completed_at is null or submitted_at is null or completed_at >= submitted_at)
);

create unique index approvals_organization_code_idx
  on public.approvals (organization_id, approval_code)
  where deleted_at is null;

create unique index approvals_organization_id_id_uidx
  on public.approvals (organization_id, id);

create index approvals_organization_status_submitted_idx
  on public.approvals (organization_id, status, submitted_at desc)
  where deleted_at is null;

create index approvals_applicant_submitted_idx
  on public.approvals (applicant_employee_id, submitted_at desc)
  where deleted_at is null;

create index approvals_owner_status_idx
  on public.approvals (owner_employee_id, status, submitted_at desc)
  where owner_employee_id is not null and deleted_at is null;

create table public.approval_steps (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  organization_id bigint not null references public.organizations(id) on delete cascade,
  approval_id bigint not null,
  step_order integer not null check (step_order > 0),
  name text not null check (length(btrim(name)) > 0),
  approver_employee_id bigint,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'skipped')),
  acted_at timestamptz,
  comment text,
  created_at timestamptz not null default now(),
  foreign key (organization_id, approval_id)
    references public.approvals (organization_id, id) on delete cascade,
  foreign key (organization_id, approver_employee_id)
    references public.employee_profiles (organization_id, id) on delete restrict
);

create unique index approval_steps_approval_order_idx
  on public.approval_steps (approval_id, step_order);

create index approval_steps_approver_status_idx
  on public.approval_steps (approver_employee_id, status)
  where approver_employee_id is not null;

create table public.approval_actions (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  organization_id bigint not null references public.organizations(id) on delete cascade,
  approval_id bigint not null,
  actor_employee_id bigint not null,
  action_type text not null
    check (action_type in ('submit', 'approve', 'reject', 'comment')),
  content text,
  created_at timestamptz not null default now(),
  foreign key (organization_id, approval_id)
    references public.approvals (organization_id, id) on delete cascade,
  foreign key (organization_id, actor_employee_id)
    references public.employee_profiles (organization_id, id) on delete restrict
);

create index approval_actions_approval_created_idx
  on public.approval_actions (approval_id, created_at desc);

create or replace function public.touch_approvals_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger approvals_updated_at
before update on public.approvals
for each row execute function public.touch_approvals_updated_at();

alter table public.approvals enable row level security;
alter table public.approvals force row level security;
alter table public.approval_steps enable row level security;
alter table public.approval_steps force row level security;
alter table public.approval_actions enable row level security;
alter table public.approval_actions force row level security;

create policy approvals_member_select on public.approvals
  for select to authenticated
  using (deleted_at is null and (select public.is_organization_member(organization_id)));

create policy approvals_manager_insert on public.approvals
  for insert to authenticated
  with check ((select public.has_organization_role(organization_id, array['owner', 'admin', 'hr', 'finance'])));

create policy approvals_requester_insert on public.approvals
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.employee_profiles employee
      join public.organization_members member on member.id = employee.organization_member_id
      where employee.id = applicant_employee_id
        and employee.organization_id = organization_id
        and member.user_id = (select auth.uid())
        and employee.deleted_at is null
    )
  );

create policy approvals_manager_update on public.approvals
  for update to authenticated
  using (deleted_at is null and (select public.has_organization_role(organization_id, array['owner', 'admin', 'hr', 'finance'])))
  with check ((select public.has_organization_role(organization_id, array['owner', 'admin', 'hr', 'finance'])));

create policy approval_steps_member_select on public.approval_steps
  for select to authenticated
  using ((select public.is_organization_member(organization_id)));

create policy approval_steps_manager_insert on public.approval_steps
  for insert to authenticated
  with check ((select public.has_organization_role(organization_id, array['owner', 'admin', 'hr', 'finance'])));

create policy approval_steps_manager_update on public.approval_steps
  for update to authenticated
  using ((select public.has_organization_role(organization_id, array['owner', 'admin', 'hr', 'finance'])))
  with check ((select public.has_organization_role(organization_id, array['owner', 'admin', 'hr', 'finance'])));

create policy approval_actions_member_select on public.approval_actions
  for select to authenticated
  using ((select public.is_organization_member(organization_id)));

create policy approval_actions_member_insert on public.approval_actions
  for insert to authenticated
  with check ((select public.is_organization_member(organization_id)));

grant select, insert, update on public.approvals, public.approval_steps to authenticated;
grant select, insert on public.approval_actions to authenticated;
grant usage, select on all sequences in schema public to authenticated;

revoke execute on function public.touch_approvals_updated_at() from public;
