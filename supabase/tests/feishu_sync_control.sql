begin;

select plan(123);

select has_table('public', 'feishu_oauth_attempts', 'OAuth attempts are durable');
select has_table('public', 'feishu_webhook_events', 'provider events are durable');
select has_table('public', 'feishu_entity_sequences', 'per-entity sequences are durable');
select has_table('public', 'feishu_sync_conflicts', 'reconciliation conflicts are durable');
select has_table('public', 'feishu_sync_leases', 'worker leases are durable');
select has_table('public', 'feishu_access_grants', 'queued access grants are durable');
select has_table('public', 'feishu_offboarding_commands', 'offboarding command results are durable and retry-safe');
select has_view('public', 'current_feishu_sync_issues', 'manager issue view exists');

select has_function('public', 'create_feishu_oauth_attempt', array['uuid','text','text','timestamp with time zone']::name[], 'OAuth creation RPC exists');
select has_function('public', 'consume_feishu_oauth_attempt', array['uuid','text']::name[], 'OAuth consumption RPC exists');
select has_function('public', 'ingest_feishu_webhook_event', array['text','text','text','text','text','text','bigint','text']::name[], 'event ingestion RPC exists');
select has_function('public', 'revoke_departed_member_access', array['uuid','text']::name[], 'transactional offboarding RPC exists');
select has_function('public', 'claim_feishu_sync_work', array['text','text','text','integer','uuid','uuid']::name[], 'exact-organization lease claim RPC exists');
select has_function('public', 'heartbeat_feishu_sync_work', array['uuid','uuid','integer']::name[], 'exact lease heartbeat RPC exists');
select has_function('public', 'apply_feishu_directory_sync_fenced', array['uuid','uuid','uuid','jsonb']::name[], 'fenced directory apply RPC exists');
select has_function('public', 'finish_feishu_sync_work', array['uuid','text','text','timestamp with time zone','uuid']::name[], 'exact-organization lease completion RPC exists');
select has_function('public', 'resolve_feishu_sync_issue', array['uuid','uuid','uuid']::name[], 'audited issue resolution RPC exists');
select has_function('public', 'next_feishu_sync_cursor', array['text']::name[], 'scheduled work reads a tenant-bound durable event cursor');
select has_function('public', 'current_active_workspace_organization_id', array[]::name[], 'active workspace organization RPC exists');
select has_function('public', 'apply_feishu_directory_sync_exact', array['uuid','uuid','uuid','uuid','jsonb']::name[], 'exact apply uses the claimed run signature');
select has_function('public', 'get_feishu_offboarding_proof', array['text']::name[], 'service-only complete offboarding proof RPC exists');
select has_function('public', 'get_feishu_member_access_proof', array['uuid']::name[], 'service-only exact member access proof RPC exists');
select col_is_unique('public', 'feishu_offboarding_commands', array['offboarding_event_id'], 'offboarding idempotency is event-only');
select has_column('public', 'feishu_offboarding_commands', 'sessions_revoked', 'offboarding records session revocation evidence');
select has_column('public', 'feishu_offboarding_commands', 'refresh_tokens_revoked', 'offboarding records refresh-token revocation evidence');
select has_column('public', 'feishu_offboarding_commands', 'queued_grants_cancelled', 'offboarding records queued-grant revocation evidence');
select is(
  (select count(*) from pg_policies where schemaname = 'public' and policyname in (
    'directory_connections_admin_select', 'directory_entity_links_admin_select',
    'directory_sync_runs_admin_select', 'directory_sync_issues_admin_select'
  )),
  0::bigint,
  'all legacy permissive directory SELECT policies are removed'
);

select ok(
  has_function_privilege('service_role', 'public.create_feishu_oauth_attempt(uuid,text,text,timestamptz)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.consume_feishu_oauth_attempt(uuid,text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.ingest_feishu_webhook_event(text,text,text,text,text,text,bigint,text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.revoke_departed_member_access(uuid,text)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.apply_feishu_directory_sync_exact(uuid,uuid,uuid,uuid,jsonb)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.apply_feishu_directory_sync_fenced(uuid,uuid,uuid,jsonb)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.get_feishu_member_access_proof(uuid)', 'EXECUTE'),
  'service role can execute fenced controls but cannot bypass the lease through exact apply'
);
select ok(
  not has_function_privilege('authenticated', 'public.create_feishu_oauth_attempt(uuid,text,text,timestamptz)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.consume_feishu_oauth_attempt(uuid,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.ingest_feishu_webhook_event(text,text,text,text,text,text,bigint,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.revoke_departed_member_access(uuid,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.get_feishu_member_access_proof(uuid)', 'EXECUTE'),
  'browser roles cannot execute protected controls'
);
select ok(
  not has_table_privilege('service_role', 'public.feishu_oauth_attempts', 'INSERT,UPDATE,DELETE')
  and not has_table_privilege('service_role', 'public.feishu_webhook_events', 'INSERT,UPDATE,DELETE')
  and not has_table_privilege('service_role', 'public.feishu_offboarding_commands', 'SELECT,INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated', 'public.feishu_sync_leases', 'SELECT,INSERT,UPDATE,DELETE'),
  'callers cannot bypass control RPCs with table writes'
);
select ok(
  (select relforcerowsecurity from pg_class where oid = 'public.feishu_oauth_attempts'::regclass)
  and (select relforcerowsecurity from pg_class where oid = 'public.feishu_webhook_events'::regclass)
  and (select relforcerowsecurity from pg_class where oid = 'public.feishu_sync_conflicts'::regclass)
  and (select relforcerowsecurity from pg_class where oid = 'public.feishu_offboarding_commands'::regclass),
  'sensitive control tables force RLS'
);
select ok(
  (select array_to_string(proconfig, ',') = 'search_path=""' from pg_proc where oid = 'public.consume_feishu_oauth_attempt(uuid,text)'::regprocedure)
  and (select array_to_string(proconfig, ',') = 'search_path=""' from pg_proc where oid = 'public.ingest_feishu_webhook_event(text,text,text,text,text,text,bigint,text)'::regprocedure)
  and (select array_to_string(proconfig, ',') = 'search_path=""' from pg_proc where oid = 'public.revoke_departed_member_access(uuid,text)'::regprocedure)
  and (select array_to_string(proconfig, ',') = 'search_path=""' from pg_proc where oid = 'public.apply_feishu_directory_sync_fenced(uuid,uuid,uuid,jsonb)'::regprocedure),
  'security definer controls have an empty search path'
);
select is(
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'feishu_oauth_attempts' and column_name = 'raw_nonce'),
  0::bigint,
  'raw OAuth nonce has no storage column'
);
select matches(
  (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.organization_members'::regclass and conname = 'organization_members_status_check'),
  'revoked',
  'member status supports terminal revocation'
);

set local role service_role;
select lives_ok(
  $$ select public.create_feishu_oauth_attempt(
    '78000000-0000-4000-8000-000000000001'::uuid,
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '/people', now() + interval '10 minutes'
  ) $$,
  'a valid digest-only OAuth attempt is created'
);
reset role;
select is(
  (select nonce_digest from public.feishu_oauth_attempts where attempt_id = '78000000-0000-4000-8000-000000000001'),
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'only the expected digest is stored'
);
set local role service_role;
select ok(
  (public.get_feishu_member_access_proof('98000000-0000-4000-8000-000000000011') ->> 'sessionCount')::integer = 1
  and (public.get_feishu_member_access_proof('98000000-0000-4000-8000-000000000011') ->> 'refreshTokenCount')::integer = 1
  and (public.get_feishu_member_access_proof('98000000-0000-4000-8000-000000000011') ->> 'queuedGrantCount')::integer = 1,
  'offboarding fixture proves every access boundary is non-zero before departure'
);
select is(
  public.consume_feishu_oauth_attempt(
    '78000000-0000-4000-8000-000000000001',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  ) ->> 'valid',
  'true',
  'matching attempt consumes once'
);
reset role;
select is(
  (select status from public.feishu_oauth_attempts where attempt_id = '78000000-0000-4000-8000-000000000001'),
  'consumed',
  'successful consumption is terminal'
);
set local role service_role;
select is(
  public.consume_feishu_oauth_attempt(
    '78000000-0000-4000-8000-000000000001',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  ) ->> 'valid',
  'false',
  'replay is rejected'
);
select throws_ok(
  $$ select public.create_feishu_oauth_attempt(
    '78000000-0000-4000-8000-000000000002'::uuid,
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    '/people', now() - interval '1 minute'
  ) $$,
  '22023',
  'expired attempt cannot be created'
);
reset role;

select col_is_unique('public', 'feishu_webhook_events', array['tenant_id','organization_id','provider_event_id'], 'provider event dedupe is organization-bound');
select col_is_pk('public', 'feishu_entity_sequences', array['connection_id','entity_type','entity_external_id'], 'entity sequence guard has an exact key');
select has_column('public', 'current_feishu_sync_issues', 'organization_public_id', 'issue view carries exact organization scope');

set local role service_role;
select is(
  public.claim_feishu_sync_work('full', null, 'missing-local-provider', 120, null, null) ->> 'reason',
  'no_connection',
  'a no-connection claim returns its real reason without inventing a run'
);
select is(
  public.claim_feishu_sync_work('incremental', 'event:41', 'missing-local-provider', 120, null, null) ->> 'reason',
  'invalid_cursor',
  'an invalid durable cursor fails closed before connection lookup'
);
reset role;

insert into public.tenants (name, slug, status)
values
  ('Feishu control tenant A', 'feishu-control-test-a', 'active'),
  ('Feishu control tenant B', 'feishu-control-test-b', 'active');
insert into public.organizations (tenant_id, name, slug)
select tenant.id, seed.name, seed.slug
  from public.tenants tenant
  cross join (values
    ('Feishu control organization A', 'feishu-control-a'),
    ('Feishu control shadow organization', 'feishu-control-shadow')
  ) seed(name, slug)
 where tenant.slug = 'feishu-control-test-a';
insert into public.organizations (tenant_id, name, slug)
select tenant.id, 'Feishu control organization B', 'feishu-control-b'
  from public.tenants tenant where tenant.slug = 'feishu-control-test-b';
insert into public.identity_providers (
  tenant_id, provider_code, auth_provider, provider_tenant_key, display_name, status
)
select tenant.id, 'feishu', 'custom:' || tenant.slug,
       'feishu-control-provider', 'Feishu control test', 'active'
  from public.tenants tenant where tenant.slug in ('feishu-control-test-a', 'feishu-control-test-b');
insert into public.roles (
  tenant_id, organization_id, code, name, description, is_system, is_enabled
)
select tenant.id, organization.id, 'feishu_control_manager',
       'Feishu control manager', 'Feishu control manager', false, true
  from public.tenants tenant
  join public.organizations organization
    on organization.tenant_id = tenant.id and organization.slug in ('feishu-control-a', 'feishu-control-b')
 where tenant.slug in ('feishu-control-test-a', 'feishu-control-test-b');
insert into public.role_permissions (tenant_id, role_id, permission_id)
select role.tenant_id, role.id, permission.id
  from public.roles role
  join public.tenants tenant on tenant.id = role.tenant_id
  join public.permissions permission on permission.code = 'organization.manage'
 where tenant.slug in ('feishu-control-test-a', 'feishu-control-test-b') and role.code = 'feishu_control_manager';
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '00000000-0000-0000-0000-000000000000',
    '98000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
    'feishu-control@example.test', crypt('local-test-password', gen_salt('bf')), now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '98000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
    'feishu-control-scheduler@example.test', crypt('local-test-password', gen_salt('bf')), now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '98000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
    'feishu-control-recovery@example.test', crypt('local-test-password', gen_salt('bf')), now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  );
