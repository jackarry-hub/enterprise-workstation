-- Professional workstation closure: decision, role execution, leave, payroll,
-- support requests, knowledge and immutable audit records.

create table public.decision_commands (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  organization_id bigint not null references public.organizations(id) on delete cascade,
  owner_member_id bigint not null,
  project_id bigint references public.projects(id) on delete set null,
  title text not null check (btrim(title) <> ''),
  summary text not null default '',
  status text not null default 'draft' check (status in ('draft', 'review', 'issued', 'executing', 'accepted', 'archived', 'cancelled')),
  deadline date not null,
  budget_limit numeric(14, 2) not null default 0 check (budget_limit >= 0),
  constraints text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint decision_commands_owner_fk foreign key (organization_id, owner_member_id) references public.organization_members(organization_id, id)
);

create table public.department_work_orders (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  organization_id bigint not null,
  command_id bigint not null references public.decision_commands(id) on delete cascade,
  department_id bigint not null references public.departments(id),
  owner_member_id bigint not null,
  objective text not null check (btrim(objective) <> ''),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'executing', 'review', 'completed', 'rejected')),
  due_date date not null,
  accepted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (command_id, department_id),
  constraint department_work_orders_org_fk foreign key (organization_id) references public.organizations(id) on delete cascade,
  constraint department_work_orders_owner_fk foreign key (organization_id, owner_member_id) references public.organization_members(organization_id, id)
);

alter table public.tasks add column if not exists work_order_id bigint references public.department_work_orders(id) on delete set null;
alter table public.tasks add column if not exists acceptance_criteria text not null default '';
alter table public.tasks add column if not exists blocker text;
alter table public.tasks add column if not exists review_note text;

create table public.task_dependencies (
  organization_id bigint not null references public.organizations(id) on delete cascade,
  task_id bigint not null references public.tasks(id) on delete cascade,
  depends_on_task_id bigint not null references public.tasks(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, depends_on_task_id),
  check (task_id <> depends_on_task_id)
);

create table public.support_requests (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  organization_id bigint not null references public.organizations(id) on delete cascade,
  command_id bigint references public.decision_commands(id) on delete cascade,
  source_task_id bigint references public.tasks(id) on delete set null,
  request_type text not null check (request_type in ('finance', 'staffing', 'training', 'procurement')),
  requester_member_id bigint not null,
  handler_member_id bigint,
  title text not null check (btrim(title) <> ''),
  description text not null default '',
  amount numeric(14, 2) check (amount is null or amount >= 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'in_progress', 'completed', 'rejected')),
  result text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint support_requests_requester_fk foreign key (organization_id, requester_member_id) references public.organization_members(organization_id, id),
  constraint support_requests_handler_fk foreign key (organization_id, handler_member_id) references public.organization_members(organization_id, id)
);

create table public.leave_requests (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  organization_id bigint not null references public.organizations(id) on delete cascade,
  employee_member_id bigint not null,
  manager_member_id bigint not null,
  leave_type text not null check (leave_type in ('annual', 'sick', 'personal', 'compensatory')),
  start_at timestamptz not null,
  end_at timestamptz not null,
  days numeric(5, 2) not null check (days > 0),
  reason text not null check (btrim(reason) <> ''),
  handover text not null check (btrim(handover) <> ''),
  status text not null default 'pending_manager' check (status in ('pending_manager', 'pending_hr', 'approved', 'rejected', 'cancelled')),
  manager_comment text,
  hr_comment text,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz,
  constraint leave_requests_period_check check (end_at >= start_at),
  constraint leave_requests_employee_fk foreign key (organization_id, employee_member_id) references public.organization_members(organization_id, id),
  constraint leave_requests_manager_fk foreign key (organization_id, manager_member_id) references public.organization_members(organization_id, id)
);

create table public.payroll_runs (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  organization_id bigint not null references public.organizations(id) on delete cascade,
  month date not null,
  status text not null default 'draft' check (status in ('draft', 'calculated', 'verified', 'approved', 'paid')),
  headcount integer not null default 0 check (headcount >= 0),
  gross_amount numeric(16, 2) not null default 0,
  deduction_amount numeric(16, 2) not null default 0,
  net_amount numeric(16, 2) not null default 0,
  attendance_locked boolean not null default false,
  exception_count integer not null default 0 check (exception_count >= 0),
  calculated_by bigint,
  verified_by bigint,
  approved_by bigint,
  calculated_at timestamptz,
  verified_at timestamptz,
  approved_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, month),
  constraint payroll_runs_amount_check check (gross_amount - deduction_amount = net_amount)
);

create table public.knowledge_documents (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  organization_id bigint not null references public.organizations(id) on delete cascade,
  command_id bigint references public.decision_commands(id) on delete set null,
  source_task_id bigint references public.tasks(id) on delete set null,
  created_by_member_id bigint not null,
  title text not null check (btrim(title) <> ''),
  summary text not null default '',
  category text not null,
  tags text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  version integer not null default 1 check (version > 0),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint knowledge_documents_creator_fk foreign key (organization_id, created_by_member_id) references public.organization_members(organization_id, id)
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  organization_id bigint not null references public.organizations(id) on delete cascade,
  actor_member_id bigint,
  entity_type text not null,
  entity_public_id uuid,
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint audit_events_actor_fk foreign key (organization_id, actor_member_id) references public.organization_members(organization_id, id)
);

