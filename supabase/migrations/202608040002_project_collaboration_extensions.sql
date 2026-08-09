-- Project collaboration extensions: append-only activity stream, project risks,
-- and typed many-to-many file relations.

create unique index files_organization_id_id_uidx
  on public.files (organization_id, id);

create unique index task_comments_organization_project_id_uidx
  on public.task_comments (organization_id, project_id, id);

create unique index daily_reports_organization_project_id_uidx
  on public.daily_reports (organization_id, project_id, id);

create table public.project_activities (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  organization_id bigint not null,
  project_id bigint not null,
  user_id uuid not null,
  action_type text not null,
  content text not null check (btrim(content) <> ''),
  created_at timestamptz not null default now(),
  constraint project_activities_project_same_organization_fk
    foreign key (organization_id, project_id)
    references public.projects (organization_id, id) on delete cascade,
  constraint project_activities_user_id_fkey
    foreign key (user_id)
    references auth.users (id),
  constraint project_activities_action_type_check check (
    action_type in (
      'project_created',
      'project_updated',
      'member_added',
      'milestone_updated',
      'task_updated',
      'file_uploaded',
      'daily_report_submitted',
      'risk_updated'
    )
  )
);

create index project_activities_project_created_idx
  on public.project_activities (project_id, created_at desc);
create index project_activities_user_created_idx
  on public.project_activities (user_id, created_at desc);

create table public.project_risks (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  organization_id bigint not null,
  project_id bigint not null,
  title text not null check (btrim(title) <> ''),
  level text not null default 'medium'
    check (level in ('low', 'medium', 'high', 'critical')),
  owner_member_id bigint not null,
  status text not null default 'open'
    check (status in ('open', 'monitoring', 'mitigated', 'closed')),
  deadline date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint project_risks_project_same_organization_fk
    foreign key (organization_id, project_id)
    references public.projects (organization_id, id) on delete cascade,
  constraint project_risks_owner_same_organization_fk
    foreign key (organization_id, owner_member_id)
    references public.organization_members (organization_id, id),
  constraint project_risks_owner_is_project_member_fk
    foreign key (project_id, owner_member_id)
    references public.project_members (project_id, member_id)
);

create index project_risks_project_status_deadline_idx
  on public.project_risks (project_id, status, deadline)
  where deleted_at is null;
create index project_risks_project_level_deadline_idx
  on public.project_risks (project_id, level, deadline)
  where deleted_at is null;
create index project_risks_owner_member_id_idx
  on public.project_risks (owner_member_id)
  where deleted_at is null;

create table public.file_relations (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  organization_id bigint not null,
  project_id bigint not null,
  file_id bigint not null,
  relation_type text not null
    check (relation_type in ('project', 'task', 'milestone', 'daily_report', 'task_comment')),
  task_id bigint,
  milestone_id bigint,
  daily_report_id bigint,
  task_comment_id bigint,
  created_by_member_id bigint not null,
  created_at timestamptz not null default now(),
  constraint file_relations_project_same_organization_fk
    foreign key (organization_id, project_id)
    references public.projects (organization_id, id) on delete cascade,
  constraint file_relations_file_same_organization_fk
    foreign key (organization_id, file_id)
    references public.files (organization_id, id) on delete cascade,
  constraint file_relations_task_same_project_fk
    foreign key (organization_id, project_id, task_id)
    references public.tasks (organization_id, project_id, id) on delete cascade,
  constraint file_relations_milestone_same_project_fk
    foreign key (organization_id, project_id, milestone_id)
    references public.milestones (organization_id, project_id, id) on delete cascade,
  constraint file_relations_daily_report_same_project_fk
    foreign key (organization_id, project_id, daily_report_id)
    references public.daily_reports (organization_id, project_id, id) on delete cascade,
  constraint file_relations_comment_same_project_fk
    foreign key (organization_id, project_id, task_comment_id)
    references public.task_comments (organization_id, project_id, id) on delete cascade,
  constraint file_relations_creator_same_organization_fk
    foreign key (organization_id, created_by_member_id)
    references public.organization_members (organization_id, id),
  constraint file_relations_target_check check (
    (relation_type = 'project'
      and num_nonnulls(task_id, milestone_id, daily_report_id, task_comment_id) = 0)
    or (relation_type = 'task'
      and task_id is not null
      and num_nonnulls(milestone_id, daily_report_id, task_comment_id) = 0)
    or (relation_type = 'milestone'
      and milestone_id is not null
      and num_nonnulls(task_id, daily_report_id, task_comment_id) = 0)
    or (relation_type = 'daily_report'
      and daily_report_id is not null
      and num_nonnulls(task_id, milestone_id, task_comment_id) = 0)
    or (relation_type = 'task_comment'
      and task_comment_id is not null
      and num_nonnulls(task_id, milestone_id, daily_report_id) = 0)
  )
);

create unique index file_relations_project_uidx
  on public.file_relations (file_id, project_id)
  where relation_type = 'project';
create unique index file_relations_task_uidx
  on public.file_relations (file_id, task_id)
  where relation_type = 'task';
