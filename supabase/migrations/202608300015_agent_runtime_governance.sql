begin;

insert into public.permissions(code,name,module,action) values('agent.runtime.kill','紧急停止智能体运行','agents','runtime.kill') on conflict(code) do update set name=excluded.name,module=excluded.module,action=excluded.action;
insert into public.role_permissions(tenant_id,role_id,permission_id)
select role.tenant_id,role.id,permission.id from public.roles role join public.permissions permission on permission.code='agent.runtime.kill'
where role.is_system and role.is_enabled and role.organization_id is null and role.code in ('owner','admin') on conflict do nothing;

create table public.agent_runtime_controls (
  tenant_id bigint not null references public.tenants(id) on delete cascade,
  organization_id bigint not null,
  kill_switch_enabled boolean not null default false,
  reason text not null default '' check(length(reason)<=500),
  version bigint not null default 1 check(version>0),
  updated_by_member_id bigint,
  updated_at timestamptz not null default clock_timestamp(),
  primary key(tenant_id,organization_id),
  foreign key(tenant_id,organization_id) references public.organizations(tenant_id,id) on delete cascade,
  foreign key(tenant_id,updated_by_member_id) references public.organization_members(tenant_id,id) on delete restrict
);

create table public.agent_runtime_tool_allowlists (
  tenant_id bigint not null references public.tenants(id) on delete cascade,
  organization_id bigint not null,
  tool_code text not null references public.agent_tool_catalog(code) on delete restrict,
  enabled boolean not null default true,
  updated_at timestamptz not null default clock_timestamp(),
  primary key(tenant_id,organization_id,tool_code),
  foreign key(tenant_id,organization_id) references public.organizations(tenant_id,id) on delete cascade
);

create table public.agent_runtime_data_allowlists (
  tenant_id bigint not null references public.tenants(id) on delete cascade,
  organization_id bigint not null,
  data_scope text not null check(data_scope~'^[a-z][a-z0-9_.-]{1,79}$'),
  enabled boolean not null default true,
  updated_at timestamptz not null default clock_timestamp(),
  primary key(tenant_id,organization_id,data_scope),
  foreign key(tenant_id,organization_id) references public.organizations(tenant_id,id) on delete cascade
);

insert into public.agent_runtime_controls(tenant_id,organization_id) select tenant_id,id from public.organizations on conflict do nothing;
insert into public.agent_runtime_tool_allowlists(tenant_id,organization_id,tool_code) select organization.tenant_id,organization.id,tool.code from public.organizations organization cross join public.agent_tool_catalog tool where tool.status='active' on conflict do nothing;
insert into public.agent_runtime_data_allowlists(tenant_id,organization_id,data_scope) select organization.tenant_id,organization.id,scope.code from public.organizations organization cross join (values('knowledge.read'),('project.read'),('task.read'),('customer.read'),('approval.read')) scope(code) on conflict do nothing;

alter table public.agent_runtime_controls enable row level security; alter table public.agent_runtime_controls force row level security;
alter table public.agent_runtime_tool_allowlists enable row level security; alter table public.agent_runtime_tool_allowlists force row level security;
alter table public.agent_runtime_data_allowlists enable row level security; alter table public.agent_runtime_data_allowlists force row level security;
create policy agent_runtime_controls_admin_read on public.agent_runtime_controls for select to authenticated using(tenant_id=(select public.current_tenant_id()) and (select public.has_organization_permission(organization_id,'agent.manage')));
create policy agent_runtime_tool_allowlists_admin_read on public.agent_runtime_tool_allowlists for select to authenticated using(tenant_id=(select public.current_tenant_id()) and (select public.has_organization_permission(organization_id,'agent.manage')));
create policy agent_runtime_data_allowlists_admin_read on public.agent_runtime_data_allowlists for select to authenticated using(tenant_id=(select public.current_tenant_id()) and (select public.has_organization_permission(organization_id,'agent.manage')));
grant select on public.agent_runtime_controls,public.agent_runtime_tool_allowlists,public.agent_runtime_data_allowlists to authenticated;

alter table public.agent_invocations add column cancel_requested_at timestamptz;

