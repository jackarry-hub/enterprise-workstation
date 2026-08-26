begin;

select plan(31);

select has_table('public', 'feishu_oauth_attempts', 'OAuth attempts are durable');
select has_table('public', 'feishu_webhook_events', 'provider events are durable');
select has_table('public', 'feishu_entity_sequences', 'per-entity sequences are durable');
select has_table('public', 'feishu_sync_conflicts', 'reconciliation conflicts are durable');
select has_table('public', 'feishu_sync_leases', 'worker leases are durable');
select has_table('public', 'feishu_access_grants', 'queued access grants are durable');
select has_view('public', 'current_feishu_sync_issues', 'manager issue view exists');

select has_function('public', 'create_feishu_oauth_attempt', array['uuid','text','text','timestamp with time zone']::name[], 'OAuth creation RPC exists');
select has_function('public', 'consume_feishu_oauth_attempt', array['uuid','text']::name[], 'OAuth consumption RPC exists');
select has_function('public', 'ingest_feishu_webhook_event', array['text','text','text','text','text','text','bigint','text']::name[], 'event ingestion RPC exists');
select has_function('public', 'revoke_departed_member_access', array['uuid','text']::name[], 'transactional offboarding RPC exists');
select has_function('public', 'claim_feishu_sync_work', array['text','text','text','integer']::name[], 'lease claim RPC exists');
select has_function('public', 'finish_feishu_sync_work', array['uuid','text','text','timestamp with time zone']::name[], 'lease completion RPC exists');
select has_function('public', 'resolve_feishu_sync_issue', array['uuid','uuid','uuid']::name[], 'audited issue resolution RPC exists');
select has_function('public', 'next_feishu_sync_cursor', array['text']::name[], 'scheduled work reads a tenant-bound durable event cursor');

select ok(
  has_function_privilege('service_role', 'public.create_feishu_oauth_attempt(uuid,text,text,timestamptz)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.consume_feishu_oauth_attempt(uuid,text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.ingest_feishu_webhook_event(text,text,text,text,text,text,bigint,text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.revoke_departed_member_access(uuid,text)', 'EXECUTE'),
  'service role can execute protected controls'
);
select ok(
  not has_function_privilege('authenticated', 'public.create_feishu_oauth_attempt(uuid,text,text,timestamptz)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.consume_feishu_oauth_attempt(uuid,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.ingest_feishu_webhook_event(text,text,text,text,text,text,bigint,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.revoke_departed_member_access(uuid,text)', 'EXECUTE'),
  'browser roles cannot execute protected controls'
);
select ok(
  not has_table_privilege('service_role', 'public.feishu_oauth_attempts', 'INSERT,UPDATE,DELETE')
  and not has_table_privilege('service_role', 'public.feishu_webhook_events', 'INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated', 'public.feishu_sync_leases', 'SELECT,INSERT,UPDATE,DELETE'),
  'callers cannot bypass control RPCs with table writes'
);
select ok(
  (select relforcerowsecurity from pg_class where oid = 'public.feishu_oauth_attempts'::regclass)
  and (select relforcerowsecurity from pg_class where oid = 'public.feishu_webhook_events'::regclass)
  and (select relforcerowsecurity from pg_class where oid = 'public.feishu_sync_conflicts'::regclass),
  'sensitive control tables force RLS'
);
select ok(
  (select array_to_string(proconfig, ',') = 'search_path=""' from pg_proc where oid = 'public.consume_feishu_oauth_attempt(uuid,text)'::regprocedure)
  and (select array_to_string(proconfig, ',') = 'search_path=""' from pg_proc where oid = 'public.ingest_feishu_webhook_event(text,text,text,text,text,text,bigint,text)'::regprocedure)
  and (select array_to_string(proconfig, ',') = 'search_path=""' from pg_proc where oid = 'public.revoke_departed_member_access(uuid,text)'::regprocedure),
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

select * from finish();
rollback;
