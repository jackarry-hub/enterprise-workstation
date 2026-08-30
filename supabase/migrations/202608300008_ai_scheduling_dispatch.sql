begin;

alter table public.scheduling_plan_versions add column dispatch_result jsonb check (dispatch_result is null or jsonb_typeof(dispatch_result)='object');

create table public.scheduling_overrides (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete cascade,
  organization_id bigint not null,
  goal_id bigint not null,
  original_plan_version_id bigint not null,
  replacement_plan_version_id bigint not null,
  assignment_id bigint not null,
  original_member_id bigint not null,
  replacement_member_id bigint not null,
  reason text not null check (length(btrim(reason)) between 5 and 1000),
  actor_member_id bigint not null,
  idempotency_key uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (tenant_id,organization_id,goal_id) references public.scheduling_goals(tenant_id,organization_id,id) on delete cascade,
  foreign key (tenant_id,organization_id,original_plan_version_id) references public.scheduling_plan_versions(tenant_id,organization_id,id) on delete restrict,
  foreign key (tenant_id,organization_id,replacement_plan_version_id) references public.scheduling_plan_versions(tenant_id,organization_id,id) on delete restrict,
  foreign key (tenant_id,organization_id,assignment_id) references public.scheduling_assignments(tenant_id,organization_id,id) on delete restrict,
  foreign key (tenant_id,original_member_id) references public.organization_members(tenant_id,id) on delete restrict,
  foreign key (tenant_id,replacement_member_id) references public.organization_members(tenant_id,id) on delete restrict,
  foreign key (tenant_id,actor_member_id) references public.organization_members(tenant_id,id) on delete restrict,
  unique (tenant_id,actor_member_id,idempotency_key)
);

create table public.scheduling_dispatch_tasks (
  tenant_id bigint not null references public.tenants(id) on delete cascade,
  organization_id bigint not null,
  plan_version_id bigint not null,
  task_id bigint not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (tenant_id,plan_version_id,task_id),
  foreign key (tenant_id,organization_id,plan_version_id) references public.scheduling_plan_versions(tenant_id,organization_id,id) on delete restrict,
  foreign key (tenant_id,organization_id,task_id) references public.tasks(tenant_id,organization_id,id) on delete restrict
);

alter table public.scheduling_overrides enable row level security;
alter table public.scheduling_overrides force row level security;
alter table public.scheduling_dispatch_tasks enable row level security;
alter table public.scheduling_dispatch_tasks force row level security;
create policy scheduling_overrides_manager_read on public.scheduling_overrides for select to authenticated using (tenant_id=(select public.current_tenant_id()) and (select public.has_organization_permission(organization_id,'agent.orchestrate')));
create policy scheduling_dispatch_tasks_manager_read on public.scheduling_dispatch_tasks for select to authenticated using (tenant_id=(select public.current_tenant_id()) and (select public.has_organization_permission(organization_id,'agent.orchestrate')));
grant select on public.scheduling_overrides,public.scheduling_dispatch_tasks to authenticated;

create or replace function public.scheduling_plan_payload(p_plan_id bigint)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('plan',jsonb_build_object(
    'id',plan.public_id,'goalId',goal.public_id,'revision',plan.revision,'source',plan.source,'status',plan.status,
    'summary',plan.summary,'cost',plan.cost_amount,'riskSummary',plan.risk_summary,'dispatch',plan.dispatch_result,
    'assignments',coalesce((select jsonb_agg(jsonb_build_object('id',assignment.public_id,'memberId',assignment.assignee_member_id,'ordinal',assignment.ordinal,'title',assignment.title,'description',assignment.description,'acceptanceCriteria',assignment.acceptance_criteria,'dueDate',assignment.due_date,'priority',assignment.priority,'estimatedHours',assignment.estimated_hours,'requiredSkills',assignment.required_skills,'evidence',assignment.evidence) order by assignment.ordinal) from public.scheduling_assignments assignment where assignment.plan_version_id=plan.id),'[]'::jsonb)
  )) from public.scheduling_plan_versions plan join public.scheduling_goals goal on goal.tenant_id=plan.tenant_id and goal.id=plan.goal_id where plan.id=p_plan_id;
