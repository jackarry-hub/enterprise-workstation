begin;

create table public.agent_orchestrations (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete cascade,
  organization_id bigint not null,
  code text not null check (code~'^[a-z][a-z0-9_]{1,79}$'),
  name text not null check (length(btrim(name)) between 2 and 120),
  description text not null default '' check (length(description)<=2000),
  status text not null default 'draft' check (status in ('draft','published','retired')),
  current_version_id bigint,
  created_by_member_id bigint not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key(tenant_id,organization_id) references public.organizations(tenant_id,id) on delete cascade,
  foreign key(tenant_id,created_by_member_id) references public.organization_members(tenant_id,id) on delete restrict,
  unique(tenant_id,organization_id,code),
  unique(tenant_id,organization_id,id)
);

create table public.agent_orchestration_versions (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete cascade,
  organization_id bigint not null,
  orchestration_id bigint not null,
  revision integer not null check(revision>0),
  request_id uuid not null,
  lifecycle text not null default 'draft' check(lifecycle in ('draft','published','retired')),
  created_by_member_id bigint not null,
  published_by_member_id bigint,
  created_at timestamptz not null default clock_timestamp(),
  published_at timestamptz,
  foreign key(tenant_id,organization_id) references public.organizations(tenant_id,id) on delete cascade,
  foreign key(tenant_id,organization_id,orchestration_id) references public.agent_orchestrations(tenant_id,organization_id,id) on delete cascade,
  foreign key(tenant_id,created_by_member_id) references public.organization_members(tenant_id,id) on delete restrict,
  foreign key(tenant_id,published_by_member_id) references public.organization_members(tenant_id,id) on delete restrict,
  unique(tenant_id,orchestration_id,revision),
  unique(tenant_id,created_by_member_id,request_id),
  unique(tenant_id,organization_id,id),
  check((lifecycle='published' and published_at is not null and published_by_member_id is not null) or lifecycle<>'published')
);

alter table public.agent_orchestrations add constraint agent_orchestrations_current_version_fk foreign key(tenant_id,organization_id,current_version_id) references public.agent_orchestration_versions(tenant_id,organization_id,id) on delete restrict;

create table public.agent_orchestration_nodes (
  id bigint generated always as identity primary key,
  tenant_id bigint not null references public.tenants(id) on delete cascade,
  organization_id bigint not null,
  orchestration_version_id bigint not null,
  node_key text not null check(node_key~'^[a-z][a-z0-9_]{0,63}$'),
  agent_version_id bigint not null,
  sequence integer not null check(sequence between 1 and 50),
  input_contract text not null check(length(input_contract) between 1 and 160),
  output_contract text not null check(length(output_contract) between 1 and 160),
  foreign key(tenant_id,organization_id,orchestration_version_id) references public.agent_orchestration_versions(tenant_id,organization_id,id) on delete cascade,
  foreign key(tenant_id,organization_id,agent_version_id) references public.agent_versions(tenant_id,organization_id,id) on delete restrict,
  unique(orchestration_version_id,node_key),
  unique(orchestration_version_id,sequence)
);

create table public.agent_orchestration_edges (
  id bigint generated always as identity primary key,
  tenant_id bigint not null references public.tenants(id) on delete cascade,
  organization_id bigint not null,
  orchestration_version_id bigint not null,
  source_node_key text not null,
  target_node_key text not null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key(tenant_id,organization_id,orchestration_version_id) references public.agent_orchestration_versions(tenant_id,organization_id,id) on delete cascade,
  unique(orchestration_version_id,source_node_key,target_node_key),
  check(source_node_key<>target_node_key)
);

