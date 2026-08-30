begin;

alter table public.audit_logs drop constraint if exists audit_logs_action_check;
alter table public.audit_logs add constraint audit_logs_action_check check (action ~ '^[a-z][a-z0-9_.]{1,79}$');

create table public.agent_tool_catalog (
  id bigint generated always as identity primary key,
  code text not null unique check (code ~ '^[a-z][a-z0-9_.-]{1,79}$'),
  name text not null check (length(btrim(name)) between 1 and 120),
  executor_code text not null check (executor_code ~ '^[a-z][a-z0-9_.-]{1,79}$'),
  high_risk boolean not null default false,
  status text not null default 'active' check (status in ('active','disabled')),
  created_at timestamptz not null default clock_timestamp()
);

insert into public.agent_tool_catalog(code,name,executor_code,high_risk) values
  ('knowledge.search','知识检索','knowledge.search',false),
  ('project.read','项目读取','project.read',false),
  ('task.read','任务读取','task.read',false),
  ('send_message','发送消息','send_message',true),
  ('modify_business_data','修改业务数据','modify_business_data',true),
  ('create_approval','发起审批','create_approval',true),
  ('publish_content','发布内容','publish_content',true),
  ('modify_permission','修改权限','modify_permission',true),
  ('delete_material','删除资料','delete_material',true),
  ('export_data','导出数据','export_data',true),
  ('create_payment_record','创建付款记录','create_payment_record',true)
on conflict(code) do update set name=excluded.name,executor_code=excluded.executor_code,high_risk=excluded.high_risk;

create table public.agent_versions (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete cascade,
  organization_id bigint not null,
  agent_id bigint not null,
  revision integer not null check (revision>0),
  request_id uuid not null,
  lifecycle text not null default 'draft' check (lifecycle in ('draft','test','published','retired')),
  model_code text not null check (length(btrim(model_code)) between 1 and 120),
  prompt_version text not null check (length(btrim(prompt_version)) between 1 and 40),
  system_prompt text not null check (octet_length(system_prompt) between 1 and 12000),
  input_schema jsonb not null default '{}'::jsonb check (jsonb_typeof(input_schema)='object'),
  output_schema jsonb not null default '{}'::jsonb check (jsonb_typeof(output_schema)='object'),
  data_scopes text[] not null default '{}'::text[] check (cardinality(data_scopes)<=30),
  secret_refs text[] not null default '{}'::text[] check (cardinality(secret_refs)<=20),
  limits jsonb not null default '{"maxSteps":20,"maxDepth":3,"timeoutSeconds":300}'::jsonb check (jsonb_typeof(limits)='object'),
  created_by_member_id bigint not null,
  published_by_member_id bigint,
  created_at timestamptz not null default clock_timestamp(),
  published_at timestamptz,
  foreign key (tenant_id,organization_id) references public.organizations(tenant_id,id) on delete cascade,
  foreign key (tenant_id,organization_id,agent_id) references public.agent_definitions(tenant_id,organization_id,id) on delete cascade,
  foreign key (tenant_id,created_by_member_id) references public.organization_members(tenant_id,id) on delete restrict,
  foreign key (tenant_id,published_by_member_id) references public.organization_members(tenant_id,id) on delete restrict,
  unique (tenant_id,agent_id,revision),
  unique (tenant_id,created_by_member_id,request_id),
  unique (tenant_id,organization_id,id),
  check ((lifecycle='published' and published_at is not null and published_by_member_id is not null) or lifecycle<>'published')
);

create table public.agent_version_tools (
  id bigint generated always as identity primary key,
  tenant_id bigint not null references public.tenants(id) on delete cascade,
  organization_id bigint not null,
  agent_version_id bigint not null,
  tool_code text not null references public.agent_tool_catalog(code) on delete restrict,
  sequence integer not null check (sequence between 1 and 30),
  high_risk boolean not null,
  safe_config jsonb not null default '{}'::jsonb check (jsonb_typeof(safe_config)='object' and pg_column_size(safe_config)<=32768),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (tenant_id,organization_id,agent_version_id) references public.agent_versions(tenant_id,organization_id,id) on delete cascade,
  unique (agent_version_id,tool_code),
  unique (agent_version_id,sequence)
);

alter table public.agent_definitions add column current_version_id bigint;
alter table public.agent_definitions add constraint agent_definitions_current_version_fk foreign key (tenant_id,organization_id,current_version_id) references public.agent_versions(tenant_id,organization_id,id) on delete restrict;

