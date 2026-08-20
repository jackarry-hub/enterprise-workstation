alter table public.tasks
  add column if not exists accepted_at timestamptz;

comment on column public.tasks.accepted_at is
  'Timestamp recorded when the assigned employee accepts a pending task.';
