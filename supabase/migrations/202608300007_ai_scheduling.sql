begin;

alter table public.audit_logs drop constraint if exists audit_logs_action_check;
alter table public.audit_logs add constraint audit_logs_action_check check (action in (
  'identity.provisioned','identity.claimed','identity.revoked','member.status_changed','member.role_changed','profile.updated','roster.imported','tenant.bootstrap_owner',
  'enterprise.initialized','directory.sync_started','directory.sync_completed','directory.sync_failed','directory.role_mapped','project.created','project.updated',
  'project.archived','project.restored','project.member_added','project.member_role_changed','project.member_removed','project.command_failed','project.milestone_created',
  'project.risk_created','project.activity_recorded','project.report_submitted','project.execution_failed','task.created','task.batch_created','task.claimed',
  'task.progress_updated','task.submitted','task.reviewed','task.reopened','task.acceptance_recorded','task.command_failed','task.comment_created','task.dependency_created',
  'notification.read','notification.retried','file.upload_reserved','file.upload_completed','file.upload_failed','file.upload_expired','file.download_authorized',
  'customer.created','customer.updated','customer.contact_created','customer.command_failed','customer.owner_transferred','customer.archived','customer.restored',
  'customer.contract_created','customer.source_linked','customer.import_started','customer.imported','customer.import_completed','customer.export_requested','customer.export_downloaded',
  'opportunity.created','opportunity.stage_changed','opportunity.converted','customer.follow_up_created','approval.submitted','approval.step_approved','approval.approved',
  'approval.rejected','approval.returned','approval.cancelled','approval.command_failed','expense.draft_created','expense.draft_updated','expense.submitted','expense.cancelled',
  'expense.paid','expense.command_failed','knowledge.directory_created','knowledge.draft_created','knowledge.version_created','knowledge.published','knowledge.archived',
  'knowledge.permission_changed','knowledge.command_failed','knowledge.searched','knowledge.source_downloaded','knowledge.reindexed',
  'payroll_policy.activated','payroll.calculated','payroll.confirmed','ai.config.updated','organization.department_created','organization.department_updated',
  'organization.position_upserted','organization.role_assigned','organization.command_failed','organization.manager_assigned','directory.manager_mapped',
  'employee_skill.verified','employee_skill.verification_failed','directory.sync_issue_resolved',
  'ai.conversation.created','ai.message.created','ai.message.completed','ai.message.failed','ai.conversation.archived',
  'scheduling.goal.created','scheduling.plan.created','scheduling.plan.overridden','scheduling.plan.dispatched'
));

create table public.scheduling_goals (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete cascade,
  organization_id bigint not null,
  project_id bigint not null,
  created_by_member_id bigint not null,
  objective text not null check (length(btrim(objective)) between 1 and 1000),
  constraints jsonb not null default '{}'::jsonb check (jsonb_typeof(constraints)='object'),
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (tenant_id,organization_id,project_id) references public.projects(tenant_id,organization_id,id) on delete restrict,
  foreign key (tenant_id,created_by_member_id) references public.organization_members(tenant_id,id) on delete restrict,
  unique (tenant_id,organization_id,id)
);

create table public.scheduling_plan_versions (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete cascade,
  organization_id bigint not null,
  goal_id bigint not null,
  revision integer not null check (revision > 0),
  source text not null check (source in ('model','rules')),
  status text not null default 'draft' check (status in ('draft','locked','dispatched','superseded')),
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary)='object'),
  cost_amount numeric(14,6),
  cost_currency text check (cost_currency is null or cost_currency ~ '^[A-Z]{3}$'),
  cost_basis jsonb check (cost_basis is null or jsonb_typeof(cost_basis)='object'),
  risk_summary text,
  model_code text,
  request_id uuid not null,
  created_by_member_id bigint not null,
  created_at timestamptz not null default clock_timestamp(),
  locked_at timestamptz,
  dispatched_at timestamptz,
  foreign key (tenant_id,organization_id,goal_id) references public.scheduling_goals(tenant_id,organization_id,id) on delete cascade,
  foreign key (tenant_id,created_by_member_id) references public.organization_members(tenant_id,id) on delete restrict,
  unique (tenant_id,goal_id,revision),
  unique (tenant_id,goal_id,request_id),
  unique (tenant_id,organization_id,id),
  check ((cost_amount is null and cost_currency is null and cost_basis is null) or (cost_amount is not null and cost_amount>=0 and cost_currency is not null and cost_basis is not null))
);

