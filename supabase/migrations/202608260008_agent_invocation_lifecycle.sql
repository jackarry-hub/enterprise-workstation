-- Agent calls are durable two-phase executions: a server-authorized running
-- header precedes provider work, then only a narrowly scoped RPC may finalize it.

alter table public.agent_invocations
  add column if not exists tool_scope jsonb not null default '{"tools":[]}'::jsonb,
  drop constraint if exists agent_invocations_tool_scope_check,
  add constraint agent_invocations_tool_scope_check check (
    jsonb_typeof(tool_scope) = 'object'
    and jsonb_typeof(tool_scope -> 'tools') = 'array'
  );

create or replace function public.validate_agent_invocation_header()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  definition record;
begin
  if new.status not in ('queued', 'running') or new.completed_at is not null then
    raise exception 'Agent invocation headers must begin queued or running without completion' using errcode = '23514';
  end if;

  select model_code, prompt_version, tool_scope
  into definition
  from public.agent_definitions
  where id = new.agent_id
    and tenant_id = new.tenant_id
    and organization_id = new.organization_id
    and status = 'enabled'
    and deleted_at is null;

  if not found
     or new.model_code is distinct from definition.model_code
     or new.prompt_version is distinct from definition.prompt_version
     or new.tool_scope is distinct from definition.tool_scope then
    raise exception 'Agent invocation header does not match the enabled server definition' using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.organization_members member
    where member.id = new.actor_member_id
      and member.tenant_id = new.tenant_id
      and member.organization_id = new.organization_id
      and member.status = 'active'
  ) then
    raise exception 'Agent invocation header actor is outside the authorized tenant and organization' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.record_agent_invocation_started_event()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
begin
  insert into public.agent_execution_logs (
    tenant_id, organization_id, invocation_id, event_type, message, metadata
  ) values (
    new.tenant_id, new.organization_id, new.id, 'invocation.started',
    'Agent invocation header persisted before provider execution',
    jsonb_build_object('status', new.status, 'model', new.model_code, 'prompt_version', new.prompt_version)
  );
  return new;
end;
$$;

drop trigger if exists agent_invocations_validate_header on public.agent_invocations;
create trigger agent_invocations_validate_header
before insert on public.agent_invocations
for each row execute function public.validate_agent_invocation_header();

drop trigger if exists agent_invocations_started_event on public.agent_invocations;
create trigger agent_invocations_started_event
after insert on public.agent_invocations
for each row execute function public.record_agent_invocation_started_event();

create or replace function public.reject_agent_ledger_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'agent_invocations' then
    if tg_op = 'UPDATE'
       and current_setting('app.agent_invocation_transition_id', true) = old.public_id::text then
      return new;
    end if;
  end if;
  raise exception 'Agent execution ledger is append-only' using errcode = '42501';
end;
$$;

