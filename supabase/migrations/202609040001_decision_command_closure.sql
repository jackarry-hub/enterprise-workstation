begin;

-- A decision command is the durable root of the internal-trial execution loop.
-- Older rows are preserved and backfilled; no existing business data is removed.
alter table public.decision_commands
  add column if not exists tenant_id bigint,
  add column if not exists background text not null default '',
  add column if not exists expected_outcome text not null default '',
  add column if not exists priority text not null default 'medium',
  add column if not exists assigned_member_id bigint,
  add column if not exists assigned_department_id bigint,
  add column if not exists confirmed_plan_version_id bigint,
  add column if not exists cancellation_reason text,
  add column if not exists version bigint not null default 1;

update public.decision_commands command
set tenant_id = organization.tenant_id
from public.organizations organization
where command.organization_id = organization.id and command.tenant_id is null;

alter table public.decision_commands alter column tenant_id set not null;
alter table public.decision_commands drop constraint if exists decision_commands_status_check;
alter table public.decision_commands add constraint decision_commands_status_check check (status in (
  'draft','analyzing','pending_confirmation','confirmed','executing','completed',
  'pending_archive','archived','cancelled','failed'
));
alter table public.decision_commands drop constraint if exists decision_commands_priority_check;
alter table public.decision_commands add constraint decision_commands_priority_check
  check (priority in ('low','medium','high','urgent'));
alter table public.decision_commands drop constraint if exists decision_commands_version_check;
alter table public.decision_commands add constraint decision_commands_version_check check (version > 0);
alter table public.decision_commands add constraint decision_commands_exact_org_fkey
  foreign key (tenant_id,organization_id) references public.organizations(tenant_id,id) on delete cascade;
alter table public.decision_commands add constraint decision_commands_assigned_member_fkey
  foreign key (tenant_id,assigned_member_id) references public.organization_members(tenant_id,id) on delete restrict;
alter table public.decision_commands add constraint decision_commands_assigned_department_fkey
  foreign key (tenant_id,organization_id,assigned_department_id)
  references public.departments(tenant_id,organization_id,id) on delete restrict;
alter table public.decision_commands add constraint decision_commands_tenant_org_id_key
  unique (tenant_id,organization_id,id);

create table public.decision_command_attachments (
  tenant_id bigint not null references public.tenants(id) on delete cascade,
  organization_id bigint not null,
  command_id bigint not null,
  file_id bigint not null,
  created_by_member_id bigint not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (tenant_id,command_id,file_id),
  foreign key (tenant_id,organization_id,command_id)
    references public.decision_commands(tenant_id,organization_id,id) on delete cascade,
  foreign key (tenant_id,organization_id,file_id)
    references public.files(tenant_id,organization_id,id) on delete restrict,
  foreign key (tenant_id,created_by_member_id)
    references public.organization_members(tenant_id,id) on delete restrict
);

create table public.decision_plan_versions (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete cascade,
  organization_id bigint not null,
  command_id bigint not null,
  revision integer not null check (revision > 0),
  source text not null check (source in ('agent','model','manual')),
  status text not null default 'draft' check (status in ('draft','superseded','confirmed')),
  plan jsonb not null check (jsonb_typeof(plan)='object' and pg_column_size(plan)<=262144),
  provider text,
  agent_public_id uuid,
  agent_run_public_id uuid,
  model_code text,
  token_usage jsonb not null default '{}'::jsonb check (jsonb_typeof(token_usage)='object'),
  cost_amount numeric(14,6) check (cost_amount is null or cost_amount >= 0),
  error_code text,
  request_id uuid not null,
  created_by_member_id bigint not null,
  created_at timestamptz not null default clock_timestamp(),
  confirmed_at timestamptz,
  unique (tenant_id,command_id,revision),
  unique (tenant_id,command_id,request_id),
  unique (tenant_id,organization_id,id),
  foreign key (tenant_id,organization_id,command_id)
    references public.decision_commands(tenant_id,organization_id,id) on delete cascade,
  foreign key (tenant_id,created_by_member_id)
    references public.organization_members(tenant_id,id) on delete restrict
);

alter table public.decision_commands add constraint decision_commands_confirmed_plan_fkey
  foreign key (tenant_id,organization_id,confirmed_plan_version_id)
  references public.decision_plan_versions(tenant_id,organization_id,id) on delete restrict;

create table public.decision_command_operations (
  id bigint generated always as identity primary key,
  tenant_id bigint not null references public.tenants(id) on delete cascade,
  organization_id bigint not null,
  actor_member_id bigint not null,
  operation text not null check (operation in ('create','revise','confirm','cancel')),
  idempotency_key uuid not null,
  request_id uuid not null,
  command_id bigint,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  result jsonb,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  unique (tenant_id,actor_member_id,operation,idempotency_key),
  foreign key (tenant_id,organization_id,command_id)
    references public.decision_commands(tenant_id,organization_id,id) on delete restrict,
  foreign key (tenant_id,actor_member_id)
    references public.organization_members(tenant_id,id) on delete restrict
);

