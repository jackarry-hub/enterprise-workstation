begin;

create table public.agent_orchestration_runs (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete restrict,
  organization_id bigint not null,
  orchestration_id bigint not null,
  orchestration_version_id bigint not null,
  actor_member_id bigint not null,
  request_id uuid not null,
  status text not null default 'running' check(status in ('running','succeeded','failed')),
  execution_depth integer not null default 1 check(execution_depth between 1 and 8),
  input_summary text not null default '' check(length(input_summary)<=600),
  output_summary text not null default '' check(length(output_summary)<=600),
  error_code text not null default '' check(length(error_code)<=120),
  total_cost numeric(14,6) not null default 0 check(total_cost>=0),
  started_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  foreign key(tenant_id,organization_id) references public.organizations(tenant_id,id) on delete restrict,
  foreign key(tenant_id,organization_id,orchestration_id) references public.agent_orchestrations(tenant_id,organization_id,id) on delete restrict,
  foreign key(tenant_id,organization_id,orchestration_version_id) references public.agent_orchestration_versions(tenant_id,organization_id,id) on delete restrict,
  foreign key(tenant_id,actor_member_id) references public.organization_members(tenant_id,id) on delete restrict,
  unique(tenant_id,actor_member_id,request_id),
  unique(tenant_id,organization_id,id),
  check((status='running' and completed_at is null) or (status in ('succeeded','failed') and completed_at is not null))
);

create table public.agent_orchestration_node_runs (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete restrict,
  organization_id bigint not null,
  orchestration_run_id bigint not null,
  node_key text not null check(node_key~'^[a-z][a-z0-9_]{0,63}$'),
  sequence integer not null check(sequence between 1 and 8),
  agent_version_id bigint not null,
  request_id uuid not null default gen_random_uuid(),
  agent_invocation_id bigint,
  status text not null default 'pending' check(status in ('pending','succeeded','failed','cancelled')),
  output_summary text not null default '' check(length(output_summary)<=600),
  error_code text not null default '' check(length(error_code)<=120),
  started_at timestamptz,
  completed_at timestamptz,
  foreign key(tenant_id,organization_id,orchestration_run_id) references public.agent_orchestration_runs(tenant_id,organization_id,id) on delete cascade,
  foreign key(tenant_id,organization_id,agent_version_id) references public.agent_versions(tenant_id,organization_id,id) on delete restrict,
  foreign key(tenant_id,organization_id,agent_invocation_id) references public.agent_invocations(tenant_id,organization_id,id) on delete restrict,
  unique(orchestration_run_id,node_key),
  unique(orchestration_run_id,sequence),
  unique(tenant_id,request_id),
  check((status='pending' and started_at is null and completed_at is null) or (status in ('succeeded','failed','cancelled') and started_at is not null and completed_at is not null))
);

create index agent_orchestration_runs_recent_idx on public.agent_orchestration_runs(organization_id,started_at desc);
create index agent_orchestration_node_runs_run_idx on public.agent_orchestration_node_runs(orchestration_run_id,sequence);

alter table public.agent_orchestration_runs enable row level security; alter table public.agent_orchestration_runs force row level security;
alter table public.agent_orchestration_node_runs enable row level security; alter table public.agent_orchestration_node_runs force row level security;
create policy agent_orchestration_runs_scoped_read on public.agent_orchestration_runs for select to authenticated using(
  tenant_id=(select public.current_tenant_id()) and (actor_member_id in(select member.id from public.organization_members member where member.tenant_id=agent_orchestration_runs.tenant_id and member.user_id=(select auth.uid()) and member.status='active') or (select public.has_organization_permission(organization_id,'agent.orchestrate')))
);
create policy agent_orchestration_node_runs_scoped_read on public.agent_orchestration_node_runs for select to authenticated using(exists(
  select 1 from public.agent_orchestration_runs run where run.id=agent_orchestration_node_runs.orchestration_run_id and run.tenant_id=(select public.current_tenant_id()) and (run.actor_member_id in(select member.id from public.organization_members member where member.tenant_id=run.tenant_id and member.user_id=(select auth.uid()) and member.status='active') or (select public.has_organization_permission(run.organization_id,'agent.orchestrate')))
));
grant select on public.agent_orchestration_runs,public.agent_orchestration_node_runs to authenticated;

