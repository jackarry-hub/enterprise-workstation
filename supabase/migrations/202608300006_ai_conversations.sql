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
  'ai.conversation.created','ai.message.created','ai.message.completed','ai.message.failed','ai.conversation.archived'
));

create table public.ai_conversations (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete cascade,
  organization_id bigint not null,
  owner_member_id bigint not null,
  title text not null check (length(btrim(title)) between 1 and 120),
  version integer not null default 1 check (version > 0),
  last_message_at timestamptz not null default clock_timestamp(),
  archived_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (tenant_id,organization_id) references public.organizations(tenant_id,id) on delete cascade,
  foreign key (tenant_id,owner_member_id) references public.organization_members(tenant_id,id) on delete cascade,
  unique (tenant_id,organization_id,id)
);

create table public.ai_messages (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete cascade,
  organization_id bigint not null,
  conversation_id bigint not null,
  owner_member_id bigint not null,
  sequence integer not null check (sequence > 0),
  role text not null check (role in ('user','assistant','system','tool')),
  content text not null check (length(content) between 1 and 12000),
  request_key uuid,
  response_to_message_id bigint,
  delivery_state text not null default 'completed' check (delivery_state in ('pending','completed','failed')),
  error_code text not null default '' check (length(error_code) <= 80),
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  foreign key (tenant_id,organization_id,conversation_id) references public.ai_conversations(tenant_id,organization_id,id) on delete cascade,
  foreign key (tenant_id,owner_member_id) references public.organization_members(tenant_id,id) on delete cascade,
  foreign key (response_to_message_id) references public.ai_messages(id) on delete restrict,
  unique (tenant_id,id),
  unique (tenant_id,conversation_id,sequence),
  unique (tenant_id,owner_member_id,request_key),
  unique (response_to_message_id),
  check ((delivery_state='pending' and completed_at is null) or (delivery_state<>'pending' and completed_at is not null))
);

create table public.ai_tool_calls (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete cascade,
  organization_id bigint not null,
  conversation_id bigint not null,
  message_id bigint not null,
  tool_code text not null check (tool_code ~ '^[a-z][a-z0-9_.-]{1,79}$'),
  state text not null check (state in ('requested','confirmed','executed','failed','rejected')),
  safe_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(safe_metadata)='object'),
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  foreign key (tenant_id,organization_id,conversation_id) references public.ai_conversations(tenant_id,organization_id,id) on delete cascade,
  foreign key (tenant_id,message_id) references public.ai_messages(tenant_id,id) on delete cascade
);

create index ai_conversations_owner_cursor_idx on public.ai_conversations(tenant_id,owner_member_id,archived_at,last_message_at desc,id desc);
create index ai_messages_conversation_sequence_idx on public.ai_messages(tenant_id,conversation_id,sequence);

alter table public.ai_conversations enable row level security;
alter table public.ai_conversations force row level security;
alter table public.ai_messages enable row level security;
alter table public.ai_messages force row level security;
alter table public.ai_tool_calls enable row level security;
alter table public.ai_tool_calls force row level security;

create policy ai_conversations_owner_select on public.ai_conversations for select to authenticated using (
  tenant_id=(select public.current_tenant_id()) and exists(select 1 from public.organization_members member where member.tenant_id=ai_conversations.tenant_id and member.id=owner_member_id and member.user_id=(select auth.uid()) and member.status='active')
);
create policy ai_messages_owner_select on public.ai_messages for select to authenticated using (
  tenant_id=(select public.current_tenant_id()) and exists(select 1 from public.organization_members member where member.tenant_id=ai_messages.tenant_id and member.id=owner_member_id and member.user_id=(select auth.uid()) and member.status='active')
);
create policy ai_tool_calls_owner_select on public.ai_tool_calls for select to authenticated using (
  tenant_id=(select public.current_tenant_id()) and exists(select 1 from public.ai_conversations conversation join public.organization_members member on member.tenant_id=conversation.tenant_id and member.id=conversation.owner_member_id where conversation.id=conversation_id and conversation.tenant_id=ai_tool_calls.tenant_id and member.user_id=(select auth.uid()) and member.status='active')
);
grant select on public.ai_conversations,public.ai_messages,public.ai_tool_calls to authenticated;