create table public.decision_archives (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete cascade,
  organization_id bigint not null,
  command_id bigint not null,
  project_id bigint not null,
  knowledge_document_id bigint,
  snapshot jsonb not null check (jsonb_typeof(snapshot)='object'),
  created_by_member_id bigint not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (tenant_id,command_id),
  unique (tenant_id,organization_id,id),
  foreign key (tenant_id,organization_id,command_id)
    references public.decision_commands(tenant_id,organization_id,id) on delete restrict,
  foreign key (tenant_id,organization_id,project_id)
    references public.projects(tenant_id,organization_id,id) on delete restrict,
  foreign key (tenant_id,organization_id,knowledge_document_id)
    references public.knowledge_documents(tenant_id,organization_id,id) on delete restrict,
  foreign key (tenant_id,created_by_member_id)
    references public.organization_members(tenant_id,id) on delete restrict
);

create index decision_commands_trial_queue_idx
  on public.decision_commands(tenant_id,organization_id,status,updated_at desc);
create index decision_plan_versions_command_idx
  on public.decision_plan_versions(tenant_id,command_id,revision desc);

alter table public.decision_command_attachments enable row level security;
alter table public.decision_command_attachments force row level security;
alter table public.decision_plan_versions enable row level security;
alter table public.decision_plan_versions force row level security;
alter table public.decision_command_operations enable row level security;
alter table public.decision_command_operations force row level security;
alter table public.decision_archives enable row level security;
alter table public.decision_archives force row level security;

drop policy if exists professional_member_read_commands on public.decision_commands;
drop policy if exists professional_owner_manage_commands on public.decision_commands;
create policy decision_commands_scoped_read on public.decision_commands for select to authenticated using (
  tenant_id=(select public.current_tenant_id()) and (
    owner_member_id=(select public.current_organization_member_id(organization_id))
    or assigned_member_id=(select public.current_organization_member_id(organization_id))
    or (select public.has_organization_permission(organization_id,'agent.orchestrate'))
  )
);
create policy decision_attachments_scoped_read on public.decision_command_attachments for select to authenticated using (
  exists(select 1 from public.decision_commands command
    where command.id=decision_command_attachments.command_id
      and command.tenant_id=decision_command_attachments.tenant_id)
);
create policy decision_plans_scoped_read on public.decision_plan_versions for select to authenticated using (
  exists(select 1 from public.decision_commands command
    where command.id=decision_plan_versions.command_id
      and command.tenant_id=decision_plan_versions.tenant_id)
);
create policy decision_archives_scoped_read on public.decision_archives for select to authenticated using (
  exists(select 1 from public.decision_commands command
    where command.id=decision_archives.command_id
      and command.tenant_id=decision_archives.tenant_id)
);

revoke all on public.decision_commands,public.decision_command_attachments,
  public.decision_plan_versions,public.decision_command_operations,public.decision_archives
  from public,anon,authenticated,service_role;
grant select on public.decision_commands,public.decision_command_attachments,
  public.decision_plan_versions,public.decision_archives to authenticated;

create or replace function public.current_decision_actor()
returns table(tenant_id bigint,organization_id bigint,member_id bigint,user_id uuid)
language sql stable security definer set search_path='' as $$
  select member.tenant_id,member.organization_id,member.id,member.user_id
  from public.organization_members member
  where member.organization_id=public.active_workspace_organization_id((select auth.uid()))
    and member.user_id=(select auth.uid()) and member.status='active'
    and (select public.has_organization_permission(member.organization_id,'agent.orchestrate'))
  limit 1;
$$;

create or replace function public.decision_plan_is_valid(p_plan jsonb)
returns boolean language sql immutable set search_path='' as $$
  select p_plan is not null and jsonb_typeof(p_plan)='object'
    and length(btrim(coalesce(p_plan->>'understanding',''))) between 1 and 4000
    and length(btrim(coalesce(p_plan->>'executionGoal',''))) between 1 and 2000
    and jsonb_typeof(p_plan->'project')='object'
    and length(btrim(coalesce(p_plan->'project'->>'name',''))) between 1 and 160
    and jsonb_typeof(p_plan->'milestones')='array'
    and jsonb_array_length(p_plan->'milestones') between 1 and 20
    and jsonb_typeof(p_plan->'tasks')='array'
    and jsonb_array_length(p_plan->'tasks') between 1 and 20
    and not exists(select 1 from jsonb_array_elements(p_plan->'tasks') task where
      jsonb_typeof(task)<>'object'
      or length(btrim(coalesce(task->>'key',''))) not between 1 and 80
      or length(btrim(coalesce(task->>'title',''))) not between 1 and 240
      or length(btrim(coalesce(task->>'acceptanceCriteria',''))) not between 1 and 2000
      or (task->>'dueDate') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or (task->>'priority') not in ('low','medium','high','urgent')
      or (task->>'assigneeMemberId') !~ '^[1-9][0-9]*$'
      or jsonb_typeof(coalesce(task->'dependencies','[]'::jsonb))<>'array'
    );
$$;