create or replace function public.is_valid_agent_runtime_limits(p_limits jsonb)
returns boolean language sql immutable set search_path='' as $$
  select jsonb_typeof(p_limits)='object' and not exists(select 1 from jsonb_object_keys(p_limits) key where key not in ('maxSteps','maxDepth','timeoutSeconds','maxTokens','maxConcurrent'))
    and coalesce((p_limits->>'maxSteps')~'^[0-9]+$',false) and (p_limits->>'maxSteps')::integer between 1 and 100
    and coalesce((p_limits->>'maxDepth')~'^[0-9]+$',false) and (p_limits->>'maxDepth')::integer between 1 and 8
    and coalesce((p_limits->>'timeoutSeconds')~'^[0-9]+$',false) and (p_limits->>'timeoutSeconds')::integer between 10 and 1800
    and coalesce((p_limits->>'maxTokens')~'^[0-9]+$',false) and (p_limits->>'maxTokens')::integer between 1 and 4000
    and coalesce((p_limits->>'maxConcurrent')~'^[0-9]+$',false) and (p_limits->>'maxConcurrent')::integer between 1 and 50;
$$;

create or replace function public.validate_agent_version_publication()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.lifecycle='published' and old.lifecycle<>'published' then
    if not public.is_valid_agent_runtime_limits(new.limits) then raise exception 'agent_limits_invalid' using errcode='22023'; end if;
    if exists(select 1 from public.agent_version_tools tool where tool.agent_version_id=new.id and not exists(select 1 from public.agent_runtime_tool_allowlists allowlist where allowlist.tenant_id=new.tenant_id and allowlist.organization_id=new.organization_id and allowlist.tool_code=tool.tool_code and allowlist.enabled)) then raise exception 'agent_tool_forbidden' using errcode='42501'; end if;
    if exists(select 1 from unnest(new.data_scopes) scope where not exists(select 1 from public.agent_runtime_data_allowlists allowlist where allowlist.tenant_id=new.tenant_id and allowlist.organization_id=new.organization_id and allowlist.data_scope=scope and allowlist.enabled)) then raise exception 'agent_data_scope_forbidden' using errcode='42501'; end if;
  end if;
  return new;
end;
$$;
create trigger agent_versions_validate_publication before update of lifecycle on public.agent_versions for each row execute function public.validate_agent_version_publication();

create or replace function public.validate_agent_invocation_header()
returns trigger language plpgsql security definer set search_path='' set row_security=off as $$
declare definition record; v_version public.agent_versions%rowtype; v_running integer;
begin
  if new.status not in ('queued','running') or new.completed_at is not null then raise exception 'Agent invocation headers must begin queued or running without completion' using errcode='23514'; end if;
  if exists(select 1 from public.agent_runtime_controls control where control.tenant_id=new.tenant_id and control.organization_id=new.organization_id and control.kill_switch_enabled) then raise exception 'tenant_kill_switch' using errcode='55000'; end if;
  select model_code,prompt_version,tool_scope,current_version_id into definition from public.agent_definitions where id=new.agent_id and tenant_id=new.tenant_id and organization_id=new.organization_id and status='enabled' and deleted_at is null;
  if not found or new.model_code is distinct from definition.model_code or new.prompt_version is distinct from definition.prompt_version or new.tool_scope is distinct from definition.tool_scope or new.agent_version_id is distinct from definition.current_version_id then raise exception 'Agent invocation header does not match the published server definition' using errcode='23514'; end if;
  select * into v_version from public.agent_versions where id=new.agent_version_id and tenant_id=new.tenant_id and organization_id=new.organization_id and lifecycle='published'; if not found or not public.is_valid_agent_runtime_limits(v_version.limits) then raise exception 'agent_version_not_runnable' using errcode='55000'; end if;
  if exists(select 1 from public.agent_version_tools tool where tool.agent_version_id=v_version.id and not exists(select 1 from public.agent_runtime_tool_allowlists allowlist where allowlist.tenant_id=new.tenant_id and allowlist.organization_id=new.organization_id and allowlist.tool_code=tool.tool_code and allowlist.enabled)) then raise exception 'agent_tool_forbidden' using errcode='42501'; end if;
  if exists(select 1 from unnest(v_version.data_scopes) scope where not exists(select 1 from public.agent_runtime_data_allowlists allowlist where allowlist.tenant_id=new.tenant_id and allowlist.organization_id=new.organization_id and allowlist.data_scope=scope and allowlist.enabled)) then raise exception 'agent_data_scope_forbidden' using errcode='42501'; end if;
  select count(*) into v_running from public.agent_invocations invocation where invocation.tenant_id=new.tenant_id and invocation.organization_id=new.organization_id and invocation.agent_id=new.agent_id and invocation.status in ('queued','running'); if v_running>=(v_version.limits->>'maxConcurrent')::integer then raise exception 'agent_concurrency_limit' using errcode='55000'; end if;
  if not exists(select 1 from public.organization_members member where member.id=new.actor_member_id and member.tenant_id=new.tenant_id and member.organization_id=new.organization_id and member.status='active') then raise exception 'Agent invocation header actor is outside the authorized tenant and organization' using errcode='23514'; end if;
  return new;