alter table public.agent_orchestrations enable row level security; alter table public.agent_orchestrations force row level security;
alter table public.agent_orchestration_versions enable row level security; alter table public.agent_orchestration_versions force row level security;
alter table public.agent_orchestration_nodes enable row level security; alter table public.agent_orchestration_nodes force row level security;
alter table public.agent_orchestration_edges enable row level security; alter table public.agent_orchestration_edges force row level security;
create policy agent_orchestrations_manager_read on public.agent_orchestrations for select to authenticated using(tenant_id=(select public.current_tenant_id()) and (select public.has_organization_permission(organization_id,'agent.orchestrate')));
grant select on public.agent_orchestrations to authenticated;

create or replace function public.reject_published_orchestration_mutation()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_table_name='agent_orchestration_versions' and old.lifecycle='published' then raise exception 'published_orchestration_immutable' using errcode='55000'; end if;
  if tg_table_name='agent_orchestration_nodes' and exists(select 1 from public.agent_orchestration_versions version where version.id=old.orchestration_version_id and version.lifecycle='published') then raise exception 'published_orchestration_immutable' using errcode='55000'; end if;
  if tg_table_name='agent_orchestration_edges' and exists(select 1 from public.agent_orchestration_versions version where version.id=old.orchestration_version_id and version.lifecycle='published') then raise exception 'published_orchestration_immutable' using errcode='55000'; end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;
create trigger agent_orchestration_versions_immutable before update or delete on public.agent_orchestration_versions for each row execute function public.reject_published_orchestration_mutation();
create trigger agent_orchestration_nodes_immutable before update or delete on public.agent_orchestration_nodes for each row execute function public.reject_published_orchestration_mutation();
create trigger agent_orchestration_edges_immutable before update or delete on public.agent_orchestration_edges for each row execute function public.reject_published_orchestration_mutation();