create or replace function public.decision_command_payload(p_command_id bigint)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('command',jsonb_build_object(
    'id',command.public_id,'title',command.title,'objective',command.summary,
    'background',command.background,'expectedOutcome',command.expected_outcome,
    'deadline',command.deadline,'priority',command.priority,'budget',command.budget_limit,
    'constraints',command.constraints,'status',command.status,'version',command.version,
    'projectId',project.public_id,'assignedMemberId',command.assigned_member_id,
    'assignedDepartmentId',command.assigned_department_id,'createdAt',command.created_at,
    'updatedAt',command.updated_at,
    'taskSummary',case when command.project_id is null then null else jsonb_build_object(
      'total',(select count(*) from public.tasks task where task.tenant_id=command.tenant_id and task.project_id=command.project_id and task.deleted_at is null and task.status<>'cancelled'),
      'done',(select count(*) from public.tasks task where task.tenant_id=command.tenant_id and task.project_id=command.project_id and task.deleted_at is null and task.status='done')
    ) end,
    'plan',(select jsonb_build_object('id',plan.public_id,'revision',plan.revision,
      'source',plan.source,'status',plan.status,'plan',plan.plan,'provider',plan.provider,
      'agentId',plan.agent_public_id,'agentRunId',plan.agent_run_public_id,
      'model',plan.model_code,'tokenUsage',plan.token_usage,'cost',plan.cost_amount,
      'error',plan.error_code,'createdAt',plan.created_at)
      from public.decision_plan_versions plan where plan.tenant_id=command.tenant_id
        and plan.command_id=command.id order by plan.revision desc limit 1)
  )) from public.decision_commands command
  left join public.projects project on project.tenant_id=command.tenant_id and project.id=command.project_id
  where command.id=p_command_id;
$$;