create unique index file_relations_milestone_uidx
  on public.file_relations (file_id, milestone_id)
  where relation_type = 'milestone';
create unique index file_relations_daily_report_uidx
  on public.file_relations (file_id, daily_report_id)
  where relation_type = 'daily_report';
create unique index file_relations_task_comment_uidx
  on public.file_relations (file_id, task_comment_id)
  where relation_type = 'task_comment';
create index file_relations_project_created_idx
  on public.file_relations (project_id, created_at desc);
create index file_relations_organization_file_id_idx
  on public.file_relations (organization_id, file_id);
create index file_relations_task_id_idx
  on public.file_relations (task_id)
  where task_id is not null;
create index file_relations_milestone_id_idx
  on public.file_relations (milestone_id)
  where milestone_id is not null;
create index file_relations_daily_report_id_idx
  on public.file_relations (daily_report_id)
  where daily_report_id is not null;
create index file_relations_task_comment_id_idx
  on public.file_relations (task_comment_id)
  where task_comment_id is not null;
create index file_relations_created_by_member_id_idx
  on public.file_relations (created_by_member_id);

create or replace function public.touch_project_risk_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger project_risks_updated_at
before update on public.project_risks
for each row execute function public.touch_project_risk_updated_at();

create or replace function public.ensure_project_risk_owner_is_active()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1
    from public.project_members memberships
    join public.organization_members members
      on members.id = memberships.member_id
     and members.organization_id = memberships.organization_id
    where memberships.project_id = new.project_id
      and memberships.organization_id = new.organization_id
      and memberships.member_id = new.owner_member_id
      and memberships.left_at is null
      and members.status = 'active'
    for update of memberships, members;

  if not found then
    raise exception 'Project risk owner must be an active project member'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger project_risks_active_owner
before insert or update
on public.project_risks
for each row execute function public.ensure_project_risk_owner_is_active();

create or replace function public.guard_project_risk_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.left_at is null and new.left_at is not null and exists (
    select 1
    from public.project_risks risks
    where risks.organization_id = old.organization_id
      and risks.project_id = old.project_id
      and risks.owner_member_id = old.member_id
      and risks.deleted_at is null
  ) then
    raise exception 'Reassign project risks before removing their owner from the project'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger project_members_guard_risk_ownership
before update of left_at on public.project_members
for each row execute function public.guard_project_risk_owner_membership();

create or replace function public.guard_organization_risk_owner_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'active' and new.status <> 'active' and exists (
    select 1
    from public.project_risks risks
    where risks.organization_id = old.organization_id
      and risks.owner_member_id = old.id
      and risks.deleted_at is null
  ) then
    raise exception 'Reassign project risks before deactivating their owner'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger organization_members_guard_risk_ownership
before update of status on public.organization_members
for each row execute function public.guard_organization_risk_owner_status();

alter table public.project_activities enable row level security;
alter table public.project_activities force row level security;
alter table public.project_risks enable row level security;
alter table public.project_risks force row level security;
alter table public.file_relations enable row level security;
alter table public.file_relations force row level security;

create policy project_activities_select on public.project_activities
for select to authenticated
using (public.can_view_project(project_id));

create policy project_risks_select on public.project_risks
for select to authenticated
using (public.can_view_project(project_id));

create policy project_risks_insert on public.project_risks
for insert to authenticated
with check (public.can_manage_project(project_id));

create policy project_risks_update on public.project_risks
for update to authenticated
using (public.can_manage_project(project_id))
with check (public.can_manage_project(project_id));

create policy file_relations_select on public.file_relations
for select to authenticated
using (
  public.can_view_project(project_id)
  and exists (
    select 1
    from public.files related_file
    where related_file.id = file_relations.file_id
      and related_file.organization_id = file_relations.organization_id
      and related_file.deleted_at is null
  )
);

create policy file_relations_insert on public.file_relations
for insert to authenticated
with check (
  public.can_contribute_project(project_id)
  and created_by_member_id = public.current_organization_member_id(organization_id)
  and exists (
    select 1
    from public.files related_file
    where related_file.id = file_relations.file_id
      and related_file.organization_id = file_relations.organization_id
      and related_file.deleted_at is null
  )
);

create policy file_relations_delete on public.file_relations
for delete to authenticated
using (
  public.can_manage_project(project_id)
  or (
    created_by_member_id = public.current_organization_member_id(organization_id)
    and public.can_contribute_project(project_id)
  )
);

revoke execute on function public.touch_project_risk_updated_at() from public;
revoke execute on function public.ensure_project_risk_owner_is_active() from public;
revoke execute on function public.guard_project_risk_owner_membership() from public;
revoke execute on function public.guard_organization_risk_owner_status() from public;

revoke insert, update, delete on public.project_activities from authenticated;
grant select on public.project_activities to authenticated;
grant select, insert on public.project_activities to service_role;
grant select, insert, update on public.project_risks to authenticated;
grant select, insert, delete on public.file_relations to authenticated;
grant usage, select on all sequences in schema public to authenticated;