create index decision_commands_org_status_idx on public.decision_commands(organization_id, status, updated_at desc);
create index department_work_orders_owner_status_idx on public.department_work_orders(owner_member_id, status, due_date);
create index support_requests_handler_status_idx on public.support_requests(handler_member_id, status, updated_at desc);
create index leave_requests_employee_status_idx on public.leave_requests(employee_member_id, status, start_at desc);
create index leave_requests_manager_status_idx on public.leave_requests(manager_member_id, status, submitted_at desc);
create index knowledge_documents_search_idx on public.knowledge_documents using gin (to_tsvector('simple', title || ' ' || summary));
create index audit_events_entity_idx on public.audit_events(organization_id, entity_type, entity_public_id, created_at desc);

alter table public.decision_commands enable row level security;
alter table public.department_work_orders enable row level security;
alter table public.task_dependencies enable row level security;
alter table public.support_requests enable row level security;
alter table public.leave_requests enable row level security;
alter table public.payroll_runs enable row level security;
alter table public.knowledge_documents enable row level security;
alter table public.audit_events enable row level security;

create policy professional_member_read_commands on public.decision_commands for select to authenticated using (public.is_organization_member(organization_id));
create policy professional_owner_manage_commands on public.decision_commands for all to authenticated using (public.has_organization_role(organization_id, array['owner', 'admin'])) with check (public.has_organization_role(organization_id, array['owner', 'admin']));
create policy professional_member_read_work_orders on public.department_work_orders for select to authenticated using (public.is_organization_member(organization_id));
create policy professional_manager_manage_work_orders on public.department_work_orders for all to authenticated using (public.has_organization_role(organization_id, array['owner', 'admin', 'department_head'])) with check (public.has_organization_role(organization_id, array['owner', 'admin', 'department_head']));
create policy professional_member_read_dependencies on public.task_dependencies for select to authenticated using (public.is_organization_member(organization_id));
create policy professional_manager_manage_dependencies on public.task_dependencies for all to authenticated using (public.has_organization_role(organization_id, array['owner', 'admin', 'department_head'])) with check (public.has_organization_role(organization_id, array['owner', 'admin', 'department_head']));
create policy professional_member_read_support on public.support_requests for select to authenticated using (public.is_organization_member(organization_id));
create policy professional_member_create_support on public.support_requests for insert to authenticated with check (requester_member_id = public.current_organization_member_id(organization_id));
create policy professional_handler_update_support on public.support_requests for update to authenticated using (handler_member_id = public.current_organization_member_id(organization_id) or public.has_organization_role(organization_id, array['owner', 'admin'])) with check (handler_member_id = public.current_organization_member_id(organization_id) or public.has_organization_role(organization_id, array['owner', 'admin']));
create policy professional_leave_read on public.leave_requests for select to authenticated using (employee_member_id = public.current_organization_member_id(organization_id) or manager_member_id = public.current_organization_member_id(organization_id) or public.has_organization_role(organization_id, array['owner', 'admin', 'hr'])));
create policy professional_leave_create on public.leave_requests for insert to authenticated with check (employee_member_id = public.current_organization_member_id(organization_id));
create policy professional_leave_review on public.leave_requests for update to authenticated using (employee_member_id = public.current_organization_member_id(organization_id) or manager_member_id = public.current_organization_member_id(organization_id) or public.has_organization_role(organization_id, array['owner', 'admin', 'hr'])) with check (public.is_organization_member(organization_id));
create policy professional_payroll_privileged on public.payroll_runs for all to authenticated using (public.has_organization_role(organization_id, array['owner', 'admin', 'hr', 'finance'])) with check (public.has_organization_role(organization_id, array['owner', 'admin', 'hr', 'finance']));
create policy professional_member_read_knowledge on public.knowledge_documents for select to authenticated using (public.is_organization_member(organization_id));
create policy professional_member_create_knowledge on public.knowledge_documents for insert to authenticated with check (created_by_member_id = public.current_organization_member_id(organization_id));
create policy professional_owner_publish_knowledge on public.knowledge_documents for update to authenticated using (created_by_member_id = public.current_organization_member_id(organization_id) or public.has_organization_role(organization_id, array['owner', 'admin', 'department_head'])) with check (public.is_organization_member(organization_id));
create policy professional_member_read_audit on public.audit_events for select to authenticated using (public.is_organization_member(organization_id));
create policy professional_member_create_audit on public.audit_events for insert to authenticated with check (actor_member_id = public.current_organization_member_id(organization_id));

insert into storage.buckets (id, name, public, file_size_limit)
values ('workbench-files', 'workbench-files', false, 31457280)
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit;

create policy workbench_files_owner_insert on storage.objects for insert to authenticated
with check (bucket_id = 'workbench-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy workbench_files_owner_read on storage.objects for select to authenticated
using (bucket_id = 'workbench-files' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy workbench_files_owner_update on storage.objects for update to authenticated
using (bucket_id = 'workbench-files' and owner_id = (select auth.uid())::text)
with check (bucket_id = 'workbench-files' and owner_id = (select auth.uid())::text);
create policy workbench_files_owner_delete on storage.objects for delete to authenticated
using (bucket_id = 'workbench-files' and owner_id = (select auth.uid())::text);

grant select, insert, update on public.decision_commands, public.department_work_orders, public.task_dependencies, public.support_requests, public.leave_requests, public.payroll_runs, public.knowledge_documents, public.audit_events to authenticated;
grant usage, select on all sequences in schema public to authenticated;

