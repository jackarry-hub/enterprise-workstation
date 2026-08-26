-- Recovery remains a server-owned lifecycle transition. This revision makes
-- its input bounds total and exposes a service-only all-tenant cron entrypoint.

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
  if p_tenant_id is null
     or p_cutoff is null
     or p_limit is null
     or p_limit not between 1 and 100
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
    recovered_latency := least(2147483647::bigint, greatest(
      coalesce(invocation.latency_ms, 0)::bigint,
      floor(extract(epoch from (completed_at_value - invocation.started_at)) * 1000)::bigint
    ))::integer;
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

create or replace function public.run_agent_invocation_recovery()
returns table(lock_acquired boolean, recovered_invocations integer)
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  tenant record;
  recovered_for_tenant bigint;
  total_recovered bigint := 0;
begin
  select pg_try_advisory_xact_lock(20260826, 9) into lock_acquired;
  if not lock_acquired then
    recovered_invocations := 0;
    return next;
    return;
  end if;

  for tenant in
    select tenant.id
    from public.tenants tenant
    where tenant.status = 'active'
    order by tenant.id
  loop
    select count(*) into recovered_for_tenant
    from public.recover_stale_agent_invocations(tenant.id, clock_timestamp() - interval '5 minutes', 100);
    total_recovered := total_recovered + recovered_for_tenant;
  end loop;

  recovered_invocations := least(2147483647::bigint, total_recovered)::integer;
  return next;
end;
$$;

revoke all on function public.recover_stale_agent_invocations(bigint, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.recover_stale_agent_invocations(bigint, timestamptz, integer) to service_role;
revoke all on function public.run_agent_invocation_recovery() from public, anon, authenticated;
grant execute on function public.run_agent_invocation_recovery() to service_role;

comment on function public.run_agent_invocation_recovery() is
  'Service-only scheduled Agent recovery across active tenants. A transaction advisory lock makes overlapping executions a safe no-op.';
