begin;

alter table public.agent_invocations add column agent_version_id bigint;
alter table public.agent_invocations add column request_id uuid;
alter table public.agent_invocations add constraint agent_invocations_version_fk foreign key(tenant_id,organization_id,agent_version_id) references public.agent_versions(tenant_id,organization_id,id) on delete restrict;
create unique index agent_invocations_request_uidx on public.agent_invocations(tenant_id,actor_member_id,request_id) where request_id is not null;

create table public.agent_invocation_steps (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete cascade,
  organization_id bigint not null,
  invocation_id bigint not null,
  sequence integer not null check(sequence>0),
  node_key text not null check(length(btrim(node_key)) between 1 and 80),
  event_type text not null check(event_type~'^[a-z][a-z0-9_.-]{1,79}$'),
  status text not null check(status in ('running','succeeded','failed','waiting_human','cancelled')),
  input_hash text check(input_hash is null or input_hash~'^[0-9a-f]{64}$'),
  safe_summary jsonb not null default '{}'::jsonb check(jsonb_typeof(safe_summary)='object' and pg_column_size(safe_summary)<=32768),
  created_at timestamptz not null default clock_timestamp(),
  foreign key(tenant_id,organization_id,invocation_id) references public.agent_invocations(tenant_id,organization_id,id) on delete cascade,
  unique(invocation_id,sequence)
);
alter table public.agent_invocation_steps enable row level security; alter table public.agent_invocation_steps force row level security;
create policy agent_invocation_steps_scoped_read on public.agent_invocation_steps for select to authenticated using(exists(select 1 from public.agent_invocations invocation where invocation.id=agent_invocation_steps.invocation_id and invocation.tenant_id=(select public.current_tenant_id()) and (invocation.actor_member_id in(select member.id from public.organization_members member where member.tenant_id=invocation.tenant_id and member.user_id=(select auth.uid()) and member.status='active') or (select public.has_organization_permission(invocation.organization_id,'agent.manage')))));
grant select on public.agent_invocation_steps to authenticated;

create or replace function public.reject_agent_invocation_step_mutation()
returns trigger language plpgsql security definer set search_path='' as $$ begin raise exception 'agent_invocation_steps_append_only' using errcode='42501'; end; $$;
create trigger agent_invocation_steps_append_only before update or delete on public.agent_invocation_steps for each row execute function public.reject_agent_invocation_step_mutation();

create or replace function public.validate_agent_invocation_header()
returns trigger language plpgsql security definer set search_path='' set row_security=off as $$
declare definition record;
begin
  if new.status not in ('queued','running') or new.completed_at is not null then raise exception 'Agent invocation headers must begin queued or running without completion' using errcode='23514'; end if;
  select model_code,prompt_version,tool_scope,current_version_id into definition from public.agent_definitions where id=new.agent_id and tenant_id=new.tenant_id and organization_id=new.organization_id and status='enabled' and deleted_at is null;
  if not found or new.model_code is distinct from definition.model_code or new.prompt_version is distinct from definition.prompt_version or new.tool_scope is distinct from definition.tool_scope or new.agent_version_id is distinct from definition.current_version_id then raise exception 'Agent invocation header does not match the published server definition' using errcode='23514'; end if;
  if not exists(select 1 from public.organization_members member where member.id=new.actor_member_id and member.tenant_id=new.tenant_id and member.organization_id=new.organization_id and member.status='active') then raise exception 'Agent invocation header actor is outside the authorized tenant and organization' using errcode='23514'; end if;
  return new;
end;
$$;

