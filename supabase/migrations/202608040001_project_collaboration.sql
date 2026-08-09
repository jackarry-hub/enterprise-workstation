-- Project collaboration center: objectives, projects, milestones, tasks,
-- discussions, project files and daily reports.

create unique index organization_members_organization_id_id_uidx
  on public.organization_members (organization_id, id);

create table public.objectives (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  organization_id bigint not null references public.organizations(id) on delete cascade,
  parent_objective_id bigint,
  owner_member_id bigint not null,
  created_by_member_id bigint not null,
  title text not null check (btrim(title) <> ''),
  description text not null default '',
  scope text not null default 'company'
    check (scope in ('company', 'department', 'team')),
  status text not null default 'draft'
    check (status in ('draft', 'active', 'completed', 'cancelled')),
  period_start date not null,
  period_end date not null,
  progress numeric(5, 2) not null default 0
    check (progress >= 0 and progress <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (organization_id, id),
  constraint objectives_valid_period check (period_start <= period_end),
  constraint objectives_parent_same_organization_fk
    foreign key (organization_id, parent_objective_id)
    references public.objectives (organization_id, id),
  constraint objectives_owner_same_organization_fk
    foreign key (organization_id, owner_member_id)
    references public.organization_members (organization_id, id),
  constraint objectives_creator_same_organization_fk
    foreign key (organization_id, created_by_member_id)
    references public.organization_members (organization_id, id)
);

create index objectives_organization_status_idx
  on public.objectives (organization_id, status, period_end)
  where deleted_at is null;
create index objectives_parent_objective_id_idx
  on public.objectives (parent_objective_id)
  where parent_objective_id is not null and deleted_at is null;
create index objectives_owner_member_id_idx
  on public.objectives (owner_member_id)
  where deleted_at is null;
create index objectives_created_by_member_id_idx
  on public.objectives (created_by_member_id);

create table public.projects (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  organization_id bigint not null references public.organizations(id) on delete cascade,
  objective_id bigint,
  code text not null check (btrim(code) <> ''),
  name text not null check (btrim(name) <> ''),
  description text not null default '',
  owner_member_id bigint not null,
  created_by_member_id bigint not null,
  status text not null default 'planning'
    check (status in ('planning', 'active', 'on_hold', 'completed', 'cancelled')),
  health text not null default 'on_track'
    check (health in ('on_track', 'at_risk', 'off_track')),
  priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high', 'critical')),
  start_date date not null,
  due_date date not null,
  actual_end_date date,
  progress numeric(5, 2) not null default 0
    check (progress >= 0 and progress <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint projects_valid_period check (start_date <= due_date),
  constraint projects_objective_same_organization_fk
    foreign key (organization_id, objective_id)
    references public.objectives (organization_id, id),
  constraint projects_owner_same_organization_fk
    foreign key (organization_id, owner_member_id)
    references public.organization_members (organization_id, id),
  constraint projects_creator_same_organization_fk
    foreign key (organization_id, created_by_member_id)
    references public.organization_members (organization_id, id)
);

create unique index projects_organization_id_id_uidx
  on public.projects (organization_id, id);
create unique index projects_organization_code_uidx
  on public.projects (organization_id, code)
  where deleted_at is null;
create index projects_organization_status_due_idx
  on public.projects (organization_id, status, due_date)
  where deleted_at is null;
create index projects_owner_status_idx
  on public.projects (owner_member_id, status)
  where deleted_at is null;
create index projects_objective_id_idx
  on public.projects (objective_id)
  where objective_id is not null and deleted_at is null;
create index projects_created_by_member_id_idx
  on public.projects (created_by_member_id);

create table public.project_members (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  organization_id bigint not null,
  project_id bigint not null,
  member_id bigint not null,
  role text not null default 'member'
    check (role in ('owner', 'manager', 'member', 'viewer')),
  allocation_percent numeric(5, 2) not null default 100
    check (allocation_percent >= 0 and allocation_percent <= 100),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, member_id),
  constraint project_members_project_same_organization_fk
    foreign key (organization_id, project_id)
    references public.projects (organization_id, id) on delete cascade,
  constraint project_members_member_same_organization_fk
    foreign key (organization_id, member_id)
    references public.organization_members (organization_id, id) on delete cascade
);

create index project_members_member_id_idx
  on public.project_members (member_id, project_id)
  where left_at is null;
create index project_members_project_role_idx
  on public.project_members (project_id, role)
  where left_at is null;
create unique index project_members_one_owner_uidx
  on public.project_members (project_id)
  where role = 'owner' and left_at is null;

create table public.milestones (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  organization_id bigint not null,
  project_id bigint not null,
  owner_member_id bigint,
  name text not null check (btrim(name) <> ''),
  description text not null default '',
  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'completed', 'overdue')),
  start_date date,
  due_date date not null,
  completed_at timestamptz,
  progress numeric(5, 2) not null default 0
    check (progress >= 0 and progress <= 100),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint milestones_valid_period
    check (start_date is null or start_date <= due_date),
  constraint milestones_project_same_organization_fk
    foreign key (organization_id, project_id)
    references public.projects (organization_id, id) on delete cascade,
  constraint milestones_owner_same_organization_fk
    foreign key (organization_id, owner_member_id)
    references public.organization_members (organization_id, id)
);

