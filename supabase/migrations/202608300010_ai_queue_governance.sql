begin;

alter table public.audit_logs drop constraint if exists audit_logs_action_check;
alter table public.audit_logs add constraint audit_logs_action_check check (action in (
  'identity.provisioned','identity.claimed','identity.revoked','member.status_changed','member.role_changed','profile.updated','roster.imported','tenant.bootstrap_owner',
  'enterprise.initialized','directory.sync_started','directory.sync_completed','directory.sync_failed','directory.role_mapped','project.created','project.updated',
  'project.archived','project.restored','project.member_added','project.member_role_changed','project.member_removed','project.command_failed','project.milestone_created',
  'project.risk_created','project.activity_recorded','project.report_submitted','project.execution_failed','task.created','task.batch_created','task.claimed',
  'task.progress_updated','task.submitted','task.reviewed','task.reopened','task.acceptance_recorded','task.command_failed','task.comment_created','task.dependency_created',
  'notification.read','notification.retried','file.upload_reserved','file.upload_completed','file.upload_failed','file.upload_expired','file.download_authorized',
  'customer.created','customer.updated','customer.contact_created','customer.command_failed','customer.owner_transferred','customer.archived','customer.restored',
  'customer.contract_created','customer.source_linked','customer.import_started','customer.imported','customer.import_completed','customer.export_requested','customer.export_downloaded',
  'opportunity.created','opportunity.stage_changed','opportunity.converted','customer.follow_up_created','approval.submitted','approval.step_approved','approval.approved',
  'approval.rejected','approval.returned','approval.cancelled','approval.command_failed','expense.draft_created','expense.draft_updated','expense.submitted','expense.cancelled',
  'expense.paid','expense.command_failed','knowledge.directory_created','knowledge.draft_created','knowledge.version_created','knowledge.published','knowledge.archived',
  'knowledge.permission_changed','knowledge.command_failed','knowledge.searched','knowledge.source_downloaded','knowledge.reindexed',
  'payroll_policy.activated','payroll.calculated','payroll.confirmed','ai.config.updated','organization.department_created','organization.department_updated',
  'organization.position_upserted','organization.role_assigned','organization.command_failed','organization.manager_assigned','directory.manager_mapped',
  'employee_skill.verified','employee_skill.verification_failed','directory.sync_issue_resolved',
  'ai.conversation.created','ai.message.created','ai.message.completed','ai.message.failed','ai.conversation.archived',
  'scheduling.goal.created','scheduling.plan.created','scheduling.plan.overridden','scheduling.plan.dispatched',
  'ai.queue.enqueued','ai.queue.rate_limited','ai.queue.cancelled','ai.queue.retried','ai.queue.completed',
  'ai.confirmation.created','ai.high_risk.executed'
));