end;
$$;

create or replace function public.append_agent_invocation_step(p_tenant_id bigint,p_organization_id bigint,p_invocation_public_id uuid,p_node_key text,p_event_type text,p_status text,p_input_hash text,p_safe_summary jsonb)
returns jsonb language plpgsql security definer set search_path='' set row_security=off as $$
declare v_invocation public.agent_invocations%rowtype; v_step public.agent_invocation_steps%rowtype; v_sequence integer; v_limits jsonb;
begin
  if length(btrim(coalesce(p_node_key,''))) not between 1 and 80 or p_event_type!~'^[a-z][a-z0-9_.-]{1,79}$' or p_status not in ('running','succeeded','failed','waiting_human','cancelled') or (p_input_hash is not null and p_input_hash!~'^[0-9a-f]{64}$') or jsonb_typeof(p_safe_summary)<>'object' or pg_column_size(p_safe_summary)>32768 then raise exception 'invalid_agent_step' using errcode='22023'; end if;
  select * into v_invocation from public.agent_invocations where tenant_id=p_tenant_id and organization_id=p_organization_id and public_id=p_invocation_public_id for update; if not found then raise exception 'not_found' using errcode='P0002'; end if;
  if v_invocation.status not in ('queued','running') or v_invocation.cancel_requested_at is not null then raise exception 'agent_invocation_terminal' using errcode='55000'; end if;
  select limits into v_limits from public.agent_versions where id=v_invocation.agent_version_id;
  select coalesce(max(sequence),0)+1 into v_sequence from public.agent_invocation_steps where invocation_id=v_invocation.id;
  if v_sequence>(v_limits->>'maxSteps')::integer then raise exception 'agent_step_limit' using errcode='54000'; end if;
  if (select count(*) from public.agent_invocation_steps where invocation_id=v_invocation.id and node_key=p_node_key and event_type=p_event_type)>=3 then raise exception 'agent_loop_detected' using errcode='54000'; end if;
  insert into public.agent_invocation_steps(tenant_id,organization_id,invocation_id,sequence,node_key,event_type,status,input_hash,safe_summary) values(p_tenant_id,p_organization_id,v_invocation.id,v_sequence,btrim(p_node_key),p_event_type,p_status,p_input_hash,p_safe_summary) returning * into v_step;
  return jsonb_build_object('stepId',v_step.public_id,'sequence',v_step.sequence,'status',v_step.status);
end;
$$;

create or replace function public.finalize_agent_invocation(p_tenant_id bigint,p_organization_id bigint,p_invocation_public_id uuid,p_status text,p_output_summary text,p_input_tokens integer,p_output_tokens integer,p_latency_ms integer,p_error_code text,p_completed_at timestamptz)
returns boolean language plpgsql security definer set search_path='' set row_security=off as $$
declare invocation public.agent_invocations%rowtype; v_status text; v_error text;
begin
  if p_tenant_id is null or p_organization_id is null or p_status not in ('succeeded','failed') or p_completed_at is null or coalesce(p_input_tokens,-1)<0 or coalesce(p_output_tokens,-1)<0 or coalesce(p_latency_ms,-1)<0 then raise exception 'Invalid Agent invocation finalization payload' using errcode='22023'; end if;
  select * into invocation from public.agent_invocations where public_id=p_invocation_public_id and tenant_id=p_tenant_id and organization_id=p_organization_id for update; if not found then raise exception 'Agent invocation is not in the requested tenant and organization' using errcode='P0002'; end if; if invocation.status in ('succeeded','failed') then return false; end if; if invocation.status not in ('queued','running') or p_completed_at<invocation.started_at then raise exception 'Illegal Agent invocation lifecycle transition' using errcode='23514'; end if;
  v_status:=case when invocation.cancel_requested_at is not null then 'failed' else p_status end; v_error:=case when invocation.cancel_requested_at is not null then 'tenant_kill_switch' else coalesce(p_error_code,'') end;
  perform set_config('app.agent_invocation_transition_id',invocation.public_id::text,true); update public.agent_invocations set status=v_status,output_summary=case when invocation.cancel_requested_at is not null then '' else coalesce(p_output_summary,'') end,input_tokens=p_input_tokens,output_tokens=p_output_tokens,latency_ms=p_latency_ms,error_code=v_error,completed_at=p_completed_at where id=invocation.id; perform set_config('app.agent_invocation_transition_id','',true);
  insert into public.agent_execution_logs(tenant_id,organization_id,invocation_id,event_type,message,metadata) values(p_tenant_id,p_organization_id,invocation.id,'invocation.finalized','Agent invocation reached a terminal lifecycle state',jsonb_build_object('status',v_status,'error_code',v_error,'latency_ms',p_latency_ms)); return true;