create table public.scheduling_assignments (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete cascade,
  organization_id bigint not null,
  plan_version_id bigint not null,
  project_id bigint not null,
  assignee_member_id bigint not null,
  ordinal integer not null check (ordinal between 0 and 19),
  title text not null check (length(btrim(title)) between 1 and 240),
  description text not null default '' check (length(description)<=4000),
  acceptance_criteria text not null check (length(btrim(acceptance_criteria)) between 1 and 2000),
  due_date date not null,
  priority text not null check (priority in ('low','medium','high','urgent')),
  estimated_hours numeric(8,2) check (estimated_hours is null or estimated_hours>=0),
  required_skills text[] not null default '{}'::text[] check (cardinality(required_skills)<=20),
  evidence jsonb not null check (jsonb_typeof(evidence)='object'),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (tenant_id,organization_id,plan_version_id) references public.scheduling_plan_versions(tenant_id,organization_id,id) on delete cascade,
  foreign key (tenant_id,organization_id,project_id) references public.projects(tenant_id,organization_id,id) on delete restrict,
  foreign key (tenant_id,assignee_member_id) references public.organization_members(tenant_id,id) on delete restrict,
  unique (tenant_id,plan_version_id,ordinal),
  unique (tenant_id,organization_id,id)
);

create index scheduling_goals_project_idx on public.scheduling_goals(tenant_id,organization_id,project_id,created_at desc);
create index scheduling_plans_goal_idx on public.scheduling_plan_versions(tenant_id,goal_id,revision desc);

alter table public.scheduling_goals enable row level security;
alter table public.scheduling_goals force row level security;
alter table public.scheduling_plan_versions enable row level security;
alter table public.scheduling_plan_versions force row level security;
alter table public.scheduling_assignments enable row level security;
alter table public.scheduling_assignments force row level security;
create policy scheduling_goals_manager_read on public.scheduling_goals for select to authenticated using (tenant_id=(select public.current_tenant_id()) and (select public.has_organization_permission(organization_id,'agent.orchestrate')));
create policy scheduling_plans_manager_read on public.scheduling_plan_versions for select to authenticated using (tenant_id=(select public.current_tenant_id()) and (select public.has_organization_permission(organization_id,'agent.orchestrate')));
create policy scheduling_assignments_manager_read on public.scheduling_assignments for select to authenticated using (tenant_id=(select public.current_tenant_id()) and (select public.has_organization_permission(organization_id,'agent.orchestrate')));
grant select on public.scheduling_goals,public.scheduling_plan_versions,public.scheduling_assignments to authenticated;

create or replace function public.reject_scheduling_plan_mutation()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_table_name='scheduling_plan_versions' and tg_op='UPDATE' and current_setting('app.scheduling_transition_plan_id',true)=old.public_id::text then return new; end if;
  raise exception 'scheduling_plan_immutable' using errcode='42501';
end;
$$;
create trigger scheduling_plans_immutable before update or delete on public.scheduling_plan_versions for each row execute function public.reject_scheduling_plan_mutation();
create trigger scheduling_assignments_immutable before update or delete on public.scheduling_assignments for each row execute function public.reject_scheduling_plan_mutation();

create or replace function public.current_scheduling_actor()
returns table(tenant_id bigint,organization_id bigint,member_id bigint,user_id uuid)
language sql stable security definer set search_path='' as $$
  select member.tenant_id,member.organization_id,member.id,member.user_id from public.organization_members member
  where member.organization_id=public.active_workspace_organization_id((select auth.uid())) and member.user_id=(select auth.uid()) and member.status='active'
    and public.has_organization_permission(member.organization_id,'agent.orchestrate') limit 1;
$$;

create or replace function public.scheduling_plan_payload(p_plan_id bigint)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('plan',jsonb_build_object(
    'id',plan.public_id,'goalId',goal.public_id,'revision',plan.revision,'source',plan.source,'status',plan.status,
    'summary',plan.summary,'cost',plan.cost_amount,'riskSummary',plan.risk_summary,
    'assignments',coalesce((select jsonb_agg(jsonb_build_object('id',assignment.public_id,'memberId',assignment.assignee_member_id,'ordinal',assignment.ordinal,'title',assignment.title,'description',assignment.description,'acceptanceCriteria',assignment.acceptance_criteria,'dueDate',assignment.due_date,'priority',assignment.priority,'estimatedHours',assignment.estimated_hours,'requiredSkills',assignment.required_skills,'evidence',assignment.evidence) order by assignment.ordinal) from public.scheduling_assignments assignment where assignment.plan_version_id=plan.id),'[]'::jsonb)
  )) from public.scheduling_plan_versions plan join public.scheduling_goals goal on goal.tenant_id=plan.tenant_id and goal.id=plan.goal_id where plan.id=p_plan_id;
