begin;

create table public.agent_external_workflow_runs (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete cascade,
  organization_id bigint not null,
  actor_member_id bigint not null,
  workflow_code text not null check(workflow_code in ('family-portrait','ai-automatic-video-editing','tarot-lead-video','daoist-interpretation-video','digital-human-talking-video','palmistry-reading-video')),
  provider_code text not null check(provider_code in ('image-studio','content-workbench')),
  request_id uuid not null,
  status text not null default 'running' check(status in ('running','succeeded','failed')),
  input_summary text not null check(length(input_summary) between 1 and 600),
  upstream_run_id text check(upstream_run_id is null or length(upstream_run_id) between 1 and 200),
  output_summary text not null default '' check(length(output_summary)<=600),
  error_code text not null default '' check(length(error_code)<=120),
  started_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  foreign key(tenant_id,organization_id) references public.organizations(tenant_id,id) on delete cascade,
  foreign key(tenant_id,actor_member_id) references public.organization_members(tenant_id,id) on delete restrict,
  unique(tenant_id,actor_member_id,request_id)
);

create index agent_external_workflow_runs_scope_idx on public.agent_external_workflow_runs(tenant_id,organization_id,workflow_code,started_at desc);
alter table public.agent_external_workflow_runs enable row level security;
alter table public.agent_external_workflow_runs force row level security;
create policy agent_external_workflow_runs_scoped_read on public.agent_external_workflow_runs for select to authenticated
using(tenant_id=(select public.current_tenant_id()) and (actor_member_id in(select member.id from public.organization_members member where member.tenant_id=agent_external_workflow_runs.tenant_id and member.user_id=(select auth.uid()) and member.status='active') or (select public.has_organization_permission(organization_id,'agent.manage'))));
grant select on public.agent_external_workflow_runs to authenticated;

create or replace function public.reject_external_workflow_run_mutation()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if current_setting('app.external_workflow_transition_id',true) is distinct from old.public_id::text then raise exception 'external_workflow_runs_append_only' using errcode='42501'; end if;
  if old.status in ('succeeded','failed') then raise exception 'external_workflow_run_terminal' using errcode='55000'; end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;
create trigger agent_external_workflow_runs_append_only before update or delete on public.agent_external_workflow_runs for each row execute function public.reject_external_workflow_run_mutation();

create or replace function public.start_external_workflow_run(
  p_tenant_public_id uuid,p_organization_public_id uuid,p_actor_member_id bigint,p_auth_user_id uuid,
  p_workflow_code text,p_provider_code text,p_input_summary text,p_request_id uuid
)
returns jsonb language plpgsql security definer set search_path='' set row_security=off as $$
declare v_tenant bigint; v_organization bigint; v_run public.agent_external_workflow_runs%rowtype; v_already_exists boolean:=false;
begin
  if p_tenant_public_id is null or p_organization_public_id is null or p_actor_member_id is null or p_auth_user_id is null or p_request_id is null
    or p_workflow_code not in ('family-portrait','ai-automatic-video-editing','tarot-lead-video','daoist-interpretation-video','digital-human-talking-video','palmistry-reading-video')
    or p_provider_code not in ('image-studio','content-workbench') or length(coalesce(p_input_summary,'')) not between 1 and 600
    or (p_workflow_code='family-portrait' and p_provider_code<>'image-studio') or (p_workflow_code<>'family-portrait' and p_provider_code<>'content-workbench')
  then raise exception 'invalid_external_workflow_run' using errcode='22023'; end if;
  select tenant.id into v_tenant from public.tenants tenant where tenant.public_id=p_tenant_public_id and tenant.status='active';
  select organization.id into v_organization from public.organizations organization where organization.tenant_id=v_tenant and organization.public_id=p_organization_public_id;
  if v_tenant is null or v_organization is null or not exists(select 1 from public.organization_members member where member.tenant_id=v_tenant and member.organization_id=v_organization and member.id=p_actor_member_id and member.user_id=p_auth_user_id and member.status='active') then raise exception 'forbidden' using errcode='42501'; end if;
  if exists(select 1 from public.agent_runtime_controls control where control.tenant_id=v_tenant and control.organization_id=v_organization and control.kill_switch_enabled) then raise exception 'tenant_kill_switch' using errcode='55000'; end if;
  select * into v_run from public.agent_external_workflow_runs where tenant_id=v_tenant and actor_member_id=p_actor_member_id and request_id=p_request_id;
  if not found then
    insert into public.agent_external_workflow_runs(tenant_id,organization_id,actor_member_id,workflow_code,provider_code,request_id,input_summary)
      values(v_tenant,v_organization,p_actor_member_id,p_workflow_code,p_provider_code,p_request_id,left(p_input_summary,600)) returning * into v_run;
    perform public.append_audit_log(v_tenant,v_organization,p_auth_user_id,p_actor_member_id,'agent.external_workflow.started','agent_external_workflow_run',v_run.public_id::text,p_request_id,null,jsonb_build_object('workflowCode',p_workflow_code,'providerCode',p_provider_code));
  elsif v_run.organization_id<>v_organization or v_run.workflow_code<>p_workflow_code or v_run.provider_code<>p_provider_code or v_run.input_summary<>left(p_input_summary,600) then raise exception 'idempotency_conflict' using errcode='23505'; else v_already_exists:=true; end if;
  return jsonb_build_object('runId',v_run.public_id,'status',v_run.status,'upstreamRunId',v_run.upstream_run_id,'outputSummary',v_run.output_summary,'errorCode',nullif(v_run.error_code,''),'startedAt',v_run.started_at,'completedAt',v_run.completed_at,'alreadyExists',v_already_exists);
