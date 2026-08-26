-- Finalize Agent definitions as publishable server configuration and preserve
-- invocation history as an immutable, service-owned ledger.

create or replace function public.is_agent_execution_ready(
  model_code text,
  prompt_version text,
  system_prompt text,
  tool_scope jsonb
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  item jsonb;
  tool_code text;
  seen_codes text[] := '{}';
begin
  if model_code is null
     or model_code not in ('deepseek-v4-flash', 'deepseek-chat', 'deepseek-reasoner')
     or prompt_version is null
     or btrim(prompt_version) is distinct from prompt_version
     or char_length(prompt_version) not between 1 and 40
     or system_prompt is null
     or btrim(system_prompt) is distinct from system_prompt
     or char_length(system_prompt) not between 1 and 12000
     or tool_scope is null
     or jsonb_typeof(tool_scope) is distinct from 'object'
     or jsonb_typeof(tool_scope -> 'tools') is distinct from 'array'
     or jsonb_array_length(tool_scope -> 'tools') > 30 then
    return false;
  end if;

  for item in select value from jsonb_array_elements(tool_scope -> 'tools') loop
    if jsonb_typeof(item) is distinct from 'string' then
      return false;
    end if;
    tool_code := item #>> '{}';
    if btrim(tool_code) is distinct from tool_code
       or char_length(tool_code) not between 1 and 80
       or tool_code = any(seen_codes) then
      return false;
    end if;
    seen_codes := array_append(seen_codes, tool_code);
  end loop;

  return true;
exception when others then
  return false;
end;
$$;

update public.agent_definitions
set status = 'disabled', updated_at = now()
where status = 'enabled'
  and not public.is_agent_execution_ready(model_code, prompt_version, system_prompt, tool_scope);

alter table public.agent_definitions
  drop constraint if exists agent_definitions_enabled_execution_ready,
  add constraint agent_definitions_enabled_execution_ready check (
    status <> 'enabled'
    or public.is_agent_execution_ready(model_code, prompt_version, system_prompt, tool_scope)
  );

create or replace function public.backfill_agent_invocation_timestamps()
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.agent_invocations
  set completed_at = created_at,
      started_at = created_at - (coalesce(latency_ms, 0) * interval '1 millisecond')
  where status in ('succeeded', 'failed') and completed_at is null;

  update public.agent_invocations
  set completed_at = null
  where status in ('queued', 'running') and completed_at is not null;
end;
$$;

select public.backfill_agent_invocation_timestamps();
revoke all on function public.backfill_agent_invocation_timestamps() from public, authenticated, service_role;

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
