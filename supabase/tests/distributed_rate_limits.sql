begin;
select no_plan();

select has_table('public', 'distributed_rate_limit_buckets');
select has_table('public', 'distributed_rate_limit_receipts');
select has_function('public', 'consume_distributed_rate_limit', array[
  'text','text','text','text','integer','integer','integer','uuid'
]);
select has_function('public', 'purge_expired_distributed_rate_limits', array['integer']);
select has_function('public', 'commercial_readiness_status', array['text']);
select policies_are('public', 'distributed_rate_limit_buckets', array[]::text[]);
select policies_are('public', 'distributed_rate_limit_receipts', array[]::text[]);
select ok(not has_table_privilege('authenticated', 'public.distributed_rate_limit_buckets', 'SELECT,INSERT,UPDATE,DELETE'));
select ok(not has_table_privilege('authenticated', 'public.distributed_rate_limit_receipts', 'SELECT,INSERT,UPDATE,DELETE'));

select is(
  (public.consume_distributed_rate_limit(repeat('a',64),repeat('b',64),repeat('c',64),'auth.login',60,2,120,'93000000-0000-4000-8000-000000000001'::uuid)->>'allowed')::boolean,
  true,
  'first request is allowed'
);
select is(
  (public.consume_distributed_rate_limit(repeat('a',64),repeat('b',64),repeat('c',64),'auth.login',60,2,120,'93000000-0000-4000-8000-000000000002'::uuid)->>'allowed')::boolean,
  true,
  'second request is allowed'
);
select is(
  (public.consume_distributed_rate_limit(repeat('a',64),repeat('b',64),repeat('c',64),'auth.login',60,2,120,'93000000-0000-4000-8000-000000000003'::uuid)->>'allowed')::boolean,
  false,
  'limit persists and locks the shared scope'
);
select is(
  (public.consume_distributed_rate_limit(repeat('d',64),repeat('b',64),repeat('c',64),'auth.login',60,2,120,'93000000-0000-4000-8000-000000000004'::uuid)->>'allowed')::boolean,
  true,
  'tenant scope is isolated'
);
select is(
  (public.consume_distributed_rate_limit(repeat('a',64),repeat('d',64),repeat('c',64),'auth.login',60,2,120,'93000000-0000-4000-8000-000000000005'::uuid)->>'allowed')::boolean,
  true,
  'subject scope is isolated'
);
select is(
  (public.consume_distributed_rate_limit(repeat('a',64),repeat('b',64),repeat('d',64),'auth.login',60,2,120,'93000000-0000-4000-8000-000000000006'::uuid)->>'allowed')::boolean,
  true,
  'IP scope is isolated'
);
select is(
  public.consume_distributed_rate_limit(repeat('a',64),repeat('b',64),repeat('c',64),'auth.login',60,2,120,'93000000-0000-4000-8000-000000000003'::uuid),
  (select receipt.result from public.distributed_rate_limit_receipts receipt where receipt.request_id='93000000-0000-4000-8000-000000000003'::uuid),
  'the same request id replays its durable result without another hit'
);

update public.distributed_rate_limit_buckets
set window_started_at = clock_timestamp() - interval '5 minutes',
    locked_until = clock_timestamp() - interval '1 minute',
    expires_at = clock_timestamp() + interval '1 day'
where tenant_scope_hash = repeat('a',64)
  and subject_scope_hash = repeat('b',64)
  and ip_scope_hash = repeat('c',64)
  and action = 'auth.login';
select is(
  (public.consume_distributed_rate_limit(repeat('a',64),repeat('b',64),repeat('c',64),'auth.login',60,2,120,'93000000-0000-4000-8000-000000000007'::uuid)->>'allowed')::boolean,
  true,
  'lockout recovers after both lock and window expiry'
);

update public.distributed_rate_limit_receipts set expires_at=clock_timestamp()-interval '1 second';
select cmp_ok(
  (public.purge_expired_distributed_rate_limits(5000)->>'receipts')::integer,
  '>',
  0,
  'expired receipt cleanup is bounded and effective'
);
select is(
  public.commercial_readiness_status('202609010001')->>'migrationReady',
  'true',
  'readiness marker matches the forward migration'
);
select is(
  public.commercial_readiness_status('old-marker')->>'migrationReady',
  'false',
  'an old release marker is not ready'
);

select * from finish();
rollback;