create or replace function public.append_agent_invocation_step(p_tenant_id bigint,p_organization_id bigint,p_invocation_public_id uuid,p_node_key text,p_event_type text,p_status text,p_input_hash text,p_safe_summary jsonb)
returns jsonb language plpgsql security definer set search_path='' set row_security=off as $$
declare v_invocation public.agent_invocations%rowtype; v_step public.agent_invocation_steps%rowtype; v_sequence integer;
begin
  if length(btrim(coalesce(p_node_key,''))) not between 1 and 80 or p_event_type!~'^[a-z][a-z0-9_.-]{1,79}$' or p_status not in ('running','succeeded','failed','waiting_human','cancelled') or (p_input_hash is not null and p_input_hash!~'^[0-9a-f]{64}$') or jsonb_typeof(p_safe_summary)<>'object' or pg_column_size(p_safe_summary)>32768 then raise exception 'invalid_agent_step' using errcode='22023'; end if;
  select * into v_invocation from public.agent_invocations where tenant_id=p_tenant_id and organization_id=p_organization_id and public_id=p_invocation_public_id for update; if not found then raise exception 'not_found' using errcode='P0002'; end if;
  if v_invocation.status not in ('queued','running') then raise exception 'agent_invocation_terminal' using errcode='55000'; end if;
  select coalesce(max(sequence),0)+1 into v_sequence from public.agent_invocation_steps where invocation_id=v_invocation.id;
  insert into public.agent_invocation_steps(tenant_id,organization_id,invocation_id,sequence,node_key,event_type,status,input_hash,safe_summary) values(p_tenant_id,p_organization_id,v_invocation.id,v_sequence,btrim(p_node_key),p_event_type,p_status,p_input_hash,p_safe_summary) returning * into v_step;
  return jsonb_build_object('stepId',v_step.public_id,'sequence',v_step.sequence,'status',v_step.status);
end;
$$;

create or replace function public.list_current_agent_runs(p_agent_public_id uuid,p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor record; v_agent bigint; v_manage boolean;
begin
  if p_agent_public_id is null or p_limit not between 1 and 200 then raise exception 'invalid_agent_run_list' using errcode='22023'; end if; select * into v_actor from public.current_agent_actor(null); if not found then raise exception 'forbidden' using errcode='42501'; end if; select id into v_agent from public.agent_definitions where tenant_id=v_actor.tenant_id and organization_id=v_actor.organization_id and public_id=p_agent_public_id and deleted_at is null; if v_agent is null then raise exception 'not_found' using errcode='P0002'; end if; v_manage:=public.has_organization_permission(v_actor.organization_id,'agent.manage');
  return jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',run.public_id,'requestId',run.request_id,'status',run.status,'inputSummary',run.input_summary,'outputSummary',run.output_summary,'modelCode',run.model_code,'promptVersion',run.prompt_version,'inputTokens',run.input_tokens,'outputTokens',run.output_tokens,'cost',run.cost_amount,'latencyMs',run.latency_ms,'errorCode',nullif(run.error_code,''),'startedAt',run.started_at,'completedAt',run.completed_at,'steps',coalesce((select jsonb_agg(jsonb_build_object('id',step.public_id,'sequence',step.sequence,'nodeKey',step.node_key,'eventType',step.event_type,'status',step.status,'summary',step.safe_summary,'createdAt',step.created_at) order by step.sequence) from public.agent_invocation_steps step where step.invocation_id=run.id),'[]'::jsonb)) order by run.started_at desc,run.id desc) from (select * from public.agent_invocations where tenant_id=v_actor.tenant_id and organization_id=v_actor.organization_id and agent_id=v_agent and (v_manage or actor_member_id=v_actor.member_id) order by started_at desc,id desc limit p_limit) run),'[]'::jsonb));
end;
$$;

revoke all on function public.append_agent_invocation_step(bigint,bigint,uuid,text,text,text,text,jsonb) from public,anon,authenticated; grant execute on function public.append_agent_invocation_step(bigint,bigint,uuid,text,text,text,text,jsonb) to service_role;
revoke all on function public.list_current_agent_runs(uuid,integer) from public,anon; grant execute on function public.list_current_agent_runs(uuid,integer) to authenticated;

commit;
