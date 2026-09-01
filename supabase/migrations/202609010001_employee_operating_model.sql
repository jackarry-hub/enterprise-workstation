begin;

-- Clean-room implementation inspired by mature workflow products. QuantXY's
-- existing tenant, organization, employee, project and Agent model remains the
-- source of truth; no external project code is copied into this migration.

create or replace function public.valid_project_sop_steps(p_steps jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_step jsonb;
  v_key text;
  v_keys text[] := '{}';
begin
  if p_steps is null or jsonb_typeof(p_steps) <> 'array'
     or jsonb_array_length(p_steps) not between 1 and 30 then
    return false;
  end if;
  for v_step in select value from jsonb_array_elements(p_steps)
  loop
    if jsonb_typeof(v_step) <> 'object'
       or not (v_step ?& array['key','name','description','kind','requiresHuman'])
       or (select count(*) from jsonb_object_keys(v_step)) <> 5
       or (v_step ->> 'key') !~ '^[a-z][a-z0-9_-]{0,39}$'
       or length(btrim(coalesce(v_step ->> 'name',''))) not between 1 and 120
       or length(coalesce(v_step ->> 'description','')) > 1000
       or coalesce(v_step ->> 'kind','') not in ('human','agent','approval','system')
       or jsonb_typeof(v_step -> 'requiresHuman') <> 'boolean' then
      return false;
    end if;
    v_key := v_step ->> 'key';
    if v_key = any(v_keys) then return false; end if;
    v_keys := array_append(v_keys, v_key);
  end loop;
  return true;
end;
$$;

create or replace function public.valid_project_decision_citations(p_citations jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare v_citation jsonb; v_type text; v_id text;
begin
  if p_citations is null or jsonb_typeof(p_citations) <> 'array'
     or jsonb_array_length(p_citations) not between 1 and 20
     or pg_column_size(p_citations) > 32768 then return false; end if;
  for v_citation in select value from jsonb_array_elements(p_citations)
  loop
    if jsonb_typeof(v_citation) <> 'object'
       or not (v_citation ?& array['type','id','label'])
       or (select count(*) from jsonb_object_keys(v_citation)) <> 3
       or length(btrim(coalesce(v_citation->>'label',''))) not between 1 and 200
       or length(btrim(coalesce(v_citation->>'id',''))) not between 1 and 500 then return false; end if;
    v_type:=v_citation->>'type'; v_id:=v_citation->>'id';
    if v_type not in ('task','report','knowledge','file','link') then return false; end if;
    if v_type='link' and v_id !~ '^https://[^[:space:]]+$' then return false; end if;
    if v_type<>'link' and v_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' then return false; end if;
  end loop;
  return true;
end;
$$;

create table public.project_sop_definitions (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete cascade,
  organization_id bigint not null,
  project_id bigint not null,
  code text not null check(code ~ '^[a-z][a-z0-9_-]{1,79}$'),
  name text not null check(length(btrim(name)) between 2 and 160),
  description text not null default '' check(length(description) <= 2000),
  status text not null default 'draft' check(status in ('draft','active','retired')),
  current_version_id bigint,
  created_by_member_id bigint not null,
  updated_by_member_id bigint not null,
  version bigint not null default 1 check(version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  unique(tenant_id, organization_id, id),
  foreign key(tenant_id, organization_id, project_id)
    references public.projects(tenant_id, organization_id, id) on delete cascade,
  foreign key(tenant_id, organization_id, created_by_member_id)
    references public.organization_members(tenant_id, organization_id, id) on delete restrict,
  foreign key(tenant_id, organization_id, updated_by_member_id)
    references public.organization_members(tenant_id, organization_id, id) on delete restrict
);
create unique index project_sop_definitions_code_uidx
  on public.project_sop_definitions(tenant_id, organization_id, project_id, code)
  where deleted_at is null;

create table public.project_sop_versions (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete cascade,
  organization_id bigint not null,
  definition_id bigint not null,
  revision integer not null check(revision > 0),
  lifecycle text not null default 'draft' check(lifecycle in ('draft','published','retired')),
  steps jsonb not null check(public.valid_project_sop_steps(steps)),
  change_note text not null check(length(btrim(change_note)) between 1 and 500),
  created_by_member_id bigint not null,
  published_by_member_id bigint,
  published_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique(tenant_id, organization_id, id),
  unique(tenant_id, definition_id, revision),
  foreign key(tenant_id, organization_id, definition_id)
    references public.project_sop_definitions(tenant_id, organization_id, id) on delete cascade,
  foreign key(tenant_id, organization_id, created_by_member_id)
    references public.organization_members(tenant_id, organization_id, id) on delete restrict,
  foreign key(tenant_id, organization_id, published_by_member_id)
    references public.organization_members(tenant_id, organization_id, id) on delete restrict,
  check((lifecycle = 'published' and published_by_member_id is not null and published_at is not null)
     or lifecycle <> 'published')
);
alter table public.project_sop_definitions
  add constraint project_sop_definitions_current_version_fkey
  foreign key(tenant_id, organization_id, current_version_id)
  references public.project_sop_versions(tenant_id, organization_id, id) on delete restrict;

create table public.project_sop_runs (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete cascade,
  organization_id bigint not null,
  project_id bigint not null,
  task_id bigint,
  definition_id bigint not null,
  sop_version_id bigint not null,
  assigned_member_id bigint not null,
  started_by_member_id bigint not null,
  status text not null check(status in ('running','waiting_human','completed','failed','cancelled')),
  current_step_index integer not null default 0 check(current_step_index >= 0),
  version bigint not null default 1 check(version > 0),
  started_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  unique(tenant_id, organization_id, id),
  foreign key(tenant_id, organization_id, project_id)
    references public.projects(tenant_id, organization_id, id) on delete restrict,
  foreign key(tenant_id, organization_id, project_id, task_id)
    references public.tasks(tenant_id, organization_id, project_id, id) on delete restrict,
  foreign key(tenant_id, organization_id, definition_id)
    references public.project_sop_definitions(tenant_id, organization_id, id) on delete restrict,
  foreign key(tenant_id, organization_id, sop_version_id)
    references public.project_sop_versions(tenant_id, organization_id, id) on delete restrict,
  foreign key(tenant_id, organization_id, assigned_member_id)
    references public.organization_members(tenant_id, organization_id, id) on delete restrict,
  foreign key(tenant_id, organization_id, started_by_member_id)
    references public.organization_members(tenant_id, organization_id, id) on delete restrict,
  check(completed_at is null or status in ('completed','failed','cancelled'))
);
create index project_sop_runs_project_status_idx
  on public.project_sop_runs(project_id, status, updated_at desc);
create index project_sop_runs_assignee_status_idx
  on public.project_sop_runs(assigned_member_id, status, updated_at desc);

create table public.project_sop_run_events (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete cascade,
  organization_id bigint not null,
  project_id bigint not null,
  sop_run_id bigint not null,
  sequence integer not null check(sequence > 0),
  actor_member_id bigint not null,
  event_type text not null check(event_type in (
    'started','step_completed','human_requested','human_resumed','completed','failed','cancelled'
  )),
  from_status text,
  to_status text not null check(to_status in ('running','waiting_human','completed','failed','cancelled')),
  step_index integer not null check(step_index >= 0),
  note text not null default '' check(length(note) <= 2000),
  evidence jsonb not null default '{}'::jsonb
    check(jsonb_typeof(evidence) = 'object' and pg_column_size(evidence) <= 32768),
  request_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  unique(sop_run_id, sequence),
  unique(tenant_id, actor_member_id, request_id),
  foreign key(tenant_id, organization_id, project_id)
    references public.projects(tenant_id, organization_id, id) on delete restrict,
  foreign key(tenant_id, organization_id, sop_run_id)
    references public.project_sop_runs(tenant_id, organization_id, id) on delete restrict,
  foreign key(tenant_id, organization_id, actor_member_id)
    references public.organization_members(tenant_id, organization_id, id) on delete restrict
);
create index project_sop_run_events_project_time_idx
  on public.project_sop_run_events(project_id, created_at desc, id desc);

create table public.project_decisions (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete cascade,
  organization_id bigint not null,
  project_id bigint not null,
  decision_type text not null check(decision_type in ('decision','risk','lesson','action')),
  title text not null check(length(btrim(title)) between 2 and 200),
  summary text not null check(length(btrim(summary)) between 2 and 8000),
  citations jsonb not null
    check(public.valid_project_decision_citations(citations)),
  owner_member_id bigint not null,
  status text not null default 'proposed' check(status in ('proposed','accepted','archived')),
  created_by_member_id bigint not null,
  accepted_by_member_id bigint,
  accepted_at timestamptz,
  version bigint not null default 1 check(version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(tenant_id, organization_id, id),
  foreign key(tenant_id, organization_id, project_id)
    references public.projects(tenant_id, organization_id, id) on delete cascade,
  foreign key(tenant_id, organization_id, owner_member_id)
    references public.organization_members(tenant_id, organization_id, id) on delete restrict,
  foreign key(tenant_id, organization_id, created_by_member_id)
    references public.organization_members(tenant_id, organization_id, id) on delete restrict,
  foreign key(tenant_id, organization_id, accepted_by_member_id)
    references public.organization_members(tenant_id, organization_id, id) on delete restrict,
  check((status = 'accepted' and accepted_by_member_id is not null and accepted_at is not null)
     or status <> 'accepted')
);
create index project_decisions_project_status_idx
  on public.project_decisions(project_id, status, updated_at desc);

create table public.project_retrospectives (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete cascade,
  organization_id bigint not null,
  project_id bigint not null,
  outcome text not null check(length(btrim(outcome)) between 2 and 8000),
  wins text not null default '' check(length(wins) <= 8000),
  lessons text not null check(length(btrim(lessons)) between 2 and 8000),
  follow_ups text not null default '' check(length(follow_ups) <= 8000),
  updated_by_member_id bigint not null,
  version bigint not null default 1 check(version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(tenant_id, organization_id, project_id),
  foreign key(tenant_id, organization_id, project_id)
    references public.projects(tenant_id, organization_id, id) on delete cascade,
  foreign key(tenant_id, organization_id, updated_by_member_id)
    references public.organization_members(tenant_id, organization_id, id) on delete restrict
);

alter table public.project_sop_definitions enable row level security;
alter table public.project_sop_definitions force row level security;
alter table public.project_sop_versions enable row level security;
alter table public.project_sop_versions force row level security;
alter table public.project_sop_runs enable row level security;
alter table public.project_sop_runs force row level security;
alter table public.project_sop_run_events enable row level security;
alter table public.project_sop_run_events force row level security;
alter table public.project_decisions enable row level security;
alter table public.project_decisions force row level security;
alter table public.project_retrospectives enable row level security;
alter table public.project_retrospectives force row level security;

create policy project_sop_definitions_project_read on public.project_sop_definitions
for select to authenticated using(tenant_id = (select public.current_tenant_id()) and (select public.can_view_project(project_id)));
create policy project_sop_versions_project_read on public.project_sop_versions
for select to authenticated using(exists(
  select 1 from public.project_sop_definitions definition
  where definition.id = project_sop_versions.definition_id
    and definition.tenant_id = project_sop_versions.tenant_id
    and (select public.can_view_project(definition.project_id))
));
create policy project_sop_runs_project_read on public.project_sop_runs
for select to authenticated using(tenant_id = (select public.current_tenant_id()) and (select public.can_view_project(project_id)));
create policy project_sop_run_events_project_read on public.project_sop_run_events
for select to authenticated using(tenant_id = (select public.current_tenant_id()) and (select public.can_view_project(project_id)));
create policy project_decisions_project_read on public.project_decisions
for select to authenticated using(tenant_id = (select public.current_tenant_id()) and (select public.can_view_project(project_id)));
create policy project_retrospectives_project_read on public.project_retrospectives
for select to authenticated using(tenant_id = (select public.current_tenant_id()) and (select public.can_view_project(project_id)));

create or replace function public.reject_operating_model_history_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'operating_model_history_append_only' using errcode = '42501';
end;
$$;
create trigger project_sop_run_events_append_only
before update or delete on public.project_sop_run_events
for each row execute function public.reject_operating_model_history_mutation();

create or replace function public.reject_published_project_sop_version_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' and old.lifecycle in ('published','retired') then
    raise exception 'published_project_sop_version_immutable' using errcode = '55000';
  end if;
  if tg_op = 'UPDATE' and old.lifecycle = 'retired' then
    raise exception 'published_project_sop_version_immutable' using errcode = '55000';
  end if;
  if tg_op = 'UPDATE' and old.lifecycle = 'published' and (
    new.lifecycle <> 'retired'
    or new.public_id is distinct from old.public_id
    or new.tenant_id is distinct from old.tenant_id
    or new.organization_id is distinct from old.organization_id
    or new.definition_id is distinct from old.definition_id
    or new.revision is distinct from old.revision
    or new.steps is distinct from old.steps
    or new.change_note is distinct from old.change_note
    or new.created_by_member_id is distinct from old.created_by_member_id
    or new.published_by_member_id is distinct from old.published_by_member_id
    or new.published_at is distinct from old.published_at
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'published_project_sop_version_immutable' using errcode = '55000';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger project_sop_versions_published_immutable
before update or delete on public.project_sop_versions
for each row execute function public.reject_published_project_sop_version_mutation();

create or replace function public.save_current_project_sop(
  p_project_public_id uuid,
  p_definition_public_id uuid,
  p_code text,
  p_name text,
  p_description text,
  p_steps jsonb,
  p_publish boolean,
  p_reason text,
  request_id uuid,
  idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant bigint; v_org bigint; v_actor bigint; v_user uuid; v_employee uuid;
  v_project bigint; v_access text; v_claim jsonb; v_replay boolean;
  v_definition public.project_sop_definitions%rowtype;
  v_version public.project_sop_versions%rowtype; v_revision integer;
  v_entity jsonb;
begin
  if p_project_public_id is null or p_code !~ '^[a-z][a-z0-9_-]{1,79}$'
     or length(btrim(coalesce(p_name,''))) not between 2 and 160
     or length(coalesce(p_description,'')) > 2000
     or not public.valid_project_sop_steps(p_steps)
     or p_publish is null or length(btrim(coalesce(p_reason,''))) not between 1 and 500
     or request_id is null or idempotency_key is null or request_id = idempotency_key then
    raise exception 'invalid_project_sop' using errcode = '22023';
  end if;
  select * into strict v_tenant,v_org,v_actor,v_user,v_employee from public.current_project_execution_identity();
  v_claim := public.claim_project_execution_command(v_tenant,v_org,v_actor,'save_current_project_sop',
    p_project_public_id,jsonb_build_object('definitionId',p_definition_public_id,'code',p_code,'name',btrim(p_name),
    'description',p_description,'steps',p_steps,'publish',p_publish,'reason',btrim(p_reason)),idempotency_key,request_id);
  if v_claim->>'state'='scope_conflict' then return public.audit_project_execution_scope_conflict(
    v_tenant,v_org,v_user,v_actor,'save_current_project_sop','sop_definition',p_project_public_id::text,
    request_id,idempotency_key,btrim(p_reason)); end if;
  v_replay := v_claim->>'state'='replay';
  select access.project_id,access.access_state into strict v_project,v_access
  from public.lock_current_project_execution_access(v_tenant,v_org,v_actor,p_project_public_id,'manage') access;
  if v_access<>'allowed' then
    if v_replay then return public.audit_project_execution_replay_denied(v_tenant,v_org,v_user,v_actor,
      'save_current_project_sop','sop_definition',p_project_public_id::text,request_id,idempotency_key,btrim(p_reason),v_access); end if;
    return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,'save_current_project_sop',
      'sop_definition','project.sop_saved',p_project_public_id::text,request_id,idempotency_key,btrim(p_reason),'failure',v_access,null);
  end if;
  if v_replay then return v_claim->'result'; end if;
  begin
    if p_definition_public_id is null then
      insert into public.project_sop_definitions(tenant_id,organization_id,project_id,code,name,description,
        status,created_by_member_id,updated_by_member_id)
      values(v_tenant,v_org,v_project,p_code,btrim(p_name),p_description,case when p_publish then 'active' else 'draft' end,v_actor,v_actor)
      returning * into strict v_definition;
    else
      select * into v_definition from public.project_sop_definitions
      where tenant_id=v_tenant and organization_id=v_org and project_id=v_project
        and public_id=p_definition_public_id and deleted_at is null for update;
      if not found then return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,
        'save_current_project_sop','sop_definition','project.sop_saved',p_definition_public_id::text,
        request_id,idempotency_key,btrim(p_reason),'failure','not_found',null); end if;
      update public.project_sop_definitions set code=p_code,name=btrim(p_name),description=p_description,
        updated_by_member_id=v_actor,version=version+1,updated_at=clock_timestamp()
      where id=v_definition.id returning * into strict v_definition;
    end if;
    select coalesce(max(revision),0)+1 into v_revision from public.project_sop_versions
      where tenant_id=v_tenant and definition_id=v_definition.id;
    if p_publish then
      update public.project_sop_versions set lifecycle='retired'
      where tenant_id=v_tenant and definition_id=v_definition.id and lifecycle='published';
    end if;
    insert into public.project_sop_versions(tenant_id,organization_id,definition_id,revision,lifecycle,
      steps,change_note,created_by_member_id,published_by_member_id,published_at)
    values(v_tenant,v_org,v_definition.id,v_revision,case when p_publish then 'published' else 'draft' end,
      p_steps,btrim(p_reason),v_actor,case when p_publish then v_actor end,case when p_publish then clock_timestamp() end)
    returning * into strict v_version;
    if p_publish then
      update public.project_sop_definitions set current_version_id=v_version.id,status='active',
        updated_by_member_id=v_actor,updated_at=clock_timestamp()
      where id=v_definition.id returning * into strict v_definition;
    end if;
    insert into public.project_activities(tenant_id,organization_id,project_id,user_id,actor_member_id,
      action_type,content,version) values(v_tenant,v_org,v_project,v_user,v_actor,'project_updated',
      case when p_publish then '发布 SOP：' else '保存 SOP 草稿：' end || v_definition.name,1);
    v_entity := jsonb_build_object('id',v_definition.public_id,'projectId',p_project_public_id,
      'code',v_definition.code,'name',v_definition.name,'description',v_definition.description,
      'status',v_definition.status,'version',v_definition.version,'versionId',v_version.public_id,
      'revision',v_version.revision,'lifecycle',v_version.lifecycle,'steps',v_version.steps,
      'updatedAt',v_definition.updated_at);
    return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,'save_current_project_sop',
      'sop_definition','project.sop_saved',v_definition.public_id::text,request_id,idempotency_key,btrim(p_reason),'success',null,v_entity);
  exception when unique_violation then
    return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,'save_current_project_sop',
      'sop_definition','project.sop_saved',p_project_public_id::text,request_id,idempotency_key,btrim(p_reason),'failure','conflict',null);
  when others then
    return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,'save_current_project_sop',
      'sop_definition','project.sop_saved',p_project_public_id::text,request_id,idempotency_key,btrim(p_reason),'failure','command_failed',null);
  end;
end;
$$;

create or replace function public.start_current_project_sop_run(
  p_project_public_id uuid,
  p_definition_public_id uuid,
  p_task_public_id uuid,
  p_assigned_employee_public_id uuid,
  p_reason text,
  request_id uuid,
  idempotency_key uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_tenant bigint; v_org bigint; v_actor bigint; v_user uuid; v_employee uuid;
  v_project bigint; v_access text; v_claim jsonb; v_replay boolean;
  v_definition public.project_sop_definitions%rowtype; v_version public.project_sop_versions%rowtype;
  v_run public.project_sop_runs%rowtype; v_task bigint; v_assignee bigint; v_first jsonb; v_status text; v_entity jsonb;
begin
  if p_project_public_id is null or p_definition_public_id is null or p_assigned_employee_public_id is null
     or length(btrim(coalesce(p_reason,''))) not between 1 and 500
     or request_id is null or idempotency_key is null or request_id=idempotency_key then
    raise exception 'invalid_project_sop_run' using errcode='22023'; end if;
  select * into strict v_tenant,v_org,v_actor,v_user,v_employee from public.current_project_execution_identity();
  v_claim:=public.claim_project_execution_command(v_tenant,v_org,v_actor,'start_current_project_sop_run',
    p_definition_public_id,jsonb_build_object('projectId',p_project_public_id,'taskId',p_task_public_id,
    'assignee',p_assigned_employee_public_id,'reason',btrim(p_reason)),idempotency_key,request_id);
  if v_claim->>'state'='scope_conflict' then return public.audit_project_execution_scope_conflict(v_tenant,v_org,v_user,v_actor,
    'start_current_project_sop_run','sop_run',p_definition_public_id::text,request_id,idempotency_key,btrim(p_reason)); end if;
  v_replay:=v_claim->>'state'='replay';
  select access.project_id,access.access_state into strict v_project,v_access from public.lock_current_project_execution_access(
    v_tenant,v_org,v_actor,p_project_public_id,'manage') access;
  if v_access<>'allowed' then
    if v_replay then return public.audit_project_execution_replay_denied(v_tenant,v_org,v_user,v_actor,
      'start_current_project_sop_run','sop_run',p_definition_public_id::text,request_id,idempotency_key,btrim(p_reason),v_access); end if;
    return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,'start_current_project_sop_run','sop_run',
      'project.sop_run_started',p_definition_public_id::text,request_id,idempotency_key,btrim(p_reason),'failure',v_access,null);
  end if;
  if v_replay then return v_claim->'result'; end if;
  select * into v_definition from public.project_sop_definitions where tenant_id=v_tenant and organization_id=v_org
    and project_id=v_project and public_id=p_definition_public_id and status='active' and deleted_at is null for update;
  if not found or v_definition.current_version_id is null then return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,
    'start_current_project_sop_run','sop_run','project.sop_run_started',p_definition_public_id::text,request_id,idempotency_key,
    btrim(p_reason),'failure','not_found',null); end if;
  select * into strict v_version from public.project_sop_versions where tenant_id=v_tenant and organization_id=v_org
    and id=v_definition.current_version_id and lifecycle='published';
  if p_task_public_id is not null then
    select id into v_task from public.tasks where tenant_id=v_tenant and organization_id=v_org and project_id=v_project
      and public_id=p_task_public_id and deleted_at is null;
    if v_task is null then return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,
      'start_current_project_sop_run','sop_run','project.sop_run_started',p_definition_public_id::text,request_id,idempotency_key,
      btrim(p_reason),'failure','not_found',null); end if;
  end if;
  select profile.organization_member_id into v_assignee from public.employee_profiles profile
  join public.organization_members member on member.tenant_id=profile.tenant_id and member.organization_id=profile.organization_id
    and member.id=profile.organization_member_id and member.status='active'
  join public.project_members membership on membership.tenant_id=profile.tenant_id and membership.organization_id=profile.organization_id
    and membership.project_id=v_project and membership.member_id=profile.organization_member_id and membership.left_at is null
  where profile.tenant_id=v_tenant and profile.organization_id=v_org and profile.public_id=p_assigned_employee_public_id
    and profile.deleted_at is null and profile.employment_status in ('probation','active','on_leave');
  if v_assignee is null then return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,
    'start_current_project_sop_run','sop_run','project.sop_run_started',p_definition_public_id::text,request_id,idempotency_key,
    btrim(p_reason),'failure','not_found',null); end if;
  v_first:=v_version.steps->0;
  v_status:=case when (v_first->>'requiresHuman')::boolean or v_first->>'kind'='approval' then 'waiting_human' else 'running' end;
  insert into public.project_sop_runs(tenant_id,organization_id,project_id,task_id,definition_id,sop_version_id,
    assigned_member_id,started_by_member_id,status) values(v_tenant,v_org,v_project,v_task,v_definition.id,v_version.id,
    v_assignee,v_actor,v_status) returning * into strict v_run;
  insert into public.project_sop_run_events(tenant_id,organization_id,project_id,sop_run_id,sequence,actor_member_id,
    event_type,from_status,to_status,step_index,note,evidence,request_id)
  values(v_tenant,v_org,v_project,v_run.id,1,v_actor,'started',null,v_status,0,btrim(p_reason),'{}',request_id);
  insert into public.project_activities(tenant_id,organization_id,project_id,user_id,actor_member_id,action_type,content,version)
    values(v_tenant,v_org,v_project,v_user,v_actor,'project_updated','启动 SOP：'||v_definition.name,1);
  v_entity:=jsonb_build_object('id',v_run.public_id,'projectId',p_project_public_id,'taskId',p_task_public_id,
    'definitionId',v_definition.public_id,'versionId',v_version.public_id,'revision',v_version.revision,
    'assignedEmployeeId',p_assigned_employee_public_id,'status',v_run.status,'currentStepIndex',0,
    'version',v_run.version,'startedAt',v_run.started_at,'updatedAt',v_run.updated_at);
  return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,'start_current_project_sop_run','sop_run',
    'project.sop_run_started',v_run.public_id::text,request_id,idempotency_key,btrim(p_reason),'success',null,v_entity);
