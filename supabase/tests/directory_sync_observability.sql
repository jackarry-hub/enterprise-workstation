begin;

select plan(38);

insert into public.tenants (name, slug, status)
values
  ('Directory observability tenant A', 'directory-observed-a', 'active'),
  ('Directory observability tenant B', 'directory-observed-b', 'active');

insert into public.organizations (tenant_id, name, slug)
select tenant.id, 'Directory observability organization', 'directory-observed-org'
from public.tenants tenant
where tenant.slug in ('directory-observed-a', 'directory-observed-b');

insert into public.organizations (tenant_id, name, slug)
select tenant.id, 'Directory observability second organization', 'directory-observed-org-second'
from public.tenants tenant
where tenant.slug = 'directory-observed-a';

insert into public.identity_providers (
  tenant_id, provider_code, auth_provider, provider_tenant_key, display_name, status
)
select tenant.id, 'feishu', 'custom:feishu', tenant.slug || '-provider', 'Feishu', 'active'
from public.tenants tenant
where tenant.slug in ('directory-observed-a', 'directory-observed-b');

insert into public.roles (
  tenant_id, organization_id, code, name, description, is_system, is_enabled
)
select tenant.id, null, 'owner', 'Directory test owner', 'Directory test owner', true, true
from public.tenants tenant
where tenant.slug in ('directory-observed-a', 'directory-observed-b');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('00000000-0000-0000-0000-000000000000', '94000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'directory-owner-a@example.test', crypt('local-e2e-password', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '94000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'directory-employee-a@example.test', crypt('local-e2e-password', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '94000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'directory-owner-b@example.test', crypt('local-e2e-password', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '94000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'directory-owner-a-second@example.test', crypt('local-e2e-password', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.organization_members (tenant_id, organization_id, user_id, status)
select tenant.id, organization.id, seed.user_id, 'active'
from (values
  ('directory-observed-a', '94000000-0000-4000-8000-000000000001'::uuid),
  ('directory-observed-a', '94000000-0000-4000-8000-000000000002'::uuid),
  ('directory-observed-b', '94000000-0000-4000-8000-000000000003'::uuid),
  ('directory-observed-a', '94000000-0000-4000-8000-000000000004'::uuid)
) as seed(tenant_slug, user_id)
join public.tenants tenant on tenant.slug = seed.tenant_slug
join public.organizations organization
  on organization.tenant_id = tenant.id
 and organization.slug = case
   when seed.user_id = '94000000-0000-4000-8000-000000000004'::uuid
     then 'directory-observed-org-second'
   else 'directory-observed-org'
 end;

insert into public.member_roles (tenant_id, member_id, role_id)
select member.tenant_id, member.id, role.id
from public.organization_members member
join public.tenants tenant on tenant.id = member.tenant_id
join public.roles role on role.tenant_id = member.tenant_id and role.code = 'owner'
where member.user_id in (
  '94000000-0000-4000-8000-000000000001'::uuid,
  '94000000-0000-4000-8000-000000000003'::uuid,
  '94000000-0000-4000-8000-000000000004'::uuid
);

select set_config(
  'test.directory_observed_tenant_a',
  (select public_id::text from public.tenants where slug = 'directory-observed-a'),
  true
);
select set_config(
  'test.directory_observed_tenant_b',
  (select public_id::text from public.tenants where slug = 'directory-observed-b'),
  true
);

select has_function(
  'public', 'apply_feishu_directory_sync_observed', array['uuid', 'uuid', 'jsonb', 'uuid']::name[],
  'observed apply RPC has the service-only request-correlated signature'
);
select has_function(
  'public', 'record_feishu_directory_sync_failure', array['uuid', 'uuid', 'text', 'uuid']::name[],
  'failure recorder RPC has the service-only request-correlated signature'
);
select ok(
  has_function_privilege('service_role', 'public.apply_feishu_directory_sync_observed(uuid, uuid, jsonb, uuid)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.apply_feishu_directory_sync(uuid, uuid, jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.apply_feishu_directory_sync_observed(uuid, uuid, jsonb, uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.apply_feishu_directory_sync_observed(uuid, uuid, jsonb, uuid)', 'EXECUTE'),
  'only service role executes the observed apply RPC'
);
select ok(
  has_function_privilege('service_role', 'public.record_feishu_directory_sync_failure(uuid, uuid, text, uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.record_feishu_directory_sync_failure(uuid, uuid, text, uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.record_feishu_directory_sync_failure(uuid, uuid, text, uuid)', 'EXECUTE'),
  'only service role executes the failure recorder RPC'
);
select is(
  (select array_to_string(proconfig, ',')
   from pg_proc
   where oid = 'public.apply_feishu_directory_sync_observed(uuid, uuid, jsonb, uuid)'::regprocedure),
  'search_path=""',
  'observed apply RPC has an empty search path'
);
select is(
  (select array_to_string(proconfig, ',')
   from pg_proc
   where oid = 'public.record_feishu_directory_sync_failure(uuid, uuid, text, uuid)'::regprocedure),
  'search_path=""',
  'failure recorder RPC has an empty search path'
);
select ok(
  not has_table_privilege('authenticated', 'public.directory_sync_runs', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
  and not has_table_privilege('authenticated', 'public.directory_sync_issues', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
  and not has_table_privilege('service_role', 'public.directory_connections', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
  and not has_table_privilege('service_role', 'public.directory_sync_runs', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
  and not has_table_privilege('service_role', 'public.directory_sync_issues', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'),
  'browser and service roles cannot manufacture durable directory run evidence directly'
);

set local role service_role;
select set_config(
  'test.directory_observed_success',
  public.apply_feishu_directory_sync_observed(
    current_setting('test.directory_observed_tenant_a')::uuid,
    '94000000-0000-4000-8000-000000000001'::uuid,
    '{"complete":true,"departments":[{"externalId":"od-preserve","departmentId":"preserve","parentExternalId":null,"name":"Preserved department","leaderOpenId":null}],"positions":[],"employees":[]}'::jsonb,
    '95000000-0000-4000-8000-000000000001'::uuid
  )::text,
  true
);
select is(
  current_setting('test.directory_observed_success')::jsonb ->> 'status', 'completed',
  'observed apply returns the completed status from the unique committed run'
);
select is(
  (current_setting('test.directory_observed_success')::jsonb ->> 'departmentCount')::integer, 1,
  'observed apply returns the exact department count'
);
select is(
  (current_setting('test.directory_observed_success')::jsonb ->> 'employeeCount')::integer, 0,
  'observed apply returns the exact employee count'
);
select is(
  (current_setting('test.directory_observed_success')::jsonb ->> 'issueCount')::integer, 0,
  'observed apply returns the exact issue count'
);
select is(
  (
    select request_id
    from public.directory_sync_runs
    where tenant_id = (select id from public.tenants where slug = 'directory-observed-a')
      and public_id = (current_setting('test.directory_observed_success')::jsonb ->> 'runId')::uuid
  ),
  '95000000-0000-4000-8000-000000000001'::uuid,
  'observed apply binds the API request ID to the committed run'
);
select is(
  (
    select count(*)
    from public.directory_sync_runs
    where tenant_id = (select id from public.tenants where slug = 'directory-observed-a')
      and request_id = '95000000-0000-4000-8000-000000000001'::uuid
  ),
  1::bigint,
  'one tenant request ID initially creates exactly one run'
);
select is(
  public.apply_feishu_directory_sync_observed(
    current_setting('test.directory_observed_tenant_a')::uuid,
    '94000000-0000-4000-8000-000000000001'::uuid,
    '{"complete":true,"departments":[{"externalId":"od-preserve","departmentId":"preserve","parentExternalId":null,"name":"Preserved department","leaderOpenId":null}],"positions":[],"employees":[]}'::jsonb,
    '95000000-0000-4000-8000-000000000001'::uuid
  ) ->> 'runId',
  current_setting('test.directory_observed_success')::jsonb ->> 'runId',
  'repeating an observed request returns its original run rather than applying again'
);
select is(
  (
    select count(*)
    from public.directory_sync_runs
    where tenant_id = (select id from public.tenants where slug = 'directory-observed-a')
      and request_id = '95000000-0000-4000-8000-000000000001'::uuid
  ),
  1::bigint,
  'repeat success request ID does not create a second run'
);
select set_config(
  'test.directory_observed_marker',
  (
    select last_sync_at::text
    from public.directory_connections
    where tenant_id = (select id from public.tenants where slug = 'directory-observed-a')
  ),
  true
);
select set_config(
  'test.directory_observed_entity_marker',
  (
    select jsonb_build_object(
      'count', count(*),
      'lastSeenAt', max(link.last_seen_at)
    )::text
    from public.directory_entity_links link
    where link.tenant_id = (select id from public.tenants where slug = 'directory-observed-a')
  ),
  true
);

select throws_ok(
  $$ select public.apply_feishu_directory_sync_observed(
    current_setting('test.directory_observed_tenant_a')::uuid,
    '94000000-0000-4000-8000-000000000001'::uuid,
    '{"complete":false,"departments":[],"positions":[],"employees":[]}'::jsonb,
    '95000000-0000-4000-8000-000000000002'::uuid
  ) $$,
  '22023',
  'invalid snapshot rolls back instead of creating a partial completed run'
);
select is(
  (
    select count(*)
    from public.directory_sync_runs
    where tenant_id = (select id from public.tenants where slug = 'directory-observed-a')
      and request_id = '95000000-0000-4000-8000-000000000002'::uuid
  ),
  0::bigint,
  'an apply transaction failure leaves no request-correlated partial run'
);

select set_config(
  'test.directory_observed_failure',
  public.record_feishu_directory_sync_failure(
    current_setting('test.directory_observed_tenant_a')::uuid,
    '94000000-0000-4000-8000-000000000001'::uuid,
    'directory_pagination_limit',
    '95000000-0000-4000-8000-000000000003'::uuid
  )::text,
  true
);
select is(
  current_setting('test.directory_observed_failure')::jsonb ->> 'status', 'failed',
  'failure recorder returns the durable failed run'
);
select is(
  (current_setting('test.directory_observed_failure')::jsonb ->> 'departmentCount')::integer
    || ':' || (current_setting('test.directory_observed_failure')::jsonb ->> 'employeeCount')::integer
    || ':' || (current_setting('test.directory_observed_failure')::jsonb ->> 'issueCount')::integer,
  '0:0:1',
  'failure recorder returns the strict zero-count plus one issue result'
);
select is(
  (
    select request_id
    from public.directory_sync_runs
    where tenant_id = (select id from public.tenants where slug = 'directory-observed-a')
      and public_id = (current_setting('test.directory_observed_failure')::jsonb ->> 'runId')::uuid
  ),
  '95000000-0000-4000-8000-000000000003'::uuid,
  'failure recorder binds the same request ID to its failed run'
);
select is(
  (
    select code
    from public.directory_sync_issues issue
    join public.directory_sync_runs run
      on run.tenant_id = issue.tenant_id and run.id = issue.sync_run_id
    where run.public_id = (current_setting('test.directory_observed_failure')::jsonb ->> 'runId')::uuid
  ),
  'DIRECTORY_PAGINATION_LIMIT',
  'failure recorder persists only the allowlisted failure code'
);
select is(
  (
    select message
    from public.directory_sync_issues issue
    join public.directory_sync_runs run
      on run.tenant_id = issue.tenant_id and run.id = issue.sync_run_id
    where run.public_id = (current_setting('test.directory_observed_failure')::jsonb ->> 'runId')::uuid
  ),
  'Directory synchronization failed; retry with the request ID.',
  'failure recorder never stores a provider or database error message'
);
select is(
  (
    select request_id
    from public.audit_logs
    where action = 'directory.sync_failed'
      and tenant_id = (select id from public.tenants where slug = 'directory-observed-a')
  ),
  '95000000-0000-4000-8000-000000000003'::uuid,
  'failure audit retains the safe request correlation ID'
);
select is(
  (
    select last_sync_at::text
    from public.directory_connections
    where tenant_id = (select id from public.tenants where slug = 'directory-observed-a')
  ),
  current_setting('test.directory_observed_marker'),
  'failure recording never moves the last successful sync marker'
);
select is(
  (
    select jsonb_build_object(
      'count', count(*),
      'lastSeenAt', max(link.last_seen_at)
    )::text
    from public.directory_entity_links link
    where link.tenant_id = (select id from public.tenants where slug = 'directory-observed-a')
  ),
  current_setting('test.directory_observed_entity_marker'),
  'failure recording never mutates the prior complete snapshot entity links'
);
select is(
  public.record_feishu_directory_sync_failure(
    current_setting('test.directory_observed_tenant_a')::uuid,
    '94000000-0000-4000-8000-000000000001'::uuid,
    'directory_pagination_limit',
    '95000000-0000-4000-8000-000000000003'::uuid
  ) ->> 'runId',
  current_setting('test.directory_observed_failure')::jsonb ->> 'runId',
  'repeating a failure request returns its original failed run'
);
select is(
  (
    select count(*)
    from public.directory_sync_runs
    where tenant_id = (select id from public.tenants where slug = 'directory-observed-a')
      and request_id = '95000000-0000-4000-8000-000000000003'::uuid
  ),
  1::bigint,
  'repeat failure request ID does not create a second failed run'
);

select throws_ok(
  $$ select public.record_feishu_directory_sync_failure(
    current_setting('test.directory_observed_tenant_b')::uuid,
    '94000000-0000-4000-8000-000000000001'::uuid,
    'directory_provider_unavailable',
    '95000000-0000-4000-8000-000000000004'::uuid
  ) $$,
  '42501',
  'an actor cannot record a failure in another tenant'
);
select is(
  (
    select count(*)
    from public.directory_sync_runs
    where tenant_id = (select id from public.tenants where slug = 'directory-observed-b')
      and request_id = '95000000-0000-4000-8000-000000000004'::uuid
  ),
  0::bigint,
  'cross-tenant failure attempt creates no run'
);
select throws_ok(
  $$ select public.record_feishu_directory_sync_failure(
    current_setting('test.directory_observed_tenant_a')::uuid,
    '94000000-0000-4000-8000-000000000002'::uuid,
    'directory_provider_unavailable',
    '95000000-0000-4000-8000-000000000005'::uuid
  ) $$,
  '42501',
  'an active employee without directory authority cannot record a failure'
);
select is(
  (
    select count(*)
    from public.directory_sync_runs
    where tenant_id = (select id from public.tenants where slug = 'directory-observed-a')
      and request_id = '95000000-0000-4000-8000-000000000005'::uuid
  ),
  0::bigint,
  'unauthorized actor creates no failure run'
);

select set_config(
  'test.directory_observed_first_connection',
  (
    select jsonb_build_object(
      'id', connection.id,
      'status', connection.status,
      'lastSyncAt', connection.last_sync_at
    )::text
    from public.directory_connections connection
    join public.organizations organization
      on organization.tenant_id = connection.tenant_id
     and organization.id = connection.organization_id
    where connection.tenant_id = (select id from public.tenants where slug = 'directory-observed-a')
      and organization.slug = 'directory-observed-org'
  ),
  true
);
select set_config(
  'test.directory_observed_second_success',
  public.apply_feishu_directory_sync_observed(
    current_setting('test.directory_observed_tenant_a')::uuid,
    '94000000-0000-4000-8000-000000000004'::uuid,
    '{"complete":true,"departments":[{"externalId":"od-second","departmentId":"second","parentExternalId":null,"name":"Second organization department","leaderOpenId":null}],"positions":[],"employees":[]}'::jsonb,
    '95000000-0000-4000-8000-000000000006'::uuid
  )::text,
  true
);
select is(
  current_setting('test.directory_observed_second_success')::jsonb ->> 'status', 'completed',
  'a non-first organization owner can complete a directory sync'
);
select is(
  (
    select organization.slug
    from public.directory_sync_runs run
    join public.organizations organization
      on organization.tenant_id = run.tenant_id
     and organization.id = run.organization_id
    where run.public_id = (current_setting('test.directory_observed_second_success')::jsonb ->> 'runId')::uuid
  ),
  'directory-observed-org-second',
  'the completed run is bound to the actor organization rather than the first organization'
);
select is(
  (
    select count(*)::text || ':' || count(distinct connection.organization_id)::text
    from public.directory_connections connection
    where connection.tenant_id = (select id from public.tenants where slug = 'directory-observed-a')
  ),
  '2:2',
  'each organization has a distinct provider connection namespace'
);
select is(
  (
    select jsonb_build_object(
      'id', connection.id,
      'status', connection.status,
      'lastSyncAt', connection.last_sync_at
    )::text
    from public.directory_connections connection
    join public.organizations organization
      on organization.tenant_id = connection.tenant_id
     and organization.id = connection.organization_id
    where connection.tenant_id = (select id from public.tenants where slug = 'directory-observed-a')
      and organization.slug = 'directory-observed-org'
  ),
  current_setting('test.directory_observed_first_connection'),
  'a second organization success does not mutate the first organization connection'
);
select set_config(
  'test.directory_observed_second_failure',
  public.record_feishu_directory_sync_failure(
    current_setting('test.directory_observed_tenant_a')::uuid,
    '94000000-0000-4000-8000-000000000004'::uuid,
    'directory_provider_unavailable',
    '95000000-0000-4000-8000-000000000007'::uuid
  )::text,
  true
);
select is(
  current_setting('test.directory_observed_second_failure')::jsonb ->> 'status', 'failed',
  'a non-first organization owner can persist a failed directory sync'
);
select ok(
  exists (
    select 1
    from public.directory_sync_runs run
    join public.directory_connections connection
      on connection.tenant_id = run.tenant_id
     and connection.id = run.connection_id
    join public.organizations organization
      on organization.tenant_id = run.tenant_id
     and organization.id = run.organization_id
    where run.public_id = (current_setting('test.directory_observed_second_failure')::jsonb ->> 'runId')::uuid
      and organization.slug = 'directory-observed-org-second'
      and connection.organization_id = run.organization_id
  ),
  'the failed run and its connection stay inside the actor organization'
);
select is(
  (
    select jsonb_build_object(
      'id', connection.id,
      'status', connection.status,
      'lastSyncAt', connection.last_sync_at
    )::text
    from public.directory_connections connection
    join public.organizations organization
      on organization.tenant_id = connection.tenant_id
     and organization.id = connection.organization_id
    where connection.tenant_id = (select id from public.tenants where slug = 'directory-observed-a')
      and organization.slug = 'directory-observed-org'
  ),
  current_setting('test.directory_observed_first_connection'),
  'a second organization failure does not mutate the first organization connection'
);
reset role;

select * from finish();

rollback;
