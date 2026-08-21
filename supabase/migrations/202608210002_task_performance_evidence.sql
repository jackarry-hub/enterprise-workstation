-- Keep append-like task execution evidence on the task row so assignment
-- recommendations can use delivery history only.
alter table public.tasks
  add column if not exists submission_count integer not null default 0,
  add column if not exists rejection_count integer not null default 0;

alter table public.tasks
  drop constraint if exists tasks_submission_count_check,
  drop constraint if exists tasks_rejection_count_check;

alter table public.tasks
  add constraint tasks_submission_count_check check (submission_count >= 0),
  add constraint tasks_rejection_count_check check (rejection_count >= 0);

comment on column public.tasks.submission_count is
  'Number of times the assignee submitted this task for acceptance.';
comment on column public.tasks.rejection_count is
  'Number of acceptance rejections or post-completion reopenings.';

create or replace function public.capture_task_performance_evidence()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.status = 'in_progress' and new.status = 'in_review' then
    new.submission_count := old.submission_count + 1;
  end if;

  if (old.status = 'in_review' and new.status = 'in_progress')
     or (old.status = 'done' and new.status = 'in_progress') then
    new.rejection_count := old.rejection_count + 1;
  end if;

  return new;
end;
$$;

drop trigger if exists tasks_capture_performance_evidence on public.tasks;
create trigger tasks_capture_performance_evidence
before update of status on public.tasks
for each row execute function public.capture_task_performance_evidence();

revoke execute on function public.capture_task_performance_evidence()
  from public, anon, authenticated;