exception when others then
  if v_tenant is null then raise; end if;
  return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,'start_current_project_sop_run','sop_run',
    'project.sop_run_started',coalesce(p_definition_public_id,p_project_public_id)::text,request_id,idempotency_key,
    btrim(coalesce(p_reason,'failed')),'failure','command_failed',null);
end;
$$;

create or replace function public.advance_current_project_sop_run(
  p_run_public_id uuid,
  p_action text,
  p_expected_version bigint,
  p_note text,
  p_evidence jsonb,
  p_reason text,
  request_id uuid,
  idempotency_key uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_tenant bigint; v_org bigint; v_actor bigint; v_user uuid; v_employee uuid;
  v_run public.project_sop_runs%rowtype; v_version public.project_sop_versions%rowtype;
  v_project_public uuid; v_access text; v_project bigint; v_claim jsonb; v_replay boolean;
  v_steps integer; v_next integer; v_next_step jsonb; v_status text; v_from_status text;
  v_event text; v_sequence integer; v_entity jsonb;
begin
  if p_run_public_id is null or p_action is null or p_action not in ('complete_step','request_human','resume','fail','cancel')
     or p_expected_version is null or p_expected_version<1 or length(coalesce(p_note,''))>2000
     or jsonb_typeof(coalesce(p_evidence,'{}'))<>'object' or pg_column_size(coalesce(p_evidence,'{}'))>32768
     or length(btrim(coalesce(p_reason,''))) not between 1 and 500
     or request_id is null or idempotency_key is null or request_id=idempotency_key then
    raise exception 'invalid_project_sop_run_action' using errcode='22023'; end if;
  select * into strict v_tenant,v_org,v_actor,v_user,v_employee from public.current_project_execution_identity();
  v_claim:=public.claim_project_execution_command(v_tenant,v_org,v_actor,'advance_current_project_sop_run',p_run_public_id,
    jsonb_build_object('action',p_action,'expectedVersion',p_expected_version,'note',p_note,'evidence',coalesce(p_evidence,'{}'),
      'reason',btrim(p_reason)),idempotency_key,request_id);
  if v_claim->>'state'='scope_conflict' then return public.audit_project_execution_scope_conflict(v_tenant,v_org,v_user,v_actor,
    'advance_current_project_sop_run','sop_run',p_run_public_id::text,request_id,idempotency_key,btrim(p_reason)); end if;
  v_replay:=v_claim->>'state'='replay';
  select * into v_run from public.project_sop_runs run
  where run.tenant_id=v_tenant and run.organization_id=v_org and run.public_id=p_run_public_id for update;
  if not found then return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,'advance_current_project_sop_run',
    'sop_run','project.sop_run_advanced',p_run_public_id::text,request_id,idempotency_key,btrim(p_reason),'failure','not_found',null); end if;
  select project.public_id into strict v_project_public from public.projects project
  where project.tenant_id=v_run.tenant_id and project.organization_id=v_run.organization_id and project.id=v_run.project_id;
  select access.project_id,access.access_state into strict v_project,v_access from public.lock_current_project_execution_access(
    v_tenant,v_org,v_actor,v_project_public,'contribute') access;
  if v_access<>'allowed' or (v_actor<>v_run.assigned_member_id and not public.can_manage_project(v_run.project_id)) then
    v_access:='forbidden';
    if v_replay then return public.audit_project_execution_replay_denied(v_tenant,v_org,v_user,v_actor,
      'advance_current_project_sop_run','sop_run',p_run_public_id::text,request_id,idempotency_key,btrim(p_reason),v_access); end if;
    return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,'advance_current_project_sop_run','sop_run',
      'project.sop_run_advanced',p_run_public_id::text,request_id,idempotency_key,btrim(p_reason),'failure',v_access,null);
  end if;
  if v_replay then return v_claim->'result'; end if;
  if v_run.version<>p_expected_version then return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,
    'advance_current_project_sop_run','sop_run','project.sop_run_advanced',p_run_public_id::text,request_id,idempotency_key,
    btrim(p_reason),'failure','stale_version',null); end if;
  if v_run.status in ('completed','failed','cancelled') then return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,
    'advance_current_project_sop_run','sop_run','project.sop_run_advanced',p_run_public_id::text,request_id,idempotency_key,
    btrim(p_reason),'failure','invalid_state',null); end if;
  select * into strict v_version from public.project_sop_versions where tenant_id=v_tenant and organization_id=v_org and id=v_run.sop_version_id;
  v_from_status:=v_run.status;
  v_steps:=jsonb_array_length(v_version.steps); v_next:=v_run.current_step_index;
  if p_action='request_human' then
    if v_run.status<>'running' then return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,
      'advance_current_project_sop_run','sop_run','project.sop_run_advanced',p_run_public_id::text,request_id,idempotency_key,
      btrim(p_reason),'failure','invalid_state',null); end if;
    v_status:='waiting_human'; v_event:='human_requested';
  elsif p_action='resume' then
    if v_run.status<>'waiting_human' then return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,
      'advance_current_project_sop_run','sop_run','project.sop_run_advanced',p_run_public_id::text,request_id,idempotency_key,
      btrim(p_reason),'failure','invalid_state',null); end if;
    v_status:='running'; v_event:='human_resumed';
  elsif p_action='fail' then v_status:='failed'; v_event:='failed';
  elsif p_action='cancel' then
    if not public.can_manage_project(v_run.project_id) then return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,
      'advance_current_project_sop_run','sop_run','project.sop_run_advanced',p_run_public_id::text,request_id,idempotency_key,
      btrim(p_reason),'failure','forbidden',null); end if;
    v_status:='cancelled'; v_event:='cancelled';
  else
    v_next:=v_run.current_step_index+1;
    if v_next>=v_steps then v_status:='completed'; v_event:='completed';
    else
      v_next_step:=v_version.steps->v_next;
      v_status:=case when (v_next_step->>'requiresHuman')::boolean or v_next_step->>'kind'='approval' then 'waiting_human' else 'running' end;
      v_event:='step_completed';
    end if;
  end if;
  update public.project_sop_runs set status=v_status,current_step_index=v_next,version=version+1,
    completed_at=case when v_status in ('completed','failed','cancelled') then clock_timestamp() else null end,
    updated_at=clock_timestamp() where id=v_run.id returning * into strict v_run;
  select coalesce(max(sequence),0)+1 into v_sequence from public.project_sop_run_events where sop_run_id=v_run.id;
  insert into public.project_sop_run_events(tenant_id,organization_id,project_id,sop_run_id,sequence,actor_member_id,
    event_type,from_status,to_status,step_index,note,evidence,request_id)
  values(v_tenant,v_org,v_run.project_id,v_run.id,v_sequence,v_actor,v_event,v_from_status,v_status,v_next,
    coalesce(p_note,''),coalesce(p_evidence,'{}'),request_id);
  insert into public.project_activities(tenant_id,organization_id,project_id,user_id,actor_member_id,action_type,content,version)
    values(v_tenant,v_org,v_run.project_id,v_user,v_actor,'project_updated','SOP 状态更新：'||v_event,1);
  v_entity:=jsonb_build_object('id',v_run.public_id,'projectId',v_project_public,'status',v_run.status,
    'currentStepIndex',v_run.current_step_index,'version',v_run.version,'updatedAt',v_run.updated_at,
    'completedAt',v_run.completed_at);
  return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,'advance_current_project_sop_run','sop_run',
    'project.sop_run_advanced',v_run.public_id::text,request_id,idempotency_key,btrim(p_reason),'success',null,v_entity);