end;
$$;

create or replace function public.set_current_tenant_agent_kill_switch(p_enabled boolean,p_reason text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor record; v_control public.agent_runtime_controls%rowtype; v_invocation public.agent_invocations%rowtype; v_now timestamptz:=clock_timestamp();
begin
  if p_enabled is null or length(btrim(coalesce(p_reason,''))) not between 5 and 500 or p_request_id is null then raise exception 'invalid_kill_switch' using errcode='22023'; end if; select * into v_actor from public.current_agent_actor('agent.runtime.kill'); if not found then raise exception 'not_found' using errcode='P0002'; end if;
  insert into public.agent_runtime_controls(tenant_id,organization_id) values(v_actor.tenant_id,v_actor.organization_id) on conflict do nothing; select * into v_control from public.agent_runtime_controls where tenant_id=v_actor.tenant_id and organization_id=v_actor.organization_id for update;
  update public.agent_runtime_controls set kill_switch_enabled=p_enabled,reason=btrim(p_reason),version=version+1,updated_by_member_id=v_actor.member_id,updated_at=v_now where tenant_id=v_actor.tenant_id and organization_id=v_actor.organization_id returning * into v_control;
  if p_enabled then for v_invocation in select * from public.agent_invocations where tenant_id=v_actor.tenant_id and organization_id=v_actor.organization_id and status in ('queued','running') for update loop perform set_config('app.agent_invocation_transition_id',v_invocation.public_id::text,true); update public.agent_invocations set status=case when v_invocation.status='queued' then 'failed' else status end,error_code=case when v_invocation.status='queued' then 'tenant_kill_switch' else error_code end,completed_at=case when v_invocation.status='queued' then v_now else completed_at end,cancel_requested_at=v_now where id=v_invocation.id; perform set_config('app.agent_invocation_transition_id','',true); end loop; end if;
  perform public.append_audit_log(v_actor.tenant_id,v_actor.organization_id,v_actor.user_id,v_actor.member_id,'agent.runtime.kill_switch_changed','agent_runtime_control',v_actor.organization_id::text,p_request_id,null,jsonb_build_object('enabled',p_enabled,'reason',btrim(p_reason),'version',v_control.version));
  return jsonb_build_object('enabled',v_control.kill_switch_enabled,'reason',v_control.reason,'version',v_control.version,'updatedAt',v_control.updated_at);
end;
$$;

create or replace function public.get_current_tenant_agent_runtime_control()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor record; v_control public.agent_runtime_controls%rowtype;
begin
  select * into v_actor from public.current_agent_actor('agent.runtime.kill');
  if not found then raise exception 'not_found' using errcode='P0002'; end if;
  select * into v_control from public.agent_runtime_controls where tenant_id=v_actor.tenant_id and organization_id=v_actor.organization_id;
  return jsonb_build_object(
    'enabled',coalesce(v_control.kill_switch_enabled,false),
    'reason',coalesce(v_control.reason,''),
    'version',coalesce(v_control.version,1),
    'updatedAt',v_control.updated_at
  );
end;
$$;

revoke all on function public.set_current_tenant_agent_kill_switch(boolean,text,uuid) from public,anon; grant execute on function public.set_current_tenant_agent_kill_switch(boolean,text,uuid) to authenticated;
revoke all on function public.get_current_tenant_agent_runtime_control() from public,anon; grant execute on function public.get_current_tenant_agent_runtime_control() to authenticated;

commit;