alter table public.agent_tool_catalog enable row level security; alter table public.agent_tool_catalog force row level security;
alter table public.agent_versions enable row level security; alter table public.agent_versions force row level security;
alter table public.agent_version_tools enable row level security; alter table public.agent_version_tools force row level security;

create or replace function public.reject_published_agent_version_mutation()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_table_name='agent_versions' and old.lifecycle='published' then raise exception 'published_agent_version_immutable' using errcode='55000'; end if;
  if tg_table_name='agent_version_tools' and exists(select 1 from public.agent_versions version where version.id=old.agent_version_id and version.lifecycle='published') then raise exception 'published_agent_version_immutable' using errcode='55000'; end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;
create trigger agent_versions_immutable before update or delete on public.agent_versions for each row execute function public.reject_published_agent_version_mutation();
create trigger agent_version_tools_immutable before update or delete on public.agent_version_tools for each row execute function public.reject_published_agent_version_mutation();

create or replace function public.current_agent_actor(p_permission text default null)
returns table(tenant_id bigint,organization_id bigint,member_id bigint,user_id uuid) language sql stable security definer set search_path='' as $$
  select member.tenant_id,member.organization_id,member.id,member.user_id from public.organization_members member
  where member.organization_id=public.active_workspace_organization_id((select auth.uid())) and member.user_id=(select auth.uid()) and member.status='active'
    and (p_permission is null or public.has_organization_permission(member.organization_id,p_permission)) limit 1;
$$;

create or replace function public.list_current_agents(p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor record; v_can_manage boolean;
begin
  if p_limit not between 1 and 200 then raise exception 'invalid_limit' using errcode='22023'; end if;
  select * into v_actor from public.current_agent_actor(null); if not found then raise exception 'forbidden' using errcode='42501'; end if;
  v_can_manage:=public.has_organization_permission(v_actor.organization_id,'agent.manage');
  return jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object(
    'id',item.public_id,'code',item.code,'name',item.name,'description',item.description,'icon',item.icon,'status',item.status,
    'currentVersionId',item.version_public_id,'revision',item.revision,'lifecycle',item.lifecycle,'modelCode',item.version_model,
    'promptVersion',item.version_prompt,'tools',item.tools,'canManage',v_can_manage,'canInvoke',item.status='enabled' and item.version_public_id is not null
  ) order by item.updated_at desc,item.id desc) from (
    select agent.*,version.public_id version_public_id,version.revision,version.lifecycle,version.model_code version_model,version.prompt_version version_prompt,
      coalesce((select jsonb_agg(jsonb_build_object('code',tool.tool_code,'highRisk',tool.high_risk) order by tool.sequence) from public.agent_version_tools tool where tool.agent_version_id=version.id),'[]'::jsonb) tools
    from public.agent_definitions agent left join public.agent_versions version on version.id=agent.current_version_id and version.tenant_id=agent.tenant_id
    where agent.tenant_id=v_actor.tenant_id and agent.organization_id=v_actor.organization_id and agent.deleted_at is null and (v_can_manage or agent.status='enabled') order by agent.updated_at desc,agent.id desc limit p_limit
  ) item),'[]'::jsonb),'canManage',v_can_manage);
end;
$$;

