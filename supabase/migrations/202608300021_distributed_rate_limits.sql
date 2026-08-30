begin;

create table public.distributed_rate_limit_buckets (
  tenant_scope_hash text not null check (tenant_scope_hash ~ '^[0-9a-f]{64}$'),
  subject_scope_hash text not null check (subject_scope_hash ~ '^[0-9a-f]{64}$'),
  ip_scope_hash text not null check (ip_scope_hash ~ '^[0-9a-f]{64}$'),
  action text not null check (action ~ '^[a-z][a-z0-9_.-]{1,79}$'),
  window_started_at timestamptz not null,
  window_seconds integer not null check (window_seconds between 1 and 86400),
  hit_count integer not null check (hit_count >= 0),
  locked_until timestamptz,
  expires_at timestamptz not null,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (tenant_scope_hash, subject_scope_hash, ip_scope_hash, action),
  check (locked_until is null or locked_until >= window_started_at),
  check (expires_at >= window_started_at)
);

create table public.distributed_rate_limit_receipts (
  request_id uuid primary key,
  scope_digest text not null check (scope_digest ~ '^[0-9a-f]{64}$'),
  result jsonb not null check (
    jsonb_typeof(result) = 'object'
    and result ? 'allowed'
    and result ? 'remaining'
    and result ? 'resetAt'
  ),
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp()
);

create index distributed_rate_limit_buckets_expiry_idx
  on public.distributed_rate_limit_buckets (expires_at);
create index distributed_rate_limit_receipts_expiry_idx
  on public.distributed_rate_limit_receipts (expires_at);

alter table public.distributed_rate_limit_buckets enable row level security;
alter table public.distributed_rate_limit_buckets force row level security;
alter table public.distributed_rate_limit_receipts enable row level security;
alter table public.distributed_rate_limit_receipts force row level security;

create or replace function public.consume_distributed_rate_limit(
  p_tenant_scope_hash text,
  p_subject_scope_hash text,
  p_ip_scope_hash text,
  p_action text,
  p_window_seconds integer,
  p_limit_count integer,
  p_lockout_seconds integer,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_bucket public.distributed_rate_limit_buckets%rowtype;
  v_receipt public.distributed_rate_limit_receipts%rowtype;
  v_scope_digest text;
  v_allowed boolean;
  v_remaining integer;
  v_reset_at timestamptz;
  v_retry_after integer;
  v_result jsonb;
begin
  if p_tenant_scope_hash !~ '^[0-9a-f]{64}$'
     or p_subject_scope_hash !~ '^[0-9a-f]{64}$'
     or p_ip_scope_hash !~ '^[0-9a-f]{64}$'
     or p_action !~ '^[a-z][a-z0-9_.-]{1,79}$'
     or p_window_seconds not between 1 and 86400
     or p_limit_count not between 1 and 10000
     or p_lockout_seconds not between 1 and 604800
     or p_request_id is null then
    raise exception 'invalid_distributed_rate_limit_request' using errcode = '22023';
  end if;

  v_scope_digest := encode(public.digest(convert_to(
    p_tenant_scope_hash || ':' || p_subject_scope_hash || ':' || p_ip_scope_hash || ':'
      || p_action || ':' || p_window_seconds::text || ':' || p_limit_count::text || ':'
      || p_lockout_seconds::text,
    'UTF8'
  ), 'sha256'), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    p_tenant_scope_hash || ':' || p_subject_scope_hash || ':' || p_ip_scope_hash || ':' || p_action,
    0
  ));

  select * into v_receipt
  from public.distributed_rate_limit_receipts receipt
  where receipt.request_id = p_request_id;
  if found then
    if v_receipt.scope_digest <> v_scope_digest then
      raise exception 'distributed_rate_limit_idempotency_conflict' using errcode = '23505';
    end if;
    return v_receipt.result;
  end if;

  select * into v_bucket
  from public.distributed_rate_limit_buckets bucket
  where bucket.tenant_scope_hash = p_tenant_scope_hash
    and bucket.subject_scope_hash = p_subject_scope_hash
    and bucket.ip_scope_hash = p_ip_scope_hash
    and bucket.action = p_action
  for update;

  if not found then
    insert into public.distributed_rate_limit_buckets (
      tenant_scope_hash, subject_scope_hash, ip_scope_hash, action,
      window_started_at, window_seconds, hit_count, locked_until, expires_at
    ) values (
      p_tenant_scope_hash, p_subject_scope_hash, p_ip_scope_hash, p_action,
      v_now, p_window_seconds, 0, null,
      v_now + make_interval(secs => p_window_seconds + 86400)
    );
    select * into strict v_bucket
    from public.distributed_rate_limit_buckets bucket
    where bucket.tenant_scope_hash = p_tenant_scope_hash
      and bucket.subject_scope_hash = p_subject_scope_hash
      and bucket.ip_scope_hash = p_ip_scope_hash
      and bucket.action = p_action
    for update;
  end if;

  if v_now >= greatest(
    v_bucket.window_started_at + make_interval(secs => v_bucket.window_seconds),
    coalesce(v_bucket.locked_until, '-infinity'::timestamptz)
  ) then
    v_bucket.window_started_at := v_now;
    v_bucket.window_seconds := p_window_seconds;
    v_bucket.hit_count := 0;
    v_bucket.locked_until := null;
  elsif v_bucket.window_seconds <> p_window_seconds then
    raise exception 'distributed_rate_limit_policy_conflict' using errcode = '23505';
  end if;

  if v_bucket.locked_until is not null and v_bucket.locked_until > v_now then
    v_allowed := false;
  else
    v_bucket.hit_count := v_bucket.hit_count + 1;
    v_allowed := v_bucket.hit_count <= p_limit_count;
    if not v_allowed then
      v_bucket.locked_until := v_now + make_interval(secs => p_lockout_seconds);
    end if;
  end if;

  v_reset_at := greatest(
    v_bucket.window_started_at + make_interval(secs => v_bucket.window_seconds),
    coalesce(v_bucket.locked_until, '-infinity'::timestamptz)
  );
  v_remaining := greatest(0, p_limit_count - v_bucket.hit_count);
  v_retry_after := case when v_allowed then 0 else greatest(1, ceil(extract(epoch from (v_reset_at - v_now)))::integer) end;

  update public.distributed_rate_limit_buckets
  set window_started_at = v_bucket.window_started_at,
      window_seconds = v_bucket.window_seconds,
      hit_count = v_bucket.hit_count,
      locked_until = v_bucket.locked_until,
      expires_at = v_reset_at + interval '1 day',
      updated_at = v_now
  where tenant_scope_hash = p_tenant_scope_hash
    and subject_scope_hash = p_subject_scope_hash
    and ip_scope_hash = p_ip_scope_hash
    and action = p_action;

  v_result := jsonb_build_object(
    'allowed', v_allowed,
    'remaining', v_remaining,
    'resetAt', v_reset_at,
    'retryAfter', v_retry_after,
    'lockedUntil', v_bucket.locked_until
  );
  insert into public.distributed_rate_limit_receipts (
    request_id, scope_digest, result, expires_at
  ) values (
    p_request_id, v_scope_digest, v_result, v_reset_at + interval '1 day'
  );
  return v_result;