exception when others then
  if v_tenant is null then raise; end if;
  return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,'advance_current_project_sop_run','sop_run',
    'project.sop_run_advanced',p_run_public_id::text,request_id,idempotency_key,btrim(coalesce(p_reason,'failed')),
    'failure','command_failed',null);
end;
$$;

create or replace function public.record_current_project_decision(
  p_project_public_id uuid,
  p_decision_type text,
  p_title text,
  p_summary text,
  p_citations jsonb,
  p_owner_employee_public_id uuid,
  p_reason text,
  request_id uuid,
  idempotency_key uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_tenant bigint; v_org bigint; v_actor bigint; v_user uuid; v_employee uuid; v_project bigint; v_access text;
  v_claim jsonb; v_replay boolean; v_owner bigint; v_row public.project_decisions%rowtype; v_entity jsonb;
begin
  if p_project_public_id is null or p_decision_type not in ('decision','risk','lesson','action')
     or length(btrim(coalesce(p_title,''))) not between 2 and 200 or length(btrim(coalesce(p_summary,''))) not between 2 and 8000
     or not public.valid_project_decision_citations(p_citations) or p_owner_employee_public_id is null
     or length(btrim(coalesce(p_reason,''))) not between 1 and 500 or request_id is null or idempotency_key is null
     or request_id=idempotency_key then raise exception 'invalid_project_decision' using errcode='22023'; end if;
  select * into strict v_tenant,v_org,v_actor,v_user,v_employee from public.current_project_execution_identity();
  v_claim:=public.claim_project_execution_command(v_tenant,v_org,v_actor,'record_current_project_decision',p_project_public_id,
    jsonb_build_object('type',p_decision_type,'title',btrim(p_title),'summary',btrim(p_summary),'citations',coalesce(p_citations,'[]'),
      'owner',p_owner_employee_public_id,'reason',btrim(p_reason)),idempotency_key,request_id);
  if v_claim->>'state'='scope_conflict' then return public.audit_project_execution_scope_conflict(v_tenant,v_org,v_user,v_actor,
    'record_current_project_decision','project_decision',p_project_public_id::text,request_id,idempotency_key,btrim(p_reason)); end if;
  v_replay:=v_claim->>'state'='replay';
  select access.project_id,access.access_state into strict v_project,v_access from public.lock_current_project_execution_access(
    v_tenant,v_org,v_actor,p_project_public_id,'contribute') access;
  if v_access<>'allowed' then
    if v_replay then return public.audit_project_execution_replay_denied(v_tenant,v_org,v_user,v_actor,'record_current_project_decision',
      'project_decision',p_project_public_id::text,request_id,idempotency_key,btrim(p_reason),v_access); end if;
    return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,'record_current_project_decision','project_decision',
      'project.decision_recorded',p_project_public_id::text,request_id,idempotency_key,btrim(p_reason),'failure',v_access,null); end if;
  if v_replay then return v_claim->'result'; end if;
  select profile.organization_member_id into v_owner from public.employee_profiles profile
  join public.project_members membership on membership.tenant_id=profile.tenant_id and membership.organization_id=profile.organization_id
    and membership.project_id=v_project and membership.member_id=profile.organization_member_id and membership.left_at is null
  where profile.tenant_id=v_tenant and profile.organization_id=v_org and profile.public_id=p_owner_employee_public_id
    and profile.deleted_at is null and profile.employment_status in ('probation','active','on_leave');
  if v_owner is null then return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,'record_current_project_decision',
    'project_decision','project.decision_recorded',p_project_public_id::text,request_id,idempotency_key,btrim(p_reason),'failure','not_found',null); end if;
  insert into public.project_decisions(tenant_id,organization_id,project_id,decision_type,title,summary,citations,
    owner_member_id,created_by_member_id) values(v_tenant,v_org,v_project,p_decision_type,btrim(p_title),btrim(p_summary),
    coalesce(p_citations,'[]'),v_owner,v_actor) returning * into strict v_row;
  insert into public.project_activities(tenant_id,organization_id,project_id,user_id,actor_member_id,action_type,content,version)
    values(v_tenant,v_org,v_project,v_user,v_actor,'project_note_added','记录项目决策：'||v_row.title,1);
  v_entity:=jsonb_build_object('id',v_row.public_id,'projectId',p_project_public_id,'type',v_row.decision_type,
    'title',v_row.title,'summary',v_row.summary,'citations',v_row.citations,'ownerEmployeeId',p_owner_employee_public_id,
    'status',v_row.status,'version',v_row.version,'createdAt',v_row.created_at,'updatedAt',v_row.updated_at);
  return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,'record_current_project_decision','project_decision',
    'project.decision_recorded',v_row.public_id::text,request_id,idempotency_key,btrim(p_reason),'success',null,v_entity);