insert into public.organization_members (tenant_id, organization_id, user_id, status)
select tenant.id, organization.id, '98000000-0000-4000-8000-000000000001'::uuid, 'active'
  from public.tenants tenant
  join public.organizations organization
    on organization.tenant_id = tenant.id and organization.slug in ('feishu-control-a', 'feishu-control-b')
 where tenant.slug in ('feishu-control-test-a', 'feishu-control-test-b');
insert into public.organization_members (tenant_id, organization_id, user_id, status)
select tenant.id, organization.id, '98000000-0000-4000-8000-000000000002'::uuid, 'active'
  from public.tenants tenant
  join public.organizations organization
    on organization.tenant_id = tenant.id and organization.slug = 'feishu-control-b'
 where tenant.slug = 'feishu-control-test-b';
insert into public.organization_members (tenant_id, organization_id, user_id, status)
select tenant.id, organization.id, '98000000-0000-4000-8000-000000000003'::uuid, 'active'
  from public.tenants tenant
  join public.organizations organization
    on organization.tenant_id = tenant.id and organization.slug = 'feishu-control-b'
 where tenant.slug = 'feishu-control-test-b';
insert into public.member_roles (tenant_id, member_id, role_id)
select member.tenant_id, member.id, role.id
  from public.organization_members member
  join public.roles role
    on role.tenant_id = member.tenant_id and role.organization_id = member.organization_id
 where member.user_id in (
   '98000000-0000-4000-8000-000000000001'::uuid,
   '98000000-0000-4000-8000-000000000002'::uuid,
   '98000000-0000-4000-8000-000000000003'::uuid
 ) and role.code = 'feishu_control_manager';
insert into public.employee_profiles (
  public_id, tenant_id, organization_id, organization_member_id,
  employee_no, display_name, job_title, employment_status, skills
)
select '98000000-0000-4000-8000-000000000011'::uuid,
       member.tenant_id, member.organization_id, member.id,
       'FS-CONTROL-1', 'Feishu control member', 'Engineer', 'active', '{}'
  from public.organization_members member
  join public.organizations organization on organization.id = member.organization_id
 where member.user_id = '98000000-0000-4000-8000-000000000001'::uuid
   and organization.slug = 'feishu-control-a';
insert into public.external_identities (
  tenant_id, organization_id, organization_member_id, identity_provider_id,
  provider_subject, provider_tenant_key, provider_match_keys,
  auth_user_id, status
)
select member.tenant_id, member.organization_id, member.id, provider.id,
       'open_id:ou-control-user', provider.provider_tenant_key,
       array['open_id:ou-control-user'], member.user_id, 'active'
  from public.organization_members member
  join public.identity_providers provider
    on provider.tenant_id = member.tenant_id and provider.provider_code = 'feishu'
  join public.organizations organization on organization.id = member.organization_id
 where member.user_id = '98000000-0000-4000-8000-000000000001'::uuid
   and organization.slug = 'feishu-control-a';
insert into public.external_identities (
  tenant_id, organization_id, organization_member_id, identity_provider_id,
  provider_subject, provider_tenant_key, provider_match_keys,
  auth_user_id, status
)
select member.tenant_id, member.organization_id, member.id, provider.id,
       'open_id:ou-control-scheduler', provider.provider_tenant_key,
       array['open_id:ou-control-scheduler'], member.user_id, 'active'
  from public.organization_members member
  join public.identity_providers provider
    on provider.tenant_id = member.tenant_id and provider.provider_code = 'feishu'
  join public.organizations organization on organization.id = member.organization_id
 where member.user_id = '98000000-0000-4000-8000-000000000002'::uuid
    and organization.slug = 'feishu-control-b';
insert into public.external_identities (
  tenant_id, organization_id, organization_member_id, identity_provider_id,
  provider_subject, provider_tenant_key, provider_match_keys,
  auth_user_id, status
)
select member.tenant_id, member.organization_id, member.id, provider.id,
       'open_id:ou-control-recovery', provider.provider_tenant_key,
       array['open_id:ou-control-recovery'], member.user_id, 'active'
  from public.organization_members member
  join public.identity_providers provider
    on provider.tenant_id = member.tenant_id and provider.provider_code = 'feishu'
  join public.organizations organization on organization.id = member.organization_id
 where member.user_id = '98000000-0000-4000-8000-000000000003'::uuid
   and organization.slug = 'feishu-control-b';
insert into public.feishu_access_grants (tenant_id, organization_id, organization_member_id, status)
select member.tenant_id, member.organization_id, member.id, 'queued'
  from public.organization_members member
  join public.organizations organization on organization.id = member.organization_id
 where member.user_id = '98000000-0000-4000-8000-000000000001'::uuid
   and organization.slug = 'feishu-control-a';