create or replace function public.create_current_agent_orchestration(p_code text,p_name text,p_description text,p_nodes jsonb,p_edges jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor record; v_orchestration public.agent_orchestrations%rowtype; v_version public.agent_orchestration_versions%rowtype; v_revision integer; v_count integer; v_connected integer; v_cycle boolean;
begin
  if p_code!~'^[a-z][a-z0-9_]{1,79}$' or length(btrim(coalesce(p_name,''))) not between 2 and 120 or length(coalesce(p_description,''))>2000 or p_request_id is null or jsonb_typeof(p_nodes)<>'array' or jsonb_array_length(p_nodes) not between 1 and 50 or jsonb_typeof(p_edges)<>'array' or jsonb_array_length(p_edges)>200 then raise exception 'invalid_orchestration' using errcode='22023'; end if;
  select * into v_actor from public.current_agent_actor('agent.orchestrate'); if not found then raise exception 'forbidden' using errcode='42501'; end if;
  if (select count(*)<>count(distinct node->>'key') from jsonb_array_elements(p_nodes) node) or exists(select 1 from jsonb_array_elements(p_nodes) node where jsonb_typeof(node)<>'object' or node->>'key'!~'^[a-z][a-z0-9_]{0,63}$' or not coalesce(node?'agentVersionId',false)) then raise exception 'invalid_orchestration_nodes' using errcode='22023'; end if;
  select count(*) into v_count from jsonb_array_elements(p_nodes) node join public.agent_versions version on version.public_id=(node->>'agentVersionId')::uuid and version.tenant_id=v_actor.tenant_id and version.organization_id=v_actor.organization_id and version.lifecycle='published' where coalesce(version.input_schema->>'x-contract','')<>'' and coalesce(version.output_schema->>'x-contract','')<>'';
  if v_count<>jsonb_array_length(p_nodes) then raise exception 'orchestration_agent_version_invalid' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_edges) edge where jsonb_typeof(edge)<>'object' or edge->>'from'=edge->>'to' or not exists(select 1 from jsonb_array_elements(p_nodes) node where node->>'key'=edge->>'from') or not exists(select 1 from jsonb_array_elements(p_nodes) node where node->>'key'=edge->>'to')) or (select count(*)<>count(distinct (edge->>'from',edge->>'to')) from jsonb_array_elements(p_edges) edge) then raise exception 'invalid_orchestration_edges' using errcode='22023'; end if;
  with recursive reach(source,target) as (select edge->>'from',edge->>'to' from jsonb_array_elements(p_edges) edge union select reach.source,edge->>'to' from reach join jsonb_array_elements(p_edges) edge on edge->>'from'=reach.target) select exists(select 1 from reach where source=target) into v_cycle;
  if v_cycle then raise exception 'orchestration_cycle' using errcode='22023'; end if;
  with recursive connected(node_key) as (select min(node->>'key') from jsonb_array_elements(p_nodes) node union select case when edge->>'from'=connected.node_key then edge->>'to' else edge->>'from' end from connected join jsonb_array_elements(p_edges) edge on edge->>'from'=connected.node_key or edge->>'to'=connected.node_key) select count(distinct node_key) into v_connected from connected;
  if v_connected<>jsonb_array_length(p_nodes) then raise exception 'orchestration_disconnected' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_edges) edge join jsonb_array_elements(p_nodes) source_node on source_node->>'key'=edge->>'from' join public.agent_versions source_version on source_version.public_id=(source_node->>'agentVersionId')::uuid join jsonb_array_elements(p_nodes) target_node on target_node->>'key'=edge->>'to' join public.agent_versions target_version on target_version.public_id=(target_node->>'agentVersionId')::uuid where source_version.output_schema->>'x-contract'<>target_version.input_schema->>'x-contract') then raise exception 'orchestration_contract_mismatch' using errcode='22023'; end if;
  select version.* into v_version from public.agent_orchestration_versions version where version.tenant_id=v_actor.tenant_id and version.created_by_member_id=v_actor.member_id and version.request_id=p_request_id;
  if found then return jsonb_build_object('orchestrationId',(select public_id from public.agent_orchestrations where id=v_version.orchestration_id),'versionId',v_version.public_id,'revision',v_version.revision,'alreadyExists',true); end if;
  insert into public.agent_orchestrations(tenant_id,organization_id,code,name,description,created_by_member_id) values(v_actor.tenant_id,v_actor.organization_id,p_code,btrim(p_name),coalesce(p_description,''),v_actor.member_id) on conflict(tenant_id,organization_id,code) do update set name=excluded.name,description=excluded.description,updated_at=clock_timestamp() returning * into v_orchestration;
  select coalesce(max(revision),0)+1 into v_revision from public.agent_orchestration_versions where orchestration_id=v_orchestration.id;
  insert into public.agent_orchestration_versions(tenant_id,organization_id,orchestration_id,revision,request_id,created_by_member_id) values(v_actor.tenant_id,v_actor.organization_id,v_orchestration.id,v_revision,p_request_id,v_actor.member_id) returning * into v_version;
  insert into public.agent_orchestration_nodes(tenant_id,organization_id,orchestration_version_id,node_key,agent_version_id,sequence,input_contract,output_contract)
    select v_actor.tenant_id,v_actor.organization_id,v_version.id,node->>'key',version.id,ordinality,version.input_schema->>'x-contract',version.output_schema->>'x-contract' from jsonb_array_elements(p_nodes) with ordinality entry(node,ordinality) join public.agent_versions version on version.public_id=(node->>'agentVersionId')::uuid and version.tenant_id=v_actor.tenant_id and version.organization_id=v_actor.organization_id;
  insert into public.agent_orchestration_edges(tenant_id,organization_id,orchestration_version_id,source_node_key,target_node_key) select v_actor.tenant_id,v_actor.organization_id,v_version.id,edge->>'from',edge->>'to' from jsonb_array_elements(p_edges) edge;
  perform public.append_audit_log(v_actor.tenant_id,v_actor.organization_id,v_actor.user_id,v_actor.member_id,'agent.orchestration.version_created','agent_orchestration_version',v_version.public_id::text,p_request_id,null,jsonb_build_object('orchestrationId',v_orchestration.public_id,'revision',v_revision,'nodes',jsonb_array_length(p_nodes),'edges',jsonb_array_length(p_edges)));
  return jsonb_build_object('orchestrationId',v_orchestration.public_id,'versionId',v_version.public_id,'revision',v_revision,'lifecycle','draft','alreadyExists',false);
