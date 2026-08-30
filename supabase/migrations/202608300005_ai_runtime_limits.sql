begin;

create table public.ai_rate_limit_windows (
  id bigint generated always as identity primary key,
  tenant_id bigint not null references public.tenants(id) on delete cascade,
  organization_id bigint not null,
  actor_member_id bigint not null,
  operation text not null check (operation ~ '^[a-z][a-z0-9_.-]{1,79}$'),
  window_started_at timestamptz not null,
  window_seconds integer not null check (window_seconds between 1 and 86400),
  consumed_count integer not null default 0 check (consumed_count >= 0),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (tenant_id,organization_id) references public.organizations(tenant_id,id) on delete cascade,
  foreign key (tenant_id,actor_member_id) references public.organization_members(tenant_id,id) on delete cascade,
  unique (tenant_id,actor_member_id,operation,window_started_at,window_seconds)
);

create table public.ai_rate_limit_receipts (
  id bigint generated always as identity primary key,
  tenant_id bigint not null references public.tenants(id) on delete cascade,
  organization_id bigint not null,
  actor_member_id bigint not null,
  operation text not null,
  request_id uuid not null,
  allowed boolean not null,
  remaining_count integer not null check (remaining_count >= 0),
  reset_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (tenant_id,organization_id) references public.organizations(tenant_id,id) on delete cascade,
  foreign key (tenant_id,actor_member_id) references public.organization_members(tenant_id,id) on delete cascade,
  unique (tenant_id,actor_member_id,operation,request_id)
);

create table public.ai_runtime_invocations (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete cascade,
  organization_id bigint not null,
  actor_member_id bigint not null,
  request_id uuid not null,
  operation text not null check (operation ~ '^[a-z][a-z0-9_.-]{1,79}$'),
  model_code text not null check (length(btrim(model_code)) between 1 and 120),
  status text not null check (status in ('queued','running','succeeded','failed','timed_out','rate_limited')),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cost_amount numeric(14,6),
  error_code text not null default '' check (length(error_code) <= 80),
  started_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (tenant_id,organization_id) references public.organizations(tenant_id,id) on delete cascade,
  foreign key (tenant_id,actor_member_id) references public.organization_members(tenant_id,id) on delete restrict,
  unique (tenant_id,actor_member_id,request_id),
  check ((status in ('queued','running') and completed_at is null) or (status in ('succeeded','failed','timed_out','rate_limited') and completed_at is not null)),
  check (completed_at is null or completed_at >= started_at)
);

create index ai_runtime_actor_started_idx on public.ai_runtime_invocations(tenant_id,actor_member_id,started_at desc);
create index ai_runtime_open_idx on public.ai_runtime_invocations(status,started_at) where status in ('queued','running');

alter table public.ai_rate_limit_windows enable row level security;
alter table public.ai_rate_limit_windows force row level security;
alter table public.ai_rate_limit_receipts enable row level security;
alter table public.ai_rate_limit_receipts force row level security;
alter table public.ai_runtime_invocations enable row level security;
alter table public.ai_runtime_invocations force row level security;

create policy ai_runtime_self_select on public.ai_runtime_invocations for select to authenticated using (
  tenant_id=(select public.current_tenant_id()) and (
    exists (select 1 from public.organization_members member where member.tenant_id=ai_runtime_invocations.tenant_id and member.id=actor_member_id and member.user_id=(select auth.uid()) and member.status='active')
    or (select public.has_organization_role(organization_id,array['owner','admin']))
  )
);
grant select on public.ai_runtime_invocations to authenticated;

create or replace function public.resolve_ai_runtime_actor(p_tenant_public_id uuid,p_organization_public_id uuid,p_actor_member_id bigint,p_auth_user_id uuid)
returns table(tenant_id bigint,organization_id bigint,actor_member_id bigint)
language sql stable security definer set search_path='' as $$
  select tenant.id,organization.id,member.id
  from public.tenants tenant
  join public.organizations organization on organization.tenant_id=tenant.id and organization.public_id=p_organization_public_id
  join public.organization_members member on member.tenant_id=tenant.id and member.organization_id=organization.id and member.id=p_actor_member_id
  where tenant.public_id=p_tenant_public_id and tenant.status='active' and member.user_id=p_auth_user_id and member.status='active'
  limit 1;
