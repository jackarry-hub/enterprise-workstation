alter table public.salary
  add column if not exists performance_bonus numeric(14,2) not null default 0 check (performance_bonus >= 0),
  add column if not exists project_bonus numeric(14,2) not null default 0 check (project_bonus >= 0),
  add column if not exists other_bonus numeric(14,2) not null default 0 check (other_bonus >= 0),
  add column if not exists social_security numeric(14,2) not null default 0 check (social_security >= 0),
  add column if not exists individual_income_tax numeric(14,2) not null default 0 check (individual_income_tax >= 0),
  add column if not exists other_deduction numeric(14,2) not null default 0 check (other_deduction >= 0);

comment on column public.salary.performance_bonus is 'Performance bonus visible only to the employee and salary managers.';
comment on column public.salary.project_bonus is 'Project bonus visible only to the employee and salary managers.';
comment on column public.salary.other_bonus is 'Other bonus visible only to the employee and salary managers.';
comment on column public.salary.social_security is 'Employee social security deduction.';
comment on column public.salary.individual_income_tax is 'Individual income tax deduction.';
comment on column public.salary.other_deduction is 'Other payroll deduction.';

create or replace function public.create_current_project_task_v2(
  p_project_public_id uuid,
  p_title text,
  p_description text,
  p_assignee_member_id bigint,
  p_due_date date,
  p_priority text,
  p_acceptance_criteria text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id bigint := (select public.current_tenant_id());
  v_organization_id bigint;
  v_actor_member_id bigint;
  v_project_id bigint;
  v_task_public_id uuid := gen_random_uuid();
begin
  if v_tenant_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_project_public_id is null
     or nullif(btrim(p_title), '') is null
     or length(btrim(p_title)) > 240
     or length(coalesce(p_description, '')) > 4000
     or nullif(btrim(p_acceptance_criteria), '') is null
     or length(btrim(p_acceptance_criteria)) > 2000
     or p_assignee_member_id is null
     or p_assignee_member_id <= 0
     or p_due_date is null
     or p_priority not in ('low', 'medium', 'high', 'urgent') then
    raise exception 'Task input is invalid' using errcode = '22023';
  end if;

  select member.organization_id, member.id
  into strict v_organization_id, v_actor_member_id
  from public.organization_members member
  where member.tenant_id = v_tenant_id
    and member.user_id = (select auth.uid())
    and member.status = 'active'
  limit 1;

  select project.id
  into strict v_project_id
  from public.projects project
  where project.organization_id = v_organization_id
    and project.public_id = p_project_public_id
    and project.deleted_at is null;

  if not (
    public.has_organization_role(v_organization_id, array['owner', 'admin'])
    or exists (
      select 1
      from public.projects project
      left join public.project_members membership
        on membership.project_id = project.id
       and membership.member_id = v_actor_member_id
       and membership.left_at is null
      where project.id = v_project_id
        and (project.owner_member_id = v_actor_member_id or membership.role in ('owner', 'manager'))
    )
  ) then
    raise exception 'Task creation is not allowed' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.organization_members member
    where member.organization_id = v_organization_id
      and member.id = p_assignee_member_id
      and member.status in ('invited', 'active')
  ) then
    raise exception 'Task assignee is not an active organization member' using errcode = '23503';
  end if;

  insert into public.project_members (
    organization_id, project_id, member_id, role, allocation_percent
  ) values (
    v_organization_id, v_project_id, p_assignee_member_id, 'member', 100
  )
  on conflict (project_id, member_id) do update
    set left_at = null, updated_at = now();

  insert into public.tasks (
    public_id, organization_id, project_id, title, description,
    assignee_member_id, reporter_member_id, status, priority,
    start_date, due_date, progress, acceptance_criteria
  ) values (
    v_task_public_id, v_organization_id, v_project_id,
    btrim(p_title), btrim(coalesce(p_description, '')),
    p_assignee_member_id, v_actor_member_id, 'todo', p_priority,
    current_date, p_due_date, 0, btrim(p_acceptance_criteria)
  );

  perform public.append_audit_log(
    v_tenant_id, v_organization_id, (select auth.uid()), v_actor_member_id,
    'task.created', 'task', v_task_public_id::text,
    null, null,
    jsonb_build_object(
      'project', p_project_public_id,
      'priority', p_priority,
      'assignee_member_id', p_assignee_member_id
    )
  );
  return v_task_public_id;
end;
$$;

revoke all on function public.create_current_project_task_v2(uuid,text,text,bigint,date,text,text)
  from public, anon;
grant execute on function public.create_current_project_task_v2(uuid,text,text,bigint,date,text,text)
  to authenticated;
