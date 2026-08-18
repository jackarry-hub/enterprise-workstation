alter table public.tasks
  add column if not exists next_step text not null default '',
  add column if not exists result_summary text not null default '',
  add column if not exists result_link text not null default '',
  add column if not exists result_files jsonb not null default '[]'::jsonb,
  add column if not exists submitted_at timestamptz,
  add column if not exists reviewed_at timestamptz;

alter table public.tasks
  drop constraint if exists tasks_result_files_array_check;
alter table public.tasks
  add constraint tasks_result_files_array_check
  check (jsonb_typeof(result_files) = 'array');

comment on column public.tasks.next_step is 'Employee-entered next execution step.';
comment on column public.tasks.result_summary is 'Acceptance submission summary.';
comment on column public.tasks.result_link is 'Optional acceptance result URL.';
comment on column public.tasks.result_files is 'Display names of acceptance attachments.';