create or replace function public.create_current_agent(p_code text,p_name text,p_description text,p_icon text,p_department_public_id uuid,p_min_job_level integer,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor record; v_agent public.agent_definitions%rowtype; v_department bigint;
begin
  if p_request_id is null or p_code !~ '^[a-z][a-z0-9_]{1,79}$' or length(btrim(coalesce(p_name,''))) not between 2 and 120 or length(coalesce(p_description,''))>2000 or length(btrim(coalesce(p_icon,''))) not between 1 and 40 or p_min_job_level not between 1 and 20 then raise exception 'invalid_agent' using errcode='22023'; end if;
  select * into v_actor from public.current_agent_actor('agent.manage'); if not found then raise exception 'forbidden' using errcode='42501'; end if;
  select agent.* into v_agent from public.agent_definitions agent join public.audit_logs audit on audit.tenant_id=agent.tenant_id and audit.resource_type='agent_definition' and audit.resource_id=agent.public_id::text and audit.request_id=p_request_id where agent.tenant_id=v_actor.tenant_id and agent.organization_id=v_actor.organization_id limit 1;
  if found then if v_agent.code<>p_code then raise exception 'idempotency_conflict' using errcode='23505'; end if; return jsonb_build_object('agentId',v_agent.public_id,'status',v_agent.status,'alreadyExists',true); end if;
  if p_department_public_id is not null then select id into v_department from public.departments where tenant_id=v_actor.tenant_id and organization_id=v_actor.organization_id and public_id=p_department_public_id and deleted_at is null; if v_department is null then raise exception 'department_not_found' using errcode='P0002'; end if; end if;
  insert into public.agent_definitions(tenant_id,organization_id,code,name,description,icon,department_id,min_job_level,status,created_by_member_id,updated_by_member_id)
    values(v_actor.tenant_id,v_actor.organization_id,p_code,btrim(p_name),coalesce(p_description,''),btrim(p_icon),v_department,p_min_job_level,'disabled',v_actor.member_id,v_actor.member_id) returning * into v_agent;
  perform public.append_audit_log(v_actor.tenant_id,v_actor.organization_id,v_actor.user_id,v_actor.member_id,'agent.created','agent_definition',v_agent.public_id::text,p_request_id,null,jsonb_build_object('code',v_agent.code));
  return jsonb_build_object('agentId',v_agent.public_id,'status',v_agent.status,'alreadyExists',false);
end;
$$;

create or replace function public.create_current_agent_version(p_agent_public_id uuid,p_model_code text,p_prompt_version text,p_system_prompt text,p_input_schema jsonb,p_output_schema jsonb,p_data_scopes text[],p_secret_refs text[],p_limits jsonb,p_tools jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor record; v_agent public.agent_definitions%rowtype; v_version public.agent_versions%rowtype; v_revision integer; v_tool_count integer;
begin
  if p_agent_public_id is null or p_request_id is null or p_model_code not in ('deepseek-v4-flash','deepseek-chat','deepseek-reasoner') or length(btrim(coalesce(p_prompt_version,''))) not between 1 and 40 or octet_length(coalesce(p_system_prompt,'')) not between 1 and 12000 or jsonb_typeof(p_input_schema)<>'object' or jsonb_typeof(p_output_schema)<>'object' or cardinality(coalesce(p_data_scopes,'{}'))>30 or cardinality(coalesce(p_secret_refs,'{}'))>20 or jsonb_typeof(p_limits)<>'object' or jsonb_typeof(p_tools)<>'array' or jsonb_array_length(p_tools)>30 then raise exception 'invalid_agent_version' using errcode='22023'; end if;
  select * into v_actor from public.current_agent_actor('agent.manage'); if not found then raise exception 'forbidden' using errcode='42501'; end if;
  select * into v_agent from public.agent_definitions where tenant_id=v_actor.tenant_id and organization_id=v_actor.organization_id and public_id=p_agent_public_id and deleted_at is null for update; if not found then raise exception 'not_found' using errcode='P0002'; end if;
  select * into v_version from public.agent_versions where tenant_id=v_actor.tenant_id and created_by_member_id=v_actor.member_id and request_id=p_request_id;
  if found then if v_version.agent_id<>v_agent.id then raise exception 'idempotency_conflict' using errcode='23505'; end if; return jsonb_build_object('versionId',v_version.public_id,'revision',v_version.revision,'lifecycle',v_version.lifecycle,'alreadyExists',true); end if;
  select count(distinct item->>'code') into v_tool_count from jsonb_array_elements(p_tools) item where jsonb_typeof(item)='object' and item->>'code' ~ '^[a-z][a-z0-9_.-]{1,79}$' and jsonb_typeof(coalesce(item->'config','{}'::jsonb))='object' and exists(select 1 from public.agent_tool_catalog catalog where catalog.code=item->>'code' and catalog.status='active');
  if v_tool_count<>jsonb_array_length(p_tools) then raise exception 'invalid_agent_tool' using errcode='22023'; end if;
  select coalesce(max(revision),0)+1 into v_revision from public.agent_versions where tenant_id=v_actor.tenant_id and agent_id=v_agent.id;
  insert into public.agent_versions(tenant_id,organization_id,agent_id,revision,request_id,model_code,prompt_version,system_prompt,input_schema,output_schema,data_scopes,secret_refs,limits,created_by_member_id)
    values(v_actor.tenant_id,v_actor.organization_id,v_agent.id,v_revision,p_request_id,p_model_code,btrim(p_prompt_version),p_system_prompt,p_input_schema,p_output_schema,coalesce(p_data_scopes,'{}'),coalesce(p_secret_refs,'{}'),p_limits,v_actor.member_id) returning * into v_version;
  insert into public.agent_version_tools(tenant_id,organization_id,agent_version_id,tool_code,sequence,high_risk,safe_config)
    select v_actor.tenant_id,v_actor.organization_id,v_version.id,item->>'code',ordinality,catalog.high_risk,coalesce(item->'config','{}'::jsonb) from jsonb_array_elements(p_tools) with ordinality entry(item,ordinality) join public.agent_tool_catalog catalog on catalog.code=item->>'code';
  perform public.append_audit_log(v_actor.tenant_id,v_actor.organization_id,v_actor.user_id,v_actor.member_id,'agent.version.created','agent_version',v_version.public_id::text,p_request_id,null,jsonb_build_object('agentId',v_agent.public_id,'revision',v_revision));
  return jsonb_build_object('versionId',v_version.public_id,'revision',v_version.revision,'lifecycle',v_version.lifecycle,'alreadyExists',false);
end;
$$;

create or replace function public.publish_current_agent_version(p_agent_public_id uuid,p_version_public_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor record; v_agent public.agent_definitions%rowtype; v_version public.agent_versions%rowtype; v_scope jsonb;
begin
  if p_agent_public_id is null or p_version_public_id is null or p_request_id is null then raise exception 'invalid_agent_publish' using errcode='22023'; end if;
  select * into v_actor from public.current_agent_actor('agent.manage'); if not found then raise exception 'forbidden' using errcode='42501'; end if;
  select * into v_agent from public.agent_definitions where tenant_id=v_actor.tenant_id and organization_id=v_actor.organization_id and public_id=p_agent_public_id and deleted_at is null for update; if not found then raise exception 'not_found' using errcode='P0002'; end if;
  select * into v_version from public.agent_versions where tenant_id=v_actor.tenant_id and organization_id=v_actor.organization_id and agent_id=v_agent.id and public_id=p_version_public_id for update; if not found then raise exception 'not_found' using errcode='P0002'; end if;
  if v_agent.current_version_id=v_version.id and v_version.lifecycle='published' then return jsonb_build_object('agentId',v_agent.public_id,'versionId',v_version.public_id,'status','enabled','alreadyPublished',true); end if;
  if v_version.lifecycle not in ('draft','test') then raise exception 'agent_version_not_publishable' using errcode='55000'; end if;
  select jsonb_build_object('tools',coalesce(jsonb_agg(tool.tool_code order by tool.sequence),'[]'::jsonb)) into v_scope from public.agent_version_tools tool where tool.agent_version_id=v_version.id;
  if not public.is_agent_execution_ready(v_version.model_code,v_version.prompt_version,v_version.system_prompt,v_scope) then raise exception 'agent_version_not_ready' using errcode='22023'; end if;
  update public.agent_versions set lifecycle='published',published_by_member_id=v_actor.member_id,published_at=clock_timestamp() where id=v_version.id;
  update public.agent_definitions set current_version_id=v_version.id,model_code=v_version.model_code,prompt_version=v_version.prompt_version,system_prompt=v_version.system_prompt,input_schema=v_version.input_schema,tool_scope=v_scope,status='enabled',updated_by_member_id=v_actor.member_id,updated_at=clock_timestamp() where id=v_agent.id;
  perform public.append_audit_log(v_actor.tenant_id,v_actor.organization_id,v_actor.user_id,v_actor.member_id,'agent.version.published','agent_version',v_version.public_id::text,p_request_id,null,jsonb_build_object('agentId',v_agent.public_id,'revision',v_version.revision));
  return jsonb_build_object('agentId',v_agent.public_id,'versionId',v_version.public_id,'status','enabled','alreadyPublished',false);
end;
$$;

revoke all on function public.current_agent_actor(text) from public,anon,authenticated,service_role;
revoke all on function public.list_current_agents(integer) from public,anon; grant execute on function public.list_current_agents(integer) to authenticated;
revoke all on function public.create_current_agent(text,text,text,text,uuid,integer,uuid) from public,anon; grant execute on function public.create_current_agent(text,text,text,text,uuid,integer,uuid) to authenticated;
revoke all on function public.create_current_agent_version(uuid,text,text,text,jsonb,jsonb,text[],text[],jsonb,jsonb,uuid) from public,anon; grant execute on function public.create_current_agent_version(uuid,text,text,text,jsonb,jsonb,text[],text[],jsonb,jsonb,uuid) to authenticated;
revoke all on function public.publish_current_agent_version(uuid,uuid,uuid) from public,anon; grant execute on function public.publish_current_agent_version(uuid,uuid,uuid) to authenticated;

commit;