end;
$$;

create or replace function public.transition_current_project_decision(
  p_decision_public_id uuid,
  p_status text,
  p_expected_version bigint,
  p_reason text,
  request_id uuid,
  idempotency_key uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_tenant bigint; v_org bigint; v_actor bigint; v_user uuid; v_employee uuid; v_project bigint; v_access text;
  v_claim jsonb; v_replay boolean; v_row public.project_decisions%rowtype; v_project_public uuid; v_entity jsonb;
begin
  if p_decision_public_id is null or p_status is null or p_status not in ('accepted','archived')
     or p_expected_version is null or p_expected_version<1
     or length(btrim(coalesce(p_reason,''))) not between 1 and 500 or request_id is null or idempotency_key is null
     or request_id=idempotency_key then raise exception 'invalid_project_decision_transition' using errcode='22023'; end if;
  select * into strict v_tenant,v_org,v_actor,v_user,v_employee from public.current_project_execution_identity();
  v_claim:=public.claim_project_execution_command(v_tenant,v_org,v_actor,'transition_current_project_decision',p_decision_public_id,
    jsonb_build_object('status',p_status,'expectedVersion',p_expected_version,'reason',btrim(p_reason)),idempotency_key,request_id);
  if v_claim->>'state'='scope_conflict' then return public.audit_project_execution_scope_conflict(v_tenant,v_org,v_user,v_actor,
    'transition_current_project_decision','project_decision',p_decision_public_id::text,request_id,idempotency_key,btrim(p_reason)); end if;
  v_replay:=v_claim->>'state'='replay';
  select * into v_row from public.project_decisions decision
  where decision.tenant_id=v_tenant and decision.organization_id=v_org and decision.public_id=p_decision_public_id for update;
  if not found then return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,'transition_current_project_decision',
    'project_decision','project.decision_transitioned',p_decision_public_id::text,request_id,idempotency_key,btrim(p_reason),'failure','not_found',null); end if;
  select project.public_id into strict v_project_public from public.projects project
  where project.tenant_id=v_row.tenant_id and project.organization_id=v_row.organization_id and project.id=v_row.project_id;
  select access.project_id,access.access_state into strict v_project,v_access from public.lock_current_project_execution_access(
    v_tenant,v_org,v_actor,v_project_public,'manage') access;
  if v_access<>'allowed' then
    if v_replay then return public.audit_project_execution_replay_denied(v_tenant,v_org,v_user,v_actor,'transition_current_project_decision',
      'project_decision',p_decision_public_id::text,request_id,idempotency_key,btrim(p_reason),v_access); end if;
    return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,'transition_current_project_decision','project_decision',
      'project.decision_transitioned',p_decision_public_id::text,request_id,idempotency_key,btrim(p_reason),'failure',v_access,null); end if;
  if v_replay then return v_claim->'result'; end if;
  if v_row.version<>p_expected_version then return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,
    'transition_current_project_decision','project_decision','project.decision_transitioned',p_decision_public_id::text,
    request_id,idempotency_key,btrim(p_reason),'failure','stale_version',null); end if;
  update public.project_decisions set status=p_status,accepted_by_member_id=case when p_status='accepted' then v_actor end,
    accepted_at=case when p_status='accepted' then clock_timestamp() end,version=version+1,updated_at=clock_timestamp()
    where id=v_row.id returning * into strict v_row;
  insert into public.project_activities(tenant_id,organization_id,project_id,user_id,actor_member_id,action_type,content,version)
    values(v_tenant,v_org,v_row.project_id,v_user,v_actor,'project_note_added',
      case when p_status='accepted' then '确认项目决策：' else '归档项目决策：' end||v_row.title,1);
  v_entity:=jsonb_build_object('id',v_row.public_id,'projectId',v_project_public,'status',v_row.status,
    'version',v_row.version,'acceptedAt',v_row.accepted_at,'updatedAt',v_row.updated_at);
  return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,'transition_current_project_decision','project_decision',
    'project.decision_transitioned',v_row.public_id::text,request_id,idempotency_key,btrim(p_reason),'success',null,v_entity);
