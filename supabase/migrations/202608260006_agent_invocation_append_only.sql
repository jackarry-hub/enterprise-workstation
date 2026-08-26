-- Finalize Agent definitions as publishable server configuration and preserve
-- invocation history as an immutable, service-owned ledger.

create or replace function public.is_valid_agent_tool_scope(value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(value) = 'object'
    and jsonb_typeof(value -> 'tools') = 'array'
    and jsonb_array_length(value -> 'tools') <= 30
    and not exists (
      select 1
      from jsonb_array_elements(value -> 'tools') item
      where jsonb_typeof(item) <> 'string'
         or btrim(item #>> '{}') = ''
         or length(item #>> '{}') > 80
    )
    and (
      select count(*) = count(distinct item #>> '{}')
      from jsonb_array_elements(value -> 'tools') item
    );
$$;

update public.agent_definitions
set status = 'disabled', updated_at = now()
where status = 'enabled'
  and not (
    model_code in ('deepseek-v4-flash', 'deepseek-chat', 'deepseek-reasoner')
    and btrim(system_prompt) <> ''
    and public.is_valid_agent_tool_scope(tool_scope)
  );

alter table public.agent_definitions
  drop constraint if exists agent_definitions_enabled_execution_ready,
  add constraint agent_definitions_enabled_execution_ready check (
    status <> 'enabled' or (
      model_code in ('deepseek-v4-flash', 'deepseek-chat', 'deepseek-reasoner')
      and btrim(system_prompt) <> ''
      and public.is_valid_agent_tool_scope(tool_scope)
    )
  );

update public.agent_invocations
set completed_at = started_at + (coalesce(latency_ms, 0) * interval '1 millisecond')
where status in ('succeeded', 'failed') and completed_at is null;

update public.agent_invocations
set completed_at = null
where status in ('queued', 'running') and completed_at is not null;

alter table public.agent_invocations
  drop constraint if exists agent_invocations_terminal_completion_check,
  add constraint agent_invocations_terminal_completion_check check (
    (status in ('succeeded', 'failed') and completed_at is not null and completed_at >= started_at)
    or (status in ('queued', 'running') and completed_at is null)
  );

revoke select on table public.agent_definitions from authenticated;
grant select (id, public_id, tenant_id, organization_id, code, name, description, department_id, icon, model_code, prompt_version, capabilities, input_schema, tool_scope, visibility_scope, min_job_level, status, created_at, updated_at, deleted_at) on table public.agent_definitions to authenticated;
revoke insert, update, delete, truncate on table public.agent_definitions, public.agent_permissions from authenticated;

revoke all on table public.agent_invocations, public.agent_execution_logs from service_role;
grant select, insert on table public.agent_invocations, public.agent_execution_logs to service_role;
revoke all on sequence public.agent_invocations_id_seq, public.agent_execution_logs_id_seq from service_role;
grant usage, select on sequence public.agent_invocations_id_seq, public.agent_execution_logs_id_seq to service_role;

create or replace function public.reject_agent_ledger_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Agent execution ledger is append-only' using errcode = '42501';
end;
$$;

drop trigger if exists agent_invocations_append_only on public.agent_invocations;
create trigger agent_invocations_append_only
before update or delete on public.agent_invocations
for each row execute function public.reject_agent_ledger_mutation();

drop trigger if exists agent_execution_logs_append_only on public.agent_execution_logs;
create trigger agent_execution_logs_append_only
before update or delete on public.agent_execution_logs
for each row execute function public.reject_agent_ledger_mutation();

comment on constraint agent_invocations_terminal_completion_check on public.agent_invocations is
  'terminal rows require completed_at; queued/running rows keep completed_at null';
