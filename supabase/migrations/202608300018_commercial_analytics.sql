begin;

create or replace function public.current_commercial_metrics(from_date date, to_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor record;
  v_as_of timestamptz := clock_timestamp();
  v_project_total numeric;
  v_project_active numeric;
  v_task_total numeric;
  v_task_done numeric;
  v_pipeline_cny numeric;
  v_pipeline_count numeric;
  v_approval_seconds numeric;
  v_approval_count numeric;
  v_expense_paid_cny numeric;
  v_expense_paid_count numeric;
  v_ai_total numeric;
  v_ai_succeeded numeric;
  v_ai_tokens numeric;
  v_ai_cost numeric;
  v_project_health jsonb;
  v_task_flow jsonb;
  v_customer_pipeline jsonb;
  v_approval_cycle jsonb;
  v_expense jsonb;
  v_ai_usage jsonb;
  v_trend jsonb;
begin
  if from_date is null or to_date is null or from_date > to_date
    or to_date - from_date > 365 or to_date > current_date then
    raise exception 'invalid_analytics_range' using errcode = '22023';
  end if;

  select * into v_actor from public.current_agent_actor(null);
  if not found or not public.has_organization_permission(v_actor.organization_id, 'analytics.read') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select count(*)::numeric,
         count(*) filter (where status = 'active')::numeric
  into v_project_total, v_project_active
  from public.projects
  where organization_id = v_actor.organization_id
    and deleted_at is null
    and created_at < (to_date + 1)::timestamptz
    and (actual_end_date is null or actual_end_date >= from_date);

  select count(*)::numeric,
         count(*) filter (where status = 'done')::numeric
  into v_task_total, v_task_done
  from public.tasks
  where organization_id = v_actor.organization_id
    and deleted_at is null
    and created_at >= from_date::timestamptz
    and created_at < (to_date + 1)::timestamptz;

  select coalesce(sum(amount) filter (where currency = 'CNY' and stage not in ('lost')), 0)::numeric,
         count(*) filter (where currency = 'CNY' and stage not in ('lost'))::numeric
  into v_pipeline_cny, v_pipeline_count
  from public.opportunities
  where tenant_id = v_actor.tenant_id and organization_id = v_actor.organization_id
    and archived_at is null and updated_at >= from_date::timestamptz
    and updated_at < (to_date + 1)::timestamptz;

  select coalesce(sum(extract(epoch from (completed_at - submitted_at))), 0)::numeric,
         count(*)::numeric
  into v_approval_seconds, v_approval_count
  from public.approvals
  where organization_id = v_actor.organization_id and deleted_at is null
    and approval_type <> 'leave' and completed_at is not null and submitted_at is not null
    and completed_at >= from_date::timestamptz and completed_at < (to_date + 1)::timestamptz;

  select coalesce(sum(amount) filter (where currency = 'CNY' and status = 'paid'), 0)::numeric,
         count(*) filter (where currency = 'CNY' and status = 'paid')::numeric
  into v_expense_paid_cny, v_expense_paid_count
  from public.expense_reports
  where tenant_id = v_actor.tenant_id and organization_id = v_actor.organization_id
    and deleted_at is null and expense_date between from_date and to_date;

  select count(*)::numeric,
         count(*) filter (where status = 'succeeded')::numeric,
         coalesce(sum(input_tokens + output_tokens), 0)::numeric,
         coalesce(sum(cost_amount), 0)::numeric
  into v_ai_total, v_ai_succeeded, v_ai_tokens, v_ai_cost
  from public.ai_runtime_invocations
  where tenant_id = v_actor.tenant_id and organization_id = v_actor.organization_id
    and started_at >= from_date::timestamptz and started_at < (to_date + 1)::timestamptz;

  select coalesce(jsonb_agg(jsonb_build_object('key', health, 'count', item_count) order by health), '[]'::jsonb)
  into v_project_health
  from (
    select health, count(*)::integer item_count from public.projects
    where organization_id = v_actor.organization_id and deleted_at is null
      and created_at < (to_date + 1)::timestamptz
      and (actual_end_date is null or actual_end_date >= from_date)
    group by health
  ) grouped;

  select coalesce(jsonb_agg(jsonb_build_object('key', status, 'count', item_count) order by status), '[]'::jsonb)
  into v_task_flow
  from (
    select status, count(*)::integer item_count from public.tasks
    where organization_id = v_actor.organization_id and deleted_at is null
      and created_at >= from_date::timestamptz and created_at < (to_date + 1)::timestamptz
    group by status
  ) grouped;

  select coalesce(jsonb_agg(jsonb_build_object('key', stage, 'currency', currency, 'count', item_count, 'amount', amount_total) order by stage, currency), '[]'::jsonb)
  into v_customer_pipeline
  from (
    select stage, currency, count(*)::integer item_count, sum(amount)::numeric amount_total
    from public.opportunities
    where tenant_id = v_actor.tenant_id and organization_id = v_actor.organization_id
      and archived_at is null and updated_at >= from_date::timestamptz
      and updated_at < (to_date + 1)::timestamptz
    group by stage, currency
  ) grouped;

  select coalesce(jsonb_agg(jsonb_build_object('key', status, 'count', item_count, 'averageHours', average_hours) order by status), '[]'::jsonb)
  into v_approval_cycle
  from (
    select status, count(*)::integer item_count,
      round((avg(extract(epoch from (completed_at - submitted_at))) filter (where completed_at is not null and submitted_at is not null)) / 3600, 2) average_hours
    from public.approvals
    where organization_id = v_actor.organization_id and deleted_at is null
      and approval_type <> 'leave' and created_at >= from_date::timestamptz
      and created_at < (to_date + 1)::timestamptz
    group by status
  ) grouped;

  select coalesce(jsonb_agg(jsonb_build_object('key', status, 'currency', currency, 'count', item_count, 'amount', amount_total) order by status, currency), '[]'::jsonb)
  into v_expense
  from (
    select status, currency, count(*)::integer item_count, sum(amount)::numeric amount_total
    from public.expense_reports
    where tenant_id = v_actor.tenant_id and organization_id = v_actor.organization_id
      and deleted_at is null and expense_date between from_date and to_date
    group by status, currency
  ) grouped;

  select coalesce(jsonb_agg(jsonb_build_object('key', status, 'count', item_count, 'tokens', token_total, 'cost', cost_total) order by status), '[]'::jsonb)
  into v_ai_usage
  from (
    select status, count(*)::integer item_count, coalesce(sum(input_tokens + output_tokens), 0)::numeric token_total,
      coalesce(sum(cost_amount), 0)::numeric cost_total
    from public.ai_runtime_invocations
    where tenant_id = v_actor.tenant_id and organization_id = v_actor.organization_id
      and started_at >= from_date::timestamptz and started_at < (to_date + 1)::timestamptz
    group by status
  ) grouped;

  select coalesce(jsonb_agg(jsonb_build_object(
    'date', day::date,
    'tasksCreated', (select count(*) from public.tasks task where task.organization_id = v_actor.organization_id and task.deleted_at is null and task.created_at >= day and task.created_at < day + interval '1 day'),
    'tasksCompleted', (select count(*) from public.tasks task where task.organization_id = v_actor.organization_id and task.deleted_at is null and task.completed_at >= day and task.completed_at < day + interval '1 day'),
    'aiInvocations', (select count(*) from public.ai_runtime_invocations invocation where invocation.tenant_id = v_actor.tenant_id and invocation.organization_id = v_actor.organization_id and invocation.started_at >= day and invocation.started_at < day + interval '1 day')
  ) order by day), '[]'::jsonb)
  into v_trend
  from generate_series(from_date::timestamptz, to_date::timestamptz, interval '1 day') day;

  return jsonb_build_object(
    'fromDate', from_date, 'toDate', to_date, 'asOf', v_as_of,
    'metrics', jsonb_build_array(
      jsonb_build_object('definitionCode','project_total','label','周期内有效项目','value',v_project_total,'numerator',v_project_total,'denominator',null,'unit','count','definition','截至周期末已创建且与周期有交集、未删除的项目数'),
      jsonb_build_object('definitionCode','project_active','label','进行中项目','value',v_project_active,'numerator',v_project_active,'denominator',v_project_total,'unit','count','definition','有效项目中当前状态为 active 的项目数'),
      jsonb_build_object('definitionCode','task_completion_rate','label','任务完成率','value',case when v_task_total = 0 then null else round(v_task_done / v_task_total, 4) end,'numerator',v_task_done,'denominator',v_task_total,'unit','ratio','definition','周期内创建且状态为 done 的任务数 / 周期内创建任务总数'),
      jsonb_build_object('definitionCode','customer_pipeline_cny','label','客户管道金额','value',v_pipeline_cny,'numerator',v_pipeline_cny,'denominator',v_pipeline_count,'unit','CNY','definition','周期内更新、非 lost 且币种为 CNY 的商机金额合计'),
      jsonb_build_object('definitionCode','approval_cycle_hours','label','平均审批周期','value',case when v_approval_count = 0 then null else round(v_approval_seconds / v_approval_count / 3600, 2) end,'numerator',v_approval_seconds,'denominator',v_approval_count,'unit','hours','definition','周期内完成的非请假审批总耗时秒数 / 完成审批数 / 3600'),
      jsonb_build_object('definitionCode','expense_paid_cny','label','已支付费用','value',v_expense_paid_cny,'numerator',v_expense_paid_cny,'denominator',v_expense_paid_count,'unit','CNY','definition','费用日期在周期内、状态 paid 且币种为 CNY 的金额合计'),
      jsonb_build_object('definitionCode','ai_success_rate','label','AI 调用成功率','value',case when v_ai_total = 0 then null else round(v_ai_succeeded / v_ai_total, 4) end,'numerator',v_ai_succeeded,'denominator',v_ai_total,'unit','ratio','definition','周期内 succeeded 的 AI 调用数 / AI 调用总数'),
      jsonb_build_object('definitionCode','ai_tokens','label','AI Token 用量','value',v_ai_tokens,'numerator',v_ai_tokens,'denominator',v_ai_total,'unit','tokens','definition','周期内 AI 输入与输出 Token 合计'),
      jsonb_build_object('definitionCode','ai_cost','label','AI 计费金额','value',v_ai_cost,'numerator',v_ai_cost,'denominator',v_ai_total,'unit','configured_currency','definition','周期内按模型配置记录的调用成本合计')
    ),
    'projectHealth', v_project_health, 'taskFlow', v_task_flow,
    'customerPipeline', v_customer_pipeline, 'approvalCycle', v_approval_cycle,
    'expense', v_expense, 'aiUsage', v_ai_usage, 'trend', v_trend
  );
end;
$$;

revoke all on function public.current_commercial_metrics(date, date) from public, anon;
grant execute on function public.current_commercial_metrics(date, date) to authenticated;

commit;