insert into auth.sessions (id, user_id, created_at, updated_at)
values ('98000000-0000-4000-8000-000000000021', '98000000-0000-4000-8000-000000000001', now(), now());
insert into auth.refresh_tokens (instance_id, token, user_id, session_id, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', 'feishu-control-refresh-a', '98000000-0000-4000-8000-000000000001', '98000000-0000-4000-8000-000000000021', now(), now());
insert into public.directory_connections (
  tenant_id, organization_id, identity_provider_id, provider_type,
  external_tenant_key, sync_mode, status
)
select tenant.id, organization.id, provider.id, 'feishu',
       provider.provider_tenant_key, 'manual', 'active'
  from public.tenants tenant
  join public.organizations organization on organization.tenant_id = tenant.id
  join public.identity_providers provider
    on provider.tenant_id = tenant.id and provider.provider_code = 'feishu'
 where organization.slug in ('feishu-control-a', 'feishu-control-b')
   and tenant.slug in ('feishu-control-test-a', 'feishu-control-test-b');

insert into public.roles (
  tenant_id, organization_id, code, name, description, is_system, is_enabled
)
select tenant.id, organization.id, 'feishu_control_wrong_org',
       'Wrong organization manager', 'Must never authorize organization A', false, true
  from public.tenants tenant
  join public.organizations organization
    on organization.tenant_id = tenant.id and organization.slug = 'feishu-control-shadow'
 where tenant.slug = 'feishu-control-test-a';
insert into public.role_permissions (tenant_id, role_id, permission_id)
select role.tenant_id, role.id, permission.id
  from public.roles role
  join public.permissions permission on permission.code = 'organization.manage'
 where role.code = 'feishu_control_wrong_org';
insert into public.member_roles (tenant_id, member_id, role_id)
select member.tenant_id, member.id, role.id
  from public.organization_members member
  join public.organizations organization on organization.id = member.organization_id
  join public.roles role
    on role.tenant_id = member.tenant_id and role.code = 'feishu_control_wrong_org'
 where member.user_id = '98000000-0000-4000-8000-000000000001'::uuid
   and organization.slug = 'feishu-control-a';
update public.roles set is_enabled = false
 where code = 'feishu_control_manager'
   and organization_id = (select id from public.organizations where slug = 'feishu-control-a');
update public.directory_connections set last_sync_at = now()
 where organization_id = (select id from public.organizations where slug = 'feishu-control-b');
set local role service_role;
select throws_ok(
  $$ select public.claim_feishu_sync_work(
    'full', null, 'feishu-control-provider', 120,
    (select public_id from public.organizations where slug = 'feishu-control-a'),
    '98000000-0000-4000-8000-000000000001'
  ) $$,
  '42501', 'forbidden',
  'disabled exact role plus enabled wrong-organization role cannot authorize an interactive claim'
);
select set_config(
  'test.feishu_actor_filtered_claim',
  public.claim_feishu_sync_work(
    'full', null, 'feishu-control-provider', 120, null, null
  )::text,
  true
);
select is(
  current_setting('test.feishu_actor_filtered_claim')::jsonb ->> 'acquired',
  'true',
  'scheduled claim skips an actorless disabled-role older connection'
);
select is(
  current_setting('test.feishu_actor_filtered_claim')::jsonb ->> 'organizationId',
  (select public_id::text from public.organizations where slug = 'feishu-control-b'),
  'scheduled claim acquires the ready connection with an authoritative actor'
);
select is(
  current_setting('test.feishu_actor_filtered_claim')::jsonb ->> 'actorAuthUserId',
  '98000000-0000-4000-8000-000000000002',
  'scheduled claim records the first valid active manager instead of the disabled actor'
);
select public.apply_feishu_directory_sync_fenced(
  (current_setting('test.feishu_actor_filtered_claim')::jsonb ->> 'runId')::uuid,
  (select public_id from public.organizations where slug = 'feishu-control-b'),
  '98000000-0000-4000-8000-000000000002',
  '{"complete":true,"departments":[],"positions":[],"employees":[]}'::jsonb
);
select public.finish_feishu_sync_work(
  (current_setting('test.feishu_actor_filtered_claim')::jsonb ->> 'runId')::uuid,
  null, 'completed', null,
  (select public_id from public.organizations where slug = 'feishu-control-b')
);
reset role;
update public.roles set is_enabled = true
 where code = 'feishu_control_manager'
   and organization_id = (select id from public.organizations where slug = 'feishu-control-a');

set local role service_role;
select is(
  public.revoke_departed_member_access(
    '98000000-0000-4000-8000-000000000011', 'feishu-control-departure-a'
  ),
  true,
  'first departure command completes transactionally'
);
reset role;
select is((select employment_status from public.employee_profiles where public_id = '98000000-0000-4000-8000-000000000011'), 'departed', 'offboarding marks the profile departed');
select is((select member.status from public.organization_members member join public.employee_profiles profile on profile.organization_member_id = member.id where profile.public_id = '98000000-0000-4000-8000-000000000011'), 'revoked', 'offboarding revokes the member');
select is((select status from public.external_identities where provider_subject = 'open_id:ou-control-user'), 'revoked', 'offboarding revokes the exact identity');
select is((select auth_user_id from public.external_identities where provider_subject = 'open_id:ou-control-user'), null::uuid, 'offboarding clears the identity auth binding');
select is((select count(*) from auth.sessions where user_id = '98000000-0000-4000-8000-000000000001'), 0::bigint, 'offboarding deletes active auth sessions');
select is((select count(*) from auth.refresh_tokens where session_id = '98000000-0000-4000-8000-000000000021'), 0::bigint, 'offboarding deletes refresh tokens');
select is((select count(*) from public.feishu_access_grants where status = 'cancelled'), 1::bigint, 'offboarding cancels queued grants');
select is((select count(*) from public.audit_logs where action = 'identity.revoked' and target_id = '98000000-0000-4000-8000-000000000011'), 1::bigint, 'offboarding commits one audit');
set local role service_role;
select ok(
  (public.get_feishu_offboarding_proof('feishu-control-departure-a') ->> 'profileDeparted')::boolean
  and (public.get_feishu_offboarding_proof('feishu-control-departure-a') ->> 'memberRevoked')::boolean
  and (public.get_feishu_offboarding_proof('feishu-control-departure-a') ->> 'identityRevoked')::boolean
  and (public.get_feishu_offboarding_proof('feishu-control-departure-a') ->> 'sessionsRevoked')::integer = 1
  and (public.get_feishu_offboarding_proof('feishu-control-departure-a') ->> 'refreshTokensRevoked')::integer = 1
  and (public.get_feishu_offboarding_proof('feishu-control-departure-a') ->> 'queuedGrantsCancelled')::integer = 1
  and (public.get_feishu_offboarding_proof('feishu-control-departure-a') ->> 'queuedGrantsRemaining')::integer = 0
  and (public.get_feishu_offboarding_proof('feishu-control-departure-a') ->> 'auditCount')::integer = 1,
  'offboarding proof reports every durable access boundary closed'
);
select ok(
  (public.get_feishu_member_access_proof('98000000-0000-4000-8000-000000000011') ->> 'sessionCount')::integer = 0
  and (public.get_feishu_member_access_proof('98000000-0000-4000-8000-000000000011') ->> 'refreshTokenCount')::integer = 0
  and (public.get_feishu_member_access_proof('98000000-0000-4000-8000-000000000011') ->> 'queuedGrantCount')::integer = 0,
  'offboarding closes every exact access boundary to zero'
);
select is(public.revoke_departed_member_access('98000000-0000-4000-8000-000000000011', 'feishu-control-departure-a'), true, 'lost-response retry returns the same terminal result');
reset role;
select is((select count(*) from public.audit_logs where action = 'identity.revoked' and target_id = '98000000-0000-4000-8000-000000000011'), 1::bigint, 'lost-response retry creates no second audit');

update public.organization_members set status = 'active'
 where user_id = '98000000-0000-4000-8000-000000000001';
update public.employee_profiles set employment_status = 'active', departure_date = null
 where public_id = '98000000-0000-4000-8000-000000000011';
update public.external_identities set status = 'active', auth_user_id = '98000000-0000-4000-8000-000000000001'
 where provider_subject = 'open_id:ou-control-user';
insert into public.feishu_access_grants (tenant_id, organization_id, organization_member_id, status)
select member.tenant_id, member.organization_id, member.id, 'queued'
  from public.organization_members member
 where member.user_id = '98000000-0000-4000-8000-000000000001';
insert into auth.sessions (id, user_id, created_at, updated_at)
values ('98000000-0000-4000-8000-000000000022', '98000000-0000-4000-8000-000000000001', now(), now());
insert into auth.refresh_tokens (instance_id, token, user_id, session_id, created_at, updated_at)
values ('00000000-0000-0000-0000-000000000000', 'feishu-control-refresh-b', '98000000-0000-4000-8000-000000000001', '98000000-0000-4000-8000-000000000022', now(), now());
set local role service_role;
select is(public.revoke_departed_member_access('98000000-0000-4000-8000-000000000011', 'feishu-control-departure-b'), true, 'rehire followed by a later departure executes a new command');
reset role;
select is((select count(*) from public.feishu_offboarding_commands where member_public_id = '98000000-0000-4000-8000-000000000011'), 2::bigint, 'distinct departure events retain two durable commands');
select is((select count(*) from public.audit_logs where action = 'identity.revoked' and target_id = '98000000-0000-4000-8000-000000000011'), 2::bigint, 'later departure creates exactly one new audit');
select is((select count(*) from auth.sessions where user_id = '98000000-0000-4000-8000-000000000001'), 0::bigint, 'later departure revokes the rehired session');
select is((select count(*) from auth.refresh_tokens where session_id = '98000000-0000-4000-8000-000000000022'), 0::bigint, 'later departure revokes the rehired refresh token');

update public.organization_members set status = 'active'
 where user_id = '98000000-0000-4000-8000-000000000001';
update public.employee_profiles set employment_status = 'active', departure_date = null
 where public_id = '98000000-0000-4000-8000-000000000011';
update public.external_identities set status = 'active', auth_user_id = '98000000-0000-4000-8000-000000000001'
 where provider_subject = 'open_id:ou-control-user';

set local role service_role;
select set_config(
  'test.feishu_control_claim',
  public.claim_feishu_sync_work(
    'full', null, 'feishu-control-provider', 120,
    (select public_id from public.organizations where slug = 'feishu-control-a'),
    '98000000-0000-4000-8000-000000000001'
  )::text,
  true
);
select is(current_setting('test.feishu_control_claim')::jsonb ->> 'acquired', 'true', 'exact organization work is durably claimed');
select throws_ok(
  $$ select public.claim_feishu_sync_work(
    'full', null, 'feishu-control-provider', 120,
    (select public_id from public.organizations where slug = 'feishu-control-a'),
    '98000000-0000-4000-8000-000000000002'
  ) $$,
  '42501', 'forbidden',
  'an existing exact active lease remains hidden from an actor bound to another organization'
);
select is(
  (select count(*) from public.directory_sync_runs run where run.public_id = (current_setting('test.feishu_control_claim')::jsonb ->> 'runId')::uuid and run.request_id = run.public_id),
  1::bigint,
  'claim creates one run that is also the request/idempotency anchor'
);
select set_config(
  'test.feishu_ready_claim',
  public.claim_feishu_sync_work(
    'full', null, 'feishu-control-provider', 120, null, null
  )::text,
  true
);
select is(current_setting('test.feishu_ready_claim')::jsonb ->> 'acquired', 'true', 'unscoped full claim skips an older active connection and acquires ready work');
select is(
  current_setting('test.feishu_ready_claim')::jsonb ->> 'organizationId',
  (select public_id::text from public.organizations where slug = 'feishu-control-b'),
  'unscoped full claim selects the ready organization B connection'
);
select set_config(
  'test.feishu_ready_apply',
  public.apply_feishu_directory_sync_fenced(
    (current_setting('test.feishu_ready_claim')::jsonb ->> 'runId')::uuid,
    (select public_id from public.organizations where slug = 'feishu-control-b'),
    '98000000-0000-4000-8000-000000000002',
    '{"complete":true,"departments":[],"positions":[],"employees":[]}'::jsonb
  )::text,
  true
);
select is(current_setting('test.feishu_ready_apply')::jsonb ->> 'status', 'completed', 'ready organization B work applies under its exact scheduled actor');
select public.finish_feishu_sync_work(
  (current_setting('test.feishu_ready_claim')::jsonb ->> 'runId')::uuid,
  null, 'completed', null,
  (select public_id from public.organizations where slug = 'feishu-control-b')
);
with inserted as (
  insert into public.feishu_webhook_events (
    tenant_id, organization_id, connection_id, provider_event_id, event_type,
    entity_type, entity_external_id, entity_sequence, payload_digest, disposition
  )
  select connection.tenant_id, connection.organization_id, connection.id,
         'feishu-control-b-cursor', 'contact.department.updated_v3',
         'department', 'od-control-b', 1, repeat('b', 64), 'applied'
    from public.directory_connections connection
    join public.organizations organization on organization.id = connection.organization_id
   where organization.slug = 'feishu-control-b'
  returning id
)
select set_config('test.feishu_b_cursor', id::text, true) from inserted;
select set_config(
  'test.feishu_incremental_claim',
  public.claim_feishu_sync_work(
    'incremental', current_setting('test.feishu_b_cursor'),
    'feishu-control-provider', 120, null, null
  )::text,
  true
);
select is(current_setting('test.feishu_incremental_claim')::jsonb ->> 'acquired', 'true', 'incremental cursor directly claims its own ready connection');
select is(
  current_setting('test.feishu_incremental_claim')::jsonb ->> 'organizationId',
  (select public_id::text from public.organizations where slug = 'feishu-control-b'),
  'incremental cursor cannot be redirected to the older organization A connection'
);
update public.feishu_sync_leases
   set lease_expires_at = now() - interval '1 second', attempt = 3
 where run_id = (current_setting('test.feishu_incremental_claim')::jsonb ->> 'runId')::uuid;
update public.external_identities identity set status = 'revoked', auth_user_id = null
  from public.organization_members member
 where member.id = identity.organization_member_id
   and member.user_id = '98000000-0000-4000-8000-000000000002'::uuid
   and identity.organization_id = (select id from public.organizations where slug = 'feishu-control-b');
update public.organization_members set status = 'revoked'
 where user_id = '98000000-0000-4000-8000-000000000002'::uuid
   and organization_id = (select id from public.organizations where slug = 'feishu-control-b');
select is(
  (select status from public.organization_members where user_id = '98000000-0000-4000-8000-000000000002'::uuid),
  'revoked',
  'old takeover actor is revoked before recovery'
);
select set_config(
  'test.feishu_takeover_claim',
  public.claim_feishu_sync_work(
    'full', null, 'feishu-control-provider', 120,
    (select public_id from public.organizations where slug = 'feishu-control-b'),
    '98000000-0000-4000-8000-000000000003'
  )::text,
  true
);
select is(current_setting('test.feishu_takeover_claim')::jsonb ->> 'acquired', 'true', 'expired lease is taken over by a new durable claim');
select is(current_setting('test.feishu_takeover_claim')::jsonb ->> 'attempt', '4', 'takeover preserves cumulative bounded attempt metadata');
select ok(
  exists (
    select 1 from public.directory_sync_runs run
     where run.public_id = (current_setting('test.feishu_incremental_claim')::jsonb ->> 'runId')::uuid
       and run.status = 'failed' and run.completed_at is not null and run.error_count >= 1
  ),
  'expired lease takeover terminalizes the superseded run before replacement'
);
select is(
  (
    select count(*) from public.audit_logs audit
     where audit.request_id = (current_setting('test.feishu_incremental_claim')::jsonb ->> 'runId')::uuid
       and audit.action = 'directory.sync_failed'
       and audit.metadata ->> 'code' = 'lease_expired_superseded'
  ),
  1::bigint,
  'expired takeover appends exactly one terminal audit for the old run'
);
select is(
  (
    select actor_auth_user_id from public.audit_logs audit
     where audit.request_id = (current_setting('test.feishu_incremental_claim')::jsonb ->> 'runId')::uuid
       and audit.action = 'directory.sync_failed'
  ),
  '98000000-0000-4000-8000-000000000003'::uuid,
  'takeover audit is attributed to the new active actor'
);
select ok(
  exists (
    select 1 from public.feishu_sync_leases lease
     where lease.run_id = (current_setting('test.feishu_takeover_claim')::jsonb ->> 'runId')::uuid
       and lease.attempt = 4 and lease.status = 'running'
  ),
  'replacement lease owns the new run and incremented attempt'
);
select set_config(
  'test.feishu_takeover_retry',
  public.claim_feishu_sync_work(
    'full', null, 'feishu-control-provider', 120,
    (select public_id from public.organizations where slug = 'feishu-control-b'),
    '98000000-0000-4000-8000-000000000003'
  )::text,
  true
);
select is(current_setting('test.feishu_takeover_retry')::jsonb ->> 'reason', 'active_lease', 'lost-response takeover retry observes the committed replacement lease');
select is(
  current_setting('test.feishu_takeover_retry')::jsonb ->> 'runId',
  current_setting('test.feishu_takeover_claim')::jsonb ->> 'runId',
  'lost-response takeover retry returns the same replacement run'
);
select is(
  (
    select count(*) from public.audit_logs audit
     where audit.request_id = (current_setting('test.feishu_incremental_claim')::jsonb ->> 'runId')::uuid
       and audit.action = 'directory.sync_failed'
  ),
  1::bigint,
  'lost-response retry neither re-terminalizes nor duplicates the takeover audit'
);
select is(
  public.claim_feishu_sync_work(
    'full', null, 'feishu-control-provider', 120,
    (select public_id from public.organizations where slug = 'feishu-control-a'),
    '98000000-0000-4000-8000-000000000001'
  ) ->> 'reason',
  'active_lease',
  'concurrent claim returns the real active-lease reason'
);
select set_config(
  'test.feishu_control_apply',
  public.apply_feishu_directory_sync_fenced(
    (current_setting('test.feishu_control_claim')::jsonb ->> 'runId')::uuid,
    (select public_id from public.organizations where slug = 'feishu-control-a'),
    '98000000-0000-4000-8000-000000000001',
    '{"complete":true,"departments":[],"positions":[],"employees":[{"openId":"ou-control-user","userId":"u-control","email":"feishu-control@example.test","name":"Feishu control member","primaryDepartmentExternalId":null,"jobTitleExternalId":null,"jobTitle":"Engineer","isActive":true}]}'::jsonb
  )::text,
  true
);
select is(current_setting('test.feishu_control_apply')::jsonb ->> 'status', 'completed', 'fenced apply completes the claimed run');
select is(
  (select count(*) from public.directory_sync_runs run where run.public_id = (current_setting('test.feishu_control_claim')::jsonb ->> 'runId')::uuid),
  1::bigint,
  'fenced apply never creates a second run'
);
select is(
  public.apply_feishu_directory_sync_fenced(
    (current_setting('test.feishu_control_claim')::jsonb ->> 'runId')::uuid,
    (select public_id from public.organizations where slug = 'feishu-control-a'),
    '98000000-0000-4000-8000-000000000001',
    '{"complete":true,"departments":[],"positions":[],"employees":[]}'::jsonb
  ) ->> 'status',
  'completed',
  'committed apply replay returns terminal run data'
);
select is(
  (select count(*) from public.audit_logs audit where audit.request_id = (current_setting('test.feishu_control_claim')::jsonb ->> 'runId')::uuid and audit.action = 'directory.sync_completed'),
  1::bigint,
  'committed apply replay creates no second completion audit'
);
select is(
  public.finish_feishu_sync_work(
    (current_setting('test.feishu_control_claim')::jsonb ->> 'runId')::uuid,
    null, 'completed', null,
    (select public_id from public.organizations where slug = 'feishu-control-a')
  ) ->> 'status',
  'completed',
  'claimed lease completes after the fenced mutation'
);
reset role;

insert into public.organization_members (tenant_id, organization_id, user_id, status)
select tenant.id, organization.id, null, 'invited'
  from public.tenants tenant
  join public.organizations organization
    on organization.tenant_id = tenant.id and organization.slug = 'feishu-control-shadow'
 where tenant.slug = 'feishu-control-test-a';
insert into public.external_identities (
  tenant_id, organization_id, organization_member_id, identity_provider_id,
  provider_subject, provider_tenant_key, provider_match_keys, status
)
select member.tenant_id, member.organization_id, member.id, provider.id,
       'open_id:ou-cross-organization', provider.provider_tenant_key,
       array['open_id:ou-cross-organization'], 'invited'
  from public.organization_members member
  join public.organizations organization on organization.id = member.organization_id
  join public.identity_providers provider
    on provider.tenant_id = member.tenant_id and provider.provider_code = 'feishu'
 where organization.slug = 'feishu-control-shadow' and member.user_id is null;
set local role service_role;
select set_config(
  'test.feishu_cross_claim',
  public.claim_feishu_sync_work(
    'reconcile', null, 'feishu-control-provider', 120,
    (select public_id from public.organizations where slug = 'feishu-control-a'),
    '98000000-0000-4000-8000-000000000001'
  )::text,
  true
);
select set_config(
  'test.feishu_cross_apply',
  public.apply_feishu_directory_sync_fenced(
    (current_setting('test.feishu_cross_claim')::jsonb ->> 'runId')::uuid,
    (select public_id from public.organizations where slug = 'feishu-control-a'),
    '98000000-0000-4000-8000-000000000001',
    '{"complete":true,"departments":[],"positions":[],"employees":[{"openId":"ou-cross-organization","userId":"u-cross","email":null,"name":"Cross organization","primaryDepartmentExternalId":null,"jobTitleExternalId":null,"jobTitle":"Engineer","isActive":true}]}'::jsonb
  )::text,
  true
);
select is(current_setting('test.feishu_cross_apply')::jsonb ->> 'status', 'failed', 'cross-organization provider subject fails the run closed');
select is((select count(*) from public.feishu_sync_conflicts where organization_id = (select id from public.organizations where slug = 'feishu-control-a') and code = 'AMBIGUOUS_EVENT'), 1::bigint, 'cross-organization provider subject creates one durable conflict');
select is((select count(*) from public.directory_entity_links where organization_id = (select id from public.organizations where slug = 'feishu-control-a') and external_id = 'ou-cross-organization'), 0::bigint, 'cross-organization provider subject is never linked');
select is((select status from public.directory_sync_runs where public_id = (current_setting('test.feishu_cross_claim')::jsonb ->> 'runId')::uuid), 'failed', 'cross-organization conflict persists a failed claimed run');
select is(
  public.apply_feishu_directory_sync_fenced(
    (current_setting('test.feishu_cross_claim')::jsonb ->> 'runId')::uuid,
    (select public_id from public.organizations where slug = 'feishu-control-a'),
    '98000000-0000-4000-8000-000000000001',
    '{"complete":true,"departments":[],"positions":[],"employees":[]}'::jsonb
  ) ->> 'status',
  'failed',
  'failed apply replay returns the same terminal run data'
);
select is((select count(*) from public.audit_logs where request_id = (current_setting('test.feishu_cross_claim')::jsonb ->> 'runId')::uuid and action = 'directory.sync_failed'), 1::bigint, 'failed apply replay creates no second failure audit');
reset role;

update public.organization_members member set status = 'active'
  from public.organizations organization
 where organization.id = member.organization_id
   and organization.slug = 'feishu-control-a'
   and member.user_id = '98000000-0000-4000-8000-000000000001';
update public.employee_profiles set employment_status = 'active', departure_date = null
 where public_id = '98000000-0000-4000-8000-000000000011';
update public.external_identities identity set
  status = 'active', auth_user_id = '98000000-0000-4000-8000-000000000001'
  from public.organizations organization
 where organization.id = identity.organization_id
   and organization.slug = 'feishu-control-a'
   and identity.provider_subject = 'open_id:ou-control-user';

insert into public.directory_sync_runs (
  tenant_id, organization_id, connection_id, status, snapshot_complete,
  started_at, completed_at
)
select connection.tenant_id, connection.organization_id, connection.id,
       'completed', true, now(), now()
  from public.directory_connections connection
  join public.organizations organization
    on organization.id = connection.organization_id
 where organization.slug = 'feishu-control-b';
insert into public.feishu_sync_conflicts (tenant_id, organization_id, code, severity, entity_type)
select tenant_id, id, 'RECONCILIATION_DIFFERENCE', 'warning', 'department'
  from public.organizations where slug = 'feishu-control-b';
select is(
  (
    select count(distinct member.organization_id)
      from public.organization_members member
      join public.member_roles assignment
        on assignment.tenant_id = member.tenant_id and assignment.member_id = member.id
      join public.roles role
        on role.tenant_id = assignment.tenant_id and role.id = assignment.role_id
      join public.role_permissions rp
        on rp.tenant_id = assignment.tenant_id and rp.role_id = assignment.role_id
      join public.permissions permission on permission.id = rp.permission_id
     where member.user_id = '98000000-0000-4000-8000-000000000001'::uuid
       and member.status = 'active'
       and role.is_enabled
       and (role.organization_id is null or role.organization_id = member.organization_id)
       and permission.code = 'organization.manage'
       and member.organization_id in (
         (select id from public.organizations where slug = 'feishu-control-a'),
         (select id from public.organizations where slug = 'feishu-control-b')
       )
  ),
  2::bigint,
  'the same auth user legitimately has enabled organization.manage membership in A and B'
);
select set_config('test.feishu_org_a_id', (select id::text from public.organizations where slug = 'feishu-control-a'), true);
select set_config('test.feishu_org_b_id', (select id::text from public.organizations where slug = 'feishu-control-b'), true);
select set_config('request.jwt.claim.sub', '98000000-0000-4000-8000-000000000001', true);
set local role authenticated;
select is(
  public.current_active_workspace_organization_id(),
  current_setting('test.feishu_org_a_id')::bigint,
  'the active external identity binds the same manager to organization A only'
);
select is((select count(*) from public.directory_sync_runs where organization_id = current_setting('test.feishu_org_b_id')::bigint), 0::bigint, 'organization B runs are RLS denied despite legitimate B manager membership');
select is((select count(*) from public.feishu_webhook_events where organization_id = current_setting('test.feishu_org_b_id')::bigint), 0::bigint, 'organization B events are RLS denied despite legitimate B manager membership');
select is((select count(*) from public.feishu_sync_conflicts where organization_id = current_setting('test.feishu_org_b_id')::bigint), 0::bigint, 'organization B conflicts are RLS denied despite legitimate B manager membership');
select ok((select count(*) from public.directory_sync_runs where organization_id = current_setting('test.feishu_org_a_id')::bigint) >= 1, 'exact active workspace organization A run remains visible through RLS');
reset role;

-- A real two-session behavioral check. Extension creation and local connection
-- capability are probed dynamically. An unavailable extension is a visible TAP
-- skip, never evidence that concurrency passed.
select set_config('test.feishu_dblink_available', 'false', true);
select set_config('test.feishu_fair_busy', '-1', true);
select set_config('test.feishu_apply_busy', '-1', true);
select set_config('test.feishu_apply_probe', 'false', true);
select set_config('test.feishu_finish_busy', '-1', true);
select set_config('test.feishu_finish_probe', 'false', true);
select set_config('test.feishu_lock_a', '{}'::jsonb::text, true);
select set_config('test.feishu_lock_b', '{}'::jsonb::text, true);
select set_config('test.feishu_apply', '{}'::jsonb::text, true);
select set_config('test.feishu_finish', '{}'::jsonb::text, true);
select set_config('test.feishu_takeover', '{}'::jsonb::text, true);
select set_config('test.feishu_takeover_retry', '{}'::jsonb::text, true);
select set_config('test.feishu_takeover_proof', '{}'::jsonb::text, true);
do $concurrency$
declare
  v_extension_schema name;
  v_status text;
  v_integer integer;
  v_claim_a jsonb;
  v_claim_b jsonb;
  v_apply jsonb;
  v_finish jsonb;
  v_takeover jsonb;
  v_takeover_retry jsonb;
  v_takeover_proof jsonb;
  v_drain jsonb;
  v_connection_name text;
  v_drain_wait integer;
  v_worker_pid integer;
  v_waiting_on_lock boolean;
begin
  begin
    select namespace.nspname into v_extension_schema
      from pg_extension extension
      join pg_namespace namespace on namespace.oid = extension.extnamespace
     where extension.extname = 'dblink';
    if not found then
      if not exists (select 1 from pg_available_extensions where name = 'dblink') then
        return;
      end if;
      begin
        execute 'create extension dblink with schema extensions';
      exception when undefined_schema then
        execute 'create extension dblink';
      end;
      select namespace.nspname into strict v_extension_schema
        from pg_extension extension
        join pg_namespace namespace on namespace.oid = extension.extnamespace
       where extension.extname = 'dblink';
    end if;
    execute format('select %I.dblink_connect($1, $2)', v_extension_schema)
      into v_status using 'feishu_lock_a', 'dbname=' || current_database();
    execute format('select %I.dblink_connect($1, $2)', v_extension_schema)
      into v_status using 'feishu_lock_b', 'dbname=' || current_database();
    execute format('select %I.dblink_connect($1, $2)', v_extension_schema)
      into v_status using 'feishu_lock_c', 'dbname=' || current_database();
  exception when others then
    perform set_config('test.feishu_dblink_gate', sqlstate, true);
    begin
      execute format('select %I.dblink_disconnect($1)', v_extension_schema)
        into v_status using 'feishu_lock_a';
    exception when others then null;
    end;
    begin
      execute format('select %I.dblink_disconnect($1)', v_extension_schema)
        into v_status using 'feishu_lock_b';
    exception when others then null;
    end;
    begin
      execute format('select %I.dblink_disconnect($1)', v_extension_schema)
        into v_status using 'feishu_lock_c';
    exception when others then null;
    end;
    return;
  end;

  perform set_config('test.feishu_dblink_available', 'true', true);
  begin
    foreach v_connection_name in array array['feishu_lock_a', 'feishu_lock_b', 'feishu_lock_c'] loop
      execute format('select %I.dblink_exec($1, $2)', v_extension_schema)
        into v_status using v_connection_name, 'set statement_timeout = ''5s''';
      execute format('select %I.dblink_exec($1, $2)', v_extension_schema)
        into v_status using v_connection_name, 'set lock_timeout = ''1s''';
    end loop;
    execute format(
      'select pid from %I.dblink($1, $2) as remote(pid integer)',
      v_extension_schema
    ) into v_worker_pid using 'feishu_lock_b', 'select pg_backend_pid()';
    execute format('select %I.dblink_exec($1, $2)', v_extension_schema)
      into v_status using 'feishu_lock_a', $seed$
        delete from public.tenants where slug = 'feishu-lock-test';
        delete from auth.users where id in (
          '99000000-0000-4000-8000-000000000001',
          '99000000-0000-4000-8000-000000000002',
          '99000000-0000-4000-8000-000000000003'
        );
        insert into public.tenants (name, slug, status)
          values ('Feishu lock tenant', 'feishu-lock-test', 'active');
        insert into public.organizations (public_id, tenant_id, name, slug)
          select seed.public_id, tenant.id, seed.name, seed.slug
            from public.tenants tenant
            cross join (values
              ('99000000-0000-4000-8000-000000000011'::uuid, 'Feishu lock organization A', 'feishu-lock-a'),
              ('99000000-0000-4000-8000-000000000012'::uuid, 'Feishu lock organization B', 'feishu-lock-b')
            ) seed(public_id, name, slug)
           where tenant.slug = 'feishu-lock-test';
        insert into public.identity_providers (
          tenant_id, provider_code, auth_provider, provider_tenant_key, display_name, status
        )
          select id, 'feishu', 'custom:feishu-lock-test', 'feishu-lock-provider',
                 'Feishu lock provider', 'active'
            from public.tenants where slug = 'feishu-lock-test';
        insert into public.roles (
          tenant_id, organization_id, code, name, description, is_system, is_enabled
        )
          select tenant.id, organization.id, 'feishu_lock_manager_' || right(organization.slug, 1), 'Feishu lock manager',
                 'Feishu lock manager', false, organization.slug <> 'feishu-lock-a'
            from public.tenants tenant
            join public.organizations organization on organization.tenant_id = tenant.id
           where tenant.slug = 'feishu-lock-test';
        insert into public.role_permissions (tenant_id, role_id, permission_id)
          select role.tenant_id, role.id, permission.id
            from public.roles role
            join public.permissions permission on permission.code = 'organization.manage'
           where role.code in ('feishu_lock_manager_a', 'feishu_lock_manager_b');
        insert into auth.users (
          instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
          raw_app_meta_data, raw_user_meta_data, created_at, updated_at
        ) values
          (
            '00000000-0000-0000-0000-000000000000',
            '99000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
            'feishu-lock-a@example.test', crypt('local-test-password', gen_salt('bf')), now(),
            '{}'::jsonb, '{}'::jsonb, now(), now()
          ),
          (
            '00000000-0000-0000-0000-000000000000',
            '99000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
            'feishu-lock-b@example.test', crypt('local-test-password', gen_salt('bf')), now(),
            '{}'::jsonb, '{}'::jsonb, now(), now()
          ),
          (
            '00000000-0000-0000-0000-000000000000',
            '99000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated',
            'feishu-lock-recovery@example.test', crypt('local-test-password', gen_salt('bf')), now(),
            '{}'::jsonb, '{}'::jsonb, now(), now()
          );
        insert into public.organization_members (tenant_id, organization_id, user_id, status)
          select tenant.id, organization.id, actor.user_id, 'active'
            from public.tenants tenant
            join public.organizations organization on organization.tenant_id = tenant.id
            join (values
              ('feishu-lock-a', '99000000-0000-4000-8000-000000000001'::uuid),
              ('feishu-lock-b', '99000000-0000-4000-8000-000000000002'::uuid),
              ('feishu-lock-b', '99000000-0000-4000-8000-000000000003'::uuid)
            ) actor(organization_slug, user_id) on actor.organization_slug = organization.slug
           where tenant.slug = 'feishu-lock-test';
        insert into public.member_roles (tenant_id, member_id, role_id)
          select member.tenant_id, member.id, role.id
            from public.organization_members member
            join public.roles role
              on role.tenant_id = member.tenant_id and role.organization_id = member.organization_id
           where member.user_id in (
             '99000000-0000-4000-8000-000000000001',
             '99000000-0000-4000-8000-000000000002',
             '99000000-0000-4000-8000-000000000003'
           );
        insert into public.external_identities (
          tenant_id, organization_id, organization_member_id, identity_provider_id,
          provider_subject, provider_tenant_key, provider_match_keys, auth_user_id, status
        )
          select member.tenant_id, member.organization_id, member.id, provider.id,
                 case member.user_id
                   when '99000000-0000-4000-8000-000000000001' then 'open_id:ou-lock-manager-a'
                   when '99000000-0000-4000-8000-000000000002' then 'open_id:ou-lock-manager-b'
                   else 'open_id:ou-lock-recovery-b' end,
                 provider.provider_tenant_key,
                 array[case member.user_id
                   when '99000000-0000-4000-8000-000000000001' then 'open_id:ou-lock-manager-a'
                   when '99000000-0000-4000-8000-000000000002' then 'open_id:ou-lock-manager-b'
                   else 'open_id:ou-lock-recovery-b' end],
                 member.user_id, 'active'
            from public.organization_members member
            join public.identity_providers provider on provider.tenant_id = member.tenant_id
           where member.user_id in (
             '99000000-0000-4000-8000-000000000001',
             '99000000-0000-4000-8000-000000000002',
             '99000000-0000-4000-8000-000000000003'
           );
        insert into public.directory_connections (
          tenant_id, organization_id, identity_provider_id, provider_type,
          external_tenant_key, sync_mode, status
        )
          select tenant.id, organization.id, provider.id, 'feishu',
                 provider.provider_tenant_key, 'manual', 'active'
            from public.tenants tenant
            join public.organizations organization on organization.tenant_id = tenant.id
            join public.identity_providers provider on provider.tenant_id = tenant.id
           where tenant.slug = 'feishu-lock-test';
      $seed$;

    -- Organization A has only a disabled-role actor. Pre-lock it as well, then
    -- prove the unscoped scheduler immediately claims valid organization B.
    execute format('select %I.dblink_exec($1, $2)', v_extension_schema)
      into v_status using 'feishu_lock_a', 'begin';
    execute format('select %I.dblink_exec($1, $2)', v_extension_schema)
      into v_status using 'feishu_lock_a', $lock$
        do $remote$
        begin
          perform 1
            from public.directory_connections connection
            join public.organizations organization
              on organization.tenant_id = connection.tenant_id
             and organization.id = connection.organization_id
           where organization.public_id = '99000000-0000-4000-8000-000000000011'
           for update of connection;
        end
        $remote$
      $lock$;

    execute format('select %I.dblink_exec($1, $2)', v_extension_schema)
      into v_status using 'feishu_lock_b', 'begin';
    execute format('select %I.dblink_exec($1, $2)', v_extension_schema)
      into v_status using 'feishu_lock_b', 'set local role service_role';
    execute format('select %I.dblink_send_query($1, $2)', v_extension_schema)
      into v_integer using 'feishu_lock_b', $query$
        select public.claim_feishu_sync_work(
          'full', null, 'feishu-lock-provider', 120, null, null
        )
      $query$;
    perform pg_sleep(0.05);
    execute format('select %I.dblink_is_busy($1)', v_extension_schema)
      into v_integer using 'feishu_lock_b';
    perform set_config('test.feishu_fair_busy', v_integer::text, true);
    if v_integer <> 0 then
      raise exception 'feishu_fair_claim_blocked' using errcode = '55000';
    end if;
    execute format(
      'select result from %I.dblink_get_result($1) as remote(result jsonb)',
      v_extension_schema
    ) into v_claim_b using 'feishu_lock_b';
    perform set_config('test.feishu_lock_b', v_claim_b::text, true);
    execute format('select %I.dblink_exec($1, $2)', v_extension_schema)
      into v_status using 'feishu_lock_a', 'rollback';
    execute format('select %I.dblink_exec($1, $2)', v_extension_schema)
      into v_status using 'feishu_lock_b', 'commit';

    -- Enable A only after fairness is proven, then create the exact run used
    -- by the independent apply/finish acquisition-order scenarios.
    execute format('select %I.dblink_exec($1, $2)', v_extension_schema)
      into v_status using 'feishu_lock_a', $enable$
        update public.roles set is_enabled = true
         where code = 'feishu_lock_manager_a'
      $enable$;
    execute format('select %I.dblink_exec($1, $2)', v_extension_schema)
      into v_status using 'feishu_lock_a', 'begin';
    execute format('select %I.dblink_exec($1, $2)', v_extension_schema)
      into v_status using 'feishu_lock_a', 'set local role service_role';
    execute format('select %I.dblink_send_query($1, $2)', v_extension_schema)
      into v_integer using 'feishu_lock_a', $query$
        select public.claim_feishu_sync_work(
          'full', null, 'feishu-lock-provider', 120,
          '99000000-0000-4000-8000-000000000011',
          '99000000-0000-4000-8000-000000000001'
        )
      $query$;
    execute format(
      'select result from %I.dblink_get_result($1) as remote(result jsonb)',
      v_extension_schema
    ) into v_claim_a using 'feishu_lock_a';
    perform set_config('test.feishu_lock_a', v_claim_a::text, true);
    execute format('select %I.dblink_exec($1, $2)', v_extension_schema)
      into v_status using 'feishu_lock_a', 'commit';

    -- Pre-lock the connection, start apply asynchronously, then prove a third
    -- session can still NOWAIT-lock lease and run: apply is blocked before both.
    execute format('select %I.dblink_exec($1, $2)', v_extension_schema)
      into v_status using 'feishu_lock_a', 'begin';
    execute format('select %I.dblink_exec($1, $2)', v_extension_schema)
      into v_status using 'feishu_lock_a', $lock$
        do $remote$
        begin
          perform 1 from public.directory_connections connection
           where connection.organization_id = (
             select id from public.organizations
              where public_id = '99000000-0000-4000-8000-000000000011'
           )
           for update of connection;
        end
        $remote$
      $lock$;
    execute format('select %I.dblink_exec($1, $2)', v_extension_schema)
      into v_status using 'feishu_lock_b', 'begin';
    execute format('select %I.dblink_exec($1, $2)', v_extension_schema)
      into v_status using 'feishu_lock_b', 'set local role service_role';
    execute format('select %I.dblink_send_query($1, $2)', v_extension_schema)
      into v_integer using 'feishu_lock_b', format($query$
        select public.apply_feishu_directory_sync_fenced(
          %L::uuid, '99000000-0000-4000-8000-000000000011',
          '99000000-0000-4000-8000-000000000001',
          '{"complete":true,"departments":[],"positions":[],"employees":[]}'::jsonb
        )
      $query$, v_claim_a ->> 'runId');
    v_drain_wait := 0;
    v_waiting_on_lock := false;
    loop
      select exists (
        select 1 from pg_catalog.pg_stat_activity activity
         where activity.pid = v_worker_pid and activity.wait_event_type = 'Lock'
      ) into v_waiting_on_lock;
      exit when v_waiting_on_lock or v_drain_wait >= 100;
      v_drain_wait := v_drain_wait + 1;
      perform pg_sleep(0.01);
    end loop;
    if not v_waiting_on_lock then
      raise exception 'feishu_apply_not_observed_waiting_on_connection' using errcode = '55000';
    end if;
    execute format('select %I.dblink_is_busy($1)', v_extension_schema)
      into v_integer using 'feishu_lock_b';
    perform set_config('test.feishu_apply_busy', v_integer::text, true);
    if v_integer <> 1 then
      raise exception 'feishu_apply_did_not_wait_on_connection' using errcode = '55000';
    end if;
    execute format('select %I.dblink_exec($1, $2)', v_extension_schema)
      into v_status using 'feishu_lock_c', 'begin';
    execute format('select %I.dblink_exec($1, $2)', v_extension_schema)
      into v_status using 'feishu_lock_c', format($probe$
        do $remote$
        begin
          perform 1 from public.feishu_sync_leases lease
           where lease.run_id = %L::uuid for update nowait;
          perform 1 from public.directory_sync_runs run
           where run.public_id = %L::uuid for update nowait;
        end
        $remote$
      $probe$, v_claim_a ->> 'runId', v_claim_a ->> 'runId');
    perform set_config('test.feishu_apply_probe', 'true', true);
    execute format('select %I.dblink_exec($1, $2)', v_extension_schema)
      into v_status using 'feishu_lock_c', 'rollback';
    execute format('select %I.dblink_exec($1, $2)', v_extension_schema)
      into v_status using 'feishu_lock_a', 'commit';
    execute format(
      'select result from %I.dblink_get_result($1) as remote(result jsonb)',
      v_extension_schema
    ) into v_apply using 'feishu_lock_b';
    perform set_config('test.feishu_apply', v_apply::text, true);
    execute format('select %I.dblink_exec($1, $2)', v_extension_schema)
      into v_status using 'feishu_lock_b', 'commit';

    -- Repeat the same acquisition-order proof for finish after apply committed.
    execute format('select %I.dblink_exec($1, $2)', v_extension_schema)
      into v_status using 'feishu_lock_a', 'begin';
    execute format('select %I.dblink_exec($1, $2)', v_extension_schema)
      into v_status using 'feishu_lock_a', $lock$
        do $remote$
        begin
          perform 1 from public.directory_connections connection
           where connection.organization_id = (
             select id from public.organizations
              where public_id = '99000000-0000-4000-8000-000000000011'
           )
           for update of connection;
        end
        $remote$
      $lock$;
    execute format('select %I.dblink_exec($1, $2)', v_extension_schema)
      into v_status using 'feishu_lock_b', 'begin';
    execute format('select %I.dblink_exec($1, $2)', v_extension_schema)
      into v_status using 'feishu_lock_b', 'set local role service_role';
    execute format('select %I.dblink_send_query($1, $2)', v_extension_schema)
      into v_integer using 'feishu_lock_b', format($query$
        select public.finish_feishu_sync_work(
          %L::uuid, null, 'completed', null,
          '99000000-0000-4000-8000-000000000011'
        )
      $query$, v_claim_a ->> 'runId');
    v_drain_wait := 0;
    v_waiting_on_lock := false;
    loop
      select exists (
        select 1 from pg_catalog.pg_stat_activity activity
         where activity.pid = v_worker_pid and activity.wait_event_type = 'Lock'
      ) into v_waiting_on_lock;
      exit when v_waiting_on_lock or v_drain_wait >= 100;
      v_drain_wait := v_drain_wait + 1;
      perform pg_sleep(0.01);
    end loop;
    if not v_waiting_on_lock then
      raise exception 'feishu_finish_not_observed_waiting_on_connection' using errcode = '55000';
    end if;
    execute format('select %I.dblink_is_busy($1)', v_extension_schema)
      into v_integer using 'feishu_lock_b';
    perform set_config('test.feishu_finish_busy', v_integer::text, true);
    if v_integer <> 1 then
      raise exception 'feishu_finish_did_not_wait' using errcode = '55000';
    end if;
    execute format('select %I.dblink_exec($1, $2)', v_extension_schema)
      into v_status using 'feishu_lock_c', 'begin';
    execute format('select %I.dblink_exec($1, $2)', v_extension_schema)
      into v_status using 'feishu_lock_c', format($probe$
        do $remote$
        begin
          perform 1 from public.feishu_sync_leases lease
           where lease.run_id = %L::uuid for update nowait;
          perform 1 from public.directory_sync_runs run
           where run.public_id = %L::uuid for update nowait;
        end
        $remote$
      $probe$, v_claim_a ->> 'runId', v_claim_a ->> 'runId');
    perform set_config('test.feishu_finish_probe', 'true', true);
    execute format('select %I.dblink_exec($1, $2)', v_extension_schema)
      into v_status using 'feishu_lock_c', 'rollback';
    execute format('select %I.dblink_exec($1, $2)', v_extension_schema)
      into v_status using 'feishu_lock_a', 'commit';
    execute format(
      'select result from %I.dblink_get_result($1) as remote(result jsonb)',
      v_extension_schema
    ) into v_finish using 'feishu_lock_b';
    perform set_config('test.feishu_finish', v_finish::text, true);
    execute format('select %I.dblink_exec($1, $2)', v_extension_schema)
      into v_status using 'feishu_lock_b', 'commit';

    -- Expire the B lease, carry its third attempt into a fourth claim, and
    -- prove retry after a lost response cannot repeat terminalization/audit.
    execute format('select %I.dblink_exec($1, $2)', v_extension_schema)
      into v_status using 'feishu_lock_a', format($query$
        update public.feishu_sync_leases
           set lease_expires_at = now() - interval '1 second', attempt = 3
         where run_id = %L::uuid
      $query$, v_claim_b ->> 'runId');
    execute format('select %I.dblink_exec($1, $2)', v_extension_schema)
      into v_status using 'feishu_lock_a', $revoke$
        update public.external_identities identity
           set status = 'revoked', auth_user_id = null
          from public.organization_members member
         where member.id = identity.organization_member_id
           and member.user_id = '99000000-0000-4000-8000-000000000002'::uuid
           and identity.organization_id = (
             select id from public.organizations where public_id = '99000000-0000-4000-8000-000000000012'
           );
        update public.organization_members
           set status = 'revoked'
         where user_id = '99000000-0000-4000-8000-000000000002'::uuid
           and organization_id = (
             select id from public.organizations where public_id = '99000000-0000-4000-8000-000000000012'
           );
      $revoke$;
    execute format('select %I.dblink_exec($1, $2)', v_extension_schema)
      into v_status using 'feishu_lock_a', 'begin';
    execute format('select %I.dblink_exec($1, $2)', v_extension_schema)
      into v_status using 'feishu_lock_a', 'set local role service_role';
    execute format('select %I.dblink_send_query($1, $2)', v_extension_schema)
      into v_integer using 'feishu_lock_a', $query$
        select public.claim_feishu_sync_work(
          'full', null, 'feishu-lock-provider', 120,
          '99000000-0000-4000-8000-000000000012',
          '99000000-0000-4000-8000-000000000003'
        )
      $query$;
    execute format(
      'select result from %I.dblink_get_result($1) as remote(result jsonb)',
      v_extension_schema
    ) into v_takeover using 'feishu_lock_a';
    perform set_config('test.feishu_takeover', v_takeover::text, true);
    execute format('select %I.dblink_exec($1, $2)', v_extension_schema)
      into v_status using 'feishu_lock_a', 'commit';

    execute format('select %I.dblink_exec($1, $2)', v_extension_schema)
      into v_status using 'feishu_lock_a', 'begin';
    execute format('select %I.dblink_exec($1, $2)', v_extension_schema)
      into v_status using 'feishu_lock_a', 'set local role service_role';
    execute format('select %I.dblink_send_query($1, $2)', v_extension_schema)
      into v_integer using 'feishu_lock_a', $query$
        select public.claim_feishu_sync_work(
          'full', null, 'feishu-lock-provider', 120,
          '99000000-0000-4000-8000-000000000012',
          '99000000-0000-4000-8000-000000000003'
        )
      $query$;
    execute format(
      'select result from %I.dblink_get_result($1) as remote(result jsonb)',
      v_extension_schema
    ) into v_takeover_retry using 'feishu_lock_a';
    perform set_config('test.feishu_takeover_retry', v_takeover_retry::text, true);
    execute format('select %I.dblink_exec($1, $2)', v_extension_schema)
      into v_status using 'feishu_lock_a', 'commit';

    execute format(
      'select result from %I.dblink($1, $2) as remote(result jsonb)',
      v_extension_schema
    ) into v_takeover_proof using 'feishu_lock_a', format($query$
      select jsonb_build_object(
        'oldStatus', (select status from public.directory_sync_runs where public_id = %L::uuid),
        'oldCompleted', (select completed_at is not null from public.directory_sync_runs where public_id = %L::uuid),
        'oldErrorCount', (select error_count from public.directory_sync_runs where public_id = %L::uuid),
        'auditCount', (
          select count(*) from public.audit_logs
           where request_id = %L::uuid and action = 'directory.sync_failed'
             and metadata ->> 'code' = 'lease_expired_superseded'
        ),
        'auditActor', (
          select actor_auth_user_id from public.audit_logs
           where request_id = %L::uuid and action = 'directory.sync_failed'
             and metadata ->> 'code' = 'lease_expired_superseded'
        ),
        'oldActorStatus', (
          select member.status
            from public.organization_members member
            join public.organizations organization on organization.id = member.organization_id
           where member.user_id = '99000000-0000-4000-8000-000000000002'::uuid
             and organization.public_id = '99000000-0000-4000-8000-000000000012'
        ),
        'leaseRunId', (select run_id from public.feishu_sync_leases where run_id = %L::uuid),
        'leaseAttempt', (select attempt from public.feishu_sync_leases where run_id = %L::uuid)
      )
    $query$,
      v_claim_b ->> 'runId', v_claim_b ->> 'runId', v_claim_b ->> 'runId',
      v_claim_b ->> 'runId', v_claim_b ->> 'runId',
      v_takeover ->> 'runId', v_takeover ->> 'runId');
    perform set_config('test.feishu_takeover_proof', v_takeover_proof::text, true);

    execute format('select %I.dblink_exec($1, $2)', v_extension_schema)
      into v_status using 'feishu_lock_a', $cleanup$
        delete from public.tenants where slug = 'feishu-lock-test';
        delete from auth.users where id in (
          '99000000-0000-4000-8000-000000000001',
          '99000000-0000-4000-8000-000000000002',
          '99000000-0000-4000-8000-000000000003'
        );
      $cleanup$;
    execute format('select %I.dblink_disconnect($1)', v_extension_schema)
      into v_status using 'feishu_lock_a';
    execute format('select %I.dblink_disconnect($1)', v_extension_schema)
      into v_status using 'feishu_lock_b';
    execute format('select %I.dblink_disconnect($1)', v_extension_schema)
      into v_status using 'feishu_lock_c';
  exception when others then
    -- Once the capability gate has passed, every behavior failure is fatal.
    -- First cancel and drain any outstanding async result so cleanup itself
    -- cannot block behind the scenario that just failed.
    foreach v_connection_name in array array['feishu_lock_a', 'feishu_lock_b', 'feishu_lock_c'] loop
      begin
        execute format('select %I.dblink_cancel_query($1)', v_extension_schema)
          into v_status using v_connection_name;
      exception when others then null;
      end;
    end loop;
    foreach v_connection_name in array array['feishu_lock_a', 'feishu_lock_b', 'feishu_lock_c'] loop
      v_drain_wait := 0;
      loop
        begin
          execute format('select %I.dblink_is_busy($1)', v_extension_schema)
            into v_integer using v_connection_name;
        exception when others then
          v_integer := 0;
        end;
        exit when v_integer = 0 or v_drain_wait >= 100;
        v_drain_wait := v_drain_wait + 1;
        perform pg_sleep(0.01);
      end loop;
      begin
        execute format(
          'select result from %I.dblink_get_result($1) as remote(result jsonb)',
          v_extension_schema
        ) into v_drain using v_connection_name;
      exception when others then null;
      end;
    end loop;
    foreach v_connection_name in array array['feishu_lock_a', 'feishu_lock_b', 'feishu_lock_c'] loop
      begin
        execute format('select %I.dblink_exec($1, $2)', v_extension_schema)
          into v_status using v_connection_name, 'rollback';
      exception when others then null;
      end;
    end loop;
    begin
      execute format('select %I.dblink_exec($1, $2)', v_extension_schema)
        into v_status using 'feishu_lock_a', $cleanup$
          delete from public.tenants where slug = 'feishu-lock-test';
          delete from auth.users where id in (
            '99000000-0000-4000-8000-000000000001',
            '99000000-0000-4000-8000-000000000002',
            '99000000-0000-4000-8000-000000000003'
          );
        $cleanup$;
    exception when others then null;
    end;
    foreach v_connection_name in array array['feishu_lock_a', 'feishu_lock_b', 'feishu_lock_c'] loop
      begin
        execute format('select %I.dblink_disconnect($1)', v_extension_schema)
          into v_status using v_connection_name;
      exception when others then null;
      end;
    end loop;
    raise;
  end;
end;
$concurrency$;
select case when current_setting('test.feishu_dblink_available') = 'true'
  then is(current_setting('test.feishu_fair_busy')::integer, 0, 'unscoped live claim skips locked organization A and acquires ready organization B')
  else ok(true, 'unscoped live fairness proof # SKIP dblink extension or local connection unavailable')
end;
select case when current_setting('test.feishu_dblink_available') = 'true'
  then is(current_setting('test.feishu_lock_a')::jsonb ->> 'acquired', 'true', 'first live database session acquires the claim')
  else ok(true, 'first live database session claim proof # SKIP dblink extension or local connection unavailable')
end;
select case when current_setting('test.feishu_dblink_available') = 'true'
  then is(current_setting('test.feishu_lock_b')::jsonb ->> 'acquired', 'true', 'second live database session acquires independent ready work')
  else ok(true, 'second live database session claim proof # SKIP dblink extension or local connection unavailable')
end;
select case when current_setting('test.feishu_dblink_available') = 'true'
  then is(current_setting('test.feishu_lock_b')::jsonb ->> 'organizationId', '99000000-0000-4000-8000-000000000012', 'unscoped live session receives exact organization B')
  else ok(true, 'unscoped live organization proof # SKIP dblink extension or local connection unavailable')
end;
select case when current_setting('test.feishu_dblink_available') = 'true'
  then is(current_setting('test.feishu_lock_b')::jsonb ->> 'actorAuthUserId', '99000000-0000-4000-8000-000000000002', 'unscoped live session skips disabled-role A and selects the valid B actor')
  else ok(true, 'unscoped live actor proof # SKIP dblink extension or local connection unavailable')
end;
select case when current_setting('test.feishu_dblink_available') = 'true'
  then isnt(current_setting('test.feishu_lock_b')::jsonb ->> 'runId', current_setting('test.feishu_lock_a')::jsonb ->> 'runId', 'fair live claims create distinct exact-connection runs')
  else ok(true, 'fair live distinct-run proof # SKIP dblink extension or local connection unavailable')
end;
select case when current_setting('test.feishu_dblink_available') = 'true'
  then is(current_setting('test.feishu_apply_busy')::integer, 1, 'apply waits behind the pre-locked connection')
  else ok(true, 'live apply connection-first wait proof # SKIP dblink extension or local connection unavailable')
end;
select case when current_setting('test.feishu_dblink_available') = 'true'
  then is(current_setting('test.feishu_apply_probe')::boolean, true, 'apply leaves lease and run unlocked while waiting for the connection')
  else ok(true, 'live apply lock-order probe # SKIP dblink extension or local connection unavailable')
end;
select case when current_setting('test.feishu_dblink_available') = 'true'
  then is(current_setting('test.feishu_apply')::jsonb ->> 'status', 'completed', 'live fenced apply completes before finish overlap releases')
  else ok(true, 'live fenced apply proof # SKIP dblink extension or local connection unavailable')
end;
select case when current_setting('test.feishu_dblink_available') = 'true'
  then is(current_setting('test.feishu_finish_busy')::integer, 1, 'finish waits behind the apply connection-first lock')
  else ok(true, 'live apply finish lock proof # SKIP dblink extension or local connection unavailable')
end;
select case when current_setting('test.feishu_dblink_available') = 'true'
  then is(current_setting('test.feishu_finish_probe')::boolean, true, 'finish leaves lease and run unlocked while waiting for the connection')
  else ok(true, 'live finish lock-order probe # SKIP dblink extension or local connection unavailable')
end;
select case when current_setting('test.feishu_dblink_available') = 'true'
  then is(current_setting('test.feishu_finish')::jsonb ->> 'status', 'completed', 'waiting finish completes after live apply commits')
  else ok(true, 'live finish completion proof # SKIP dblink extension or local connection unavailable')
end;
select case when current_setting('test.feishu_dblink_available') = 'true'
  then is(current_setting('test.feishu_takeover')::jsonb ->> 'acquired', 'true', 'expired live lease is replaced by a new claim')
  else ok(true, 'live takeover claim proof # SKIP dblink extension or local connection unavailable')
end;
select case when current_setting('test.feishu_dblink_available') = 'true'
  then is(current_setting('test.feishu_takeover')::jsonb ->> 'attempt', '4', 'expired live lease carries cumulative attempt into replacement')
  else ok(true, 'live takeover attempt proof # SKIP dblink extension or local connection unavailable')
end;
select case when current_setting('test.feishu_dblink_available') = 'true'
  then ok(
    current_setting('test.feishu_takeover_proof')::jsonb ->> 'oldStatus' = 'failed'
    and (current_setting('test.feishu_takeover_proof')::jsonb ->> 'oldCompleted')::boolean
    and (current_setting('test.feishu_takeover_proof')::jsonb ->> 'oldErrorCount')::integer >= 1,
    'expired live lease terminalizes its old run'
  )
  else ok(true, 'live takeover terminal proof # SKIP dblink extension or local connection unavailable')
end;
select case when current_setting('test.feishu_dblink_available') = 'true'
  then ok(
    (current_setting('test.feishu_takeover_proof')::jsonb ->> 'auditCount')::integer = 1
    and current_setting('test.feishu_takeover_proof')::jsonb ->> 'leaseRunId' = current_setting('test.feishu_takeover')::jsonb ->> 'runId'
    and (current_setting('test.feishu_takeover_proof')::jsonb ->> 'leaseAttempt')::integer = 4,
    'live takeover owns one replacement lease and one old-run terminal audit'
  )
  else ok(true, 'live takeover durable proof # SKIP dblink extension or local connection unavailable')
end;
select case when current_setting('test.feishu_dblink_available') = 'true'
  then ok(
    current_setting('test.feishu_takeover_proof')::jsonb ->> 'oldActorStatus' = 'revoked'
    and current_setting('test.feishu_takeover_proof')::jsonb ->> 'auditActor' = '99000000-0000-4000-8000-000000000003',
    'live takeover succeeds after old actor revocation and audits the new active actor'
  )
  else ok(true, 'live takeover actor proof # SKIP dblink extension or local connection unavailable')
end;
select case when current_setting('test.feishu_dblink_available') = 'true'
  then is(current_setting('test.feishu_takeover_retry')::jsonb ->> 'reason', 'active_lease', 'lost-response live retry observes replacement active lease')
  else ok(true, 'live takeover retry reason proof # SKIP dblink extension or local connection unavailable')
end;
select case when current_setting('test.feishu_dblink_available') = 'true'
  then is(current_setting('test.feishu_takeover_retry')::jsonb ->> 'runId', current_setting('test.feishu_takeover')::jsonb ->> 'runId', 'lost-response live retry returns the same replacement run')
  else ok(true, 'live takeover retry idempotency proof # SKIP dblink extension or local connection unavailable')
end;
select * from finish();
rollback;
