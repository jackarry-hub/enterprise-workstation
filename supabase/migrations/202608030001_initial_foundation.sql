create extension if not exists pgcrypto;

create table public.organizations (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  name text not null,
  slug text not null unique,
  logo_url text,
  timezone text not null default 'Asia/Shanghai',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  id bigint generated always as identity primary key,
  organization_id bigint not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('invited', 'active', 'suspended')),
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index organization_members_user_id_idx
  on public.organization_members (user_id);

create table public.roles (
  id bigint generated always as identity primary key,
  organization_id bigint references public.organizations(id) on delete cascade,
  code text not null,
  name text not null,
  description text not null,
  is_system boolean not null default false,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index roles_system_code_idx
  on public.roles (code)
  where organization_id is null;

create unique index roles_organization_code_idx
  on public.roles (organization_id, code)
  where organization_id is not null;

create table public.permissions (
  id bigint generated always as identity primary key,
  code text not null unique,
  name text not null,
  module text not null,
  action text not null
);

create table public.member_roles (
  member_id bigint not null references public.organization_members(id) on delete cascade,
  role_id bigint not null references public.roles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (member_id, role_id)
);

create index member_roles_role_id_idx on public.member_roles (role_id);

create table public.role_permissions (
  role_id bigint not null references public.roles(id) on delete cascade,
  permission_id bigint not null references public.permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

create index role_permissions_permission_id_idx
  on public.role_permissions (permission_id);

create table public.files (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  organization_id bigint not null references public.organizations(id) on delete cascade,
  bucket text not null,
  object_path text not null,
  original_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  access_scope text not null default 'restricted'
    check (access_scope in ('organization', 'restricted', 'private')),
  uploaded_by uuid not null references auth.users(id),
  entity_type text,
  entity_public_id uuid,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (bucket, object_path)
);

create index files_organization_id_idx on public.files (organization_id);
create index files_uploaded_by_idx on public.files (uploaded_by);
create index files_entity_idx
  on public.files (organization_id, entity_type, entity_public_id)
  where deleted_at is null;

insert into public.roles (code, name, description, is_system)
values
  ('owner', '老板', '企业全局经营数据与全部业务查看权限', true),
  ('admin', '管理员', '系统配置、成员、角色与权限管理', true),
  ('department_head', '部门负责人', '本部门项目、任务、人员与审批管理', true),
  ('employee', '普通员工', '本人任务、日程、考勤、薪资与申请', true),
  ('hr', 'HR', '组织人事、考勤与人事类审批管理', true),
  ('finance', '财务', '薪资、报销、采购与财务统计管理', true)
on conflict do nothing;

insert into public.permissions (code, name, module, action)
values
  ('dashboard.read', '查看经营驾驶舱', 'dashboard', 'read'),
  ('organization.manage', '管理组织与权限', 'organization', 'manage'),
  ('department.manage', '管理本部门', 'department', 'manage'),
  ('project.manage', '管理项目', 'projects', 'manage'),
  ('task.manage', '管理任务', 'tasks', 'manage'),
  ('hr.manage', '管理组织人事', 'hr', 'manage'),
  ('attendance.self', '查看本人考勤', 'attendance', 'self'),
  ('attendance.manage', '管理考勤', 'attendance', 'manage'),
  ('salary.self', '查看本人工资', 'salary', 'self'),
  ('salary.manage', '管理薪资', 'salary', 'manage'),
  ('approval.self', '管理本人审批', 'approvals', 'self'),
  ('approval.manage', '管理审批流程', 'approvals', 'manage'),
  ('files.manage', '管理业务文件', 'files', 'manage')
on conflict (code) do nothing;

create or replace function public.is_organization_member(target_organization_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members
    where organization_id = target_organization_id
      and user_id = (select auth.uid())
      and status = 'active'
  );
$$;

create or replace function public.has_organization_role(
  target_organization_id bigint,
  allowed_role_codes text[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members members
    join public.member_roles assignments on assignments.member_id = members.id
    join public.roles roles on roles.id = assignments.role_id
    where members.organization_id = target_organization_id
      and members.user_id = (select auth.uid())
      and members.status = 'active'
      and roles.is_enabled
      and roles.code = any (allowed_role_codes)
      and (roles.organization_id is null or roles.organization_id = target_organization_id)
  );
$$;

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.member_roles enable row level security;
alter table public.role_permissions enable row level security;
alter table public.files enable row level security;

create policy organizations_member_select on public.organizations
  for select to authenticated
  using ((select public.is_organization_member(id)));

create policy organization_members_member_select on public.organization_members
  for select to authenticated
  using ((select public.is_organization_member(organization_id)));

create policy roles_member_select on public.roles
  for select to authenticated
  using (organization_id is null or (select public.is_organization_member(organization_id)));

create policy permissions_authenticated_select on public.permissions
  for select to authenticated using (true);

create policy member_roles_member_select on public.member_roles
  for select to authenticated
  using (
    exists (
      select 1 from public.organization_members member
      where member.id = member_id
        and (select public.is_organization_member(member.organization_id))
    )
  );

create policy role_permissions_authenticated_select on public.role_permissions
  for select to authenticated using (true);

create policy files_member_select on public.files
  for select to authenticated
  using (
    deleted_at is null
    and (select public.is_organization_member(organization_id))
    and (
      access_scope = 'organization'
      or uploaded_by = (select auth.uid())
      or (select public.has_organization_role(
        organization_id,
        array['owner', 'admin', 'department_head', 'hr', 'finance']
      ))
    )
  );

create policy files_member_insert on public.files
  for insert to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and (select public.is_organization_member(organization_id))
  );

grant usage on schema public to authenticated;
grant select on public.organizations, public.organization_members,
  public.roles, public.permissions, public.member_roles,
  public.role_permissions, public.files to authenticated;
grant insert on public.files to authenticated;
grant usage, select on all sequences in schema public to authenticated;