create unique index milestones_organization_project_id_uidx
  on public.milestones (organization_id, project_id, id);
create index milestones_project_sort_idx
  on public.milestones (project_id, sort_order, due_date)
  where deleted_at is null;
create index milestones_owner_status_idx
  on public.milestones (owner_member_id, status)
  where owner_member_id is not null and deleted_at is null;

create table public.tasks (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  organization_id bigint not null,
  project_id bigint not null,
  milestone_id bigint,
  parent_task_id bigint,
  title text not null check (btrim(title) <> ''),
  description text not null default '',
  assignee_member_id bigint,
  reporter_member_id bigint not null,
  status text not null default 'todo'
    check (status in ('backlog', 'todo', 'in_progress', 'in_review', 'done', 'cancelled')),
  priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high', 'urgent')),
  start_date date,
  due_date date,
  completed_at timestamptz,
  progress numeric(5, 2) not null default 0
    check (progress >= 0 and progress <= 100),
  estimated_hours numeric(8, 2)
    check (estimated_hours is null or estimated_hours >= 0),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (organization_id, project_id, id),
  constraint tasks_valid_period
    check (start_date is null or due_date is null or start_date <= due_date),
  constraint tasks_project_same_organization_fk
    foreign key (organization_id, project_id)
    references public.projects (organization_id, id) on delete cascade,
  constraint tasks_milestone_same_project_fk
    foreign key (organization_id, project_id, milestone_id)
    references public.milestones (organization_id, project_id, id),
  constraint tasks_parent_same_project_fk
    foreign key (organization_id, project_id, parent_task_id)
    references public.tasks (organization_id, project_id, id),
  constraint tasks_assignee_same_organization_fk
    foreign key (organization_id, assignee_member_id)
    references public.organization_members (organization_id, id),
  constraint tasks_assignee_is_project_member_fk
    foreign key (project_id, assignee_member_id)
    references public.project_members (project_id, member_id),
  constraint tasks_reporter_same_organization_fk
    foreign key (organization_id, reporter_member_id)
    references public.organization_members (organization_id, id)
);

create index tasks_project_status_sort_idx
  on public.tasks (project_id, status, sort_order)
  where deleted_at is null;
create index tasks_assignee_status_due_idx
  on public.tasks (assignee_member_id, status, due_date)
  where assignee_member_id is not null and deleted_at is null;
create index tasks_milestone_id_idx
  on public.tasks (milestone_id)
  where milestone_id is not null and deleted_at is null;
create index tasks_parent_task_id_idx
  on public.tasks (parent_task_id)
  where parent_task_id is not null and deleted_at is null;
create index tasks_reporter_member_id_idx
  on public.tasks (reporter_member_id);

