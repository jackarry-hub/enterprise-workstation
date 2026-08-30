begin;
select no_plan();

select has_trigger(
  'public',
  'audit_logs',
  'audit_logs_append_only',
  'tenant audit log has an append-only trigger'
);
select has_trigger(
  'public',
  'audit_events',
  'audit_events_append_only',
  'legacy business audit event has an append-only trigger'
);

select ok(
  not has_table_privilege('anon', 'public.audit_logs', 'UPDATE,DELETE')
  and not has_table_privilege('authenticated', 'public.audit_logs', 'UPDATE,DELETE')
  and not has_table_privilege('service_role', 'public.audit_logs', 'UPDATE,DELETE'),
  'no application role can update or delete tenant audit logs'
);
select ok(
  not has_table_privilege('anon', 'public.audit_events', 'UPDATE,DELETE')
  and not has_table_privilege('authenticated', 'public.audit_events', 'UPDATE,DELETE')
  and not has_table_privilege('service_role', 'public.audit_events', 'UPDATE,DELETE'),
  'no application role can update or delete legacy audit events'
);

insert into public.audit_events (organization_id, entity_type, action, detail)
select organization.id, 'database_verification', 'audit.immutability_checked', '{"scope":"local-ci"}'::jsonb
from public.organizations organization
join public.tenants tenant on tenant.id = organization.tenant_id
where tenant.slug = 'quantxy-commercial-test'
  and organization.slug = 'quantxy-commercial-test-org';

select throws_ok(
  $$
    update public.audit_events
    set detail = '{"mutated":true}'::jsonb
    where entity_type = 'database_verification'
      and action = 'audit.immutability_checked'
  $$,
  '42501',
  'Audit events are append-only',
  'database owner cannot bypass audit event immutability'
);
select throws_ok(
  $$
    delete from public.audit_events
    where entity_type = 'database_verification'
      and action = 'audit.immutability_checked'
  $$,
  '42501',
  'Audit events are append-only',
  'database owner cannot delete audit events'
);
select throws_ok(
  $$ update public.audit_logs set event_type = event_type where id = (select min(id) from public.audit_logs) $$,
  '42501',
  'Audit logs are append-only',
  'database owner cannot bypass tenant audit log immutability'
);

select * from finish();
rollback;