end;
$$;

create or replace function public.save_current_project_retrospective(
  p_project_public_id uuid,
  p_outcome text,
  p_wins text,
  p_lessons text,
  p_follow_ups text,
  p_expected_version bigint,
  p_reason text,
  request_id uuid,
  idempotency_key uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_tenant bigint; v_org bigint; v_actor bigint; v_user uuid; v_employee uuid; v_project bigint; v_access text;
  v_claim jsonb; v_replay boolean; v_row public.project_retrospectives%rowtype; v_entity jsonb;
begin
  if p_project_public_id is null or length(btrim(coalesce(p_outcome,''))) not between 2 and 8000
     or length(coalesce(p_wins,''))>8000 or length(btrim(coalesce(p_lessons,''))) not between 2 and 8000
     or length(coalesce(p_follow_ups,''))>8000 or coalesce(p_expected_version,0)<0
     or length(btrim(coalesce(p_reason,''))) not between 1 and 500 or request_id is null or idempotency_key is null
     or request_id=idempotency_key then raise exception 'invalid_project_retrospective' using errcode='22023'; end if;
  select * into strict v_tenant,v_org,v_actor,v_user,v_employee from public.current_project_execution_identity();
  v_claim:=public.claim_project_execution_command(v_tenant,v_org,v_actor,'save_current_project_retrospective',p_project_public_id,
    jsonb_build_object('outcome',btrim(p_outcome),'wins',p_wins,'lessons',btrim(p_lessons),'followUps',p_follow_ups,
      'expectedVersion',p_expected_version,'reason',btrim(p_reason)),idempotency_key,request_id);
  if v_claim->>'state'='scope_conflict' then return public.audit_project_execution_scope_conflict(v_tenant,v_org,v_user,v_actor,
    'save_current_project_retrospective','project_retrospective',p_project_public_id::text,request_id,idempotency_key,btrim(p_reason)); end if;
  v_replay:=v_claim->>'state'='replay';
  select access.project_id,access.access_state into strict v_project,v_access from public.lock_current_project_execution_access(
    v_tenant,v_org,v_actor,p_project_public_id,'manage') access;
  if v_access<>'allowed' then
    if v_replay then return public.audit_project_execution_replay_denied(v_tenant,v_org,v_user,v_actor,'save_current_project_retrospective',
      'project_retrospective',p_project_public_id::text,request_id,idempotency_key,btrim(p_reason),v_access); end if;
    return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,'save_current_project_retrospective','project_retrospective',
      'project.retrospective_saved',p_project_public_id::text,request_id,idempotency_key,btrim(p_reason),'failure',v_access,null); end if;
  if v_replay then return v_claim->'result'; end if;
  select * into v_row from public.project_retrospectives where tenant_id=v_tenant and organization_id=v_org and project_id=v_project for update;
  if found and v_row.version<>p_expected_version then return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,
    'save_current_project_retrospective','project_retrospective','project.retrospective_saved',p_project_public_id::text,
    request_id,idempotency_key,btrim(p_reason),'failure','stale_version',null); end if;
  if not found and p_expected_version<>0 then return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,
    'save_current_project_retrospective','project_retrospective','project.retrospective_saved',p_project_public_id::text,
    request_id,idempotency_key,btrim(p_reason),'failure','stale_version',null); end if;
  insert into public.project_retrospectives(tenant_id,organization_id,project_id,outcome,wins,lessons,follow_ups,updated_by_member_id)
  values(v_tenant,v_org,v_project,btrim(p_outcome),p_wins,btrim(p_lessons),p_follow_ups,v_actor)
  on conflict(tenant_id,organization_id,project_id) do update set outcome=excluded.outcome,wins=excluded.wins,
    lessons=excluded.lessons,follow_ups=excluded.follow_ups,updated_by_member_id=excluded.updated_by_member_id,
    version=public.project_retrospectives.version+1,updated_at=clock_timestamp()
  returning * into strict v_row;
  insert into public.project_activities(tenant_id,organization_id,project_id,user_id,actor_member_id,action_type,content,version)
    values(v_tenant,v_org,v_project,v_user,v_actor,'project_updated','更新项目复盘',1);
  v_entity:=jsonb_build_object('id',v_row.public_id,'projectId',p_project_public_id,'outcome',v_row.outcome,'wins',v_row.wins,
    'lessons',v_row.lessons,'followUps',v_row.follow_ups,'version',v_row.version,'updatedAt',v_row.updated_at);
  return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,'save_current_project_retrospective','project_retrospective',
    'project.retrospective_saved',v_row.public_id::text,request_id,idempotency_key,btrim(p_reason),'success',null,v_entity);