create table public.task_comments (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  organization_id bigint not null,
  project_id bigint not null,
  task_id bigint not null,
  author_member_id bigint not null,
  body text not null check (btrim(body) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint task_comments_task_same_project_fk
    foreign key (organization_id, project_id, task_id)
    references public.tasks (organization_id, project_id, id) on delete cascade,
  constraint task_comments_author_same_organization_fk
    foreign key (organization_id, author_member_id)
    references public.organization_members (organization_id, id)
);

create index task_comments_task_created_idx
  on public.task_comments (task_id, created_at)
  where deleted_at is null;
create index task_comments_author_member_id_idx
  on public.task_comments (author_member_id)
  where deleted_at is null;

alter table public.files
  add column project_id bigint,
  add column task_id bigint,
  add constraint files_project_same_organization_fk
    foreign key (organization_id, project_id)
    references public.projects (organization_id, id) on delete cascade,
  add constraint files_task_same_project_fk
    foreign key (organization_id, project_id, task_id)
    references public.tasks (organization_id, project_id, id),
  add constraint files_task_requires_project_check
    check (task_id is null or project_id is not null);

create index files_project_created_idx
  on public.files (project_id, created_at desc)
  where project_id is not null and deleted_at is null;
create index files_task_created_idx
  on public.files (task_id, created_at desc)
  where task_id is not null and deleted_at is null;

create table public.daily_reports (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  organization_id bigint not null,
  project_id bigint not null,
  author_member_id bigint not null,
  report_date date not null,
  status text not null default 'draft'
    check (status in ('draft', 'submitted')),
  summary text not null default '',
  next_plan text not null default '',
  blockers text,
  support_needed text,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (project_id, author_member_id, report_date),
  constraint daily_reports_project_same_organization_fk
    foreign key (organization_id, project_id)
    references public.projects (organization_id, id) on delete cascade,
  constraint daily_reports_author_same_organization_fk
    foreign key (organization_id, author_member_id)
    references public.organization_members (organization_id, id),
  constraint daily_reports_submission_state_check
    check (
      (status = 'draft' and submitted_at is null)
      or (status = 'submitted' and submitted_at is not null)
    )
);

create index daily_reports_project_date_idx
  on public.daily_reports (project_id, report_date desc)
  where deleted_at is null;
create index daily_reports_author_date_idx
  on public.daily_reports (author_member_id, report_date desc)
  where deleted_at is null;

insert into public.permissions (code, name, module, action)
values
  ('project.read', '查看项目', 'projects', 'read'),
  ('project.create', '创建项目', 'projects', 'create'),
  ('task.execute', '执行本人任务', 'tasks', 'execute'),
  ('project.comment', '参与项目讨论', 'projects', 'comment'),
  ('project.report', '提交项目日报', 'projects', 'report'),
  ('project.files', '管理项目文件', 'projects', 'files')
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_id)
select roles.id, permissions.id
from public.roles roles
cross join public.permissions permissions
where roles.organization_id is null
  and (
    (roles.code = 'owner' and permissions.code = 'project.read')
    or (
      roles.code = 'admin'
      and permissions.code in (
        'project.read',
        'project.create',
        'project.manage',
        'task.manage',
        'task.execute',
        'project.comment',
        'project.report',
        'project.files'
      )
    )
  )
on conflict do nothing;

create or replace function public.current_organization_member_id(
  target_organization_id bigint
)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select members.id
  from public.organization_members members
  where members.organization_id = target_organization_id
    and members.user_id = (select auth.uid())
    and members.status = 'active'
  limit 1;
$$;

create or replace function public.is_project_member(target_project_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.projects projects
    join public.organization_members members
      on members.organization_id = projects.organization_id
     and members.user_id = (select auth.uid())
     and members.status = 'active'
    left join public.project_members memberships
      on memberships.project_id = projects.id
     and memberships.member_id = members.id
     and memberships.left_at is null
    where projects.id = target_project_id
      and projects.deleted_at is null
      and (
        projects.owner_member_id = members.id
        or memberships.id is not null
      )
  );
$$;

create or replace function public.can_view_project(target_project_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.projects projects
    where projects.id = target_project_id
      and projects.deleted_at is null
      and (
        public.is_project_member(projects.id)
        or public.has_organization_role(
          projects.organization_id,
          array['owner', 'admin']
        )
      )
  );
$$;

create or replace function public.can_manage_project(target_project_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.projects projects
    join public.organization_members members
      on members.organization_id = projects.organization_id
     and members.user_id = (select auth.uid())
     and members.status = 'active'
    left join public.project_members memberships
      on memberships.project_id = projects.id
     and memberships.member_id = members.id
     and memberships.left_at is null
    where projects.id = target_project_id
      and projects.deleted_at is null
      and (
        public.has_organization_role(projects.organization_id, array['admin'])
        or projects.owner_member_id = members.id
        or memberships.role in ('owner', 'manager')
      )
  );
$$;

create or replace function public.can_contribute_project(target_project_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.projects projects
    join public.organization_members members
      on members.organization_id = projects.organization_id
     and members.user_id = (select auth.uid())
     and members.status = 'active'
    left join public.project_members memberships
      on memberships.project_id = projects.id
     and memberships.member_id = members.id
     and memberships.left_at is null
    where projects.id = target_project_id
      and projects.deleted_at is null
      and (
        public.has_organization_role(projects.organization_id, array['admin'])
        or projects.owner_member_id = members.id
        or memberships.role in ('owner', 'manager', 'member')
      )
  );
$$;