create table public.ai_runtime_budgets (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete cascade,
  organization_id bigint not null,
  scope_type text not null check (scope_type in ('tenant','department','user')),
  department_id bigint,
  actor_member_id bigint,
  period_start date not null,
  period_end date not null,
  token_limit bigint check (token_limit is null or token_limit > 0),
  cost_limit numeric(14,6) check (cost_limit is null or cost_limit > 0),
  concurrency_limit integer not null default 5 check (concurrency_limit between 1 and 100),
  consumed_tokens bigint not null default 0 check (consumed_tokens >= 0),
  consumed_cost numeric(14,6) not null default 0 check (consumed_cost >= 0),
  reserved_tokens bigint not null default 0 check (reserved_tokens >= 0),
  reserved_cost numeric(14,6) not null default 0 check (reserved_cost >= 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (tenant_id,organization_id) references public.organizations(tenant_id,id) on delete cascade,
  foreign key (tenant_id,department_id) references public.departments(tenant_id,id) on delete cascade,
  foreign key (tenant_id,actor_member_id) references public.organization_members(tenant_id,id) on delete cascade,
  check (period_start <= period_end),
  check ((scope_type='tenant' and department_id is null and actor_member_id is null) or (scope_type='department' and department_id is not null and actor_member_id is null) or (scope_type='user' and department_id is null and actor_member_id is not null)),
  unique nulls not distinct (tenant_id,organization_id,scope_type,department_id,actor_member_id,period_start,period_end)
);

create table public.ai_runtime_queue (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete cascade,
  organization_id bigint not null,
  actor_member_id bigint not null,
  department_id bigint,
  request_id uuid not null,
  operation text not null check (operation ~ '^[a-z][a-z0-9_.-]{1,79}$'),
  payload jsonb not null check (jsonb_typeof(payload)='object' and pg_column_size(payload)<=262144),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  state text not null default 'queued' check (state in ('queued','running','succeeded','failed','timed_out','cancelled','dead_letter','rate_limited')),
  priority smallint not null default 5 check (priority between 1 and 9),
  attempts integer not null default 0 check (attempts between 0 and 10),
  max_attempts integer not null default 5 check (max_attempts between 1 and 10),
  manual_retry_count integer not null default 0 check (manual_retry_count between 0 and 20),
  cycle_started_tokens bigint not null default 0 check (cycle_started_tokens>=0),
  cycle_started_cost numeric(14,6) not null default 0 check (cycle_started_cost>=0),
  scheduled_at timestamptz not null default clock_timestamp(),
  lease_token uuid,
  lease_expires_at timestamptz,
  cancel_requested_at timestamptz,
  timeout_seconds integer not null default 120 check (timeout_seconds between 10 and 1800),
  model_fallbacks text[] not null default '{}'::text[] check (cardinality(model_fallbacks)<=5),
  estimated_tokens bigint check (estimated_tokens is null or estimated_tokens>=0),
  estimated_cost numeric(14,6) check (estimated_cost is null or estimated_cost>=0),
  consumed_tokens bigint not null default 0 check (consumed_tokens>=0),
  consumed_cost numeric(14,6) not null default 0 check (consumed_cost>=0),
  result jsonb check (result is null or jsonb_typeof(result)='object'),
  error_code text not null default '' check (length(error_code)<=80),
  retention_until timestamptz not null default (clock_timestamp()+interval '90 days'),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  foreign key (tenant_id,organization_id) references public.organizations(tenant_id,id) on delete cascade,
  foreign key (tenant_id,actor_member_id) references public.organization_members(tenant_id,id) on delete restrict,
  foreign key (tenant_id,department_id) references public.departments(tenant_id,id) on delete set null,
  unique (tenant_id,actor_member_id,request_id),
  check ((state='running' and lease_token is not null and lease_expires_at is not null) or (state<>'running' and lease_token is null and lease_expires_at is null)),
  check ((state in ('queued','running') and completed_at is null) or (state not in ('queued','running') and completed_at is not null))
);
create index ai_runtime_queue_claim_idx on public.ai_runtime_queue(state,priority,scheduled_at,id) where state in ('queued','running');
create index ai_runtime_queue_retention_idx on public.ai_runtime_queue(retention_until,id) where state not in ('queued','running');

create table public.ai_runtime_budget_reservations (
  id bigint generated always as identity primary key,
  tenant_id bigint not null references public.tenants(id) on delete cascade,
  organization_id bigint not null,
  budget_id bigint not null references public.ai_runtime_budgets(id) on delete restrict,
  queue_job_id bigint not null references public.ai_runtime_queue(id) on delete cascade,
  retry_cycle integer not null check (retry_cycle between 0 and 20),
  reserved_tokens bigint not null default 0 check (reserved_tokens>=0),
  reserved_cost numeric(14,6) not null default 0 check (reserved_cost>=0),
  consumed_tokens bigint not null default 0 check (consumed_tokens>=0),
  consumed_cost numeric(14,6) not null default 0 check (consumed_cost>=0),
  created_at timestamptz not null default clock_timestamp(),
  released_at timestamptz,
  foreign key (tenant_id,organization_id) references public.organizations(tenant_id,id) on delete cascade,
  unique (queue_job_id,budget_id,retry_cycle)
);

create table public.ai_runtime_queue_commands (
  id bigint generated always as identity primary key,
  tenant_id bigint not null references public.tenants(id) on delete cascade,
  organization_id bigint not null,
  actor_member_id bigint not null,
  queue_job_id bigint not null references public.ai_runtime_queue(id) on delete cascade,
  request_id uuid not null,
  command text not null check (command in ('cancel','retry')),
  result jsonb not null check (jsonb_typeof(result)='object'),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (tenant_id,organization_id) references public.organizations(tenant_id,id) on delete cascade,
  foreign key (tenant_id,actor_member_id) references public.organization_members(tenant_id,id) on delete restrict,
  unique (tenant_id,actor_member_id,request_id)
);

create table public.ai_human_confirmations (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete cascade,
  organization_id bigint not null,
  actor_member_id bigint not null,
  request_id uuid not null,
  resource_id text not null check (length(btrim(resource_id)) between 1 and 200),
  action text not null check (action in ('send_message','modify_business_data','create_approval','publish_content','modify_permission','delete_material','export_data','create_payment_record')),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  state text not null default 'confirmed' check (state in ('confirmed','executing','consumed','expired')),
  execution_token uuid,
  confirmed_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  retention_until timestamptz not null default (clock_timestamp()+interval '365 days'),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (tenant_id,organization_id) references public.organizations(tenant_id,id) on delete cascade,
  foreign key (tenant_id,actor_member_id) references public.organization_members(tenant_id,id) on delete restrict,
  unique (tenant_id,actor_member_id,request_id),
  check (expires_at>confirmed_at),
  check ((state='executing' and execution_token is not null) or (state<>'executing' and execution_token is null))
);

create table public.ai_high_risk_executions (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete cascade,
  organization_id bigint not null,
  actor_member_id bigint not null,
  confirmation_id bigint not null unique,
  action text not null,
  resource_id text not null,
  payload_hash text not null,
  outcome text not null default 'executing' check (outcome in ('executing','succeeded','failed')),
  result_summary jsonb not null default '{}'::jsonb check (jsonb_typeof(result_summary)='object'),
  error_code text not null default '' check (length(error_code)<=80),
  started_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  retention_until timestamptz not null default (clock_timestamp()+interval '365 days'),
  foreign key (tenant_id,organization_id) references public.organizations(tenant_id,id) on delete cascade,
  foreign key (tenant_id,actor_member_id) references public.organization_members(tenant_id,id) on delete restrict,
  foreign key (confirmation_id) references public.ai_human_confirmations(id) on delete restrict,
  check ((outcome='executing' and completed_at is null) or (outcome<>'executing' and completed_at is not null))
);

create table public.ai_human_takeover_queue (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete cascade,
  organization_id bigint not null,
  queue_job_id bigint,
  reason_code text not null check (length(reason_code) between 1 and 80),
  state text not null default 'open' check (state in ('open','assigned','resolved','dismissed')),
  assigned_member_id bigint,
  safe_context jsonb not null default '{}'::jsonb check (jsonb_typeof(safe_context)='object' and pg_column_size(safe_context)<=32768),
  created_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz,
  foreign key (tenant_id,organization_id) references public.organizations(tenant_id,id) on delete cascade,
  foreign key (queue_job_id) references public.ai_runtime_queue(id) on delete set null,
  foreign key (tenant_id,assigned_member_id) references public.organization_members(tenant_id,id) on delete set null
);
create unique index ai_takeover_open_job_idx on public.ai_human_takeover_queue(queue_job_id) where queue_job_id is not null and state in ('open','assigned');

create table public.ai_evaluation_cases (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete cascade,
  organization_id bigint not null,
  operation text not null check (operation ~ '^[a-z][a-z0-9_.-]{1,79}$'),
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  expected_contract jsonb not null check (jsonb_typeof(expected_contract)='object'),
  last_result jsonb,
  status text not null default 'active' check (status in ('active','disabled')),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (tenant_id,organization_id) references public.organizations(tenant_id,id) on delete cascade,
  unique (tenant_id,organization_id,operation,input_hash)
);

alter table public.ai_runtime_budgets enable row level security; alter table public.ai_runtime_budgets force row level security;
alter table public.ai_runtime_queue enable row level security; alter table public.ai_runtime_queue force row level security;
alter table public.ai_runtime_budget_reservations enable row level security; alter table public.ai_runtime_budget_reservations force row level security;
alter table public.ai_runtime_queue_commands enable row level security; alter table public.ai_runtime_queue_commands force row level security;
alter table public.ai_human_confirmations enable row level security; alter table public.ai_human_confirmations force row level security;
alter table public.ai_high_risk_executions enable row level security; alter table public.ai_high_risk_executions force row level security;
alter table public.ai_human_takeover_queue enable row level security; alter table public.ai_human_takeover_queue force row level security;
alter table public.ai_evaluation_cases enable row level security; alter table public.ai_evaluation_cases force row level security;

create policy ai_runtime_queue_self_read on public.ai_runtime_queue for select to authenticated using (tenant_id=(select public.current_tenant_id()) and exists(select 1 from public.organization_members member where member.tenant_id=ai_runtime_queue.tenant_id and member.id=actor_member_id and member.user_id=(select auth.uid()) and member.status='active'));
create policy ai_confirmations_self_read on public.ai_human_confirmations for select to authenticated using (tenant_id=(select public.current_tenant_id()) and exists(select 1 from public.organization_members member where member.tenant_id=ai_human_confirmations.tenant_id and member.id=actor_member_id and member.user_id=(select auth.uid()) and member.status='active'));
create policy ai_executions_self_read on public.ai_high_risk_executions for select to authenticated using (tenant_id=(select public.current_tenant_id()) and exists(select 1 from public.organization_members member where member.tenant_id=ai_high_risk_executions.tenant_id and member.id=actor_member_id and member.user_id=(select auth.uid()) and member.status='active'));
grant select on public.ai_runtime_queue,public.ai_human_confirmations,public.ai_high_risk_executions to authenticated;

create or replace function public.enqueue_ai_runtime_job(
  p_tenant_public_id uuid,p_organization_public_id uuid,p_actor_member_id bigint,p_auth_user_id uuid,p_request_id uuid,p_operation text,p_payload jsonb,p_priority integer,p_max_attempts integer,p_scheduled_at timestamptz,p_timeout_seconds integer,p_model_fallbacks text[],p_estimated_tokens bigint,p_estimated_cost numeric
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor record; v_job public.ai_runtime_queue%rowtype; v_department bigint; v_hash text; v_rate_limited boolean:=false;
begin
  if p_request_id is null or p_operation !~ '^[a-z][a-z0-9_.-]{1,79}$' or p_payload is null or jsonb_typeof(p_payload)<>'object' or pg_column_size(p_payload)>262144 or p_priority not between 1 and 9 or p_max_attempts not between 1 and 10 or p_scheduled_at is null or p_timeout_seconds not between 10 and 1800 or cardinality(coalesce(p_model_fallbacks,'{}'::text[]))>5 or coalesce(p_estimated_tokens,0)<0 or coalesce(p_estimated_cost,0)<0 then raise exception 'invalid_ai_queue_request' using errcode='22023'; end if;
  select * into v_actor from public.resolve_ai_runtime_actor(p_tenant_public_id,p_organization_public_id,p_actor_member_id,p_auth_user_id); if not found then raise exception 'forbidden' using errcode='42501'; end if;
  select profile.department_id into v_department from public.employee_profiles profile where profile.tenant_id=v_actor.tenant_id and profile.organization_id=v_actor.organization_id and profile.organization_member_id=v_actor.actor_member_id and profile.deleted_at is null limit 1;
  v_hash:=encode(digest(convert_to(p_payload::text,'UTF8'),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(v_actor.tenant_id::text||':'||v_actor.actor_member_id::text||':'||p_request_id::text,0));
  select * into v_job from public.ai_runtime_queue where tenant_id=v_actor.tenant_id and actor_member_id=v_actor.actor_member_id and request_id=p_request_id for update;
  if found then if v_job.operation<>p_operation or v_job.payload_hash<>v_hash then raise exception 'idempotency_conflict' using errcode='23505'; end if; return jsonb_build_object('jobId',v_job.public_id,'status',v_job.state,'alreadyExists',true,'errorCode',nullif(v_job.error_code,'')); end if;
  perform 1 from public.ai_runtime_budgets budget where budget.tenant_id=v_actor.tenant_id and budget.organization_id=v_actor.organization_id and current_date between budget.period_start and budget.period_end and ((budget.scope_type='tenant') or (budget.scope_type='department' and budget.department_id=v_department) or (budget.scope_type='user' and budget.actor_member_id=v_actor.actor_member_id)) for update;
  select exists(select 1 from public.ai_runtime_budgets budget where budget.tenant_id=v_actor.tenant_id and budget.organization_id=v_actor.organization_id and current_date between budget.period_start and budget.period_end and ((budget.scope_type='tenant') or (budget.scope_type='department' and budget.department_id=v_department) or (budget.scope_type='user' and budget.actor_member_id=v_actor.actor_member_id)) and ((budget.token_limit is not null and budget.consumed_tokens+budget.reserved_tokens+coalesce(p_estimated_tokens,0)>budget.token_limit) or (budget.cost_limit is not null and budget.consumed_cost+budget.reserved_cost+coalesce(p_estimated_cost,0)>budget.cost_limit))) into v_rate_limited;
  insert into public.ai_runtime_queue(tenant_id,organization_id,actor_member_id,department_id,request_id,operation,payload,payload_hash,state,priority,max_attempts,scheduled_at,timeout_seconds,model_fallbacks,estimated_tokens,estimated_cost,error_code,completed_at)
  values(v_actor.tenant_id,v_actor.organization_id,v_actor.actor_member_id,v_department,p_request_id,p_operation,p_payload,v_hash,case when v_rate_limited then 'rate_limited' else 'queued' end,p_priority,p_max_attempts,p_scheduled_at,p_timeout_seconds,coalesce(p_model_fallbacks,'{}'::text[]),p_estimated_tokens,p_estimated_cost,case when v_rate_limited then 'ai_budget_exhausted' else '' end,case when v_rate_limited then clock_timestamp() else null end) returning * into v_job;
  if not v_rate_limited then
    insert into public.ai_runtime_budget_reservations(tenant_id,organization_id,budget_id,queue_job_id,retry_cycle,reserved_tokens,reserved_cost)
      select budget.tenant_id,budget.organization_id,budget.id,v_job.id,0,coalesce(p_estimated_tokens,0),coalesce(p_estimated_cost,0)
      from public.ai_runtime_budgets budget where budget.tenant_id=v_actor.tenant_id and budget.organization_id=v_actor.organization_id and current_date between budget.period_start and budget.period_end and ((budget.scope_type='tenant') or (budget.scope_type='department' and budget.department_id=v_department) or (budget.scope_type='user' and budget.actor_member_id=v_actor.actor_member_id));
    update public.ai_runtime_budgets budget set reserved_tokens=budget.reserved_tokens+coalesce(p_estimated_tokens,0),reserved_cost=budget.reserved_cost+coalesce(p_estimated_cost,0),updated_at=clock_timestamp()
      where budget.tenant_id=v_actor.tenant_id and budget.organization_id=v_actor.organization_id and current_date between budget.period_start and budget.period_end and ((budget.scope_type='tenant') or (budget.scope_type='department' and budget.department_id=v_department) or (budget.scope_type='user' and budget.actor_member_id=v_actor.actor_member_id));
  end if;
  perform public.append_audit_log(v_actor.tenant_id,v_actor.organization_id,p_auth_user_id,v_actor.actor_member_id,case when v_rate_limited then 'ai.queue.rate_limited' else 'ai.queue.enqueued' end,'ai_runtime_job',v_job.public_id::text,p_request_id,null,jsonb_build_object('operation',p_operation));
  return jsonb_build_object('jobId',v_job.public_id,'status',v_job.state,'alreadyExists',false,'errorCode',nullif(v_job.error_code,''));
end;
$$;

create or replace function public.claim_ai_runtime_queue_job(p_lease_seconds integer default 120)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_job public.ai_runtime_queue%rowtype; v_token uuid:=gen_random_uuid();
begin
  if p_lease_seconds not between 30 and 600 then raise exception 'invalid_lease' using errcode='22023'; end if;
  update public.ai_runtime_queue job set state='cancelled',lease_token=null,lease_expires_at=null,completed_at=clock_timestamp(),updated_at=clock_timestamp() where job.state='running' and job.lease_expires_at<clock_timestamp() and job.cancel_requested_at is not null;
  with exhausted as (update public.ai_runtime_queue job set state='dead_letter',lease_token=null,lease_expires_at=null,error_code='worker_lease_exhausted',completed_at=clock_timestamp(),updated_at=clock_timestamp() where job.state='running' and job.lease_expires_at<clock_timestamp() and job.attempts>=job.max_attempts returning job.*)
  insert into public.ai_human_takeover_queue(tenant_id,organization_id,queue_job_id,reason_code,safe_context) select exhausted.tenant_id,exhausted.organization_id,exhausted.id,'worker_lease_exhausted',jsonb_build_object('jobId',exhausted.public_id,'operation',exhausted.operation) from exhausted on conflict do nothing;
  with charges as (
    select reservation.budget_id,sum(reservation.reserved_tokens)::bigint reserved_tokens,sum(reservation.reserved_cost)::numeric reserved_cost,
      sum(greatest(0,job.consumed_tokens-job.cycle_started_tokens))::bigint consumed_tokens,sum(greatest(0,job.consumed_cost-job.cycle_started_cost))::numeric consumed_cost
    from public.ai_runtime_budget_reservations reservation join public.ai_runtime_queue job on job.id=reservation.queue_job_id
    where reservation.released_at is null and job.state not in ('queued','running') and reservation.retry_cycle=job.manual_retry_count group by reservation.budget_id
  ) update public.ai_runtime_budgets budget set reserved_tokens=greatest(0,budget.reserved_tokens-charges.reserved_tokens),reserved_cost=greatest(0,budget.reserved_cost-charges.reserved_cost),consumed_tokens=budget.consumed_tokens+charges.consumed_tokens,consumed_cost=budget.consumed_cost+charges.consumed_cost,updated_at=clock_timestamp() from charges where budget.id=charges.budget_id;
  update public.ai_runtime_budget_reservations reservation set consumed_tokens=greatest(0,job.consumed_tokens-job.cycle_started_tokens),consumed_cost=greatest(0,job.consumed_cost-job.cycle_started_cost),released_at=clock_timestamp()
    from public.ai_runtime_queue job where job.id=reservation.queue_job_id and reservation.released_at is null and job.state not in ('queued','running') and reservation.retry_cycle=job.manual_retry_count;
  select * into v_job from public.ai_runtime_queue job where ((job.state='queued' and job.scheduled_at<=clock_timestamp()) or (job.state='running' and job.lease_expires_at<clock_timestamp())) and job.attempts<job.max_attempts and job.cancel_requested_at is null
    and not exists (select 1 from public.ai_runtime_budget_reservations reservation join public.ai_runtime_budgets budget on budget.id=reservation.budget_id where reservation.queue_job_id=job.id and reservation.retry_cycle=job.manual_retry_count and reservation.released_at is null and budget.concurrency_limit <= (select count(*) from public.ai_runtime_queue running where running.tenant_id=job.tenant_id and running.organization_id=job.organization_id and running.state='running' and running.id<>job.id and ((budget.scope_type='tenant') or (budget.scope_type='department' and running.department_id=budget.department_id) or (budget.scope_type='user' and running.actor_member_id=budget.actor_member_id))))
  order by job.priority,job.scheduled_at,job.id for update skip locked limit 1;
  if not found then return jsonb_build_object('acquired',false); end if;
  update public.ai_runtime_queue set state='running',attempts=attempts+1,lease_token=v_token,lease_expires_at=clock_timestamp()+make_interval(secs=>p_lease_seconds),updated_at=clock_timestamp() where id=v_job.id returning * into v_job;
  return jsonb_build_object('acquired',true,'jobId',v_job.public_id,'leaseToken',v_token,'operation',v_job.operation,'payload',v_job.payload,'attempt',v_job.attempts,'timeoutSeconds',v_job.timeout_seconds,'modelFallbacks',v_job.model_fallbacks,'cancelRequested',false);
end;
$$;

create or replace function public.complete_ai_runtime_queue_job(p_job_public_id uuid,p_lease_token uuid,p_outcome text,p_result jsonb,p_error_code text,p_consumed_tokens bigint,p_consumed_cost numeric,p_retry_delay_seconds integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_job public.ai_runtime_queue%rowtype; v_state text; v_retry boolean:=false; v_user uuid; v_cycle_tokens bigint; v_cycle_cost numeric;
begin
  if p_job_public_id is null or p_lease_token is null or p_outcome not in ('succeeded','failed','timed_out') or coalesce(p_consumed_tokens,0)<0 or coalesce(p_consumed_cost,0)<0 or p_result is null or jsonb_typeof(p_result)<>'object' or pg_column_size(p_result)>65536 or length(coalesce(p_error_code,''))>80 or (p_retry_delay_seconds is not null and p_retry_delay_seconds not between 0 and 86400) then raise exception 'invalid_ai_queue_completion' using errcode='22023'; end if;
  select * into v_job from public.ai_runtime_queue where public_id=p_job_public_id and state='running' and lease_token=p_lease_token for update; if not found then raise exception 'queue_lease_conflict' using errcode='55000'; end if;
  if v_job.cancel_requested_at is not null then v_state:='cancelled'; elsif p_outcome='succeeded' then v_state:='succeeded'; elsif p_retry_delay_seconds is not null and v_job.attempts<v_job.max_attempts then v_state:='queued'; v_retry:=true; elsif v_job.attempts>=v_job.max_attempts then v_state:='dead_letter'; else v_state:=p_outcome; end if;
  v_cycle_tokens:=greatest(0,v_job.consumed_tokens+coalesce(p_consumed_tokens,0)-v_job.cycle_started_tokens);
  v_cycle_cost:=greatest(0,v_job.consumed_cost+coalesce(p_consumed_cost,0)-v_job.cycle_started_cost);
  update public.ai_runtime_queue set state=v_state,lease_token=null,lease_expires_at=null,scheduled_at=case when v_retry then clock_timestamp()+make_interval(secs=>p_retry_delay_seconds) else scheduled_at end,result=case when v_retry then null else p_result end,error_code=left(coalesce(p_error_code,''),80),consumed_tokens=consumed_tokens+coalesce(p_consumed_tokens,0),consumed_cost=consumed_cost+coalesce(p_consumed_cost,0),completed_at=case when v_retry then null else clock_timestamp() end,updated_at=clock_timestamp() where id=v_job.id;
  if not v_retry then
    update public.ai_runtime_budgets budget set reserved_tokens=greatest(0,budget.reserved_tokens-reservation.reserved_tokens),reserved_cost=greatest(0,budget.reserved_cost-reservation.reserved_cost),consumed_tokens=budget.consumed_tokens+v_cycle_tokens,consumed_cost=budget.consumed_cost+v_cycle_cost,updated_at=clock_timestamp()
      from public.ai_runtime_budget_reservations reservation where reservation.budget_id=budget.id and reservation.queue_job_id=v_job.id and reservation.retry_cycle=v_job.manual_retry_count and reservation.released_at is null;
    update public.ai_runtime_budget_reservations set consumed_tokens=v_cycle_tokens,consumed_cost=v_cycle_cost,released_at=clock_timestamp() where queue_job_id=v_job.id and retry_cycle=v_job.manual_retry_count and released_at is null;
  end if;
  if v_state in ('dead_letter','failed','timed_out') then insert into public.ai_human_takeover_queue(tenant_id,organization_id,queue_job_id,reason_code,safe_context) values(v_job.tenant_id,v_job.organization_id,v_job.id,case when v_state='dead_letter' then 'retry_exhausted' else left(coalesce(nullif(p_error_code,''),v_state),80) end,jsonb_build_object('jobId',v_job.public_id,'operation',v_job.operation)) on conflict do nothing; end if;
  select user_id into v_user from public.organization_members where tenant_id=v_job.tenant_id and id=v_job.actor_member_id;
  perform public.append_audit_log(v_job.tenant_id,v_job.organization_id,v_user,v_job.actor_member_id,'ai.queue.completed','ai_runtime_job',v_job.public_id::text,v_job.request_id,null,jsonb_build_object('state',v_state,'attempt',v_job.attempts,'retryScheduled',v_retry,'errorCode',nullif(p_error_code,'')));
  return jsonb_build_object('jobId',v_job.public_id,'status',v_state,'retryScheduled',v_retry);
end;
$$;

create or replace function public.cancel_ai_runtime_job(p_tenant_public_id uuid,p_organization_public_id uuid,p_actor_member_id bigint,p_auth_user_id uuid,p_job_public_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor record; v_job public.ai_runtime_queue%rowtype; v_receipt record; v_result jsonb;
begin
  if p_job_public_id is null or p_request_id is null then raise exception 'invalid_ai_queue_cancellation' using errcode='22023'; end if;
  select * into v_actor from public.resolve_ai_runtime_actor(p_tenant_public_id,p_organization_public_id,p_actor_member_id,p_auth_user_id); if not found then raise exception 'forbidden' using errcode='42501'; end if;
  select command.result,command.command,job.public_id job_public_id into v_receipt from public.ai_runtime_queue_commands command join public.ai_runtime_queue job on job.id=command.queue_job_id where command.tenant_id=v_actor.tenant_id and command.actor_member_id=v_actor.actor_member_id and command.request_id=p_request_id;
  if found then if v_receipt.command<>'cancel' or v_receipt.job_public_id<>p_job_public_id then raise exception 'idempotency_conflict' using errcode='23505'; end if; return v_receipt.result; end if;
  select * into v_job from public.ai_runtime_queue where tenant_id=v_actor.tenant_id and organization_id=v_actor.organization_id and actor_member_id=v_actor.actor_member_id and public_id=p_job_public_id for update; if not found then raise exception 'not_found' using errcode='P0002'; end if;
  if v_job.state='queued' then update public.ai_runtime_queue set state='cancelled',cancel_requested_at=clock_timestamp(),completed_at=clock_timestamp(),updated_at=clock_timestamp() where id=v_job.id returning * into v_job; elsif v_job.state='running' and v_job.cancel_requested_at is null then update public.ai_runtime_queue set cancel_requested_at=clock_timestamp(),updated_at=clock_timestamp() where id=v_job.id returning * into v_job; end if;
  if v_job.state='cancelled' then
    update public.ai_runtime_budgets budget set reserved_tokens=greatest(0,budget.reserved_tokens-reservation.reserved_tokens),reserved_cost=greatest(0,budget.reserved_cost-reservation.reserved_cost),updated_at=clock_timestamp()
      from public.ai_runtime_budget_reservations reservation where reservation.budget_id=budget.id and reservation.queue_job_id=v_job.id and reservation.retry_cycle=v_job.manual_retry_count and reservation.released_at is null;
    update public.ai_runtime_budget_reservations set released_at=clock_timestamp() where queue_job_id=v_job.id and retry_cycle=v_job.manual_retry_count and released_at is null;
  end if;
  perform public.append_audit_log(v_actor.tenant_id,v_actor.organization_id,p_auth_user_id,v_actor.actor_member_id,'ai.queue.cancelled','ai_runtime_job',v_job.public_id::text,p_request_id,null,jsonb_build_object('state',v_job.state,'requested',v_job.cancel_requested_at is not null));
  v_result:=jsonb_build_object('jobId',v_job.public_id,'status',v_job.state,'cancellationRequested',v_job.cancel_requested_at is not null);
  insert into public.ai_runtime_queue_commands(tenant_id,organization_id,actor_member_id,queue_job_id,request_id,command,result) values(v_actor.tenant_id,v_actor.organization_id,v_actor.actor_member_id,v_job.id,p_request_id,'cancel',v_result);
  return v_result;
end;
$$;

create or replace function public.retry_ai_runtime_job(p_tenant_public_id uuid,p_organization_public_id uuid,p_actor_member_id bigint,p_auth_user_id uuid,p_job_public_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor record; v_job public.ai_runtime_queue%rowtype; v_receipt record; v_result jsonb;
begin
  if p_job_public_id is null or p_request_id is null then raise exception 'invalid_ai_queue_retry' using errcode='22023'; end if;
  select * into v_actor from public.resolve_ai_runtime_actor(p_tenant_public_id,p_organization_public_id,p_actor_member_id,p_auth_user_id); if not found then raise exception 'forbidden' using errcode='42501'; end if;
  select command.result,command.command,job.public_id job_public_id into v_receipt from public.ai_runtime_queue_commands command join public.ai_runtime_queue job on job.id=command.queue_job_id where command.tenant_id=v_actor.tenant_id and command.actor_member_id=v_actor.actor_member_id and command.request_id=p_request_id;
  if found then if v_receipt.command<>'retry' or v_receipt.job_public_id<>p_job_public_id then raise exception 'idempotency_conflict' using errcode='23505'; end if; return v_receipt.result; end if;
  select * into v_job from public.ai_runtime_queue where tenant_id=v_actor.tenant_id and organization_id=v_actor.organization_id and actor_member_id=v_actor.actor_member_id and public_id=p_job_public_id for update; if not found then raise exception 'not_found' using errcode='P0002'; end if;
  if v_job.state not in ('dead_letter','failed','timed_out') or v_job.manual_retry_count>=20 then raise exception 'queue_job_not_retryable' using errcode='55000'; end if;
  perform 1 from public.ai_runtime_budgets budget where budget.tenant_id=v_actor.tenant_id and budget.organization_id=v_actor.organization_id and current_date between budget.period_start and budget.period_end and ((budget.scope_type='tenant') or (budget.scope_type='department' and budget.department_id=v_job.department_id) or (budget.scope_type='user' and budget.actor_member_id=v_actor.actor_member_id)) for update;
  if exists(select 1 from public.ai_runtime_budgets budget where budget.tenant_id=v_actor.tenant_id and budget.organization_id=v_actor.organization_id and current_date between budget.period_start and budget.period_end and ((budget.scope_type='tenant') or (budget.scope_type='department' and budget.department_id=v_job.department_id) or (budget.scope_type='user' and budget.actor_member_id=v_actor.actor_member_id)) and ((budget.token_limit is not null and budget.consumed_tokens+budget.reserved_tokens+coalesce(v_job.estimated_tokens,0)>budget.token_limit) or (budget.cost_limit is not null and budget.consumed_cost+budget.reserved_cost+coalesce(v_job.estimated_cost,0)>budget.cost_limit))) then raise exception 'ai_budget_exhausted' using errcode='55000'; end if;
  update public.ai_runtime_queue set state='queued',attempts=0,manual_retry_count=manual_retry_count+1,cycle_started_tokens=consumed_tokens,cycle_started_cost=consumed_cost,scheduled_at=clock_timestamp(),lease_token=null,lease_expires_at=null,cancel_requested_at=null,result=null,error_code='',completed_at=null,updated_at=clock_timestamp() where id=v_job.id returning * into v_job;
  insert into public.ai_runtime_budget_reservations(tenant_id,organization_id,budget_id,queue_job_id,retry_cycle,reserved_tokens,reserved_cost)
    select budget.tenant_id,budget.organization_id,budget.id,v_job.id,v_job.manual_retry_count,coalesce(v_job.estimated_tokens,0),coalesce(v_job.estimated_cost,0) from public.ai_runtime_budgets budget where budget.tenant_id=v_actor.tenant_id and budget.organization_id=v_actor.organization_id and current_date between budget.period_start and budget.period_end and ((budget.scope_type='tenant') or (budget.scope_type='department' and budget.department_id=v_job.department_id) or (budget.scope_type='user' and budget.actor_member_id=v_actor.actor_member_id));
  update public.ai_runtime_budgets budget set reserved_tokens=budget.reserved_tokens+coalesce(v_job.estimated_tokens,0),reserved_cost=budget.reserved_cost+coalesce(v_job.estimated_cost,0),updated_at=clock_timestamp() where budget.tenant_id=v_actor.tenant_id and budget.organization_id=v_actor.organization_id and current_date between budget.period_start and budget.period_end and ((budget.scope_type='tenant') or (budget.scope_type='department' and budget.department_id=v_job.department_id) or (budget.scope_type='user' and budget.actor_member_id=v_actor.actor_member_id));
  update public.ai_human_takeover_queue set state='dismissed',resolved_at=clock_timestamp() where queue_job_id=v_job.id and state in ('open','assigned');
  perform public.append_audit_log(v_actor.tenant_id,v_actor.organization_id,p_auth_user_id,v_actor.actor_member_id,'ai.queue.retried','ai_runtime_job',v_job.public_id::text,p_request_id,null,jsonb_build_object('manualRetryCount',v_job.manual_retry_count));
  v_result:=jsonb_build_object('jobId',v_job.public_id,'status',v_job.state,'manualRetryCount',v_job.manual_retry_count);
  insert into public.ai_runtime_queue_commands(tenant_id,organization_id,actor_member_id,queue_job_id,request_id,command,result) values(v_actor.tenant_id,v_actor.organization_id,v_actor.actor_member_id,v_job.id,p_request_id,'retry',v_result);
  return v_result;
end;
$$;

create or replace function public.confirm_current_ai_action(p_resource_id text,p_action text,p_payload_hash text,p_ttl_seconds integer,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor record; v_confirmation public.ai_human_confirmations%rowtype;
begin
  if length(btrim(coalesce(p_resource_id,''))) not between 1 and 200 or p_action not in ('send_message','modify_business_data','create_approval','publish_content','modify_permission','delete_material','export_data','create_payment_record') or p_payload_hash!~'^[0-9a-f]{64}$' or p_ttl_seconds not between 30 and 600 or p_request_id is null then raise exception 'invalid_confirmation' using errcode='22023'; end if;
  select * into v_actor from public.current_ai_conversation_actor(); if not found then raise exception 'forbidden' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_actor.tenant_id::text||':'||v_actor.member_id::text||':'||p_request_id::text,0));
  select * into v_confirmation from public.ai_human_confirmations where tenant_id=v_actor.tenant_id and actor_member_id=v_actor.member_id and request_id=p_request_id for update;
  if found then if v_confirmation.resource_id<>btrim(p_resource_id) or v_confirmation.action<>p_action or v_confirmation.payload_hash<>p_payload_hash then raise exception 'idempotency_conflict' using errcode='23505'; end if; return jsonb_build_object('confirmationId',v_confirmation.public_id,'action',v_confirmation.action,'resourceId',v_confirmation.resource_id,'expiresAt',v_confirmation.expires_at,'state',v_confirmation.state,'requestId',p_request_id); end if;
  insert into public.ai_human_confirmations(tenant_id,organization_id,actor_member_id,request_id,resource_id,action,payload_hash,expires_at) values(v_actor.tenant_id,v_actor.organization_id,v_actor.member_id,p_request_id,btrim(p_resource_id),p_action,p_payload_hash,clock_timestamp()+make_interval(secs=>p_ttl_seconds)) returning * into v_confirmation;
  perform public.append_audit_log(v_actor.tenant_id,v_actor.organization_id,v_actor.user_id,v_actor.member_id,'ai.confirmation.created','ai_human_confirmation',v_confirmation.public_id::text,p_request_id,null,jsonb_build_object('action',v_confirmation.action,'resourceId',v_confirmation.resource_id,'expiresAt',v_confirmation.expires_at));
  return jsonb_build_object('confirmationId',v_confirmation.public_id,'action',v_confirmation.action,'resourceId',v_confirmation.resource_id,'expiresAt',v_confirmation.expires_at,'state',v_confirmation.state,'requestId',p_request_id);
end;
$$;

create or replace function public.claim_ai_human_confirmation(p_tenant_public_id uuid,p_organization_public_id uuid,p_actor_member_id bigint,p_auth_user_id uuid,p_confirmation_public_id uuid,p_resource_id text,p_action text,p_payload_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor record; v_confirmation public.ai_human_confirmations%rowtype; v_execution public.ai_high_risk_executions%rowtype; v_token uuid:=gen_random_uuid();
begin
  select * into v_actor from public.resolve_ai_runtime_actor(p_tenant_public_id,p_organization_public_id,p_actor_member_id,p_auth_user_id); if not found then return jsonb_build_object('claimed',false,'code','human_confirmation_mismatch'); end if;
  select * into v_confirmation from public.ai_human_confirmations where tenant_id=v_actor.tenant_id and public_id=p_confirmation_public_id for update; if not found then return jsonb_build_object('claimed',false,'code','human_confirmation_required'); end if;
  if v_confirmation.actor_member_id<>v_actor.actor_member_id or v_confirmation.organization_id<>v_actor.organization_id or v_confirmation.resource_id<>p_resource_id or v_confirmation.action<>p_action or v_confirmation.payload_hash<>p_payload_hash then return jsonb_build_object('claimed',false,'code','human_confirmation_mismatch'); end if;
  if v_confirmation.state in ('executing','consumed') then return jsonb_build_object('claimed',false,'code','human_confirmation_replayed'); end if;
  if v_confirmation.state='expired' or v_confirmation.expires_at<=clock_timestamp() then update public.ai_human_confirmations set state='expired' where id=v_confirmation.id; return jsonb_build_object('claimed',false,'code','human_confirmation_expired'); end if;
  update public.ai_human_confirmations set state='executing',execution_token=v_token where id=v_confirmation.id;
  insert into public.ai_high_risk_executions(tenant_id,organization_id,actor_member_id,confirmation_id,action,resource_id,payload_hash) values(v_confirmation.tenant_id,v_confirmation.organization_id,v_confirmation.actor_member_id,v_confirmation.id,v_confirmation.action,v_confirmation.resource_id,v_confirmation.payload_hash) returning * into v_execution;
  return jsonb_build_object('claimed',true,'confirmationId',v_confirmation.public_id,'executionToken',v_token,'executionId',v_execution.public_id);
end;
$$;

create or replace function public.complete_ai_high_risk_execution(p_confirmation_public_id uuid,p_execution_token uuid,p_success boolean,p_result_summary jsonb,p_error_code text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_confirmation public.ai_human_confirmations%rowtype; v_execution public.ai_high_risk_executions%rowtype; v_user uuid;
begin
  if p_result_summary is null or jsonb_typeof(p_result_summary)<>'object' or pg_column_size(p_result_summary)>32768 or length(coalesce(p_error_code,''))>80 then raise exception 'invalid_execution_result' using errcode='22023'; end if;
  select * into v_confirmation from public.ai_human_confirmations where public_id=p_confirmation_public_id and state='executing' and execution_token=p_execution_token for update; if not found then raise exception 'confirmation_lease_conflict' using errcode='55000'; end if;
  select * into v_execution from public.ai_high_risk_executions where confirmation_id=v_confirmation.id and outcome='executing' for update; if not found then raise exception 'execution_audit_missing' using errcode='55000'; end if;
  update public.ai_human_confirmations set state='consumed',execution_token=null,consumed_at=clock_timestamp() where id=v_confirmation.id;
  update public.ai_high_risk_executions set outcome=case when p_success then 'succeeded' else 'failed' end,result_summary=p_result_summary,error_code=left(coalesce(p_error_code,''),80),completed_at=clock_timestamp() where id=v_execution.id returning * into v_execution;
  select user_id into v_user from public.organization_members where tenant_id=v_confirmation.tenant_id and id=v_confirmation.actor_member_id;
  perform public.append_audit_log(v_confirmation.tenant_id,v_confirmation.organization_id,v_user,v_confirmation.actor_member_id,'ai.high_risk.executed','ai_high_risk_execution',v_execution.public_id::text,v_confirmation.request_id,null,jsonb_build_object('action',v_confirmation.action,'resourceId',v_confirmation.resource_id,'outcome',v_execution.outcome,'errorCode',nullif(v_execution.error_code,'')));
  return jsonb_build_object('executionId',v_execution.public_id,'outcome',v_execution.outcome);
end;
$$;

create or replace function public.purge_expired_ai_runtime_records(p_batch_size integer default 500)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_queue integer:=0; v_executions integer:=0; v_confirmations integer:=0;
begin
  if p_batch_size not between 1 and 5000 then raise exception 'invalid_batch_size' using errcode='22023'; end if;
  with doomed as (select id from public.ai_runtime_queue where state not in ('queued','running') and retention_until<clock_timestamp() order by id limit p_batch_size for update skip locked), deleted as (delete from public.ai_runtime_queue where id in (select id from doomed) returning 1) select count(*) into v_queue from deleted;
  with doomed as (select id from public.ai_high_risk_executions where outcome<>'executing' and retention_until<clock_timestamp() order by id limit p_batch_size for update skip locked), deleted as (delete from public.ai_high_risk_executions where id in (select id from doomed) returning 1) select count(*) into v_executions from deleted;
  with doomed as (select confirmation.id from public.ai_human_confirmations confirmation where confirmation.state in ('consumed','expired') and confirmation.retention_until<clock_timestamp() and not exists(select 1 from public.ai_high_risk_executions execution where execution.confirmation_id=confirmation.id) order by confirmation.id limit p_batch_size for update skip locked), deleted as (delete from public.ai_human_confirmations where id in (select id from doomed) returning 1) select count(*) into v_confirmations from deleted;
  return jsonb_build_object('queue',v_queue,'executions',v_executions,'confirmations',v_confirmations);
end;
$$;

revoke all on function public.enqueue_ai_runtime_job(uuid,uuid,bigint,uuid,uuid,text,jsonb,integer,integer,timestamptz,integer,text[],bigint,numeric) from public,anon,authenticated;
revoke all on function public.claim_ai_runtime_queue_job(integer) from public,anon,authenticated;
revoke all on function public.complete_ai_runtime_queue_job(uuid,uuid,text,jsonb,text,bigint,numeric,integer) from public,anon,authenticated;
revoke all on function public.cancel_ai_runtime_job(uuid,uuid,bigint,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.retry_ai_runtime_job(uuid,uuid,bigint,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.confirm_current_ai_action(text,text,text,integer,uuid) from public,anon;
revoke all on function public.claim_ai_human_confirmation(uuid,uuid,bigint,uuid,uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.complete_ai_high_risk_execution(uuid,uuid,boolean,jsonb,text) from public,anon,authenticated;
revoke all on function public.purge_expired_ai_runtime_records(integer) from public,anon,authenticated;
grant execute on function public.enqueue_ai_runtime_job(uuid,uuid,bigint,uuid,uuid,text,jsonb,integer,integer,timestamptz,integer,text[],bigint,numeric) to service_role;
grant execute on function public.claim_ai_runtime_queue_job(integer) to service_role;
grant execute on function public.complete_ai_runtime_queue_job(uuid,uuid,text,jsonb,text,bigint,numeric,integer) to service_role;
grant execute on function public.cancel_ai_runtime_job(uuid,uuid,bigint,uuid,uuid,uuid) to service_role;
grant execute on function public.retry_ai_runtime_job(uuid,uuid,bigint,uuid,uuid,uuid) to service_role;
grant execute on function public.confirm_current_ai_action(text,text,text,integer,uuid) to authenticated;
grant execute on function public.claim_ai_human_confirmation(uuid,uuid,bigint,uuid,uuid,text,text,text) to service_role;
grant execute on function public.complete_ai_high_risk_execution(uuid,uuid,boolean,jsonb,text) to service_role;
grant execute on function public.purge_expired_ai_runtime_records(integer) to service_role;

commit;