end;
$$;

create or replace function public.publish_current_agent_orchestration(p_orchestration_public_id uuid,p_version_public_id uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor record; v_orchestration public.agent_orchestrations%rowtype; v_version public.agent_orchestration_versions%rowtype;
begin
  if p_orchestration_public_id is null or p_version_public_id is null or p_request_id is null then raise exception 'invalid_orchestration_publish' using errcode='22023'; end if;
  select * into v_actor from public.current_agent_actor('agent.orchestrate'); if not found then raise exception 'forbidden' using errcode='42501'; end if;
  select * into v_orchestration from public.agent_orchestrations where tenant_id=v_actor.tenant_id and organization_id=v_actor.organization_id and public_id=p_orchestration_public_id for update; if not found then raise exception 'not_found' using errcode='P0002'; end if;
  select * into v_version from public.agent_orchestration_versions where tenant_id=v_actor.tenant_id and orchestration_id=v_orchestration.id and public_id=p_version_public_id for update; if not found then raise exception 'not_found' using errcode='P0002'; end if;
  if v_orchestration.current_version_id=v_version.id and v_version.lifecycle='published' then return jsonb_build_object('orchestrationId',v_orchestration.public_id,'versionId',v_version.public_id,'status','published','alreadyPublished',true); end if;
  if v_version.lifecycle<>'draft' then raise exception 'orchestration_not_publishable' using errcode='55000'; end if;
  update public.agent_orchestration_versions set lifecycle='published',published_by_member_id=v_actor.member_id,published_at=clock_timestamp() where id=v_version.id;
  update public.agent_orchestrations set current_version_id=v_version.id,status='published',updated_at=clock_timestamp() where id=v_orchestration.id;
  perform public.append_audit_log(v_actor.tenant_id,v_actor.organization_id,v_actor.user_id,v_actor.member_id,'agent.orchestration.published','agent_orchestration_version',v_version.public_id::text,p_request_id,null,jsonb_build_object('orchestrationId',v_orchestration.public_id,'revision',v_version.revision));
  return jsonb_build_object('orchestrationId',v_orchestration.public_id,'versionId',v_version.public_id,'status','published','alreadyPublished',false);
end;
$$;

create or replace function public.list_current_agent_orchestrations(p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor record;
begin
  if p_limit not between 1 and 200 then raise exception 'invalid_limit' using errcode='22023'; end if; select * into v_actor from public.current_agent_actor('agent.orchestrate'); if not found then raise exception 'forbidden' using errcode='42501'; end if;
  return jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',item.public_id,'code',item.code,'name',item.name,'description',item.description,'status',item.status,'versionId',version.public_id,'revision',version.revision,'nodeCount',(select count(*) from public.agent_orchestration_nodes where orchestration_version_id=version.id),'edgeCount',(select count(*) from public.agent_orchestration_edges where orchestration_version_id=version.id)) order by item.updated_at desc,item.id desc) from (select * from public.agent_orchestrations where tenant_id=v_actor.tenant_id and organization_id=v_actor.organization_id order by updated_at desc,id desc limit p_limit) item left join public.agent_orchestration_versions version on version.id=item.current_version_id),'[]'::jsonb));
end;
$$;

revoke all on function public.create_current_agent_orchestration(text,text,text,jsonb,jsonb,uuid) from public,anon; grant execute on function public.create_current_agent_orchestration(text,text,text,jsonb,jsonb,uuid) to authenticated;
revoke all on function public.publish_current_agent_orchestration(uuid,uuid,uuid) from public,anon; grant execute on function public.publish_current_agent_orchestration(uuid,uuid,uuid) to authenticated;
revoke all on function public.list_current_agent_orchestrations(integer) from public,anon; grant execute on function public.list_current_agent_orchestrations(integer) to authenticated;

commit;
