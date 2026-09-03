create or replace function public.reject_published_agent_version_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'agent_versions' then
    if old.lifecycle = 'published' then
      raise exception 'published_agent_version_immutable' using errcode = '55000';
    end if;
  elsif tg_table_name = 'agent_version_tools' then
    if exists (
      select 1
      from public.agent_versions version
      where version.id = old.agent_version_id
        and version.lifecycle = 'published'
    ) then
      raise exception 'published_agent_version_immutable' using errcode = '55000';
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public.create_scheduling_goal(
  p_project_public_id uuid,
  p_objective text,
  p_constraints jsonb,
  p_idempotency_key uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
  v_project public.projects%rowtype;
  v_goal public.scheduling_goals%rowtype;
begin
  if p_project_public_id is null
    or length(btrim(coalesce(p_objective, ''))) not between 1 and 1000
    or p_constraints is null
    or jsonb_typeof(p_constraints) <> 'object'
    or pg_column_size(p_constraints) > 32768
    or p_idempotency_key is null
    or p_request_id is null
  then
    raise exception 'invalid_request' using errcode = '22023';
  end if;

  select * into v_actor from public.current_scheduling_actor();
  if not found then raise exception 'forbidden' using errcode = '42501'; end if;

  select * into v_project
  from public.projects
  where tenant_id = v_actor.tenant_id
    and organization_id = v_actor.organization_id
    and public_id = p_project_public_id
    and deleted_at is null
    and status in ('planning', 'active', 'on_hold');
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;

  if (
    select access_state
    from public.lock_current_project_execution_access(
      v_actor.tenant_id,
      v_actor.organization_id,
      v_actor.member_id,
      p_project_public_id,
      'manage'
    )
  ) <> 'allowed' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      v_actor.tenant_id::text || ':' || v_actor.member_id::text || ':goal:' || p_idempotency_key::text,
      0
    )
  );

  select goal.* into v_goal
  from public.scheduling_goals goal
  join public.audit_logs audit
    on audit.tenant_id = goal.tenant_id
   and audit.target_type = 'scheduling_goal'
   and audit.target_id = goal.public_id::text
   and audit.request_id = p_idempotency_key
  where goal.tenant_id = v_actor.tenant_id
    and goal.created_by_member_id = v_actor.member_id
  limit 1;

  if not found then
    insert into public.scheduling_goals(
      tenant_id,
      organization_id,
      project_id,
      created_by_member_id,
      objective,
      constraints
    )
    values (
      v_actor.tenant_id,
      v_actor.organization_id,
      v_project.id,
      v_actor.member_id,
      btrim(p_objective),
      p_constraints
    )
    returning * into v_goal;

    perform public.append_audit_log(
      v_actor.tenant_id,
      v_actor.organization_id,
      v_actor.user_id,
      v_actor.member_id,
      'scheduling.goal.created',
      'scheduling_goal',
      v_goal.public_id::text,
      p_idempotency_key,
      null,
      jsonb_build_object('projectId', p_project_public_id, 'requestId', p_request_id)
    );
  elsif v_goal.project_id <> v_project.id
    or v_goal.objective <> btrim(p_objective)
    or v_goal.constraints <> p_constraints
  then
    raise exception 'idempotency_conflict' using errcode = '23505';
  end if;

  return jsonb_build_object(
    'goal',
    jsonb_build_object(
      'id', v_goal.public_id,
      'projectId', p_project_public_id,
      'objective', v_goal.objective,
      'constraints', v_goal.constraints,
      'status', v_goal.status
    )
  );
end;
$$;

create or replace function public.create_current_agent(
  p_code text,
  p_name text,
  p_description text,
  p_icon text,
  p_department_public_id uuid,
  p_min_job_level integer,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
  v_agent public.agent_definitions%rowtype;
  v_department bigint;
begin
  if p_request_id is null
    or p_code !~ '^[a-z][a-z0-9_]{1,79}$'
    or length(btrim(coalesce(p_name, ''))) not between 2 and 120
    or length(coalesce(p_description, '')) > 2000
    or length(btrim(coalesce(p_icon, ''))) not between 1 and 40
    or p_min_job_level not between 1 and 20
  then
    raise exception 'invalid_agent' using errcode = '22023';
  end if;

  select * into v_actor from public.current_agent_actor('agent.manage');
  if not found then raise exception 'forbidden' using errcode = '42501'; end if;

  select agent.* into v_agent
  from public.agent_definitions agent
  join public.audit_logs audit
    on audit.tenant_id = agent.tenant_id
   and audit.target_type = 'agent_definition'
   and audit.target_id = agent.public_id::text
   and audit.request_id = p_request_id
  where agent.tenant_id = v_actor.tenant_id
    and agent.organization_id = v_actor.organization_id
  limit 1;

  if found then
    if v_agent.code <> p_code then
      raise exception 'idempotency_conflict' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'agentId', v_agent.public_id,
      'status', v_agent.status,
      'alreadyExists', true
    );
  end if;

  if p_department_public_id is not null then
    select id into v_department
    from public.departments
    where tenant_id = v_actor.tenant_id
      and organization_id = v_actor.organization_id
      and public_id = p_department_public_id
      and deleted_at is null;
    if v_department is null then
      raise exception 'department_not_found' using errcode = 'P0002';
    end if;
  end if;

  insert into public.agent_definitions(
    tenant_id,
    organization_id,
    code,
    name,
    description,
    icon,
    department_id,
    min_job_level,
    status,
    created_by_member_id,
    updated_by_member_id
  )
  values (
    v_actor.tenant_id,
    v_actor.organization_id,
    p_code,
    btrim(p_name),
    coalesce(p_description, ''),
    btrim(p_icon),
    v_department,
    p_min_job_level,
    'disabled',
    v_actor.member_id,
    v_actor.member_id
  )
  returning * into v_agent;

  perform public.append_audit_log(
    v_actor.tenant_id,
    v_actor.organization_id,
    v_actor.user_id,
    v_actor.member_id,
    'agent.created',
    'agent_definition',
    v_agent.public_id::text,
    p_request_id,
    null,
    jsonb_build_object('code', v_agent.code)
  );

  return jsonb_build_object(
    'agentId', v_agent.public_id,
    'status', v_agent.status,
    'alreadyExists', false
  );
end;
$$;

revoke all on function public.create_scheduling_goal(uuid, text, jsonb, uuid, uuid) from public, anon;
grant execute on function public.create_scheduling_goal(uuid, text, jsonb, uuid, uuid) to authenticated;

revoke all on function public.create_current_agent(text, text, text, text, uuid, integer, uuid) from public, anon;
grant execute on function public.create_current_agent(text, text, text, text, uuid, integer, uuid) to authenticated;