end;
$$;

create or replace function public.finalize_external_workflow_run(p_run_public_id uuid,p_status text,p_upstream_run_id text,p_output_summary text,p_error_code text,p_completed_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' set row_security=off as $$
declare v_run public.agent_external_workflow_runs%rowtype; v_member public.organization_members%rowtype;
begin
  if p_run_public_id is null or p_status not in ('succeeded','failed') or p_completed_at is null or length(coalesce(p_upstream_run_id,''))>200 or length(coalesce(p_output_summary,''))>600 or length(coalesce(p_error_code,''))>120 then raise exception 'invalid_external_workflow_finalization' using errcode='22023'; end if;
  select * into v_run from public.agent_external_workflow_runs where public_id=p_run_public_id for update; if not found then raise exception 'not_found' using errcode='P0002'; end if;
  if v_run.status in ('succeeded','failed') then return jsonb_build_object('runId',v_run.public_id,'status',v_run.status,'upstreamRunId',v_run.upstream_run_id,'outputSummary',v_run.output_summary,'errorCode',nullif(v_run.error_code,''),'completedAt',v_run.completed_at,'alreadyFinalized',true); end if;
  if p_status='succeeded' and length(coalesce(p_upstream_run_id,''))<1 then raise exception 'external_workflow_receipt_missing' using errcode='22023'; end if;
  perform set_config('app.external_workflow_transition_id',v_run.public_id::text,true);
  update public.agent_external_workflow_runs set status=p_status,upstream_run_id=nullif(left(coalesce(p_upstream_run_id,''),200),''),output_summary=left(coalesce(p_output_summary,''),600),error_code=left(coalesce(p_error_code,''),120),completed_at=p_completed_at where id=v_run.id returning * into v_run;
  perform set_config('app.external_workflow_transition_id','',true);
  select * into v_member from public.organization_members where tenant_id=v_run.tenant_id and id=v_run.actor_member_id;
  perform public.append_audit_log(v_run.tenant_id,v_run.organization_id,v_member.user_id,v_run.actor_member_id,'agent.external_workflow.finalized','agent_external_workflow_run',v_run.public_id::text,v_run.request_id,null,jsonb_build_object('workflowCode',v_run.workflow_code,'providerCode',v_run.provider_code,'status',v_run.status,'errorCode',nullif(v_run.error_code,'')));
  return jsonb_build_object('runId',v_run.public_id,'status',v_run.status,'upstreamRunId',v_run.upstream_run_id,'outputSummary',v_run.output_summary,'errorCode',nullif(v_run.error_code,''),'completedAt',v_run.completed_at,'alreadyFinalized',false);
end;
$$;

create or replace function public.list_current_external_workflow_runs(p_workflow_code text,p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor record; v_manage boolean;
begin
  if p_workflow_code not in ('family-portrait','ai-automatic-video-editing','tarot-lead-video','daoist-interpretation-video','digital-human-talking-video','palmistry-reading-video') or p_limit not between 1 and 100 then raise exception 'invalid_external_workflow_run_list' using errcode='22023'; end if;
  select * into v_actor from public.current_agent_actor(null); if not found then raise exception 'forbidden' using errcode='42501'; end if; v_manage:=public.has_organization_permission(v_actor.organization_id,'agent.manage');
  return jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',run.public_id,'workflowCode',run.workflow_code,'providerCode',run.provider_code,'status',run.status,'inputSummary',run.input_summary,'upstreamRunId',run.upstream_run_id,'outputSummary',run.output_summary,'errorCode',nullif(run.error_code,''),'startedAt',run.started_at,'completedAt',run.completed_at) order by run.started_at desc) from (select * from public.agent_external_workflow_runs where tenant_id=v_actor.tenant_id and organization_id=v_actor.organization_id and workflow_code=p_workflow_code and (v_manage or actor_member_id=v_actor.member_id) order by started_at desc limit p_limit) run),'[]'::jsonb));
end;
$$;

revoke all on function public.start_external_workflow_run(uuid,uuid,bigint,uuid,text,text,text,uuid) from public,anon,authenticated,service_role; grant execute on function public.start_external_workflow_run(uuid,uuid,bigint,uuid,text,text,text,uuid) to service_role;
revoke all on function public.finalize_external_workflow_run(uuid,text,text,text,text,timestamptz) from public,anon,authenticated,service_role; grant execute on function public.finalize_external_workflow_run(uuid,text,text,text,text,timestamptz) to service_role;
revoke all on function public.list_current_external_workflow_runs(text,integer) from public,anon; grant execute on function public.list_current_external_workflow_runs(text,integer) to authenticated;

commit;