end;
$$;

create or replace function public.update_current_project_risk_status(
  p_risk_public_id uuid,
  p_status text,
  p_expected_version bigint,
  p_reason text,
  request_id uuid,
  idempotency_key uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_tenant bigint; v_org bigint; v_actor bigint; v_user uuid; v_employee uuid; v_project bigint; v_access text;
  v_claim jsonb; v_replay boolean; v_row public.project_risks%rowtype; v_project_public uuid; v_entity jsonb;
begin
  if p_risk_public_id is null or p_status is null or p_status not in ('open','monitoring','mitigated','closed')
     or p_expected_version is null or p_expected_version<1
     or length(btrim(coalesce(p_reason,''))) not between 1 and 500 or request_id is null or idempotency_key is null
     or request_id=idempotency_key then raise exception 'invalid_project_risk_status' using errcode='22023'; end if;
  select * into strict v_tenant,v_org,v_actor,v_user,v_employee from public.current_project_execution_identity();
  v_claim:=public.claim_project_execution_command(v_tenant,v_org,v_actor,'update_current_project_risk_status',p_risk_public_id,
    jsonb_build_object('status',p_status,'expectedVersion',p_expected_version,'reason',btrim(p_reason)),idempotency_key,request_id);
  if v_claim->>'state'='scope_conflict' then return public.audit_project_execution_scope_conflict(v_tenant,v_org,v_user,v_actor,
    'update_current_project_risk_status','risk',p_risk_public_id::text,request_id,idempotency_key,btrim(p_reason)); end if;
  v_replay:=v_claim->>'state'='replay';
  select * into v_row from public.project_risks risk
  where risk.tenant_id=v_tenant and risk.organization_id=v_org and risk.public_id=p_risk_public_id and risk.deleted_at is null for update;
  if not found then return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,'update_current_project_risk_status',
    'risk','project.risk_status_updated',p_risk_public_id::text,request_id,idempotency_key,btrim(p_reason),'failure','not_found',null); end if;
  select project.public_id into strict v_project_public from public.projects project
  where project.tenant_id=v_row.tenant_id and project.organization_id=v_row.organization_id and project.id=v_row.project_id;
  select access.project_id,access.access_state into strict v_project,v_access from public.lock_current_project_execution_access(
    v_tenant,v_org,v_actor,v_project_public,'manage') access;
  if v_access<>'allowed' then
    if v_replay then return public.audit_project_execution_replay_denied(v_tenant,v_org,v_user,v_actor,'update_current_project_risk_status',
      'risk',p_risk_public_id::text,request_id,idempotency_key,btrim(p_reason),v_access); end if;
    return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,'update_current_project_risk_status','risk',
      'project.risk_status_updated',p_risk_public_id::text,request_id,idempotency_key,btrim(p_reason),'failure',v_access,null); end if;
  if v_replay then return v_claim->'result'; end if;
  if v_row.version<>p_expected_version then return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,
    'update_current_project_risk_status','risk','project.risk_status_updated',p_risk_public_id::text,request_id,idempotency_key,
    btrim(p_reason),'failure','stale_version',null); end if;
  update public.project_risks set status=p_status,updated_by_member_id=v_actor,version=version+1,updated_at=clock_timestamp()
    where id=v_row.id returning * into strict v_row;
  insert into public.project_activities(tenant_id,organization_id,project_id,user_id,actor_member_id,action_type,content,version)
    values(v_tenant,v_org,v_row.project_id,v_user,v_actor,'risk_updated','更新风险状态：'||v_row.title||' -> '||p_status,1);
  v_entity:=jsonb_build_object('id',v_row.public_id,'projectId',v_project_public,'status',v_row.status,
    'version',v_row.version,'updatedAt',v_row.updated_at);
  return public.complete_project_execution_command(v_tenant,v_org,v_user,v_actor,'update_current_project_risk_status','risk',
    'project.risk_status_updated',v_row.public_id::text,request_id,idempotency_key,btrim(p_reason),'success',null,v_entity);