create or replace function public.finalize_agent_invocation(
  p_tenant_id bigint,
  p_organization_id bigint,
  p_invocation_public_id uuid,
  p_status text,
  p_output_summary text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_latency_ms integer,
  p_error_code text,
  p_completed_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  invocation public.agent_invocations%rowtype;
begin
  if p_tenant_id is null or p_organization_id is null
     or p_status not in ('succeeded', 'failed')
     or p_completed_at is null
     or coalesce(p_input_tokens, -1) < 0
     or coalesce(p_output_tokens, -1) < 0
     or coalesce(p_latency_ms, -1) < 0 then
    raise exception 'Invalid Agent invocation finalization payload' using errcode = '22023';
  end if;

  select * into invocation
  from public.agent_invocations
  where public_id = p_invocation_public_id
    and tenant_id = p_tenant_id
    and organization_id = p_organization_id
  for update;
  if not found then
    raise exception 'Agent invocation is not in the requested tenant and organization' using errcode = 'P0002';
  end if;
  if invocation.status in ('succeeded', 'failed') then
    return false;
  end if;
  if invocation.status not in ('queued', 'running') or p_completed_at < invocation.started_at then
    raise exception 'Illegal Agent invocation lifecycle transition' using errcode = '23514';
  end if;

  perform set_config('app.agent_invocation_transition_id', invocation.public_id::text, true);
  update public.agent_invocations
  set status = p_status,
      output_summary = coalesce(p_output_summary, ''),
      input_tokens = p_input_tokens,
      output_tokens = p_output_tokens,
      latency_ms = p_latency_ms,
      error_code = coalesce(p_error_code, ''),
      completed_at = p_completed_at
  where id = invocation.id
    and tenant_id = p_tenant_id
    and organization_id = p_organization_id;
  perform set_config('app.agent_invocation_transition_id', '', true);

  insert into public.agent_execution_logs (
    tenant_id, organization_id, invocation_id, event_type, message, metadata
  ) values (
    p_tenant_id, p_organization_id, invocation.id, 'invocation.finalized',
    'Agent invocation reached a terminal lifecycle state',
    jsonb_build_object('status', p_status, 'error_code', coalesce(p_error_code, ''), 'latency_ms', p_latency_ms)
  );
  return true;
end;
$$;

create or replace function public.recover_stale_agent_invocations(
  p_tenant_id bigint,
  p_cutoff timestamptz,
  p_limit integer default 100
)
returns table(invocation_public_id uuid)
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  invocation public.agent_invocations%rowtype;
  completed_at_value timestamptz := clock_timestamp();
  recovered_latency integer;
begin
  if p_tenant_id is null or p_cutoff is null or p_limit not between 1 and 100
     or p_cutoff > clock_timestamp() - interval '5 minutes' then
    raise exception 'Invalid Agent invocation recovery payload' using errcode = '22023';
  end if;

  for invocation in
    select *
    from public.agent_invocations candidate
    where candidate.tenant_id = p_tenant_id
      and candidate.status in ('queued', 'running')
      and candidate.started_at < p_cutoff
    order by candidate.started_at
    limit p_limit
    for update skip locked
  loop
    recovered_latency := least(
      2147483647,
      greatest(
        coalesce(invocation.latency_ms, 0),
        floor(extract(epoch from (completed_at_value - invocation.started_at)) * 1000)::integer
      )
    )::integer;
    perform set_config('app.agent_invocation_transition_id', invocation.public_id::text, true);
    update public.agent_invocations
    set status = 'failed',
        output_summary = '',
        input_tokens = 0,
        output_tokens = 0,
        latency_ms = recovered_latency,
        error_code = 'recovery_timeout',
        completed_at = completed_at_value
    where id = invocation.id
      and tenant_id = p_tenant_id
      and status in ('queued', 'running');
    perform set_config('app.agent_invocation_transition_id', '', true);

    insert into public.agent_execution_logs (
      tenant_id, organization_id, invocation_id, event_type, message, metadata
    ) values (
      invocation.tenant_id, invocation.organization_id, invocation.id, 'invocation.recovered_timeout',
      'Stale Agent invocation reconciled as a timeout',
      jsonb_build_object('cutoff', p_cutoff, 'latency_ms', recovered_latency)
    );
    invocation_public_id := invocation.public_id;
    return next;
  end loop;
end;
$$;

revoke all on function public.finalize_agent_invocation(bigint, bigint, uuid, text, text, integer, integer, integer, text, timestamptz) from public, anon, authenticated;
grant execute on function public.finalize_agent_invocation(bigint, bigint, uuid, text, text, integer, integer, integer, text, timestamptz) to service_role;
revoke all on function public.recover_stale_agent_invocations(bigint, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.recover_stale_agent_invocations(bigint, timestamptz, integer) to service_role;

comment on function public.finalize_agent_invocation(bigint, bigint, uuid, text, text, integer, integer, integer, text, timestamptz) is
  'Service-only, locked, one-way Agent lifecycle transition. False means already terminal.';