$$;

create or replace function public.consume_ai_rate_limit(
  p_tenant_public_id uuid,p_organization_public_id uuid,p_actor_member_id bigint,p_auth_user_id uuid,
  p_operation text,p_window_seconds integer,p_limit_count integer,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor record; v_receipt public.ai_rate_limit_receipts%rowtype; v_window_start timestamptz; v_reset timestamptz; v_count integer; v_allowed boolean;
begin
  if p_request_id is null or p_operation !~ '^[a-z][a-z0-9_.-]{1,79}$' or p_window_seconds not between 1 and 86400 or p_limit_count not between 1 and 10000 then
    raise exception 'invalid_ai_rate_limit_request' using errcode='22023';
  end if;
  select * into v_actor from public.resolve_ai_runtime_actor(p_tenant_public_id,p_organization_public_id,p_actor_member_id,p_auth_user_id);
  if not found then raise exception 'forbidden' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_actor.tenant_id::text||':'||v_actor.actor_member_id::text||':'||p_operation||':'||p_request_id::text,0));
  select * into v_receipt from public.ai_rate_limit_receipts where tenant_id=v_actor.tenant_id and actor_member_id=v_actor.actor_member_id and operation=p_operation and request_id=p_request_id;
  if found then return jsonb_build_object('allowed',v_receipt.allowed,'remaining',v_receipt.remaining_count,'resetAt',v_receipt.reset_at); end if;
  v_window_start:=to_timestamp(floor(extract(epoch from clock_timestamp())/p_window_seconds)*p_window_seconds);
  v_reset:=v_window_start+make_interval(secs=>p_window_seconds);
  insert into public.ai_rate_limit_windows(tenant_id,organization_id,actor_member_id,operation,window_started_at,window_seconds)
  values(v_actor.tenant_id,v_actor.organization_id,v_actor.actor_member_id,p_operation,v_window_start,p_window_seconds) on conflict do nothing;
  select consumed_count into v_count from public.ai_rate_limit_windows where tenant_id=v_actor.tenant_id and actor_member_id=v_actor.actor_member_id and operation=p_operation and window_started_at=v_window_start and window_seconds=p_window_seconds for update;
  v_allowed:=v_count<p_limit_count;
  if v_allowed then
    update public.ai_rate_limit_windows set consumed_count=consumed_count+1,updated_at=clock_timestamp() where tenant_id=v_actor.tenant_id and actor_member_id=v_actor.actor_member_id and operation=p_operation and window_started_at=v_window_start and window_seconds=p_window_seconds returning consumed_count into v_count;
  end if;
  insert into public.ai_rate_limit_receipts(tenant_id,organization_id,actor_member_id,operation,request_id,allowed,remaining_count,reset_at)
  values(v_actor.tenant_id,v_actor.organization_id,v_actor.actor_member_id,p_operation,p_request_id,v_allowed,greatest(0,p_limit_count-v_count),v_reset);
  return jsonb_build_object('allowed',v_allowed,'remaining',greatest(0,p_limit_count-v_count),'resetAt',v_reset);
end;
$$;

