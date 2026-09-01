-- Fix the scheduled Agent recovery worker after the live Staging RPC exposed
-- PL/pgSQL record-variable shadowing in the original all-tenant loop.

create or replace function public.run_agent_invocation_recovery()
returns table(lock_acquired boolean, recovered_invocations integer)
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  current_tenant_id bigint;
  recovered_for_tenant bigint;
  total_recovered bigint := 0;
begin
  select pg_try_advisory_xact_lock(20260826, 9) into lock_acquired;
  if not lock_acquired then
    recovered_invocations := 0;
    return next;
    return;
  end if;

  for current_tenant_id in
    select t.id
    from public.tenants as t
    where t.status = 'active'
    order by t.id
  loop
    select count(*) into recovered_for_tenant
    from public.recover_stale_agent_invocations(
      current_tenant_id,
      clock_timestamp() - interval '5 minutes',
      100
    );
    total_recovered := total_recovered + recovered_for_tenant;
  end loop;

  recovered_invocations := least(2147483647::bigint, total_recovered)::integer;
  return next;
end;
$$;

revoke all on function public.run_agent_invocation_recovery() from public, anon, authenticated;
grant execute on function public.run_agent_invocation_recovery() to service_role;

comment on function public.run_agent_invocation_recovery() is
  'Service-only scheduled Agent recovery across active tenants. Uses an unambiguous scalar tenant id and a transaction advisory lock.';