$$;

create or replace function public.create_scheduling_goal(p_project_public_id uuid,p_objective text,p_constraints jsonb,p_idempotency_key uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor record; v_project public.projects%rowtype; v_goal public.scheduling_goals%rowtype;
begin
  if p_project_public_id is null or length(btrim(coalesce(p_objective,''))) not between 1 and 1000 or p_constraints is null or jsonb_typeof(p_constraints)<>'object' or pg_column_size(p_constraints)>32768 or p_idempotency_key is null or p_request_id is null then raise exception 'invalid_request' using errcode='22023'; end if;
  select * into v_actor from public.current_scheduling_actor(); if not found then raise exception 'forbidden' using errcode='42501'; end if;
  select * into v_project from public.projects where tenant_id=v_actor.tenant_id and organization_id=v_actor.organization_id and public_id=p_project_public_id and deleted_at is null and status in ('planning','active','on_hold'); if not found then raise exception 'not_found' using errcode='P0002'; end if;
  if (select access_state from public.lock_current_project_execution_access(v_actor.tenant_id,v_actor.organization_id,v_actor.member_id,p_project_public_id,'manage'))<>'allowed' then raise exception 'forbidden' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_actor.tenant_id::text||':'||v_actor.member_id::text||':goal:'||p_idempotency_key::text,0));
  select goal.* into v_goal from public.scheduling_goals goal join public.audit_logs audit on audit.tenant_id=goal.tenant_id and audit.resource_type='scheduling_goal' and audit.resource_id=goal.public_id::text and audit.request_id=p_idempotency_key where goal.tenant_id=v_actor.tenant_id and goal.created_by_member_id=v_actor.member_id limit 1;
  if not found then
    insert into public.scheduling_goals(tenant_id,organization_id,project_id,created_by_member_id,objective,constraints) values(v_actor.tenant_id,v_actor.organization_id,v_project.id,v_actor.member_id,btrim(p_objective),p_constraints) returning * into v_goal;
    perform public.append_audit_log(v_actor.tenant_id,v_actor.organization_id,v_actor.user_id,v_actor.member_id,'scheduling.goal.created','scheduling_goal',v_goal.public_id::text,p_idempotency_key,null,jsonb_build_object('projectId',p_project_public_id,'requestId',p_request_id));
  elsif v_goal.project_id<>v_project.id or v_goal.objective<>btrim(p_objective) or v_goal.constraints<>p_constraints then raise exception 'idempotency_conflict' using errcode='23505'; end if;
  return jsonb_build_object('goal',jsonb_build_object('id',v_goal.public_id,'projectId',p_project_public_id,'objective',v_goal.objective,'constraints',v_goal.constraints,'status',v_goal.status));
end;
$$;