create or replace function public.reject_agent_orchestration_run_mutation()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if current_setting('app.agent_orchestration_transition_id',true) is distinct from old.public_id::text then raise exception 'agent_orchestration_runs_append_only' using errcode='42501'; end if;
  if old.status in ('succeeded','failed') then raise exception 'agent_orchestration_run_terminal' using errcode='55000'; end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;
create trigger agent_orchestration_runs_append_only before update or delete on public.agent_orchestration_runs for each row execute function public.reject_agent_orchestration_run_mutation();

create or replace function public.reject_agent_orchestration_node_run_mutation()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if current_setting('app.agent_orchestration_transition_id',true) is distinct from (select run.public_id::text from public.agent_orchestration_runs run where run.id=old.orchestration_run_id) then raise exception 'agent_orchestration_node_runs_append_only' using errcode='42501'; end if;
  if old.status in ('succeeded','failed','cancelled') then raise exception 'agent_orchestration_node_terminal' using errcode='55000'; end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;
create trigger agent_orchestration_node_runs_append_only before update or delete on public.agent_orchestration_node_runs for each row execute function public.reject_agent_orchestration_node_run_mutation();

create or replace function public.start_agent_orchestration_run(
  p_tenant_public_id uuid,p_organization_public_id uuid,p_actor_member_id bigint,p_auth_user_id uuid,
  p_orchestration_public_id uuid,p_input_summary text,p_request_id uuid
)
returns jsonb language plpgsql security definer set search_path='' set row_security=off as $$
declare v_tenant bigint; v_organization bigint; v_orchestration public.agent_orchestrations%rowtype; v_version public.agent_orchestration_versions%rowtype; v_run public.agent_orchestration_runs%rowtype; v_node_count integer; v_graph jsonb; v_already_exists boolean:=false;
begin
  if p_tenant_public_id is null or p_organization_public_id is null or p_actor_member_id is null or p_auth_user_id is null or p_orchestration_public_id is null or p_request_id is null or length(coalesce(p_input_summary,'')) not between 1 and 600 then raise exception 'invalid_orchestration_run' using errcode='22023'; end if;
  select tenant.id into v_tenant from public.tenants tenant where tenant.public_id=p_tenant_public_id and tenant.status='active';
  select organization.id into v_organization from public.organizations organization where organization.tenant_id=v_tenant and organization.public_id=p_organization_public_id;
  if v_tenant is null or v_organization is null or not exists(select 1 from public.organization_members member where member.tenant_id=v_tenant and member.organization_id=v_organization and member.id=p_actor_member_id and member.user_id=p_auth_user_id and member.status='active') then raise exception 'forbidden' using errcode='42501'; end if;
  if not exists(select 1 from public.member_roles assignment join public.roles role on role.tenant_id=assignment.tenant_id and role.id=assignment.role_id and role.is_enabled join public.role_permissions role_permission on role_permission.tenant_id=role.tenant_id and role_permission.role_id=role.id join public.permissions permission on permission.id=role_permission.permission_id where assignment.tenant_id=v_tenant and assignment.member_id=p_actor_member_id and (role.organization_id is null or role.organization_id=v_organization) and permission.code='agent.orchestrate') then raise exception 'forbidden' using errcode='42501'; end if;
  if exists(select 1 from public.agent_runtime_controls control where control.tenant_id=v_tenant and control.organization_id=v_organization and control.kill_switch_enabled) then raise exception 'tenant_kill_switch' using errcode='55000'; end if;
  select * into v_orchestration from public.agent_orchestrations where tenant_id=v_tenant and organization_id=v_organization and public_id=p_orchestration_public_id and status='published'; if not found then raise exception 'not_found' using errcode='P0002'; end if;
  select * into v_version from public.agent_orchestration_versions where id=v_orchestration.current_version_id and tenant_id=v_tenant and organization_id=v_organization and lifecycle='published'; if not found then raise exception 'orchestration_version_unavailable' using errcode='55000'; end if;
  select count(*) into v_node_count from public.agent_orchestration_nodes where orchestration_version_id=v_version.id; if v_node_count not between 1 and 8 then raise exception 'orchestration_execution_size' using errcode='22023'; end if;
  if exists(select 1 from public.agent_orchestration_nodes node join public.agent_versions version on version.id=node.agent_version_id and version.tenant_id=node.tenant_id join public.agent_definitions agent on agent.id=version.agent_id and agent.tenant_id=version.tenant_id where node.orchestration_version_id=v_version.id and (version.lifecycle<>'published' or agent.status<>'enabled' or agent.current_version_id<>version.id or not public.is_valid_agent_runtime_limits(version.limits) or (version.limits->>'maxDepth')::integer<1)) then raise exception 'orchestration_pinned_version_stale' using errcode='55000'; end if;
  select * into v_run from public.agent_orchestration_runs where tenant_id=v_tenant and actor_member_id=p_actor_member_id and request_id=p_request_id;
  if not found then
    insert into public.agent_orchestration_runs(tenant_id,organization_id,orchestration_id,orchestration_version_id,actor_member_id,request_id,input_summary) values(v_tenant,v_organization,v_orchestration.id,v_version.id,p_actor_member_id,p_request_id,left(p_input_summary,600)) returning * into v_run;
    insert into public.agent_orchestration_node_runs(tenant_id,organization_id,orchestration_run_id,node_key,sequence,agent_version_id)
      select v_tenant,v_organization,v_run.id,node.node_key,node.sequence,node.agent_version_id from public.agent_orchestration_nodes node where node.orchestration_version_id=v_version.id order by node.sequence;
  elsif v_run.orchestration_id<>v_orchestration.id or v_run.input_summary<>left(p_input_summary,600) then raise exception 'idempotency_conflict' using errcode='23505'; else v_already_exists:=true; end if;
  select jsonb_build_object(
    'nodes',coalesce((select jsonb_agg(jsonb_build_object('key',node.node_key,'sequence',node.sequence,'agentId',agent.public_id,'agentVersionId',version.public_id,'requestId',node_run.request_id,'maxDepth',(version.limits->>'maxDepth')::integer) order by node.sequence) from public.agent_orchestration_nodes node join public.agent_versions version on version.id=node.agent_version_id join public.agent_definitions agent on agent.id=version.agent_id join public.agent_orchestration_node_runs node_run on node_run.orchestration_run_id=v_run.id and node_run.node_key=node.node_key where node.orchestration_version_id=v_version.id),'[]'::jsonb),
    'edges',coalesce((select jsonb_agg(jsonb_build_object('from',edge.source_node_key,'to',edge.target_node_key) order by edge.source_node_key,edge.target_node_key) from public.agent_orchestration_edges edge where edge.orchestration_version_id=v_version.id),'[]'::jsonb)
  ) into v_graph;
  return jsonb_build_object('runId',v_run.public_id,'status',v_run.status,'alreadyExists',v_already_exists,'graph',v_graph,'startedAt',v_run.started_at,'completedAt',v_run.completed_at,'outputSummary',v_run.output_summary,'errorCode',nullif(v_run.error_code,''));