create or replace function public.enforce_project_identity_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if row(
    new.id,
    new.public_id,
    new.organization_id,
    new.created_by_member_id,
    new.created_at
  ) is distinct from row(
    old.id,
    old.public_id,
    old.organization_id,
    old.created_by_member_id,
    old.created_at
  ) then
    raise exception using
      errcode = '42501',
      message = 'Project identity and organization fields are immutable.';
  end if;

  return new;
end;
$$;

create or replace function public.enforce_task_member_execution_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_member_id bigint;
begin
  if public.can_manage_project(old.project_id) then
    return new;
  end if;

  current_member_id := public.current_organization_member_id(old.organization_id);

  if current_member_id is null
    or old.assignee_member_id is distinct from current_member_id
    or new.assignee_member_id is distinct from current_member_id then
    raise exception using
      errcode = '42501',
      message = 'Only the assigned member may execute this task.';
  end if;

  if row(
    new.id,
    new.public_id,
    new.organization_id,
    new.project_id,
    new.milestone_id,
    new.parent_task_id,
    new.title,
    new.description,
    new.assignee_member_id,
    new.reporter_member_id,
    new.priority,
    new.start_date,
    new.due_date,
    new.estimated_hours,
    new.sort_order,
    new.created_at,
    new.deleted_at
  ) is distinct from row(
    old.id,
    old.public_id,
    old.organization_id,
    old.project_id,
    old.milestone_id,
    old.parent_task_id,
    old.title,
    old.description,
    old.assignee_member_id,
    old.reporter_member_id,
    old.priority,
    old.start_date,
    old.due_date,
    old.estimated_hours,
    old.sort_order,
    old.created_at,
    old.deleted_at
  ) then
    raise exception using
      errcode = '42501',
      message = 'Project members may only update task execution fields.';
  end if;

  return new;
end;
$$;

create trigger projects_identity_fields_guard
before update on public.projects
for each row execute function public.enforce_project_identity_fields();

create trigger tasks_member_execution_fields_guard
before update on public.tasks
for each row execute function public.enforce_task_member_execution_fields();

alter table public.objectives enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.milestones enable row level security;
alter table public.tasks enable row level security;
alter table public.task_comments enable row level security;
alter table public.daily_reports enable row level security;

create policy objectives_member_select on public.objectives
  for select to authenticated
  using (
    deleted_at is null
    and (select public.is_organization_member(organization_id))
  );

create policy objectives_admin_insert on public.objectives
  for insert to authenticated
  with check (
    created_by_member_id = (
      select public.current_organization_member_id(organization_id)
    )
    and (select public.has_organization_role(organization_id, array['admin']))
  );

create policy objectives_admin_update on public.objectives
  for update to authenticated
  using ((select public.has_organization_role(organization_id, array['admin'])))
  with check ((select public.has_organization_role(organization_id, array['admin'])));

create policy projects_authorized_select on public.projects
  for select to authenticated
  using (
    deleted_at is null
    and (
      (select public.has_organization_role(
        organization_id,
        array['owner', 'admin']
      ))
      or (select public.is_project_member(id))
    )
  );

create policy projects_admin_insert on public.projects
  for insert to authenticated
  with check (
    created_by_member_id = (
      select public.current_organization_member_id(organization_id)
    )
    and (select public.has_organization_role(organization_id, array['admin']))
  );

create policy projects_manager_update on public.projects
  for update to authenticated
  using ((select public.can_manage_project(id)))
  with check ((select public.can_manage_project(id)));

create policy project_members_authorized_select on public.project_members
  for select to authenticated
  using ((select public.can_view_project(project_id)));

create policy project_members_manager_insert on public.project_members
  for insert to authenticated
  with check ((select public.can_manage_project(project_id)));

create policy project_members_manager_update on public.project_members
  for update to authenticated
  using ((select public.can_manage_project(project_id)))
  with check ((select public.can_manage_project(project_id)));

create policy milestones_authorized_select on public.milestones
  for select to authenticated
  using (
    deleted_at is null
    and (select public.can_view_project(project_id))
  );

create policy milestones_manager_insert on public.milestones
  for insert to authenticated
  with check ((select public.can_manage_project(project_id)));

create policy milestones_manager_update on public.milestones
  for update to authenticated
  using ((select public.can_manage_project(project_id)))
  with check ((select public.can_manage_project(project_id)));

create policy tasks_authorized_select on public.tasks
  for select to authenticated
  using (
    deleted_at is null
    and (select public.can_view_project(project_id))
  );

create policy tasks_manager_insert on public.tasks
  for insert to authenticated
  with check ((select public.can_manage_project(project_id)));

