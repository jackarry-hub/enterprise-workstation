alter table public.ai_provider_configs force row level security;
alter table public.audit_events force row level security;
alter table public.decision_commands force row level security;
alter table public.department_work_orders force row level security;
alter table public.leave_requests force row level security;
alter table public.objectives force row level security;
alter table public.payroll_runs force row level security;
alter table public.permissions force row level security;
alter table public.support_requests force row level security;

create or replace function public.reject_audit_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Audit events are append-only' using errcode = '42501';
end;
$$;

create trigger audit_events_append_only
before update or delete on public.audit_events
for each row execute function public.reject_audit_event_mutation();

revoke update, delete on table public.audit_events from public, anon, authenticated, service_role;
revoke execute on function public.reject_audit_event_mutation() from public, anon, authenticated, service_role;
