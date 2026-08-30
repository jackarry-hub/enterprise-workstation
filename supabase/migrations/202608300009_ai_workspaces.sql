begin;

create or replace function public.list_current_scheduling_workbench(p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor record;
begin
  if p_limit not between 1 and 100 then raise exception 'invalid_limit' using errcode='22023'; end if;
  select * into v_actor from public.current_scheduling_actor(); if not found then raise exception 'forbidden' using errcode='42501'; end if;
  return jsonb_build_object(
    'projects',coalesce((select jsonb_agg(jsonb_build_object('id',project.public_id,'name',project.name,'dueDate',project.due_date,'status',project.status) order by project.updated_at desc,project.id desc)
      from public.projects project where project.tenant_id=v_actor.tenant_id and project.organization_id=v_actor.organization_id and project.deleted_at is null and project.status in ('planning','active','on_hold') and (
        public.has_organization_permission(v_actor.organization_id,'project.manage') or exists(select 1 from public.project_members membership where membership.tenant_id=v_actor.tenant_id and membership.organization_id=v_actor.organization_id and membership.project_id=project.id and membership.member_id=v_actor.member_id and membership.left_at is null and membership.role in ('owner','manager'))
      )),'[]'::jsonb),
    'members',coalesce((select jsonb_agg(jsonb_build_object('projectId',project.public_id,'memberId',member.id,'name',profile.display_name,'skills',profile.skills,'openTaskCount',(select count(*) from public.tasks task where task.tenant_id=v_actor.tenant_id and task.organization_id=v_actor.organization_id and task.assignee_member_id=member.id and task.deleted_at is null and task.status in ('backlog','todo','in_progress','in_review'))) order by project.id,member.id)
      from public.project_members membership join public.projects project on project.tenant_id=v_actor.tenant_id and project.organization_id=v_actor.organization_id and project.id=membership.project_id and project.deleted_at is null
      join public.organization_members member on member.tenant_id=v_actor.tenant_id and member.organization_id=v_actor.organization_id and member.id=membership.member_id and member.status='active'
      join public.employee_profiles profile on profile.tenant_id=v_actor.tenant_id and profile.organization_member_id=member.id and profile.deleted_at is null and profile.employment_status in ('probation','active','on_leave')
      where membership.tenant_id=v_actor.tenant_id and membership.organization_id=v_actor.organization_id and membership.left_at is null and membership.role in ('owner','manager','member')),'[]'::jsonb),
    'goals',coalesce((select jsonb_agg(jsonb_build_object('id',goal.public_id,'projectId',project.public_id,'objective',goal.objective,'constraints',goal.constraints,'status',goal.status,'createdAt',goal.created_at,'plan',case when plan.id is null then null else public.scheduling_plan_payload(plan.id)->'plan' end,'override',case when latest_override.id is null then null else jsonb_build_object('reason',latest_override.reason,'originalMemberId',latest_override.original_member_id,'replacementMemberId',latest_override.replacement_member_id) end) order by goal.created_at desc,goal.id desc)
      from (select * from public.scheduling_goals where tenant_id=v_actor.tenant_id and organization_id=v_actor.organization_id and status='active' order by created_at desc,id desc limit p_limit) goal
      join public.projects project on project.tenant_id=goal.tenant_id and project.id=goal.project_id
      left join lateral (select * from public.scheduling_plan_versions candidate where candidate.tenant_id=goal.tenant_id and candidate.goal_id=goal.id order by candidate.revision desc limit 1) plan on true
      left join lateral (select * from public.scheduling_overrides candidate where candidate.tenant_id=goal.tenant_id and candidate.replacement_plan_version_id=plan.id order by candidate.created_at desc limit 1) latest_override on true),'[]'::jsonb)
  );
end;
$$;

revoke all on function public.list_current_scheduling_workbench(integer) from public,anon;
grant execute on function public.list_current_scheduling_workbench(integer) to authenticated;

commit;