create or replace function public.start_ai_runtime_invocation(
  p_tenant_public_id uuid,p_organization_public_id uuid,p_actor_member_id bigint,p_auth_user_id uuid,
  p_request_id uuid,p_operation text,p_model_code text,p_started_at timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor record; v_row public.ai_runtime_invocations%rowtype;
begin
  if p_request_id is null or p_operation !~ '^[a-z][a-z0-9_.-]{1,79}$' or length(btrim(coalesce(p_model_code,''))) not between 1 and 120 or p_started_at is null then raise exception 'invalid_ai_invocation' using errcode='22023'; end if;
  select * into v_actor from public.resolve_ai_runtime_actor(p_tenant_public_id,p_organization_public_id,p_actor_member_id,p_auth_user_id);
  if not found then raise exception 'forbidden' using errcode='42501'; end if;
  insert into public.ai_runtime_invocations(tenant_id,organization_id,actor_member_id,request_id,operation,model_code,status,started_at)
  values(v_actor.tenant_id,v_actor.organization_id,v_actor.actor_member_id,p_request_id,p_operation,btrim(p_model_code),'running',p_started_at) on conflict(tenant_id,actor_member_id,request_id) do nothing;
  select * into v_row from public.ai_runtime_invocations where tenant_id=v_actor.tenant_id and actor_member_id=v_actor.actor_member_id and request_id=p_request_id for update;
  if v_row.operation<>p_operation or v_row.model_code<>btrim(p_model_code) then raise exception 'idempotency_conflict' using errcode='23505'; end if;
  return jsonb_build_object('invocationId',v_row.public_id,'status',v_row.status);
end;
$$;

create or replace function public.finalize_ai_runtime_invocation(
  p_tenant_public_id uuid,p_organization_public_id uuid,p_actor_member_id bigint,p_auth_user_id uuid,
  p_invocation_public_id uuid,p_status text,p_input_tokens integer,p_output_tokens integer,p_cost_amount numeric,p_error_code text,p_completed_at timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor record; v_row public.ai_runtime_invocations%rowtype;
begin
  if p_status not in ('succeeded','failed','timed_out','rate_limited') or least(coalesce(p_input_tokens,-1),coalesce(p_output_tokens,-1))<0 or p_cost_amount<0 or length(coalesce(p_error_code,''))>80 or p_completed_at is null then raise exception 'invalid_ai_invocation_finalization' using errcode='22023'; end if;
  select * into v_actor from public.resolve_ai_runtime_actor(p_tenant_public_id,p_organization_public_id,p_actor_member_id,p_auth_user_id);
  if not found then raise exception 'forbidden' using errcode='42501'; end if;
  select * into v_row from public.ai_runtime_invocations where tenant_id=v_actor.tenant_id and organization_id=v_actor.organization_id and actor_member_id=v_actor.actor_member_id and public_id=p_invocation_public_id for update;
  if not found then raise exception 'not_found' using errcode='P0002'; end if;
  if v_row.status in ('succeeded','failed','timed_out','rate_limited') then return jsonb_build_object('invocationId',v_row.public_id,'status',v_row.status,'alreadyTerminal',true); end if;
  update public.ai_runtime_invocations set status=p_status,input_tokens=p_input_tokens,output_tokens=p_output_tokens,cost_amount=p_cost_amount,error_code=left(coalesce(p_error_code,''),80),completed_at=p_completed_at,updated_at=clock_timestamp() where id=v_row.id;
  return jsonb_build_object('invocationId',v_row.public_id,'status',p_status,'alreadyTerminal',false);
end;
$$;

revoke all on function public.resolve_ai_runtime_actor(uuid,uuid,bigint,uuid) from public,anon,authenticated,service_role;
revoke all on function public.consume_ai_rate_limit(uuid,uuid,bigint,uuid,text,integer,integer,uuid) from public,anon,authenticated;
revoke all on function public.start_ai_runtime_invocation(uuid,uuid,bigint,uuid,uuid,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.finalize_ai_runtime_invocation(uuid,uuid,bigint,uuid,uuid,text,integer,integer,numeric,text,timestamptz) from public,anon,authenticated;
grant execute on function public.consume_ai_rate_limit(uuid,uuid,bigint,uuid,text,integer,integer,uuid) to service_role;
grant execute on function public.start_ai_runtime_invocation(uuid,uuid,bigint,uuid,uuid,text,text,timestamptz) to service_role;
grant execute on function public.finalize_ai_runtime_invocation(uuid,uuid,bigint,uuid,uuid,text,integer,integer,numeric,text,timestamptz) to service_role;

commit;