create policy tasks_manager_or_assignee_update on public.tasks
  for update to authenticated
  using (
    (select public.can_manage_project(project_id))
    or assignee_member_id = (
      select public.current_organization_member_id(organization_id)
    )
  )
  with check (
    (select public.can_manage_project(project_id))
    or assignee_member_id = (
      select public.current_organization_member_id(organization_id)
    )
  );

create policy task_comments_authorized_select on public.task_comments
  for select to authenticated
  using (
    deleted_at is null
    and (select public.can_view_project(project_id))
  );

create policy task_comments_contributor_insert on public.task_comments
  for insert to authenticated
  with check (
    author_member_id = (
      select public.current_organization_member_id(organization_id)
    )
    and (select public.can_contribute_project(project_id))
  );

create policy task_comments_author_or_manager_update on public.task_comments
  for update to authenticated
  using (
    author_member_id = (
      select public.current_organization_member_id(organization_id)
    )
    or (select public.can_manage_project(project_id))
  )
  with check (
    author_member_id = (
      select public.current_organization_member_id(organization_id)
    )
    or (select public.can_manage_project(project_id))
  );

drop policy files_member_select on public.files;
drop policy files_member_insert on public.files;

create policy files_authorized_select on public.files
  for select to authenticated
  using (
    deleted_at is null
    and (
      (
        project_id is null
        and (select public.is_organization_member(organization_id))
        and (
          access_scope = 'organization'
          or uploaded_by = (select auth.uid())
          or (select public.has_organization_role(
            organization_id,
            array['owner', 'admin', 'department_head', 'hr', 'finance']
          ))
        )
      )
      or (
        project_id is not null
        and (select public.can_view_project(project_id))
        and (
          access_scope <> 'private'
          or uploaded_by = (select auth.uid())
          or (select public.can_manage_project(project_id))
        )
      )
    )
  );

create policy files_contributor_insert on public.files
  for insert to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and (
      (
        project_id is null
        and (select public.is_organization_member(organization_id))
      )
      or (
        project_id is not null
        and (select public.can_contribute_project(project_id))
      )
    )
  );

create policy files_uploader_or_manager_update on public.files
  for update to authenticated
  using (
    uploaded_by = (select auth.uid())
    or (
      project_id is not null
      and (select public.can_manage_project(project_id))
    )
    or (
      project_id is null
      and (select public.has_organization_role(organization_id, array['admin']))
    )
  )
  with check (
    uploaded_by = (select auth.uid())
    or (
      project_id is not null
      and (select public.can_manage_project(project_id))
    )
    or (
      project_id is null
      and (select public.has_organization_role(organization_id, array['admin']))
    )
  );

create policy daily_reports_authorized_select on public.daily_reports
  for select to authenticated
  using (
    deleted_at is null
    and (select public.can_view_project(project_id))
  );

create policy daily_reports_contributor_insert on public.daily_reports
  for insert to authenticated
  with check (
    author_member_id = (
      select public.current_organization_member_id(organization_id)
    )
    and (select public.can_contribute_project(project_id))
  );

create policy daily_reports_author_or_manager_update on public.daily_reports
  for update to authenticated
  using (
    author_member_id = (
      select public.current_organization_member_id(organization_id)
    )
    or (select public.can_manage_project(project_id))
  )
  with check (
    author_member_id = (
      select public.current_organization_member_id(organization_id)
    )
    or (select public.can_manage_project(project_id))
  );

revoke execute on function public.current_organization_member_id(bigint) from public;
revoke execute on function public.is_project_member(bigint) from public;
revoke execute on function public.can_view_project(bigint) from public;
revoke execute on function public.can_manage_project(bigint) from public;
revoke execute on function public.can_contribute_project(bigint) from public;
revoke execute on function public.enforce_project_identity_fields() from public;
revoke execute on function public.enforce_task_member_execution_fields() from public;

grant execute on function public.current_organization_member_id(bigint) to authenticated;
grant execute on function public.is_project_member(bigint) to authenticated;
grant execute on function public.can_view_project(bigint) to authenticated;
grant execute on function public.can_manage_project(bigint) to authenticated;
grant execute on function public.can_contribute_project(bigint) to authenticated;

grant select, insert, update on public.objectives to authenticated;
grant select, insert, update on public.projects to authenticated;
grant select, insert, update on public.project_members to authenticated;
grant select, insert, update on public.milestones to authenticated;
grant select, insert, update on public.tasks to authenticated;
grant select, insert, update on public.task_comments to authenticated;
grant update on public.files to authenticated;
grant select, insert, update on public.daily_reports to authenticated;
grant usage, select on all sequences in schema public to authenticated;