end;
$$;

create or replace function public.record_agent_orchestration_node_result(p_run_public_id uuid,p_node_key text,p_status text,p_agent_invocation_public_id uuid,p_output_summary text,p_error_code text,p_started_at timestamptz,p_completed_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' set row_security=off as $$
declare v_run public.agent_orchestration_runs%rowtype; v_node public.agent_orchestration_node_runs%rowtype; v_invocation public.agent_invocations%rowtype;
begin
  if p_run_public_id is null or p_node_key is null or p_status not in ('succeeded','failed') or p_started_at is null or p_completed_at is null or p_completed_at<p_started_at or length(coalesce(p_output_summary,''))>600 or length(coalesce(p_error_code,''))>120 then raise exception 'invalid_orchestration_node_result' using errcode='22023'; end if;
  select * into v_run from public.agent_orchestration_runs where public_id=p_run_public_id for update; if not found then raise exception 'not_found' using errcode='P0002'; end if; if v_run.status<>'running' then raise exception 'orchestration_run_terminal' using errcode='55000'; end if;
  select * into v_node from public.agent_orchestration_node_runs where orchestration_run_id=v_run.id and node_key=p_node_key for update; if not found then raise exception 'not_found' using errcode='P0002'; end if; if v_node.status<>'pending' then return jsonb_build_object('nodeId',v_node.public_id,'status',v_node.status,'alreadyRecorded',true); end if;
  if p_agent_invocation_public_id is not null then select * into v_invocation from public.agent_invocations where public_id=p_agent_invocation_public_id and tenant_id=v_run.tenant_id and organization_id=v_run.organization_id and actor_member_id=v_run.actor_member_id and agent_version_id=v_node.agent_version_id and status in ('succeeded','failed'); if not found then raise exception 'agent_invocation_mismatch' using errcode='23514'; end if; end if;
  perform set_config('app.agent_orchestration_transition_id',v_run.public_id::text,true);
  update public.agent_orchestration_node_runs set status=p_status,agent_invocation_id=v_invocation.id,output_summary=left(coalesce(p_output_summary,''),600),error_code=left(coalesce(p_error_code,''),120),started_at=p_started_at,completed_at=p_completed_at where id=v_node.id returning * into v_node;
  perform set_config('app.agent_orchestration_transition_id','',true);
  return jsonb_build_object('nodeId',v_node.public_id,'status',v_node.status,'alreadyRecorded',false);
end;
$$;

create or replace function public.finalize_agent_orchestration_run(p_run_public_id uuid,p_status text,p_output_summary text,p_error_code text,p_completed_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' set row_security=off as $$
declare v_run public.agent_orchestration_runs%rowtype; v_member public.organization_members%rowtype; v_cost numeric(14,6);
begin
  if p_run_public_id is null or p_status not in ('succeeded','failed') or p_completed_at is null or length(coalesce(p_output_summary,''))>600 or length(coalesce(p_error_code,''))>120 then raise exception 'invalid_orchestration_finalization' using errcode='22023'; end if;
  select * into v_run from public.agent_orchestration_runs where public_id=p_run_public_id for update; if not found then raise exception 'not_found' using errcode='P0002'; end if; if v_run.status in ('succeeded','failed') then return jsonb_build_object('runId',v_run.public_id,'status',v_run.status,'alreadyFinalized',true); end if;
  if p_status='succeeded' and exists(select 1 from public.agent_orchestration_node_runs node where node.orchestration_run_id=v_run.id and node.status<>'succeeded') then raise exception 'orchestration_nodes_incomplete' using errcode='55000'; end if;
  if p_status='failed' then perform set_config('app.agent_orchestration_transition_id',v_run.public_id::text,true); update public.agent_orchestration_node_runs set status='cancelled',started_at=p_completed_at,completed_at=p_completed_at,error_code='upstream_node_failed' where orchestration_run_id=v_run.id and status='pending'; perform set_config('app.agent_orchestration_transition_id','',true); end if;
  select coalesce(sum(invocation.cost_amount),0) into v_cost from public.agent_orchestration_node_runs node join public.agent_invocations invocation on invocation.id=node.agent_invocation_id where node.orchestration_run_id=v_run.id;
  perform set_config('app.agent_orchestration_transition_id',v_run.public_id::text,true); update public.agent_orchestration_runs set status=p_status,output_summary=left(coalesce(p_output_summary,''),600),error_code=left(coalesce(p_error_code,''),120),total_cost=v_cost,completed_at=p_completed_at where id=v_run.id returning * into v_run; perform set_config('app.agent_orchestration_transition_id','',true);
  select * into v_member from public.organization_members where tenant_id=v_run.tenant_id and id=v_run.actor_member_id;
  perform public.append_audit_log(v_run.tenant_id,v_run.organization_id,v_member.user_id,v_run.actor_member_id,'agent.orchestration.run_finalized','agent_orchestration_run',v_run.public_id::text,v_run.request_id,null,jsonb_build_object('status',v_run.status,'errorCode',nullif(v_run.error_code,''),'totalCost',v_run.total_cost));
  return jsonb_build_object('runId',v_run.public_id,'status',v_run.status,'outputSummary',v_run.output_summary,'errorCode',nullif(v_run.error_code,''),'totalCost',v_run.total_cost,'completedAt',v_run.completed_at,'alreadyFinalized',false);
end;
$$;

create or replace function public.list_current_agent_orchestration_runs(p_orchestration_public_id uuid,p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor record; v_orchestration bigint;
begin
  if p_orchestration_public_id is null or p_limit not between 1 and 100 then raise exception 'invalid_orchestration_run_list' using errcode='22023'; end if; select * into v_actor from public.current_agent_actor('agent.orchestrate'); if not found then raise exception 'forbidden' using errcode='42501'; end if; select id into v_orchestration from public.agent_orchestrations where tenant_id=v_actor.tenant_id and organization_id=v_actor.organization_id and public_id=p_orchestration_public_id; if v_orchestration is null then raise exception 'not_found' using errcode='P0002'; end if;
  return jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',run.public_id,'status',run.status,'inputSummary',run.input_summary,'outputSummary',run.output_summary,'errorCode',nullif(run.error_code,''),'totalCost',run.total_cost,'startedAt',run.started_at,'completedAt',run.completed_at,'nodes',coalesce((select jsonb_agg(jsonb_build_object('id',node.public_id,'key',node.node_key,'sequence',node.sequence,'status',node.status,'outputSummary',node.output_summary,'errorCode',nullif(node.error_code,''),'startedAt',node.started_at,'completedAt',node.completed_at) order by node.sequence) from public.agent_orchestration_node_runs node where node.orchestration_run_id=run.id),'[]'::jsonb)) order by run.started_at desc) from (select * from public.agent_orchestration_runs where tenant_id=v_actor.tenant_id and organization_id=v_actor.organization_id and orchestration_id=v_orchestration order by started_at desc limit p_limit) run),'[]'::jsonb));
end;
$$;

revoke all on function public.start_agent_orchestration_run(uuid,uuid,bigint,uuid,uuid,text,uuid) from public,anon,authenticated,service_role; grant execute on function public.start_agent_orchestration_run(uuid,uuid,bigint,uuid,uuid,text,uuid) to service_role;
revoke all on function public.record_agent_orchestration_node_result(uuid,text,text,uuid,text,text,timestamptz,timestamptz) from public,anon,authenticated,service_role; grant execute on function public.record_agent_orchestration_node_result(uuid,text,text,uuid,text,text,timestamptz,timestamptz) to service_role;
revoke all on function public.finalize_agent_orchestration_run(uuid,text,text,text,timestamptz) from public,anon,authenticated,service_role; grant execute on function public.finalize_agent_orchestration_run(uuid,text,text,text,timestamptz) to service_role;
revoke all on function public.list_current_agent_orchestration_runs(uuid,integer) from public,anon; grant execute on function public.list_current_agent_orchestration_runs(uuid,integer) to authenticated;

commit;