create or replace function public.get_scheduling_evidence(p_goal_public_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor record; v_goal public.scheduling_goals%rowtype; v_project public.projects%rowtype;
begin
  select * into v_actor from public.current_scheduling_actor(); if not found then raise exception 'forbidden' using errcode='42501'; end if;
  select * into v_goal from public.scheduling_goals where tenant_id=v_actor.tenant_id and organization_id=v_actor.organization_id and public_id=p_goal_public_id and status='active'; if not found then raise exception 'not_found' using errcode='P0002'; end if;
  select * into v_project from public.projects where tenant_id=v_actor.tenant_id and id=v_goal.project_id and deleted_at is null;
  return jsonb_build_object(
    'goal',jsonb_build_object('id',v_goal.public_id,'objective',v_goal.objective,'constraints',v_goal.constraints),
    'project',jsonb_build_object('id',v_project.public_id,'name',v_project.name,'description',v_project.description,'dueDate',v_project.due_date,'status',v_project.status),
    'members',coalesce((select jsonb_agg(jsonb_build_object(
      'memberId',member.id,'employeeId',profile.public_id,'name',profile.display_name,'jobTitle',profile.job_title,'skills',profile.skills,
      'allocationPercent',membership.allocation_percent,
      'openTaskCount',(select count(*) from public.tasks task where task.tenant_id=v_actor.tenant_id and task.organization_id=v_actor.organization_id and task.assignee_member_id=member.id and task.deleted_at is null and task.status in ('backlog','todo','in_progress','in_review')),
      'taskIds',coalesce((select jsonb_agg(task.public_id order by task.id) from public.tasks task where task.tenant_id=v_actor.tenant_id and task.organization_id=v_actor.organization_id and task.assignee_member_id=member.id and task.deleted_at is null and task.status in ('backlog','todo','in_progress','in_review')),'[]'::jsonb)
    ) order by member.id) from public.project_members membership join public.organization_members member on member.tenant_id=v_actor.tenant_id and member.organization_id=v_actor.organization_id and member.id=membership.member_id and member.status='active' join public.employee_profiles profile on profile.tenant_id=v_actor.tenant_id and profile.organization_member_id=member.id and profile.deleted_at is null and profile.employment_status in ('probation','active','on_leave') where membership.tenant_id=v_actor.tenant_id and membership.organization_id=v_actor.organization_id and membership.project_id=v_goal.project_id and membership.left_at is null and membership.role in ('owner','manager','member')),'[]'::jsonb)
  );
end;
$$;

create or replace function public.save_scheduling_plan(
  p_tenant_public_id uuid,p_organization_public_id uuid,p_actor_member_id bigint,p_auth_user_id uuid,
  p_goal_public_id uuid,p_source text,p_assignments jsonb,p_summary jsonb,p_cost_amount numeric,p_cost_currency text,p_cost_basis jsonb,p_risk_summary text,p_model_code text,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor record; v_goal public.scheduling_goals%rowtype; v_plan public.scheduling_plan_versions%rowtype; v_item jsonb; v_member bigint; v_revision integer; v_assignments jsonb:='[]'::jsonb; v_assignment public.scheduling_assignments%rowtype;
begin
  if p_source not in ('model','rules') or (p_source='model' and length(btrim(coalesce(p_model_code,''))) not between 1 and 120) or p_assignments is null or jsonb_typeof(p_assignments)<>'array' or jsonb_array_length(p_assignments) not between 1 and 20 or p_summary is null or jsonb_typeof(p_summary)<>'object' or p_request_id is null or ((p_cost_amount is null)<>(p_cost_currency is null) or (p_cost_amount is null)<>(p_cost_basis is null)) then raise exception 'invalid_plan' using errcode='22023'; end if;
  select * into v_actor from public.resolve_ai_runtime_actor(p_tenant_public_id,p_organization_public_id,p_actor_member_id,p_auth_user_id); if not found then raise exception 'forbidden' using errcode='42501'; end if;
  if not exists (
    select 1 from public.member_roles assignment
    join public.roles role on role.tenant_id=assignment.tenant_id and role.id=assignment.role_id and role.is_enabled and (role.organization_id is null or role.organization_id=v_actor.organization_id)
    join public.role_permissions role_permission on role_permission.tenant_id=assignment.tenant_id and role_permission.role_id=role.id
    join public.permissions permission on permission.id=role_permission.permission_id and permission.code='agent.orchestrate'
    where assignment.tenant_id=v_actor.tenant_id and assignment.member_id=v_actor.actor_member_id
  ) then raise exception 'forbidden' using errcode='42501'; end if;
  select * into v_goal from public.scheduling_goals where tenant_id=v_actor.tenant_id and organization_id=v_actor.organization_id and public_id=p_goal_public_id and status='active' for update; if not found then raise exception 'not_found' using errcode='P0002'; end if;
  select * into v_plan from public.scheduling_plan_versions where tenant_id=v_actor.tenant_id and goal_id=v_goal.id and request_id=p_request_id;
  if found then return public.scheduling_plan_payload(v_plan.id); end if;
  for v_item in select value from jsonb_array_elements(p_assignments) loop
    if jsonb_typeof(v_item)<>'object' or (v_item->>'memberId')!~'^[1-9][0-9]*$' or length(btrim(coalesce(v_item->>'title',''))) not between 1 and 240 or length(coalesce(v_item->>'description',''))>4000 or length(btrim(coalesce(v_item->>'acceptanceCriteria',''))) not between 1 and 2000 or (v_item->>'dueDate')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or (v_item->>'priority') not in ('low','medium','high','urgent') or jsonb_typeof(v_item->'evidence')<>'object' or (v_item?'requiredSkills' and jsonb_typeof(v_item->'requiredSkills')<>'array') then raise exception 'invalid_assignment' using errcode='22023'; end if;
    v_member:=(v_item->>'memberId')::bigint;
    if not exists(select 1 from public.project_members membership join public.organization_members member on member.tenant_id=v_actor.tenant_id and member.id=membership.member_id and member.status='active' where membership.tenant_id=v_actor.tenant_id and membership.organization_id=v_actor.organization_id and membership.project_id=v_goal.project_id and membership.member_id=v_member and membership.left_at is null and membership.role in ('owner','manager','member')) then raise exception 'invalid_assignee' using errcode='22023'; end if;
  end loop;
  select coalesce(max(revision),0)+1 into v_revision from public.scheduling_plan_versions where tenant_id=v_actor.tenant_id and goal_id=v_goal.id;
  for v_plan in select * from public.scheduling_plan_versions where tenant_id=v_actor.tenant_id and goal_id=v_goal.id and status='draft' for update loop
    perform set_config('app.scheduling_transition_plan_id',v_plan.public_id::text,true); update public.scheduling_plan_versions set status='superseded' where id=v_plan.id; perform set_config('app.scheduling_transition_plan_id','',true);
  end loop;
  insert into public.scheduling_plan_versions(tenant_id,organization_id,goal_id,revision,source,summary,cost_amount,cost_currency,cost_basis,risk_summary,model_code,request_id,created_by_member_id)
  values(v_actor.tenant_id,v_actor.organization_id,v_goal.id,v_revision,p_source,p_summary,p_cost_amount,p_cost_currency,p_cost_basis,nullif(btrim(coalesce(p_risk_summary,'')),''),nullif(btrim(coalesce(p_model_code,'')),''),p_request_id,v_actor.actor_member_id) returning * into v_plan;
  for v_item in select value from jsonb_array_elements(p_assignments) loop
    insert into public.scheduling_assignments(tenant_id,organization_id,plan_version_id,project_id,assignee_member_id,ordinal,title,description,acceptance_criteria,due_date,priority,estimated_hours,required_skills,evidence)
    values(v_actor.tenant_id,v_actor.organization_id,v_plan.id,v_goal.project_id,(v_item->>'memberId')::bigint,coalesce((v_item->>'ordinal')::integer,jsonb_array_length(v_assignments)),btrim(v_item->>'title'),coalesce(v_item->>'description',''),btrim(v_item->>'acceptanceCriteria'),(v_item->>'dueDate')::date,v_item->>'priority',nullif(v_item->>'estimatedHours','')::numeric,coalesce(array(select jsonb_array_elements_text(coalesce(v_item->'requiredSkills','[]'::jsonb))),'{}'::text[]),v_item->'evidence') returning * into v_assignment;
    v_assignments:=v_assignments||jsonb_build_array(jsonb_build_object('id',v_assignment.public_id,'memberId',v_assignment.assignee_member_id,'ordinal',v_assignment.ordinal,'title',v_assignment.title,'description',v_assignment.description,'acceptanceCriteria',v_assignment.acceptance_criteria,'dueDate',v_assignment.due_date,'priority',v_assignment.priority,'estimatedHours',v_assignment.estimated_hours,'requiredSkills',v_assignment.required_skills,'evidence',v_assignment.evidence));
  end loop;
  perform public.append_audit_log(v_actor.tenant_id,v_actor.organization_id,p_auth_user_id,v_actor.actor_member_id,'scheduling.plan.created','scheduling_plan',v_plan.public_id::text,p_request_id,null,jsonb_build_object('goalId',p_goal_public_id,'source',p_source,'revision',v_revision));
  return public.scheduling_plan_payload(v_plan.id);
end;
$$;

revoke all on function public.reject_scheduling_plan_mutation() from public,anon,authenticated,service_role;
revoke all on function public.current_scheduling_actor() from public,anon,authenticated,service_role;
revoke all on function public.scheduling_plan_payload(bigint) from public,anon,authenticated,service_role;
revoke all on function public.create_scheduling_goal(uuid,text,jsonb,uuid,uuid) from public,anon;
revoke all on function public.get_scheduling_evidence(uuid) from public,anon;
revoke all on function public.save_scheduling_plan(uuid,uuid,bigint,uuid,uuid,text,jsonb,jsonb,numeric,text,jsonb,text,text,uuid) from public,anon,authenticated;
grant execute on function public.create_scheduling_goal(uuid,text,jsonb,uuid,uuid) to authenticated;
grant execute on function public.get_scheduling_evidence(uuid) to authenticated;
grant execute on function public.save_scheduling_plan(uuid,uuid,bigint,uuid,uuid,text,jsonb,jsonb,numeric,text,jsonb,text,text,uuid) to service_role;

commit;