$$;

create or replace function public.override_scheduling_assignment(
  p_plan_public_id uuid,p_assignment_public_id uuid,p_replacement_member_id bigint,p_reason text,p_expected_revision integer,p_idempotency_key uuid,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor record; v_plan public.scheduling_plan_versions%rowtype; v_new_plan public.scheduling_plan_versions%rowtype; v_assignment public.scheduling_assignments%rowtype; v_override public.scheduling_overrides%rowtype; v_goal public.scheduling_goals%rowtype; v_copy public.scheduling_assignments%rowtype; v_evidence jsonb; v_result jsonb;
begin
  if p_plan_public_id is null or p_assignment_public_id is null or p_replacement_member_id is null or length(btrim(coalesce(p_reason,''))) not between 5 and 1000 or p_expected_revision<1 or p_idempotency_key is null or p_request_id is null then raise exception 'invalid_override' using errcode='22023'; end if;
  select * into v_actor from public.current_scheduling_actor(); if not found then raise exception 'forbidden' using errcode='42501'; end if;
  select * into v_override from public.scheduling_overrides where tenant_id=v_actor.tenant_id and actor_member_id=v_actor.member_id and idempotency_key=p_idempotency_key;
  if found then return public.scheduling_plan_payload(v_override.replacement_plan_version_id)||jsonb_build_object('override',jsonb_build_object('id',v_override.public_id,'reason',v_override.reason,'originalMemberId',v_override.original_member_id,'replacementMemberId',v_override.replacement_member_id)); end if;
  select * into v_plan from public.scheduling_plan_versions where tenant_id=v_actor.tenant_id and organization_id=v_actor.organization_id and public_id=p_plan_public_id for update; if not found then raise exception 'not_found' using errcode='P0002'; end if;
  select * into v_override from public.scheduling_overrides where tenant_id=v_actor.tenant_id and actor_member_id=v_actor.member_id and idempotency_key=p_idempotency_key;
  if found then return public.scheduling_plan_payload(v_override.replacement_plan_version_id)||jsonb_build_object('override',jsonb_build_object('id',v_override.public_id,'reason',v_override.reason,'originalMemberId',v_override.original_member_id,'replacementMemberId',v_override.replacement_member_id)); end if;
  if v_plan.status<>'draft' or v_plan.revision<>p_expected_revision then raise exception 'version_conflict' using errcode='40001'; end if;
  select * into v_assignment from public.scheduling_assignments where tenant_id=v_actor.tenant_id and plan_version_id=v_plan.id and public_id=p_assignment_public_id; if not found then raise exception 'not_found' using errcode='P0002'; end if;
  select * into v_goal from public.scheduling_goals where tenant_id=v_actor.tenant_id and id=v_plan.goal_id;
  if not exists(select 1 from public.project_members membership join public.organization_members member on member.tenant_id=v_actor.tenant_id and member.id=membership.member_id and member.status='active' where membership.tenant_id=v_actor.tenant_id and membership.organization_id=v_actor.organization_id and membership.project_id=v_goal.project_id and membership.member_id=p_replacement_member_id and membership.left_at is null and membership.role in ('owner','manager','member')) then raise exception 'invalid_assignee' using errcode='22023'; end if;
  v_evidence:=jsonb_build_object('memberId',p_replacement_member_id,
    'employeeId',(select profile.public_id from public.employee_profiles profile where profile.tenant_id=v_actor.tenant_id and profile.organization_member_id=p_replacement_member_id and profile.deleted_at is null),
    'skills',coalesce((select to_jsonb(profile.skills) from public.employee_profiles profile where profile.tenant_id=v_actor.tenant_id and profile.organization_member_id=p_replacement_member_id and profile.deleted_at is null),'[]'::jsonb),
    'openTaskCount',(select count(*) from public.tasks task where task.tenant_id=v_actor.tenant_id and task.organization_id=v_actor.organization_id and task.assignee_member_id=p_replacement_member_id and task.deleted_at is null and task.status in ('backlog','todo','in_progress','in_review')),
    'taskIds',coalesce((select jsonb_agg(task.public_id order by task.id) from public.tasks task where task.tenant_id=v_actor.tenant_id and task.organization_id=v_actor.organization_id and task.assignee_member_id=p_replacement_member_id and task.deleted_at is null and task.status in ('backlog','todo','in_progress','in_review')),'[]'::jsonb));
  perform set_config('app.scheduling_transition_plan_id',v_plan.public_id::text,true); update public.scheduling_plan_versions set status='superseded' where id=v_plan.id; perform set_config('app.scheduling_transition_plan_id','',true);
  insert into public.scheduling_plan_versions(tenant_id,organization_id,goal_id,revision,source,status,summary,cost_amount,cost_currency,cost_basis,risk_summary,model_code,request_id,created_by_member_id)
  values(v_plan.tenant_id,v_plan.organization_id,v_plan.goal_id,v_plan.revision+1,v_plan.source,'draft',v_plan.summary||jsonb_build_object('humanOverride',true),v_plan.cost_amount,v_plan.cost_currency,v_plan.cost_basis,v_plan.risk_summary,v_plan.model_code,p_idempotency_key,v_actor.member_id) returning * into v_new_plan;
  for v_copy in select * from public.scheduling_assignments where tenant_id=v_actor.tenant_id and plan_version_id=v_plan.id order by ordinal loop
    insert into public.scheduling_assignments(tenant_id,organization_id,plan_version_id,project_id,assignee_member_id,ordinal,title,description,acceptance_criteria,due_date,priority,estimated_hours,required_skills,evidence)
    values(v_copy.tenant_id,v_copy.organization_id,v_new_plan.id,v_copy.project_id,case when v_copy.id=v_assignment.id then p_replacement_member_id else v_copy.assignee_member_id end,v_copy.ordinal,v_copy.title,v_copy.description,v_copy.acceptance_criteria,v_copy.due_date,v_copy.priority,v_copy.estimated_hours,v_copy.required_skills,case when v_copy.id=v_assignment.id then v_evidence else v_copy.evidence end);
  end loop;
  insert into public.scheduling_overrides(tenant_id,organization_id,goal_id,original_plan_version_id,replacement_plan_version_id,assignment_id,original_member_id,replacement_member_id,reason,actor_member_id,idempotency_key)
  values(v_actor.tenant_id,v_actor.organization_id,v_plan.goal_id,v_plan.id,v_new_plan.id,v_assignment.id,v_assignment.assignee_member_id,p_replacement_member_id,btrim(p_reason),v_actor.member_id,p_idempotency_key) returning * into v_override;
  perform public.append_audit_log(v_actor.tenant_id,v_actor.organization_id,v_actor.user_id,v_actor.member_id,'scheduling.plan.overridden','scheduling_plan',v_new_plan.public_id::text,p_request_id,null,jsonb_build_object('originalPlanId',v_plan.public_id,'assignmentId',v_assignment.public_id,'originalMemberId',v_assignment.assignee_member_id,'replacementMemberId',p_replacement_member_id,'reason',btrim(p_reason)));
  return public.scheduling_plan_payload(v_new_plan.id)||jsonb_build_object('override',jsonb_build_object('id',v_override.public_id,'reason',v_override.reason,'originalMemberId',v_override.original_member_id,'replacementMemberId',v_override.replacement_member_id));
end;
$$;

create or replace function public.dispatch_scheduling_plan(p_plan_public_id uuid,p_expected_revision integer,p_idempotency_key uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor record; v_plan public.scheduling_plan_versions%rowtype; v_goal public.scheduling_goals%rowtype; v_assignment public.scheduling_assignments%rowtype; v_items jsonb:='[]'::jsonb; v_result jsonb; v_task_ids jsonb; v_notification_ids jsonb; v_link_count integer;
begin
  if p_plan_public_id is null or p_expected_revision<1 or p_idempotency_key is null or p_request_id is null then raise exception 'invalid_dispatch' using errcode='22023'; end if;
  select * into v_actor from public.current_scheduling_actor(); if not found then raise exception 'forbidden' using errcode='42501'; end if;
  select * into v_plan from public.scheduling_plan_versions where tenant_id=v_actor.tenant_id and organization_id=v_actor.organization_id and public_id=p_plan_public_id for update; if not found then raise exception 'not_found' using errcode='P0002'; end if;
  if v_plan.status='dispatched' then return public.scheduling_plan_payload(v_plan.id); end if;
  if v_plan.status<>'draft' or v_plan.revision<>p_expected_revision then raise exception 'version_conflict' using errcode='40001'; end if;
  select * into v_goal from public.scheduling_goals where tenant_id=v_actor.tenant_id and id=v_plan.goal_id;
  for v_assignment in select * from public.scheduling_assignments where tenant_id=v_actor.tenant_id and plan_version_id=v_plan.id order by ordinal loop
    v_items:=v_items||jsonb_build_array(jsonb_build_object('projectId',(select public_id from public.projects where tenant_id=v_actor.tenant_id and id=v_assignment.project_id),'assigneeMemberId',v_assignment.assignee_member_id,'title',v_assignment.title,'description',v_assignment.description,'acceptanceCriteria',v_assignment.acceptance_criteria,'dueDate',v_assignment.due_date,'priority',v_assignment.priority));
  end loop;
  if jsonb_array_length(v_items)=0 then raise exception 'empty_plan' using errcode='22023'; end if;
  v_result:=public.create_current_task_batch_v3(v_items,p_idempotency_key,p_request_id);
  if v_result->>'outcome'<>'success' then raise exception 'dispatch_failed' using errcode='55000'; end if;
  v_task_ids:=coalesce(v_result->'taskIds','[]'::jsonb);
  insert into public.scheduling_dispatch_tasks(tenant_id,organization_id,plan_version_id,task_id)
  select v_actor.tenant_id,v_actor.organization_id,v_plan.id,task.id from public.tasks task join jsonb_array_elements_text(v_task_ids) item(public_id) on task.public_id=item.public_id::uuid where task.tenant_id=v_actor.tenant_id and task.organization_id=v_actor.organization_id;
  get diagnostics v_link_count=row_count;
  if v_link_count<>jsonb_array_length(v_task_ids) then raise exception 'dispatch_task_link_mismatch' using errcode='55000'; end if;
  select coalesce(jsonb_agg(notification.public_id order by notification.id),'[]'::jsonb) into v_notification_ids from public.task_notifications notification join public.scheduling_dispatch_tasks link on link.tenant_id=notification.tenant_id and link.organization_id=notification.organization_id and link.task_id=notification.task_id where link.tenant_id=v_actor.tenant_id and link.plan_version_id=v_plan.id and notification.event_type='task.assigned';
  perform set_config('app.scheduling_transition_plan_id',v_plan.public_id::text,true);
  update public.scheduling_plan_versions set status='dispatched',locked_at=clock_timestamp(),dispatched_at=clock_timestamp(),dispatch_result=jsonb_build_object('taskIds',v_task_ids,'notificationIds',v_notification_ids,'idempotencyKey',p_idempotency_key) where id=v_plan.id returning * into v_plan;
  perform set_config('app.scheduling_transition_plan_id','',true);
  perform public.append_audit_log(v_actor.tenant_id,v_actor.organization_id,v_actor.user_id,v_actor.member_id,'scheduling.plan.dispatched','scheduling_plan',v_plan.public_id::text,p_request_id,null,v_plan.dispatch_result);
  return public.scheduling_plan_payload(v_plan.id);
end;
$$;

revoke all on function public.override_scheduling_assignment(uuid,uuid,bigint,text,integer,uuid,uuid) from public,anon;
revoke all on function public.dispatch_scheduling_plan(uuid,integer,uuid,uuid) from public,anon;
grant execute on function public.override_scheduling_assignment(uuid,uuid,bigint,text,integer,uuid,uuid) to authenticated;
grant execute on function public.dispatch_scheduling_plan(uuid,integer,uuid,uuid) to authenticated;

commit;
