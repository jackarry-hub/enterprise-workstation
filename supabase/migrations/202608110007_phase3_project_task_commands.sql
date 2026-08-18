alter table public.audit_logs drop constraint if exists audit_logs_action_check;
alter table public.audit_logs add constraint audit_logs_action_check check (action in (
  'identity.provisioned', 'identity.claimed', 'identity.revoked',
  'member.status_changed', 'member.role_changed', 'profile.updated',
  'roster.imported', 'tenant.bootstrap_owner', 'enterprise.initialized',
  'directory.sync_started', 'directory.sync_completed', 'directory.sync_failed',
  'directory.role_mapped', 'project.created', 'task.created'
));

create or replace function public.create_current_project(
  p_name text,
  p_description text,
  p_owner_member_id bigint,
  p_member_ids bigint[],
  p_status text,
  p_priority text,
  p_start_date date,
  p_due_date date
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
  v_project_public_id uuid := gen_random_uuid();
  v_owner_member_id bigint := p_owner_member_id;
  v_member_id bigint;
  v_is_owner_admin boolean;
  v_is_department_head boolean;
begin
  if v_tenant_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if nullif(btrim(p_name), '') is null or length(btrim(p_name)) > 160
     or length(coalesce(p_description, '')) > 4000
     or p_status not in ('planning', 'active')
     or p_priority not in ('low', 'medium', 'high', 'critical')
     or p_start_date is null or p_due_date is null or p_due_date < p_start_date
     or cardinality(coalesce(p_member_ids, '{}'::bigint[])) > 100 then
    raise exception 'Project input is invalid' using errcode = '22023';
  end if;

  select member.organization_id, member.id
  into strict v_organization_id, v_actor_member_id
  from public.organization_members member
  where member.tenant_id = v_tenant_id and member.user_id = (select auth.uid())
    and member.status = 'active' limit 1;

  v_is_owner_admin := public.has_organization_role(v_organization_id, array['owner', 'admin']);
  v_is_department_head := public.has_organization_role(v_organization_id, array['department_head']);
  if not v_is_owner_admin and not v_is_department_head then
    raise exception 'Project creation is not allowed' using errcode = '42501';
  end if;
  if not v_is_owner_admin then v_owner_member_id := v_actor_member_id; end if;

  if not exists (
    select 1 from public.organization_members member
    where member.tenant_id = v_tenant_id and member.organization_id = v_organization_id
      and member.id = v_owner_member_id and member.status in ('invited', 'active')
  ) or exists (
    select 1 from unnest(coalesce(p_member_ids, '{}'::bigint[])) requested(member_id)
    where not exists (
      select 1 from public.organization_members member
      where member.tenant_id = v_tenant_id and member.organization_id = v_organization_id
        and member.id = requested.member_id and member.status in ('invited', 'active')
    )
  ) then
    raise exception 'Project member is invalid' using errcode = '23503';
  end if;

  insert into public.projects (
    public_id, organization_id, code, name, description,
    owner_member_id, created_by_member_id, status, health,
    priority, start_date, due_date, progress
  ) values (
    v_project_public_id, v_organization_id,
    'QXY-' || upper(substr(replace(v_project_public_id::text, '-', ''), 1, 10)),
    btrim(p_name), btrim(coalesce(p_description, '')),
    v_owner_member_id, v_actor_member_id, p_status, 'on_track',
    p_priority, p_start_date, p_due_date, 0
  ) returning id into v_project_id;

  insert into public.project_members (
    organization_id, project_id, member_id, role, allocation_percent
  ) values (v_organization_id, v_project_id, v_owner_member_id, 'owner', 100);
  for v_member_id in select distinct member_id from unnest(
    coalesce(p_member_ids, '{}'::bigint[]) || array[v_actor_member_id]
  ) requested(member_id)
  loop
    if v_member_id <> v_owner_member_id then
      insert into public.project_members (
        organization_id, project_id, member_id, role, allocation_percent
      ) values (
        v_organization_id, v_project_id, v_member_id,
        case when v_member_id = v_actor_member_id then 'manager' else 'member' end,
        100
      ) on conflict (project_id, member_id) do nothing;
    end if;
  end loop;

  perform public.append_audit_log(
    v_tenant_id, v_organization_id, (select auth.uid()), v_actor_member_id,
    'project.created', 'project', v_project_public_id::text,
    null, null, jsonb_build_object('status', p_status, 'priority', p_priority)
  );
  return v_project_public_id;
end;
$$;

create or replace function public.create_current_project_task(
  p_project_public_id uuid,
  p_title text,
  p_description text,
  p_assignee_member_id bigint,
  p_due_date date,
  p_priority text
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
  if v_tenant_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_project_public_id is null or nullif(btrim(p_title), '') is null
     or length(btrim(p_title)) > 240 or length(coalesce(p_description, '')) > 4000
     or p_assignee_member_id is null or p_assignee_member_id <= 0
     or p_due_date is null or p_priority not in ('low', 'medium', 'high', 'urgent') then
    raise exception 'Task input is invalid' using errcode = '22023';
  end if;

  select member.organization_id, member.id
  into strict v_organization_id, v_actor_member_id
  from public.organization_members member
  where member.tenant_id = v_tenant_id and member.user_id = (select auth.uid())
    and member.status = 'active' limit 1;
  select project.id into strict v_project_id
  from public.projects project
  where project.organization_id = v_organization_id
    and project.public_id = p_project_public_id and project.deleted_at is null;

  if not (
    public.has_organization_role(v_organization_id, array['owner', 'admin'])
    or exists (
      select 1 from public.projects project
      left join public.project_members membership
        on membership.project_id = project.id
       and membership.member_id = v_actor_member_id and membership.left_at is null
      where project.id = v_project_id
        and (project.owner_member_id = v_actor_member_id or membership.role in ('owner', 'manager'))
    )
  ) then
    raise exception 'Task creation is not allowed' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.project_members membership
    join public.organization_members member
      on member.organization_id = membership.organization_id
     and member.id = membership.member_id
    where membership.project_id = v_project_id
      and membership.member_id = p_assignee_member_id
      and membership.left_at is null and member.status in ('invited', 'active')
  ) then
    raise exception 'Task assignee is not a project member' using errcode = '23503';
  end if;

  insert into public.tasks (
    public_id, organization_id, project_id, title, description,
    assignee_member_id, reporter_member_id, status, priority,
    start_date, due_date, progress
  ) values (
    v_task_public_id, v_organization_id, v_project_id,
    btrim(p_title), btrim(coalesce(p_description, '')),
    p_assignee_member_id, v_actor_member_id, 'todo', p_priority,
    current_date, p_due_date, 0
  );
  perform public.append_audit_log(
    v_tenant_id, v_organization_id, (select auth.uid()), v_actor_member_id,
    'task.created', 'task', v_task_public_id::text,
    null, null, jsonb_build_object('project', p_project_public_id, 'priority', p_priority)
  );
  return v_task_public_id;
end;
$$;

revoke all on function public.create_current_project(text,text,bigint,bigint[],text,text,date,date) from public, anon;
grant execute on function public.create_current_project(text,text,bigint,bigint[],text,text,date,date) to authenticated;
revoke all on function public.create_current_project_task(uuid,text,text,bigint,date,text) from public, anon;
grant execute on function public.create_current_project_task(uuid,text,text,bigint,date,text) to authenticated;
