begin;

-- Repair the runtime-only PostgreSQL incompatibility in the already-applied
-- confirmation function without touching any existing decision or project row.
do $$
declare
  function_definition text;
begin
  select pg_get_functiondef(
    'public.confirm_current_decision_plan(uuid,bigint,uuid,uuid)'::regprocedure
  ) into function_definition;

  if position('jsonb_object_length(v_milestone_ids)' in function_definition) = 0
    or position('jsonb_object_length(v_task_ids)' in function_definition) = 0 then
    raise exception 'Unexpected confirm_current_decision_plan definition';
  end if;

  function_definition := replace(
    function_definition,
    'jsonb_object_length(v_milestone_ids)',
    '(select count(*) from jsonb_object_keys(v_milestone_ids))'
  );
  function_definition := replace(
    function_definition,
    'jsonb_object_length(v_task_ids)',
    '(select count(*) from jsonb_object_keys(v_task_ids))'
  );
  execute function_definition;
end;
$$;

create or replace function public.complete_current_decision_command(
  p_command_public_id uuid,p_expected_command_version bigint,p_summary text,
  p_idempotency_key uuid,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor record; v_command public.decision_commands%rowtype; v_project public.projects%rowtype;
  v_document public.knowledge_documents%rowtype; v_version public.knowledge_document_versions%rowtype;
  v_total integer; v_done integer; v_archive public.decision_archives%rowtype; v_text text;
begin
  if p_command_public_id is null or p_expected_command_version<1 or length(btrim(coalesce(p_summary,''))) not between 1 and 2000 or p_idempotency_key is null or p_request_id is null then raise exception 'invalid_request' using errcode='22023'; end if;
  select * into v_actor from public.current_decision_actor(); if not found then raise exception 'forbidden' using errcode='42501'; end if;
  select * into v_command from public.decision_commands where tenant_id=v_actor.tenant_id and organization_id=v_actor.organization_id and public_id=p_command_public_id for update; if not found then raise exception 'not_found' using errcode='P0002'; end if;
  if v_command.status='archived' then return public.decision_command_payload(v_command.id)||jsonb_build_object('outcome','success','replayed',true); end if;
  if v_command.version<>p_expected_command_version or v_command.status<>'executing' or v_command.project_id is null then raise exception 'version_conflict' using errcode='40001'; end if;
  select count(*)::integer,count(*) filter(where task.status='done')::integer into v_total,v_done from public.tasks task where task.tenant_id=v_actor.tenant_id and task.project_id=v_command.project_id and task.deleted_at is null and task.status<>'cancelled';
  if v_total<1 or v_total<>v_done then raise exception 'tasks_incomplete' using errcode='55000'; end if;
  select * into v_project from public.projects where tenant_id=v_actor.tenant_id and id=v_command.project_id for update;
  v_text:=concat_ws(E'\n\n','决策指令：'||v_command.title,'目标：'||v_command.summary,'预期结果：'||v_command.expected_outcome,'复盘摘要：'||btrim(p_summary),'完成任务：'||v_done::text||'/'||v_total::text);
  insert into public.knowledge_documents(tenant_id,organization_id,command_id,created_by_member_id,owner_member_id,title,summary,category,tags,status,version)
  values(v_actor.tenant_id,v_actor.organization_id,v_command.id,v_actor.member_id,v_actor.member_id,'项目复盘：'||left(v_command.title,180),left(btrim(p_summary),2000),'项目复盘',array['决策闭环','项目复盘'],'draft',1) returning * into v_document;
  insert into public.knowledge_document_versions(tenant_id,organization_id,document_id,version_number,status,title,summary,extracted_text,created_by_member_id)
  values(v_actor.tenant_id,v_actor.organization_id,v_document.id,1,'draft',v_document.title,v_document.summary,left(v_text,5000000),v_actor.member_id) returning * into v_version;
  update public.knowledge_documents set current_version_id=v_version.id,updated_at=clock_timestamp() where id=v_document.id;
  update public.projects set status='completed',progress=100,actual_end_date=current_date,updated_by_member_id=v_actor.member_id,version=version+1,updated_at=clock_timestamp() where id=v_project.id;
  insert into public.decision_archives(tenant_id,organization_id,command_id,project_id,knowledge_document_id,snapshot,created_by_member_id)
  values(v_actor.tenant_id,v_actor.organization_id,v_command.id,v_project.id,v_document.id,jsonb_build_object('summary',btrim(p_summary),'metrics',jsonb_build_object('taskTotal',v_total,'taskDone',v_done)),v_actor.member_id) returning * into v_archive;
  update public.decision_commands set status='archived',archived_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() where id=v_command.id returning * into v_command;
  perform public.append_audit_log(v_actor.tenant_id,v_actor.organization_id,v_actor.user_id,v_actor.member_id,'knowledge.draft_created','knowledge_document',v_document.public_id::text,p_request_id,null,jsonb_build_object('source','decision_archive','commandId',v_command.public_id));
  perform public.append_audit_log(v_actor.tenant_id,v_actor.organization_id,v_actor.user_id,v_actor.member_id,'decision.command.archived','decision_command',v_command.public_id::text,p_request_id,null,jsonb_build_object('projectId',v_project.public_id,'knowledgeDocumentId',v_document.public_id,'taskTotal',v_total));
  return public.decision_command_payload(v_command.id)||jsonb_build_object('outcome','success','knowledgeDocumentId',v_document.public_id,'archiveId',v_archive.public_id);
end;
$$;

revoke all on function public.complete_current_decision_command(uuid,bigint,text,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.complete_current_decision_command(uuid,bigint,text,uuid,uuid) to authenticated;

commit;