create or replace function public.list_current_decision_workbench(p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor record;
begin
  select * into v_actor from public.current_decision_actor();
  if not found then raise exception 'forbidden' using errcode='42501'; end if;
  return jsonb_build_object(
    'commands',coalesce((select jsonb_agg(public.decision_command_payload(command.id)->'command' order by command.updated_at desc)
      from (select * from public.decision_commands where tenant_id=v_actor.tenant_id
        and organization_id=v_actor.organization_id order by updated_at desc limit least(greatest(p_limit,1),100)) command),'[]'::jsonb),
    'members',coalesce((select jsonb_agg(jsonb_build_object('memberId',member.id,
      'employeeId',profile.public_id,'name',profile.display_name,'departmentId',profile.department_id,
      'department',department.name,'jobTitle',profile.job_title,'skills',profile.skills,
      'accountStatus',member.status) order by profile.display_name)
      from public.organization_members member join public.employee_profiles profile
        on profile.tenant_id=member.tenant_id and profile.organization_id=member.organization_id
        and profile.organization_member_id=member.id and profile.deleted_at is null
      left join public.departments department on department.tenant_id=profile.tenant_id and department.id=profile.department_id
      where member.tenant_id=v_actor.tenant_id and member.organization_id=v_actor.organization_id
        and member.status in ('active','invited') and profile.employment_status in ('probation','active','on_leave')),'[]'::jsonb),
    'departments',coalesce((select jsonb_agg(jsonb_build_object('id',department.id,'name',department.name) order by department.name)
      from public.departments department where department.tenant_id=v_actor.tenant_id
        and department.organization_id=v_actor.organization_id and department.deleted_at is null),'[]'::jsonb)
  );
end;
$$;

create or replace function public.complete_current_decision_command(
  p_command_public_id uuid,p_expected_command_version bigint,p_summary text,
  p_idempotency_key uuid,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor record; v_command public.decision_commands%rowtype; v_project public.projects%rowtype;
  v_document public.knowledge_documents%rowtype; v_version public.knowledge_document_versions%rowtype;
  v_total integer; v_done integer; v_archive public.decision_archives%rowtype; v_text text;
begin
  if p_command_public_id is null or p_expected_command_version<1 or length(btrim(coalesce(p_summary,''))) not between 1 and 2000 or p_idempotency_key is null or p_request_id is null then raise exception 'invalid_request' using errcode='22023'; end if;
  select * into v_actor from public.current_decision_actor(); if not found then raise exception 'forbidden' using errcode='42501'; end if;
  select * into v_command from public.decision_commands where tenant_id=v_actor.tenant_id and organization_id=v_actor.organization_id and public_id=p_command_public_id for update; if not found then raise exception 'not_found' using errcode='P0002'; end if;
  if v_command.status='archived' then return public.decision_command_payload(v_command.id)||jsonb_build_object('outcome','success','replayed',true); end if;
  if v_command.version<>p_expected_command_version or v_command.status<>'executing' or v_command.project_id is null then raise exception 'version_conflict' using errcode='40001'; end if;
  select count(*)::integer,count(*) filter(where task.status='done')::integer into v_total,v_done from public.tasks task where task.tenant_id=v_actor.tenant_id and task.project_id=v_command.project_id and task.deleted_at is null and task.status<>'cancelled';
  if v_total<1 or v_total<>v_done then raise exception 'tasks_incomplete' using errcode='55000'; end if;
  select * into v_project from public.projects where tenant_id=v_actor.tenant_id and id=v_command.project_id for update;
  v_text:=concat_ws(E'\n\n','决策指令：'||v_command.title,'目标：'||v_command.summary,'预期结果：'||v_command.expected_outcome,'复盘摘要：'||btrim(p_summary),'完成任务：'||v_done::text||'/'||v_total::text);
  insert into public.knowledge_documents(tenant_id,organization_id,command_id,created_by_member_id,owner_member_id,title,summary,category,tags,status,version)
  values(v_actor.tenant_id,v_actor.organization_id,v_command.id,v_actor.member_id,v_actor.member_id,'项目复盘：'||left(v_command.title,180),left(btrim(p_summary),2000),'项目复盘',array['决策闭环','项目复盘'],'draft',1) returning * into v_document;
  insert into public.knowledge_document_versions(tenant_id,organization_id,document_id,version_number,status,title,summary,extracted_text,created_by_member_id)
  values(v_actor.tenant_id,v_actor.organization_id,v_document.id,1,'draft',v_document.title,v_document.summary,left(v_text,5000000),v_actor.member_id) returning * into v_version;
  update public.knowledge_documents set current_version_id=v_version.id,updated_at=clock_timestamp() where id=v_document.id;
  update public.projects set status='completed',progress=100,actual_end_date=current_date,updated_by_member_id=v_actor.member_id,version=version+1,updated_at=clock_timestamp() where id=v_project.id;
  insert into public.decision_archives(tenant_id,organization_id,command_id,project_id,knowledge_document_id,snapshot,created_by_member_id)
  values(v_actor.tenant_id,v_actor.organization_id,v_command.id,v_project.id,v_document.id,jsonb_build_object('summary',btrim(p_summary),'metrics',jsonb_build_object('taskTotal',v_total,'taskDone',v_done)),v_actor.member_id) returning * into v_archive;
  update public.decision_commands set status='archived',archived_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() where id=v_command.id returning * into v_command;
  perform public.append_audit_log(v_actor.tenant_id,v_actor.organization_id,v_actor.user_id,v_actor.member_id,'knowledge.draft_created','knowledge_document',v_document.public_id::text,p_request_id,null,jsonb_build_object('source','decision_archive','commandId',v_command.public_id));
  perform public.append_audit_log(v_actor.tenant_id,v_actor.organization_id,v_actor.user_id,v_actor.member_id,'decision.command.archived','decision_command',v_command.public_id::text,p_request_id,null,jsonb_build_object('projectId',v_project.public_id,'knowledgeDocumentId',v_document.public_id,'taskTotal',v_total));
  return public.decision_command_payload(v_command.id)||jsonb_build_object('outcome','success','knowledgeDocumentId',v_document.public_id,'archiveId',v_archive.public_id);
end;
$$;

create or replace function public.create_current_decision_command(
  p_title text,p_objective text,p_background text,p_expected_outcome text,p_deadline date,
  p_priority text,p_budget numeric,p_constraints text,p_assigned_member_id bigint,
  p_assigned_department_id bigint,p_attachment_public_ids jsonb,
  p_idempotency_key uuid,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor record; v_command public.decision_commands%rowtype; v_operation public.decision_command_operations%rowtype;
  v_hash text; v_file_id bigint;
begin
  if length(btrim(coalesce(p_title,''))) not between 1 and 160
    or length(btrim(coalesce(p_objective,''))) not between 1 and 4000
    or length(coalesce(p_background,''))>12000 or length(btrim(coalesce(p_expected_outcome,''))) not between 1 and 4000
    or p_deadline<current_date or p_priority not in ('low','medium','high','urgent')
    or p_budget is null or p_budget<0 or p_budget>9999999999999999.99
    or length(coalesce(p_constraints,''))>4000 or p_attachment_public_ids is null
    or jsonb_typeof(p_attachment_public_ids)<>'array' or jsonb_array_length(p_attachment_public_ids)>20
    or p_idempotency_key is null or p_request_id is null then raise exception 'invalid_request' using errcode='22023'; end if;
  select * into v_actor from public.current_decision_actor(); if not found then raise exception 'forbidden' using errcode='42501'; end if;
  if p_assigned_member_id is not null and not exists(select 1 from public.organization_members member
    join public.employee_profiles profile on profile.tenant_id=member.tenant_id and profile.organization_member_id=member.id and profile.deleted_at is null
    where member.tenant_id=v_actor.tenant_id and member.organization_id=v_actor.organization_id and member.id=p_assigned_member_id
      and member.status in ('active','invited') and profile.employment_status in ('probation','active','on_leave')) then raise exception 'invalid_assignee' using errcode='22023'; end if;
  if p_assigned_department_id is not null and not exists(select 1 from public.departments department where department.tenant_id=v_actor.tenant_id and department.organization_id=v_actor.organization_id and department.id=p_assigned_department_id and department.deleted_at is null) then raise exception 'invalid_department' using errcode='22023'; end if;
  v_hash:=encode(extensions.digest(convert_to(concat_ws('|',p_title,p_objective,p_background,p_expected_outcome,p_deadline,p_priority,p_budget,p_constraints,p_assigned_member_id,p_assigned_department_id,p_attachment_public_ids::text),'utf8'),'sha256'),'hex');
  insert into public.decision_command_operations(tenant_id,organization_id,actor_member_id,operation,idempotency_key,request_id,payload_hash)
  values(v_actor.tenant_id,v_actor.organization_id,v_actor.member_id,'create',p_idempotency_key,p_request_id,v_hash)
  on conflict do nothing returning * into v_operation;
  if not found then select * into v_operation from public.decision_command_operations where tenant_id=v_actor.tenant_id and actor_member_id=v_actor.member_id and operation='create' and idempotency_key=p_idempotency_key; if v_operation.payload_hash<>v_hash then raise exception 'idempotency_conflict' using errcode='23505'; end if; return v_operation.result; end if;
  insert into public.decision_commands(tenant_id,organization_id,owner_member_id,title,summary,background,expected_outcome,status,deadline,budget_limit,constraints,priority,assigned_member_id,assigned_department_id)
  values(v_actor.tenant_id,v_actor.organization_id,v_actor.member_id,btrim(p_title),btrim(p_objective),coalesce(p_background,''),btrim(p_expected_outcome),'draft',p_deadline,p_budget,coalesce(p_constraints,''),p_priority,p_assigned_member_id,p_assigned_department_id)
  returning * into v_command;
  for v_file_id in select file.id from public.files file join jsonb_array_elements_text(p_attachment_public_ids) item(public_id) on file.public_id=item.public_id::uuid where file.tenant_id=v_actor.tenant_id and file.organization_id=v_actor.organization_id and file.deleted_at is null and file.verified_at is not null loop insert into public.decision_command_attachments(tenant_id,organization_id,command_id,file_id,created_by_member_id) values(v_actor.tenant_id,v_actor.organization_id,v_command.id,v_file_id,v_actor.member_id); end loop;
  if (select count(*) from public.decision_command_attachments where tenant_id=v_actor.tenant_id and command_id=v_command.id)<>jsonb_array_length(p_attachment_public_ids) then raise exception 'invalid_attachment' using errcode='22023'; end if;
  perform public.append_audit_log(v_actor.tenant_id,v_actor.organization_id,v_actor.user_id,v_actor.member_id,'decision.command.created','decision_command',v_command.public_id::text,p_request_id,null,jsonb_build_object('priority',p_priority,'deadline',p_deadline,'attachmentCount',jsonb_array_length(p_attachment_public_ids)));
  update public.decision_command_operations set command_id=v_command.id,result=public.decision_command_payload(v_command.id),completed_at=clock_timestamp() where id=v_operation.id returning * into v_operation;
  return v_operation.result;
end;
$$;

create or replace function public.get_current_decision_evidence(p_command_public_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor record; v_command public.decision_commands%rowtype;
begin
  select * into v_actor from public.current_decision_actor(); if not found then raise exception 'forbidden' using errcode='42501'; end if;
  select * into v_command from public.decision_commands where tenant_id=v_actor.tenant_id and organization_id=v_actor.organization_id and public_id=p_command_public_id and status not in ('cancelled','archived') limit 1;
  if not found then raise exception 'not_found' using errcode='P0002'; end if;
  return jsonb_build_object('command',public.decision_command_payload(v_command.id)->'command',
    'members',(public.list_current_decision_workbench(100)->'members'),
    'departments',(public.list_current_decision_workbench(100)->'departments'));
end;
$$;

create or replace function public.save_decision_plan_from_service(
  p_tenant_public_id uuid,p_organization_public_id uuid,p_actor_member_id bigint,p_auth_user_id uuid,
  p_command_public_id uuid,p_plan jsonb,p_source text,p_provider text,p_agent_public_id uuid,
  p_agent_run_public_id uuid,p_model_code text,p_token_usage jsonb,p_cost_amount numeric,
  p_error_code text,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor record; v_command public.decision_commands%rowtype; v_plan public.decision_plan_versions%rowtype; v_revision integer;
begin
  if p_source not in ('agent','model','manual') or not public.decision_plan_is_valid(p_plan) or p_request_id is null or p_token_usage is null or jsonb_typeof(p_token_usage)<>'object' then raise exception 'invalid_plan' using errcode='22023'; end if;
  select * into v_actor from public.resolve_ai_runtime_actor(p_tenant_public_id,p_organization_public_id,p_actor_member_id,p_auth_user_id); if not found then raise exception 'forbidden' using errcode='42501'; end if;
  if not exists(
    select 1 from public.member_roles assignment
    join public.roles role on role.tenant_id=assignment.tenant_id and role.id=assignment.role_id and role.is_enabled
    join public.role_permissions role_permission on role_permission.tenant_id=role.tenant_id and role_permission.role_id=role.id
    join public.permissions permission on permission.id=role_permission.permission_id
    where assignment.tenant_id=v_actor.tenant_id and assignment.member_id=v_actor.actor_member_id
      and (role.organization_id is null or role.organization_id=v_actor.organization_id)
      and permission.code='agent.orchestrate'
  ) then raise exception 'forbidden' using errcode='42501'; end if;
  select * into v_command from public.decision_commands where tenant_id=v_actor.tenant_id and organization_id=v_actor.organization_id and public_id=p_command_public_id for update; if not found then raise exception 'not_found' using errcode='P0002'; end if;
  select * into v_plan from public.decision_plan_versions where tenant_id=v_actor.tenant_id and command_id=v_command.id and request_id=p_request_id; if found then return public.decision_command_payload(v_command.id); end if;
  if v_command.status not in ('draft','analyzing','pending_confirmation','failed') then raise exception 'invalid_state' using errcode='55000'; end if;
  update public.decision_plan_versions set status='superseded' where tenant_id=v_actor.tenant_id and command_id=v_command.id and status='draft';
  select coalesce(max(revision),0)+1 into v_revision from public.decision_plan_versions where tenant_id=v_actor.tenant_id and command_id=v_command.id;
  insert into public.decision_plan_versions(tenant_id,organization_id,command_id,revision,source,status,plan,provider,agent_public_id,agent_run_public_id,model_code,token_usage,cost_amount,error_code,request_id,created_by_member_id)
  values(v_actor.tenant_id,v_actor.organization_id,v_command.id,v_revision,p_source,'draft',p_plan,nullif(btrim(coalesce(p_provider,'')),''),p_agent_public_id,p_agent_run_public_id,nullif(btrim(coalesce(p_model_code,'')),''),p_token_usage,p_cost_amount,nullif(btrim(coalesce(p_error_code,'')),''),p_request_id,v_actor.actor_member_id) returning * into v_plan;
  update public.decision_commands set status='pending_confirmation',version=version+1,updated_at=clock_timestamp() where id=v_command.id returning * into v_command;
  perform public.append_audit_log(v_actor.tenant_id,v_actor.organization_id,p_auth_user_id,v_actor.actor_member_id,'decision.plan.created','decision_plan',v_plan.public_id::text,p_request_id,null,jsonb_build_object('commandId',v_command.public_id,'revision',v_revision,'source',p_source,'agentId',p_agent_public_id,'agentRunId',p_agent_run_public_id));
  return public.decision_command_payload(v_command.id);
end;
$$;

create or replace function public.revise_current_decision_plan(
  p_command_public_id uuid,p_plan jsonb,p_expected_command_version bigint,p_idempotency_key uuid,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor record; v_command public.decision_commands%rowtype; v_plan public.decision_plan_versions%rowtype; v_revision integer;
begin
  if not public.decision_plan_is_valid(p_plan) or p_expected_command_version<1 or p_idempotency_key is null or p_request_id is null then raise exception 'invalid_plan' using errcode='22023'; end if;
  select * into v_actor from public.current_decision_actor(); if not found then raise exception 'forbidden' using errcode='42501'; end if;
  select * into v_command from public.decision_commands where tenant_id=v_actor.tenant_id and organization_id=v_actor.organization_id and public_id=p_command_public_id for update; if not found then raise exception 'not_found' using errcode='P0002'; end if;
  if v_command.version<>p_expected_command_version or v_command.status<>'pending_confirmation' then raise exception 'version_conflict' using errcode='40001'; end if;
  select * into v_plan from public.decision_plan_versions where tenant_id=v_actor.tenant_id and command_id=v_command.id and request_id=p_idempotency_key; if found then return public.decision_command_payload(v_command.id); end if;
  update public.decision_plan_versions set status='superseded' where tenant_id=v_actor.tenant_id and command_id=v_command.id and status='draft';
  select coalesce(max(revision),0)+1 into v_revision from public.decision_plan_versions where tenant_id=v_actor.tenant_id and command_id=v_command.id;
  insert into public.decision_plan_versions(tenant_id,organization_id,command_id,revision,source,status,plan,token_usage,request_id,created_by_member_id)
  values(v_actor.tenant_id,v_actor.organization_id,v_command.id,v_revision,'manual','draft',p_plan,'{}'::jsonb,p_idempotency_key,v_actor.member_id) returning * into v_plan;
  update public.decision_commands set version=version+1,updated_at=clock_timestamp() where id=v_command.id returning * into v_command;
  perform public.append_audit_log(v_actor.tenant_id,v_actor.organization_id,v_actor.user_id,v_actor.member_id,'decision.plan.revised','decision_plan',v_plan.public_id::text,p_request_id,null,jsonb_build_object('commandId',v_command.public_id,'revision',v_revision));
  return public.decision_command_payload(v_command.id);
end;
$$;

create or replace function public.confirm_current_decision_plan(
  p_command_public_id uuid,p_expected_command_version bigint,p_idempotency_key uuid,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor record; v_command public.decision_commands%rowtype; v_plan public.decision_plan_versions%rowtype;
  v_project public.projects%rowtype; v_owner bigint; v_item jsonb; v_member bigint; v_milestone public.milestones%rowtype;
  v_task public.tasks%rowtype; v_milestone_ids jsonb:='{}'::jsonb; v_task_ids jsonb:='{}'::jsonb;
  v_task_public_ids jsonb:='[]'::jsonb; v_project_public_id uuid:=gen_random_uuid(); v_failure text;
begin
  if p_command_public_id is null or p_expected_command_version<1 or p_idempotency_key is null or p_request_id is null then raise exception 'invalid_request' using errcode='22023'; end if;
  select * into v_actor from public.current_decision_actor(); if not found then raise exception 'forbidden' using errcode='42501'; end if;
  select * into v_command from public.decision_commands where tenant_id=v_actor.tenant_id and organization_id=v_actor.organization_id and public_id=p_command_public_id for update; if not found then raise exception 'not_found' using errcode='P0002'; end if;
  if v_command.project_id is not null and v_command.confirmed_plan_version_id is not null then return public.decision_command_payload(v_command.id); end if;
  if v_command.version<>p_expected_command_version or v_command.status<>'pending_confirmation' then raise exception 'version_conflict' using errcode='40001'; end if;
  select * into v_plan from public.decision_plan_versions where tenant_id=v_actor.tenant_id and command_id=v_command.id and status='draft' order by revision desc limit 1 for update; if not found or not public.decision_plan_is_valid(v_plan.plan) then raise exception 'invalid_plan' using errcode='22023'; end if;
  v_owner:=coalesce(v_command.assigned_member_id,v_actor.member_id);
  if not exists(select 1 from public.organization_members member join public.employee_profiles profile on profile.tenant_id=member.tenant_id and profile.organization_member_id=member.id and profile.deleted_at is null where member.tenant_id=v_actor.tenant_id and member.organization_id=v_actor.organization_id and member.id=v_owner and member.status in ('active','invited') and profile.employment_status in ('probation','active','on_leave')) then raise exception 'invalid_owner' using errcode='22023'; end if;
  begin
    insert into public.projects(public_id,tenant_id,organization_id,code,name,category,description,owner_member_id,created_by_member_id,updated_by_member_id,budget_amount,status,health,priority,start_date,due_date,progress,version)
    values(v_project_public_id,v_actor.tenant_id,v_actor.organization_id,'QXY-'||upper(substr(replace(v_project_public_id::text,'-',''),1,10)),btrim(v_plan.plan->'project'->>'name'),'决策项目',coalesce(v_plan.plan->'project'->>'description',v_command.summary),v_owner,v_actor.member_id,v_actor.member_id,v_command.budget_limit,'active','on_track',case when v_command.priority='urgent' then 'critical' else v_command.priority end,current_date,v_command.deadline,0,1) returning * into v_project;
    perform set_config('quantxy.explicit_project_member_mutation','on',true);
    insert into public.project_members(tenant_id,organization_id,project_id,member_id,role,allocation_percent,created_by_member_id,updated_by_member_id,version)
    values(v_actor.tenant_id,v_actor.organization_id,v_project.id,v_owner,'owner',100,v_actor.member_id,v_actor.member_id,1);
    if v_owner<>v_actor.member_id then insert into public.project_members(tenant_id,organization_id,project_id,member_id,role,allocation_percent,created_by_member_id,updated_by_member_id,version) values(v_actor.tenant_id,v_actor.organization_id,v_project.id,v_actor.member_id,'manager',100,v_actor.member_id,v_actor.member_id,1) on conflict do nothing; end if;
    for v_member in select distinct (task->>'assigneeMemberId')::bigint from jsonb_array_elements(v_plan.plan->'tasks') task loop insert into public.project_members(tenant_id,organization_id,project_id,member_id,role,allocation_percent,created_by_member_id,updated_by_member_id,version) values(v_actor.tenant_id,v_actor.organization_id,v_project.id,v_member,case when v_member=v_owner then 'owner' else 'member' end,100,v_actor.member_id,v_actor.member_id,1) on conflict do nothing; end loop;
    perform set_config('quantxy.explicit_project_member_mutation','',true);
    for v_item in select value from jsonb_array_elements(v_plan.plan->'milestones') loop
      if length(btrim(coalesce(v_item->>'key',''))) not between 1 and 80 or length(btrim(coalesce(v_item->>'name',''))) not between 1 and 160 or (v_item->>'dueDate')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'invalid_milestone'; end if;
      insert into public.milestones(tenant_id,organization_id,project_id,owner_member_id,name,description,status,start_date,due_date,progress,sort_order,created_by_member_id,updated_by_member_id,version)
      values(v_actor.tenant_id,v_actor.organization_id,v_project.id,v_owner,btrim(v_item->>'name'),coalesce(v_item->>'description',''),'pending',current_date,(v_item->>'dueDate')::date,0,(select count(*) from jsonb_object_keys(v_milestone_ids)),v_actor.member_id,v_actor.member_id,1) returning * into v_milestone;
      v_milestone_ids:=v_milestone_ids||jsonb_build_object(v_item->>'key',v_milestone.id);
    end loop;
    for v_item in select value from jsonb_array_elements(v_plan.plan->'tasks') loop
      v_member:=(v_item->>'assigneeMemberId')::bigint;
      insert into public.tasks(tenant_id,organization_id,project_id,milestone_id,title,description,assignee_member_id,reporter_member_id,status,priority,start_date,due_date,progress,estimated_hours,sort_order,acceptance_criteria,created_by_member_id,updated_by_member_id,version)
      values(v_actor.tenant_id,v_actor.organization_id,v_project.id,nullif(v_milestone_ids->>(v_item->>'milestoneKey'),'')::bigint,btrim(v_item->>'title'),coalesce(v_item->>'description',''),v_member,v_actor.member_id,'todo',v_item->>'priority',current_date,(v_item->>'dueDate')::date,0,nullif(v_item->>'estimatedHours','')::numeric,(select count(*) from jsonb_object_keys(v_task_ids)),btrim(v_item->>'acceptanceCriteria'),v_actor.member_id,v_actor.member_id,1) returning * into v_task;
      v_task_ids:=v_task_ids||jsonb_build_object(v_item->>'key',v_task.id); v_task_public_ids:=v_task_public_ids||jsonb_build_array(v_task.public_id);
      insert into public.project_activities(tenant_id,organization_id,project_id,user_id,actor_member_id,action_type,content,version) values(v_actor.tenant_id,v_actor.organization_id,v_project.id,v_actor.user_id,v_actor.member_id,'task_updated','决策指令创建任务：'||v_task.title,1);
      perform public.append_audit_log(v_actor.tenant_id,v_actor.organization_id,v_actor.user_id,v_actor.member_id,'task.created','task',v_task.public_id::text,p_request_id,null,jsonb_build_object('commandId',v_command.public_id,'planId',v_plan.public_id,'assigneeMemberId',v_member));
    end loop;
    for v_item in select value from jsonb_array_elements(v_plan.plan->'tasks') loop
      insert into public.task_dependencies(tenant_id,organization_id,project_id,task_id,depends_on_task_id,created_by_member_id,version)
      select v_actor.tenant_id,v_actor.organization_id,v_project.id,(v_task_ids->>(v_item->>'key'))::bigint,(v_task_ids->>dependency.value)::bigint,v_actor.member_id,1 from jsonb_array_elements_text(coalesce(v_item->'dependencies','[]'::jsonb)) dependency(value) where v_task_ids ? dependency.value;
    end loop;
    update public.decision_plan_versions set status='confirmed',confirmed_at=clock_timestamp() where id=v_plan.id;
    update public.decision_commands set project_id=v_project.id,confirmed_plan_version_id=v_plan.id,status='executing',version=version+1,updated_at=clock_timestamp() where id=v_command.id returning * into v_command;
    perform public.append_audit_log(v_actor.tenant_id,v_actor.organization_id,v_actor.user_id,v_actor.member_id,'decision.plan.confirmed','decision_command',v_command.public_id::text,p_request_id,null,jsonb_build_object('projectId',v_project.public_id,'planId',v_plan.public_id,'taskIds',v_task_public_ids));
  exception when others then v_failure:='command_failed';
  end;
  if v_failure is not null then perform public.append_audit_log(v_actor.tenant_id,v_actor.organization_id,v_actor.user_id,v_actor.member_id,'decision.command.failed','decision_command',v_command.public_id::text,p_request_id,null,jsonb_build_object('operation','confirm')); return jsonb_build_object('outcome','failure','error',v_failure,'requestId',p_request_id); end if;
  return public.decision_command_payload(v_command.id)||jsonb_build_object('outcome','success','projectId',v_project.public_id,'taskIds',v_task_public_ids);
end;
$$;

revoke all on function public.current_decision_actor() from public,anon,authenticated,service_role;
revoke all on function public.decision_plan_is_valid(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.decision_command_payload(bigint) from public,anon,authenticated,service_role;
revoke all on function public.list_current_decision_workbench(integer) from public,anon;
revoke all on function public.create_current_decision_command(text,text,text,text,date,text,numeric,text,bigint,bigint,jsonb,uuid,uuid) from public,anon;
revoke all on function public.get_current_decision_evidence(uuid) from public,anon;
revoke all on function public.save_decision_plan_from_service(uuid,uuid,bigint,uuid,uuid,jsonb,text,text,uuid,uuid,text,jsonb,numeric,text,uuid) from public,anon,authenticated;
revoke all on function public.revise_current_decision_plan(uuid,jsonb,bigint,uuid,uuid) from public,anon;
revoke all on function public.confirm_current_decision_plan(uuid,bigint,uuid,uuid) from public,anon;
revoke all on function public.complete_current_decision_command(uuid,bigint,text,uuid,uuid) from public,anon;
grant execute on function public.list_current_decision_workbench(integer),
  public.create_current_decision_command(text,text,text,text,date,text,numeric,text,bigint,bigint,jsonb,uuid,uuid),
  public.get_current_decision_evidence(uuid),public.revise_current_decision_plan(uuid,jsonb,bigint,uuid,uuid),
  public.confirm_current_decision_plan(uuid,bigint,uuid,uuid) to authenticated;
grant execute on function public.complete_current_decision_command(uuid,bigint,text,uuid,uuid) to authenticated;
grant execute on function public.save_decision_plan_from_service(uuid,uuid,bigint,uuid,uuid,jsonb,text,text,uuid,uuid,text,jsonb,numeric,text,uuid) to service_role;

commit;
