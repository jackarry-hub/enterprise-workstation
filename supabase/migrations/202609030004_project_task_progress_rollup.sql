begin;

create or replace function public.roll_up_project_progress_from_tasks()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id bigint;
  v_organization_id bigint;
  v_project_id bigint;
  v_actor_member_id bigint;
  v_progress numeric(5, 2);
begin
  if tg_op = 'DELETE' then
    v_tenant_id := old.tenant_id;
    v_organization_id := old.organization_id;
    v_project_id := old.project_id;
    v_actor_member_id := old.updated_by_member_id;
  else
    v_tenant_id := new.tenant_id;
    v_organization_id := new.organization_id;
    v_project_id := new.project_id;
    v_actor_member_id := new.updated_by_member_id;
  end if;

  select coalesce(
    round(
      100.0 * count(*) filter (where task.status = 'done')
      / nullif(count(*) filter (where task.status <> 'cancelled'), 0),
      0
    ),
    0
  )::numeric(5, 2)
  into v_progress
  from public.tasks task
  where task.tenant_id = v_tenant_id
    and task.organization_id = v_organization_id
    and task.project_id = v_project_id
    and task.deleted_at is null;

  update public.projects project
  set progress = v_progress,
      updated_by_member_id = coalesce(v_actor_member_id, project.updated_by_member_id),
      version = project.version + 1,
      updated_at = clock_timestamp()
  where project.tenant_id = v_tenant_id
    and project.organization_id = v_organization_id
    and project.id = v_project_id
    and project.deleted_at is null
    and project.progress is distinct from v_progress;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists tasks_roll_up_project_progress on public.tasks;
create trigger tasks_roll_up_project_progress
after insert or delete or update of status, deleted_at
on public.tasks
for each row execute function public.roll_up_project_progress_from_tasks();

with progress_rollup as (
  select
    project.id,
    coalesce(
      round(
        100.0 * count(task.id) filter (where task.status = 'done')
        / nullif(count(task.id) filter (where task.status <> 'cancelled'), 0),
        0
      ),
      0
    )::numeric(5, 2) as progress
  from public.projects project
  left join public.tasks task
    on task.tenant_id = project.tenant_id
   and task.organization_id = project.organization_id
   and task.project_id = project.id
   and task.deleted_at is null
  where project.deleted_at is null
  group by project.id
)
update public.projects project
set progress = rollup.progress,
    version = project.version + 1,
    updated_at = clock_timestamp()
from progress_rollup rollup
where project.id = rollup.id
  and project.progress is distinct from rollup.progress;

revoke all on function public.roll_up_project_progress_from_tasks()
from public, anon, authenticated, service_role;

commit;