create or replace function public.current_ai_conversation_actor()
returns table(tenant_id bigint,organization_id bigint,member_id bigint,user_id uuid)
language sql stable security definer set search_path='' as $$
  select member.tenant_id,member.organization_id,member.id,member.user_id
  from public.organization_members member
  where member.organization_id=public.active_workspace_organization_id((select auth.uid())) and member.user_id=(select auth.uid()) and member.status='active'
  limit 1;
$$;

create or replace function public.list_current_ai_conversations(p_limit integer default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor record;
begin
  if p_limit not between 1 and 100 then raise exception 'invalid_limit' using errcode='22023'; end if;
  select * into v_actor from public.current_ai_conversation_actor();
  if not found then raise exception 'forbidden' using errcode='42501'; end if;
  return jsonb_build_object('items',coalesce((select jsonb_agg(jsonb_build_object('id',item.public_id,'title',item.title,'version',item.version,'lastMessageAt',item.last_message_at,'archivedAt',item.archived_at) order by item.last_message_at desc,item.id desc) from (select * from public.ai_conversations where tenant_id=v_actor.tenant_id and organization_id=v_actor.organization_id and owner_member_id=v_actor.member_id and archived_at is null order by last_message_at desc,id desc limit p_limit) item),'[]'::jsonb));
end;
$$;

create or replace function public.list_current_ai_messages(p_conversation_public_id uuid,p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor record; v_conversation public.ai_conversations%rowtype;
begin
  if p_limit not between 1 and 200 then raise exception 'invalid_limit' using errcode='22023'; end if;
  select * into v_actor from public.current_ai_conversation_actor();
  select * into v_conversation from public.ai_conversations where tenant_id=v_actor.tenant_id and organization_id=v_actor.organization_id and owner_member_id=v_actor.member_id and public_id=p_conversation_public_id;
  if not found then raise exception 'not_found' using errcode='P0002'; end if;
  return jsonb_build_object('conversation',jsonb_build_object('id',v_conversation.public_id,'title',v_conversation.title,'version',v_conversation.version,'archivedAt',v_conversation.archived_at),'items',coalesce((select jsonb_agg(jsonb_build_object('id',message.public_id,'sequence',message.sequence,'role',message.role,'content',message.content,'state',message.delivery_state,'errorCode',nullif(message.error_code,''),'createdAt',message.created_at) order by message.sequence) from (select * from public.ai_messages where tenant_id=v_actor.tenant_id and conversation_id=v_conversation.id order by sequence desc limit p_limit) message),'[]'::jsonb));
end;
$$;

create or replace function public.create_ai_conversation(p_title text,p_idempotency_key uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor record; v_conversation public.ai_conversations%rowtype;
begin
  if length(btrim(coalesce(p_title,''))) not between 1 and 120 or p_idempotency_key is null or p_request_id is null then raise exception 'invalid_request' using errcode='22023'; end if;
  select * into v_actor from public.current_ai_conversation_actor(); if not found then raise exception 'forbidden' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_actor.tenant_id::text||':'||v_actor.member_id::text||':conversation:'||p_idempotency_key::text,0));
  select conversation.* into v_conversation from public.ai_conversations conversation join public.audit_logs audit on audit.tenant_id=conversation.tenant_id and audit.organization_id=conversation.organization_id and audit.resource_type='ai_conversation' and audit.resource_id=conversation.public_id::text and audit.request_id=p_idempotency_key where conversation.tenant_id=v_actor.tenant_id and conversation.owner_member_id=v_actor.member_id limit 1;
  if not found then
    insert into public.ai_conversations(tenant_id,organization_id,owner_member_id,title) values(v_actor.tenant_id,v_actor.organization_id,v_actor.member_id,btrim(p_title)) returning * into v_conversation;
    perform public.append_audit_log(v_actor.tenant_id,v_actor.organization_id,v_actor.user_id,v_actor.member_id,'ai.conversation.created','ai_conversation',v_conversation.public_id::text,p_idempotency_key,null,jsonb_build_object('requestId',p_request_id));
  elsif v_conversation.title<>btrim(p_title) then raise exception 'idempotency_conflict' using errcode='23505'; end if;
  return jsonb_build_object('conversation',jsonb_build_object('id',v_conversation.public_id,'title',v_conversation.title,'version',v_conversation.version,'lastMessageAt',v_conversation.last_message_at));
end;
$$;

create or replace function public.append_ai_user_message(p_conversation_public_id uuid,p_content text,p_idempotency_key uuid,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor record; v_conversation public.ai_conversations%rowtype; v_message public.ai_messages%rowtype; v_response public.ai_messages%rowtype; v_sequence integer;
begin
  if length(coalesce(p_content,'')) not between 1 and 12000 or p_idempotency_key is null or p_request_id is null then raise exception 'invalid_request' using errcode='22023'; end if;
  select * into v_actor from public.current_ai_conversation_actor(); if not found then raise exception 'forbidden' using errcode='42501'; end if;
  select * into v_conversation from public.ai_conversations where tenant_id=v_actor.tenant_id and organization_id=v_actor.organization_id and owner_member_id=v_actor.member_id and public_id=p_conversation_public_id and archived_at is null for update;
  if not found then raise exception 'not_found' using errcode='P0002'; end if;
  select * into v_message from public.ai_messages where tenant_id=v_actor.tenant_id and owner_member_id=v_actor.member_id and request_key=p_idempotency_key;
  if found then
    if v_message.conversation_id<>v_conversation.id or v_message.content<>p_content then raise exception 'idempotency_conflict' using errcode='23505'; end if;
    select * into v_response from public.ai_messages where response_to_message_id=v_message.id;
    return jsonb_build_object('conversationId',v_conversation.public_id,'userMessageId',v_message.public_id,'assistantMessageId',v_response.public_id,'state',case when v_response.id is null then 'pending' else v_response.delivery_state end);
  end if;
  if exists (
    select 1 from public.ai_messages pending
    where pending.tenant_id=v_actor.tenant_id and pending.conversation_id=v_conversation.id and pending.role='user'
      and not exists (select 1 from public.ai_messages response where response.response_to_message_id=pending.id)
  ) then raise exception 'conversation_busy' using errcode='55000'; end if;
  select coalesce(max(sequence),0)+1 into v_sequence from public.ai_messages where tenant_id=v_actor.tenant_id and conversation_id=v_conversation.id;
  insert into public.ai_messages(tenant_id,organization_id,conversation_id,owner_member_id,sequence,role,content,request_key,delivery_state,completed_at)
  values(v_actor.tenant_id,v_actor.organization_id,v_conversation.id,v_actor.member_id,v_sequence,'user',p_content,p_idempotency_key,'completed',clock_timestamp()) returning * into v_message;
  update public.ai_conversations set version=version+1,last_message_at=clock_timestamp(),updated_at=clock_timestamp() where id=v_conversation.id;
  perform public.append_audit_log(v_actor.tenant_id,v_actor.organization_id,v_actor.user_id,v_actor.member_id,'ai.message.created','ai_message',v_message.public_id::text,p_request_id,null,jsonb_build_object('conversationId',v_conversation.public_id));
  return jsonb_build_object('conversationId',v_conversation.public_id,'userMessageId',v_message.public_id,'assistantMessageId',null,'state','pending');
end;
$$;

create or replace function public.complete_ai_assistant_message(
  p_tenant_public_id uuid,p_organization_public_id uuid,p_actor_member_id bigint,p_auth_user_id uuid,
  p_conversation_public_id uuid,p_user_message_public_id uuid,p_content text,p_success boolean,p_error_code text,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor record; v_conversation public.ai_conversations%rowtype; v_user_message public.ai_messages%rowtype; v_message public.ai_messages%rowtype;
begin
  if p_request_id is null or length(coalesce(p_content,'')) not between 1 and 12000 or length(coalesce(p_error_code,''))>80 then raise exception 'invalid_request' using errcode='22023'; end if;
  select * into v_actor from public.resolve_ai_runtime_actor(p_tenant_public_id,p_organization_public_id,p_actor_member_id,p_auth_user_id); if not found then raise exception 'forbidden' using errcode='42501'; end if;
  select * into v_conversation from public.ai_conversations where tenant_id=v_actor.tenant_id and organization_id=v_actor.organization_id and owner_member_id=v_actor.actor_member_id and public_id=p_conversation_public_id for update; if not found then raise exception 'not_found' using errcode='P0002'; end if;
  select * into v_user_message from public.ai_messages where tenant_id=v_actor.tenant_id and conversation_id=v_conversation.id and owner_member_id=v_actor.actor_member_id and public_id=p_user_message_public_id and role='user'; if not found then raise exception 'not_found' using errcode='P0002'; end if;
  select * into v_message from public.ai_messages where response_to_message_id=v_user_message.id;
  if not found then
    insert into public.ai_messages(tenant_id,organization_id,conversation_id,owner_member_id,sequence,role,content,response_to_message_id,delivery_state,error_code,completed_at)
    values(v_actor.tenant_id,v_actor.organization_id,v_conversation.id,v_actor.actor_member_id,v_user_message.sequence+1,'assistant',p_content,v_user_message.id,case when p_success then 'completed' else 'failed' end,left(coalesce(p_error_code,''),80),clock_timestamp()) returning * into v_message;
    update public.ai_conversations set version=version+1,last_message_at=v_message.created_at,updated_at=clock_timestamp() where id=v_conversation.id;
    perform public.append_audit_log(v_actor.tenant_id,v_actor.organization_id,p_auth_user_id,v_actor.actor_member_id,case when p_success then 'ai.message.completed' else 'ai.message.failed' end,'ai_message',v_message.public_id::text,p_request_id,null,jsonb_build_object('conversationId',v_conversation.public_id,'errorCode',nullif(p_error_code,'')));
  end if;
  return jsonb_build_object('conversationId',v_conversation.public_id,'userMessageId',v_user_message.public_id,'assistantMessageId',v_message.public_id,'state',v_message.delivery_state);
end;
$$;

create or replace function public.archive_ai_conversation(p_conversation_public_id uuid,p_expected_version integer,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor record; v_conversation public.ai_conversations%rowtype;
begin
  if p_expected_version<1 or p_request_id is null then raise exception 'invalid_request' using errcode='22023'; end if;
  select * into v_actor from public.current_ai_conversation_actor();
  select * into v_conversation from public.ai_conversations where tenant_id=v_actor.tenant_id and organization_id=v_actor.organization_id and owner_member_id=v_actor.member_id and public_id=p_conversation_public_id for update;
  if not found then raise exception 'not_found' using errcode='P0002'; end if;
  if v_conversation.archived_at is not null then return jsonb_build_object('conversationId',v_conversation.public_id,'version',v_conversation.version,'archived',true); end if;
  if v_conversation.version<>p_expected_version then raise exception 'version_conflict' using errcode='40001'; end if;
  update public.ai_conversations set archived_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() where id=v_conversation.id returning * into v_conversation;
  perform public.append_audit_log(v_actor.tenant_id,v_actor.organization_id,v_actor.user_id,v_actor.member_id,'ai.conversation.archived','ai_conversation',v_conversation.public_id::text,p_request_id,null,'{}'::jsonb);
  return jsonb_build_object('conversationId',v_conversation.public_id,'version',v_conversation.version,'archived',true);
end;
$$;

revoke all on function public.current_ai_conversation_actor() from public,anon,authenticated,service_role;
revoke all on function public.list_current_ai_conversations(integer) from public,anon;
revoke all on function public.list_current_ai_messages(uuid,integer) from public,anon;
revoke all on function public.create_ai_conversation(text,uuid,uuid) from public,anon;
revoke all on function public.append_ai_user_message(uuid,text,uuid,uuid) from public,anon;
revoke all on function public.archive_ai_conversation(uuid,integer,uuid) from public,anon;
revoke all on function public.complete_ai_assistant_message(uuid,uuid,bigint,uuid,uuid,uuid,text,boolean,text,uuid) from public,anon,authenticated;
grant execute on function public.list_current_ai_conversations(integer) to authenticated;
grant execute on function public.list_current_ai_messages(uuid,integer) to authenticated;
grant execute on function public.create_ai_conversation(text,uuid,uuid) to authenticated;
grant execute on function public.append_ai_user_message(uuid,text,uuid,uuid) to authenticated;
grant execute on function public.archive_ai_conversation(uuid,integer,uuid) to authenticated;
grant execute on function public.complete_ai_assistant_message(uuid,uuid,bigint,uuid,uuid,uuid,text,boolean,text,uuid) to service_role;

commit;