end;
$$;

create or replace function public.purge_expired_distributed_rate_limits(p_limit integer default 5000)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receipts integer := 0;
  v_buckets integer := 0;
begin
  if p_limit not between 1 and 50000 then
    raise exception 'invalid_distributed_rate_limit_cleanup' using errcode = '22023';
  end if;
  with expired as (
    select receipt.request_id
    from public.distributed_rate_limit_receipts receipt
    where receipt.expires_at < clock_timestamp()
    order by receipt.expires_at
    limit p_limit
    for update skip locked
  ), removed as (
    delete from public.distributed_rate_limit_receipts receipt
    using expired
    where receipt.request_id = expired.request_id
    returning 1
  ) select count(*) into v_receipts from removed;

  with expired as (
    select bucket.tenant_scope_hash, bucket.subject_scope_hash, bucket.ip_scope_hash, bucket.action
    from public.distributed_rate_limit_buckets bucket
    where bucket.expires_at < clock_timestamp()
    order by bucket.expires_at
    limit p_limit
    for update skip locked
  ), removed as (
    delete from public.distributed_rate_limit_buckets bucket
    using expired
    where bucket.tenant_scope_hash = expired.tenant_scope_hash
      and bucket.subject_scope_hash = expired.subject_scope_hash
      and bucket.ip_scope_hash = expired.ip_scope_hash
      and bucket.action = expired.action
    returning 1
  ) select count(*) into v_buckets from removed;
  return jsonb_build_object('receipts', v_receipts, 'buckets', v_buckets);
end;
$$;

create or replace function public.commercial_readiness_status(p_required_marker text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_marker constant text := '202608300021';
begin
  return jsonb_build_object(
    'database', true,
    'migrationMarker', v_marker,
    'migrationReady', p_required_marker = v_marker
      and to_regclass('public.distributed_rate_limit_buckets') is not null
      and to_regclass('public.distributed_rate_limit_receipts') is not null,
    'checkedAt', clock_timestamp()
  );
end;
$$;

revoke all on table public.distributed_rate_limit_buckets from public, anon, authenticated, service_role;
revoke all on table public.distributed_rate_limit_receipts from public, anon, authenticated, service_role;
revoke all on function public.consume_distributed_rate_limit(text,text,text,text,integer,integer,integer,uuid) from public, anon, authenticated;
revoke all on function public.purge_expired_distributed_rate_limits(integer) from public, anon, authenticated;
revoke all on function public.commercial_readiness_status(text) from public, anon, authenticated;
grant execute on function public.consume_distributed_rate_limit(text,text,text,text,integer,integer,integer,uuid) to service_role;
grant execute on function public.purge_expired_distributed_rate_limits(integer) to service_role;
grant execute on function public.commercial_readiness_status(text) to service_role;

commit;
