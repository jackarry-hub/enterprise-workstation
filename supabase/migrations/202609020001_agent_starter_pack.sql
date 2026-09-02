begin;

create or replace function public.provision_current_agent_starter_pack(
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor record;
  v_seed record;
  v_agent public.agent_definitions%rowtype;
  v_version public.agent_versions%rowtype;
  v_installed integer := 0;
  v_available integer := 0;
begin
  if p_request_id is null then
    raise exception 'invalid_starter_pack_request' using errcode = '22023';
  end if;

  select * into v_actor from public.current_agent_actor('agent.manage');
  if not found then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('agent-starter-pack:' || v_actor.organization_id::text, 0)
  );

  insert into public.agent_runtime_controls(tenant_id, organization_id)
  values(v_actor.tenant_id, v_actor.organization_id)
  on conflict do nothing;

  insert into public.agent_runtime_tool_allowlists(
    tenant_id, organization_id, tool_code
  )
  select v_actor.tenant_id, v_actor.organization_id, catalog.code
  from public.agent_tool_catalog catalog
  where catalog.status = 'active'
  on conflict do nothing;

  insert into public.agent_runtime_data_allowlists(
    tenant_id, organization_id, data_scope
  )
  select v_actor.tenant_id, v_actor.organization_id, scope.code
  from (values
    ('knowledge.read'), ('project.read'), ('task.read'),
    ('customer.read'), ('approval.read')
  ) as scope(code)
  on conflict do nothing;

  for v_seed in
    select * from (values
      (
        'task_breakdown', '任务拆解 Agent', 'check',
        '把输入的业务目标整理为待人工确认的任务清单、依赖和验收标准。',
        '你是企业任务拆解助手。只依据用户本次输入提供建议，不得声称已创建、修改或分配任何业务记录。输出应包含目标、任务清单、依赖、负责人建议、截止时间建议和可验证的验收标准；缺少关键信息时明确列出待确认项。'
      ),
      (
        'smart_dispatch', '协作派单建议 Agent', 'flow',
        '根据输入的成员职责、能力、负载和截止时间生成可解释的派单建议。',
        '你是企业协作派单助手。只使用输入中明确提供的成员、职责、能力、负载和时限，不得虚构员工信息，不得声称已经分配任务。输出推荐负责人、候选人、依据、冲突和需要主管确认的事项。'
      ),
      (
        'project_review', '项目复盘 Agent', 'target',
        '把输入的项目进展、结果和风险整理为可执行复盘。',
        '你是企业项目复盘助手。只依据输入的真实项目材料，区分事实、判断和缺失信息。输出目标完成度、交付证据、偏差、风险、根因、后续行动和责任建议，不得声称已修改项目或任务。'
      )
    ) as seed(code, name, icon, description, system_prompt)
  loop
    select * into v_agent
    from public.agent_definitions agent
    where agent.tenant_id = v_actor.tenant_id
      and agent.organization_id = v_actor.organization_id
      and agent.code = v_seed.code
      and agent.deleted_at is null
    for update;

    if not found then
      insert into public.agent_definitions(
        tenant_id, organization_id, code, name, description, icon,
        capabilities, visibility_scope, min_job_level, status,
        created_by_member_id, updated_by_member_id
      ) values (
        v_actor.tenant_id, v_actor.organization_id, v_seed.code,
        v_seed.name, v_seed.description, v_seed.icon,
        array['受控模型调用', '不可变版本', '运行审计']::text[],
        'all', 1, 'disabled', v_actor.member_id, v_actor.member_id
      ) returning * into v_agent;

      perform public.append_audit_log(
        v_actor.tenant_id, v_actor.organization_id, v_actor.user_id,
        v_actor.member_id, 'agent.created', 'agent_definition',
        v_agent.public_id::text, p_request_id, null,
        jsonb_build_object('code', v_agent.code, 'source', 'starter_pack')
      );
    end if;

    insert into public.agent_permissions(
      tenant_id, organization_id, agent_id, scope_type,
      min_job_level, created_by_member_id
    ) values (
      v_actor.tenant_id, v_actor.organization_id, v_agent.id, 'all',
      greatest(v_agent.min_job_level, 1), v_actor.member_id
    ) on conflict do nothing;

    if v_agent.current_version_id is null then
      insert into public.agent_versions(
        tenant_id, organization_id, agent_id, revision, request_id,
        lifecycle, model_code, prompt_version, system_prompt,
        input_schema, output_schema, data_scopes, secret_refs, limits,
        created_by_member_id
      ) values (
        v_actor.tenant_id, v_actor.organization_id, v_agent.id,
        coalesce((select max(version.revision) + 1 from public.agent_versions version where version.tenant_id = v_actor.tenant_id and version.agent_id = v_agent.id), 1),
        gen_random_uuid(), 'draft', 'deepseek-chat', 'starter-v1',
        v_seed.system_prompt,
        '{"type":"object","properties":{"input":{"type":"string"}},"required":["input"],"x-contract":"quantxy.text.v1"}'::jsonb,
        '{"type":"object","properties":{"output":{"type":"string"}},"required":["output"],"x-contract":"quantxy.text.v1"}'::jsonb,
        '{}'::text[], array['DEEPSEEK_API_KEY']::text[],
        '{"maxSteps":20,"maxDepth":3,"timeoutSeconds":300,"maxTokens":2000,"maxConcurrent":3}'::jsonb,
        v_actor.member_id
      ) returning * into v_version;

      update public.agent_versions
      set lifecycle = 'published',
          published_by_member_id = v_actor.member_id,
          published_at = clock_timestamp()
      where id = v_version.id;

      update public.agent_definitions
      set current_version_id = v_version.id,
          model_code = v_version.model_code,
          prompt_version = v_version.prompt_version,
          system_prompt = v_version.system_prompt,
          input_schema = v_version.input_schema,
          tool_scope = '{"tools":[]}'::jsonb,
          status = 'enabled',
          updated_by_member_id = v_actor.member_id,
          updated_at = clock_timestamp()
      where id = v_agent.id;

      perform public.append_audit_log(
        v_actor.tenant_id, v_actor.organization_id, v_actor.user_id,
        v_actor.member_id, 'agent.version.published', 'agent_version',
        v_version.public_id::text, p_request_id, null,
        jsonb_build_object(
          'agentId', v_agent.public_id,
          'revision', v_version.revision,
          'source', 'starter_pack',
          'tools', jsonb_build_array()
        )
      );
      v_installed := v_installed + 1;
    end if;
    v_available := v_available + 1;
  end loop;

  perform public.append_audit_log(
    v_actor.tenant_id, v_actor.organization_id, v_actor.user_id,
    v_actor.member_id, 'agent.starter_pack.provisioned',
    'organization', v_actor.organization_id::text, p_request_id, null,
    jsonb_build_object('installed', v_installed, 'available', v_available)
  );

  return jsonb_build_object(
    'status', 'ready',
    'installed', v_installed,
    'available', v_available,
    'alreadyProvisioned', v_installed = 0
  );
end;
$$;

revoke all on function public.provision_current_agent_starter_pack(uuid)
  from public, anon;
grant execute on function public.provision_current_agent_starter_pack(uuid)
  to authenticated;

commit;