end;
$$;

create or replace function public.current_project_operating_model(
  p_project_public_id uuid,
  p_trace_limit integer default 80
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor record; v_project public.projects%rowtype; v_can_manage boolean;
begin
  if p_project_public_id is null or p_trace_limit not between 1 and 200 then
    raise exception 'invalid_project_operating_model_query' using errcode='22023'; end if;
  select * into v_actor from public.current_agent_actor(null); if not found then raise exception 'forbidden' using errcode='42501'; end if;
  select * into v_project from public.projects where tenant_id=v_actor.tenant_id and organization_id=v_actor.organization_id
    and public_id=p_project_public_id and deleted_at is null;
  if not found then raise exception 'not_found' using errcode='P0002'; end if;
  if not public.can_view_project(v_project.id) then raise exception 'forbidden' using errcode='42501'; end if;
  v_can_manage:=public.can_manage_project(v_project.id);
  return jsonb_build_object(
    'canManage',v_can_manage,
    'sops',coalesce((select jsonb_agg(jsonb_build_object(
      'id',definition.public_id,'code',definition.code,'name',definition.name,'description',definition.description,
      'status',definition.status,'version',definition.version,'versionId',version.public_id,'revision',version.revision,
      'lifecycle',version.lifecycle,'steps',version.steps,'updatedAt',definition.updated_at
    ) order by definition.updated_at desc) from public.project_sop_definitions definition
      left join public.project_sop_versions version on version.id=definition.current_version_id
      where definition.tenant_id=v_actor.tenant_id and definition.organization_id=v_actor.organization_id
        and definition.project_id=v_project.id and definition.deleted_at is null),'[]'::jsonb),
    'sopRuns',coalesce((select jsonb_agg(jsonb_build_object(
      'id',run.public_id,'definitionId',definition.public_id,'definitionName',definition.name,
      'versionId',version.public_id,'revision',version.revision,'steps',version.steps,
      'taskId',task.public_id,'assignedEmployeeId',profile.public_id,'assignedName',profile.display_name,
      'status',run.status,'currentStepIndex',run.current_step_index,'version',run.version,
      'startedAt',run.started_at,'completedAt',run.completed_at,'updatedAt',run.updated_at
    ) order by run.updated_at desc) from public.project_sop_runs run
      join public.project_sop_definitions definition on definition.id=run.definition_id
      join public.project_sop_versions version on version.id=run.sop_version_id
      join public.employee_profiles profile on profile.organization_member_id=run.assigned_member_id
        and profile.tenant_id=run.tenant_id and profile.organization_id=run.organization_id and profile.deleted_at is null
      left join public.tasks task on task.id=run.task_id
      where run.tenant_id=v_actor.tenant_id and run.organization_id=v_actor.organization_id and run.project_id=v_project.id),'[]'::jsonb),
    'decisions',coalesce((select jsonb_agg(jsonb_build_object(
      'id',decision.public_id,'type',decision.decision_type,'title',decision.title,'summary',decision.summary,
      'citations',decision.citations,'ownerEmployeeId',owner.public_id,'ownerName',owner.display_name,
      'status',decision.status,'version',decision.version,'createdAt',decision.created_at,
      'acceptedAt',decision.accepted_at,'updatedAt',decision.updated_at
    ) order by decision.updated_at desc) from public.project_decisions decision
      join public.employee_profiles owner on owner.tenant_id=decision.tenant_id and owner.organization_id=decision.organization_id
        and owner.organization_member_id=decision.owner_member_id and owner.deleted_at is null
      where decision.tenant_id=v_actor.tenant_id and decision.organization_id=v_actor.organization_id
        and decision.project_id=v_project.id),'[]'::jsonb),
    'retrospective',(select jsonb_build_object('id',retro.public_id,'outcome',retro.outcome,'wins',retro.wins,
      'lessons',retro.lessons,'followUps',retro.follow_ups,'version',retro.version,'updatedAt',retro.updated_at)
      from public.project_retrospectives retro where retro.tenant_id=v_actor.tenant_id
        and retro.organization_id=v_actor.organization_id and retro.project_id=v_project.id),
    'trace',coalesce((select jsonb_agg(item.payload order by item.occurred_at desc,item.sort_id desc) from (
      select activity.created_at occurred_at,activity.id sort_id,jsonb_build_object('id',activity.public_id,'source','project',
        'eventType',activity.action_type,'title',activity.content,'actorName',coalesce(profile.display_name,'系统'),
        'occurredAt',activity.created_at) payload
      from public.project_activities activity left join public.employee_profiles profile
        on profile.tenant_id=activity.tenant_id and profile.organization_id=activity.organization_id
        and profile.organization_member_id=activity.actor_member_id and profile.deleted_at is null
      where activity.tenant_id=v_actor.tenant_id and activity.organization_id=v_actor.organization_id and activity.project_id=v_project.id
      union all
      select event.occurred_at,event.id,jsonb_build_object('id',event.public_id,'source','acceptance','eventType',event.event_type,
        'title',task.title,'actorName',event.actor_name_snapshot,'occurredAt',event.occurred_at,'taskId',task.public_id)
      from public.task_acceptance_events event join public.tasks task on task.id=event.task_id
      where event.tenant_id=v_actor.tenant_id and event.organization_id=v_actor.organization_id and event.project_id=v_project.id
      union all
      select event.created_at,event.id,jsonb_build_object('id',event.public_id,'source','sop','eventType',event.event_type,
        'title',definition.name,'actorName',profile.display_name,'occurredAt',event.created_at,'runId',run.public_id)
      from public.project_sop_run_events event join public.project_sop_runs run on run.id=event.sop_run_id
      join public.project_sop_definitions definition on definition.id=run.definition_id
      join public.employee_profiles profile on profile.tenant_id=event.tenant_id and profile.organization_id=event.organization_id
        and profile.organization_member_id=event.actor_member_id and profile.deleted_at is null
      where event.tenant_id=v_actor.tenant_id and event.organization_id=v_actor.organization_id and event.project_id=v_project.id
      order by occurred_at desc,sort_id desc limit p_trace_limit
    ) item),'[]'::jsonb)
  );
end;
$$;

create or replace function public.current_employee_capability_center(
  p_employee_public_id uuid,
  p_organization_public_id uuid,
  p_limit integer default 50
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor record; v_actor_profile public.employee_profiles%rowtype; v_target public.employee_profiles%rowtype;
  v_org bigint; v_private boolean; v_agent boolean;
begin
  if p_employee_public_id is null or p_organization_public_id is null or p_limit not between 1 and 100 then
    raise exception 'invalid_employee_capability_query' using errcode='22023'; end if;
  select * into v_actor from public.current_agent_actor(null); if not found then raise exception 'forbidden' using errcode='42501'; end if;
  select id into v_org from public.organizations where tenant_id=v_actor.tenant_id and id=v_actor.organization_id
    and public_id=p_organization_public_id;
  if v_org is null then raise exception 'forbidden' using errcode='42501'; end if;
  select * into v_actor_profile from public.employee_profiles where tenant_id=v_actor.tenant_id and organization_id=v_org
    and organization_member_id=v_actor.member_id and deleted_at is null;
  select * into v_target from public.employee_profiles where tenant_id=v_actor.tenant_id and organization_id=v_org
    and public_id=p_employee_public_id and deleted_at is null and employment_status in ('probation','active','on_leave');
  if not found then raise exception 'not_found' using errcode='P0002'; end if;
  v_private:=v_target.organization_member_id=v_actor.member_id
    or public.has_organization_permission(v_org,'hr.manage')
    or public.has_organization_role(v_org,array['owner','admin'])
    or v_target.manager_employee_id=v_actor_profile.id;
  v_agent:=v_target.organization_member_id=v_actor.member_id or public.has_organization_permission(v_org,'agent.manage');
  return jsonb_build_object(
    'canViewWork',v_private,'canViewAgent',v_agent,
    'workProfile',case when v_private then (select jsonb_build_object('summary',profile.summary,
      'preferredTaskTypes',profile.preferred_task_types,'growthGoals',profile.growth_goals,
      'weeklyCapacityHours',profile.weekly_capacity_hours,'selfSkills',profile.self_skills,'updatedAt',profile.updated_at)
      from public.employee_work_profiles profile where profile.tenant_id=v_actor.tenant_id
        and profile.organization_id=v_org and profile.employee_profile_id=v_target.id) end,
    'skills',coalesce((select jsonb_agg(jsonb_build_object('id',skill.public_id,'code',tag.code,'name',tag.name,
      'level',skill.proficiency_level,'yearsExperience',skill.years_experience,'source',skill.source,
      'verificationStatus',skill.verification_status,'updatedAt',skill.updated_at) order by
      (skill.verification_status='verified') desc,skill.proficiency_level desc nulls last,tag.name)
      from public.employee_skills skill join public.skill_tags tag on tag.tenant_id=skill.tenant_id
        and tag.organization_id=skill.organization_id and tag.id=skill.skill_tag_id and tag.deleted_at is null
      where skill.tenant_id=v_actor.tenant_id and skill.organization_id=v_org and skill.employee_profile_id=v_target.id
        and (v_private or skill.verification_status='verified')),'[]'::jsonb),
    'workload',case when v_private then jsonb_build_object(
      'openTasks',(select count(*) from public.tasks task where task.tenant_id=v_actor.tenant_id and task.organization_id=v_org
        and task.assignee_member_id=v_target.organization_member_id and task.deleted_at is null and task.status not in ('done','cancelled')),
      'inProgressTasks',(select count(*) from public.tasks task where task.tenant_id=v_actor.tenant_id and task.organization_id=v_org
        and task.assignee_member_id=v_target.organization_member_id and task.deleted_at is null and task.status='in_progress'),
      'awaitingReviewTasks',(select count(*) from public.tasks task where task.tenant_id=v_actor.tenant_id and task.organization_id=v_org
        and task.assignee_member_id=v_target.organization_member_id and task.deleted_at is null and task.status='in_review'),
      'completedTasks',(select count(*) from public.tasks task where task.tenant_id=v_actor.tenant_id and task.organization_id=v_org
        and task.assignee_member_id=v_target.organization_member_id and task.deleted_at is null and task.status='done')) end,
    'assignments',case when v_private then coalesce((select jsonb_agg(jsonb_build_object('id',task.public_id,
      'title',task.title,'projectId',project.public_id,'projectName',project.name,'status',task.status,'priority',task.priority,
      'progress',task.progress,'dueDate',task.due_date,'updatedAt',task.updated_at) order by
      (task.status not in ('done','cancelled')) desc,task.due_date nulls last,task.updated_at desc)
      from (select * from public.tasks where tenant_id=v_actor.tenant_id and organization_id=v_org
        and assignee_member_id=v_target.organization_member_id and deleted_at is null order by updated_at desc limit p_limit) task
      join public.projects project on project.tenant_id=task.tenant_id and project.organization_id=task.organization_id
        and project.id=task.project_id and project.deleted_at is null),'[]'::jsonb) else '[]'::jsonb end,
    'evidence',case when v_private then coalesce((select jsonb_agg(jsonb_build_object('id',event.public_id,
      'eventType',event.event_type,'taskId',task.public_id,'taskTitle',task.title,'projectId',project.public_id,
      'projectName',project.name,'decision',event.decision,'note',event.note,'occurredAt',event.occurred_at)
      order by event.occurred_at desc) from (select acceptance.* from public.task_acceptance_events acceptance
        join public.tasks assigned_task on assigned_task.tenant_id=acceptance.tenant_id
          and assigned_task.organization_id=acceptance.organization_id and assigned_task.id=acceptance.task_id
          and assigned_task.assignee_member_id=v_target.organization_member_id and assigned_task.deleted_at is null
        where acceptance.tenant_id=v_actor.tenant_id and acceptance.organization_id=v_org
        order by acceptance.occurred_at desc limit p_limit) event
      join public.tasks task on task.id=event.task_id join public.projects project on project.id=event.project_id),'[]'::jsonb)
      else '[]'::jsonb end,
    'agentRuns',case when v_agent then coalesce((select jsonb_agg(jsonb_build_object('id',run.public_id,
      'agentId',agent.public_id,'agentName',agent.name,'status',run.status,'inputSummary',run.input_summary,
      'outputSummary',run.output_summary,'modelCode',run.model_code,'cost',run.cost_amount,'latencyMs',run.latency_ms,
      'startedAt',run.started_at,'completedAt',run.completed_at) order by run.started_at desc)
      from (select * from public.agent_invocations where tenant_id=v_actor.tenant_id and organization_id=v_org
        and actor_member_id=v_target.organization_member_id order by started_at desc limit p_limit) run
      join public.agent_definitions agent on agent.id=run.agent_id),'[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;

revoke insert,update,delete,truncate,references,trigger on public.project_sop_definitions,
  public.project_sop_versions,public.project_sop_runs,public.project_sop_run_events,
  public.project_decisions,public.project_retrospectives from public,anon,authenticated,service_role;
grant select on public.project_sop_definitions,public.project_sop_versions,public.project_sop_runs,
  public.project_sop_run_events,public.project_decisions,public.project_retrospectives to authenticated;

revoke all on function public.valid_project_sop_steps(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.valid_project_decision_citations(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.reject_operating_model_history_mutation() from public,anon,authenticated,service_role;
revoke all on function public.reject_published_project_sop_version_mutation() from public,anon,authenticated,service_role;
revoke all on function public.save_current_project_sop(uuid,uuid,text,text,text,jsonb,boolean,text,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.start_current_project_sop_run(uuid,uuid,uuid,uuid,text,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.advance_current_project_sop_run(uuid,text,bigint,text,jsonb,text,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.record_current_project_decision(uuid,text,text,text,jsonb,uuid,text,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.transition_current_project_decision(uuid,text,bigint,text,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.save_current_project_retrospective(uuid,text,text,text,text,bigint,text,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.update_current_project_risk_status(uuid,text,bigint,text,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.current_project_operating_model(uuid,integer) from public,anon,authenticated,service_role;
revoke all on function public.current_employee_capability_center(uuid,uuid,integer) from public,anon,authenticated,service_role;

grant execute on function public.save_current_project_sop(uuid,uuid,text,text,text,jsonb,boolean,text,uuid,uuid) to authenticated;
grant execute on function public.start_current_project_sop_run(uuid,uuid,uuid,uuid,text,uuid,uuid) to authenticated;
grant execute on function public.advance_current_project_sop_run(uuid,text,bigint,text,jsonb,text,uuid,uuid) to authenticated;
grant execute on function public.record_current_project_decision(uuid,text,text,text,jsonb,uuid,text,uuid,uuid) to authenticated;
grant execute on function public.transition_current_project_decision(uuid,text,bigint,text,uuid,uuid) to authenticated;
grant execute on function public.save_current_project_retrospective(uuid,text,text,text,text,bigint,text,uuid,uuid) to authenticated;
grant execute on function public.update_current_project_risk_status(uuid,text,bigint,text,uuid,uuid) to authenticated;
grant execute on function public.current_project_operating_model(uuid,integer) to authenticated;
grant execute on function public.current_employee_capability_center(uuid,uuid,integer) to authenticated;

create or replace function public.commercial_readiness_status(p_required_marker text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_marker constant text := '202609010001';
begin
  return jsonb_build_object('database',true,'migrationMarker',v_marker,
    'migrationReady',p_required_marker=v_marker
      and to_regclass('public.project_sop_definitions') is not null
      and to_regclass('public.project_sop_run_events') is not null
      and to_regclass('public.project_decisions') is not null
      and to_regclass('public.project_retrospectives') is not null
      and to_regclass('public.distributed_rate_limit_buckets') is not null,
    'checkedAt',clock_timestamp());
end;
$$;
revoke all on function public.commercial_readiness_status(text) from public,anon,authenticated;
grant execute on function public.commercial_readiness_status(text) to service_role;

commit;
