-- Agent execution is a service-owned append ledger. Browser roles may read under
-- the original RLS policies, but cannot fabricate or mutate execution history.

alter table public.agent_definitions
  add column if not exists system_prompt text not null default '';

drop policy if exists agent_invocations_member_insert on public.agent_invocations;
drop policy if exists agent_invocations_system_update on public.agent_invocations;
drop policy if exists agent_execution_logs_member_insert on public.agent_execution_logs;

revoke insert, update, delete on table public.agent_invocations from authenticated;
revoke insert, update, delete on table public.agent_execution_logs from authenticated;
revoke usage, select on sequence public.agent_invocations_id_seq, public.agent_execution_logs_id_seq from authenticated;

grant insert on table public.agent_invocations, public.agent_execution_logs to service_role;
grant usage, select on sequence public.agent_invocations_id_seq, public.agent_execution_logs_id_seq to service_role;

comment on column public.agent_definitions.system_prompt is
  'Server-only execution prompt. Empty prompts are not callable.';
