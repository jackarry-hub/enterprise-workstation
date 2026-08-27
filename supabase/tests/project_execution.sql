begin;
select plan(49);

select ok(has_column('public','milestones','tenant_id'),'milestones carry tenant ownership');
select ok(has_column('public','project_risks','tenant_id'),'risks carry tenant ownership');
select ok(has_column('public','project_activities','tenant_id'),'activities carry tenant ownership');
select ok(has_column('public','daily_reports','tenant_id'),'reports carry tenant ownership');
select ok(has_column('public','task_comments','tenant_id'),'comments carry tenant ownership');
select ok(has_column('public','task_dependencies','tenant_id'),'dependencies carry tenant ownership');
select ok(has_column('public','task_dependencies','public_id'),'dependencies expose a stable public id');
select ok(has_table('public','project_execution_command_idempotency'),'execution command ledger exists');
select ok(has_function('public','create_current_project_milestone',array['uuid','text','text','uuid','date','date','numeric','text','uuid','uuid']::name[]),'milestone command exists');
select ok(has_function('public','create_current_project_risk',array['uuid','text','text','uuid','date','text','uuid','uuid']::name[]),'risk command exists');
select ok(has_function('public','record_current_project_activity',array['uuid','text','text','uuid','uuid']::name[]),'activity command exists');
select ok(has_function('public','submit_current_project_report',array['uuid','date','text','text','text','text','text','uuid','uuid']::name[]),'report command exists');
select ok(has_function('public','create_current_task_comment',array['uuid','text','text','uuid','uuid']::name[]),'comment command exists');
select ok(has_function('public','create_current_task_dependency',array['uuid','uuid','text','uuid','uuid']::name[]),'dependency command exists');
select ok(
  has_function_privilege('authenticated','public.create_current_project_milestone(uuid,text,text,uuid,date,date,numeric,text,uuid,uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.create_current_project_risk(uuid,text,text,uuid,date,text,uuid,uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.record_current_project_activity(uuid,text,text,uuid,uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.submit_current_project_report(uuid,date,text,text,text,text,text,uuid,uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.create_current_task_comment(uuid,text,text,uuid,uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.create_current_task_dependency(uuid,uuid,text,uuid,uuid)','EXECUTE'),
  'authenticated users can enter each controlled command'
);
select ok(
  not has_function_privilege('service_role','public.create_current_project_milestone(uuid,text,text,uuid,date,date,numeric,text,uuid,uuid)','EXECUTE')
  and not has_function_privilege('service_role','public.create_current_project_risk(uuid,text,text,uuid,date,text,uuid,uuid)','EXECUTE')
  and not has_function_privilege('service_role','public.record_current_project_activity(uuid,text,text,uuid,uuid)','EXECUTE')
  and not has_function_privilege('service_role','public.submit_current_project_report(uuid,date,text,text,text,text,text,uuid,uuid)','EXECUTE')
  and not has_function_privilege('service_role','public.create_current_task_comment(uuid,text,text,uuid,uuid)','EXECUTE')
  and not has_function_privilege('service_role','public.create_current_task_dependency(uuid,uuid,text,uuid,uuid)','EXECUTE'),
  'service role cannot bypass project execution commands'
);
select ok(
  not has_function_privilege('authenticated','public.lock_current_project_execution_access(bigint,bigint,bigint,uuid,text)','EXECUTE')
  and not has_function_privilege('authenticated','public.lock_current_task_execution_access(bigint,bigint,bigint,uuid,text)','EXECUTE')
  and not has_function_privilege('authenticated','public.claim_project_execution_command(bigint,bigint,bigint,text,uuid,jsonb,uuid,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.audit_project_execution_replay_denied(bigint,bigint,uuid,bigint,text,text,text,uuid,uuid,text,text)','EXECUTE')
  and not has_function_privilege('service_role','public.lock_current_project_execution_access(bigint,bigint,bigint,uuid,text)','EXECUTE')
  and not has_function_privilege('service_role','public.claim_project_execution_command(bigint,bigint,bigint,text,uuid,jsonb,uuid,uuid)','EXECUTE'),
  'internal lock, claim, and replay audit helpers are not externally executable'
);
select ok(
  not exists (
    select 1
    from unnest(array[
      'milestones_creator_organization_fkey','milestones_updater_organization_fkey',
      'project_risks_creator_organization_fkey','project_risks_updater_organization_fkey',
      'project_activities_actor_organization_fkey',
      'daily_reports_creator_organization_fkey','daily_reports_updater_organization_fkey',
      'task_comments_creator_organization_fkey','task_comments_updater_organization_fkey',
      'task_dependencies_creator_organization_fkey'
    ]) as constraints(constraint_name)
    where not exists (
      select 1 from pg_constraint constraint_record
      where constraint_record.conname=constraint_name and constraint_record.contype='f'
    )
  ),
  'every execution actor field is constrained to the child organization'
);
select ok(
  not exists (
    select 1
    from unnest(array['anon','authenticated','service_role']) as roles(role_name)
    cross join unnest(array[
      'public.milestones','public.project_risks','public.project_activities',
      'public.daily_reports','public.task_comments','public.task_dependencies'
    ]) as tables(table_name)
    cross join unnest(array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) as privileges(privilege_name)
    where has_table_privilege(role_name,table_name,privilege_name)
  ),
  'browser and bypass roles cannot mutate execution tables directly'
);
select ok(
  not exists (
    select 1
    from unnest(array['anon','authenticated','service_role']) as roles(role_name)
    cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) as privileges(privilege_name)
    where has_table_privilege(role_name,'public.project_execution_command_idempotency',privilege_name)
  ),
  'no external role can access the command ledger'
);
select ok(
  (select relforcerowsecurity from pg_class where oid='public.milestones'::regclass)
  and (select relforcerowsecurity from pg_class where oid='public.project_risks'::regclass)
  and (select relforcerowsecurity from pg_class where oid='public.project_activities'::regclass)
  and (select relforcerowsecurity from pg_class where oid='public.daily_reports'::regclass)
  and (select relforcerowsecurity from pg_class where oid='public.task_comments'::regclass)
  and (select relforcerowsecurity from pg_class where oid='public.task_dependencies'::regclass)
  and (select relforcerowsecurity from pg_class where oid='public.project_execution_command_idempotency'::regclass),
  'all execution tables force row level security'
);

insert into public.tenants(name,slug,status) values
  ('Project execution A','project-execution-a','active'),
  ('Project execution B','project-execution-b','active');
insert into public.organizations(tenant_id,name,slug)
select tenant.id,seed.name,seed.slug
from public.tenants tenant
join (values
  ('project-execution-a','Project execution A','project-execution-org-a'),
  ('project-execution-b','Project execution B','project-execution-org-b')
) seed(tenant_slug,name,slug) on seed.tenant_slug=tenant.slug;
insert into public.identity_providers(tenant_id,provider_code,auth_provider,provider_tenant_key,display_name,status)
select id,'projectexecution','custom:projectexecution',slug||'-key','Project execution identity','active'
from public.tenants where slug like 'project-execution-%';
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
  ('00000000-0000-0000-0000-000000000000','88000000-0000-4000-8000-000000000001','authenticated','authenticated','execution-manager-a@example.test',crypt('local-e2e-password',gen_salt('bf')),now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','88000000-0000-4000-8000-000000000002','authenticated','authenticated','execution-owner-a@example.test',crypt('local-e2e-password',gen_salt('bf')),now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','88000000-0000-4000-8000-000000000003','authenticated','authenticated','execution-unrelated-a@example.test',crypt('local-e2e-password',gen_salt('bf')),now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','88000000-0000-4000-8000-000000000004','authenticated','authenticated','execution-user-b@example.test',crypt('local-e2e-password',gen_salt('bf')),now(),'{}','{}',now(),now());
insert into public.organization_members(tenant_id,organization_id,user_id,status)
select tenant.id,organization.id,seed.user_id,'active'
from (values
  ('project-execution-a','project-execution-org-a','88000000-0000-4000-8000-000000000001'::uuid),
  ('project-execution-a','project-execution-org-a','88000000-0000-4000-8000-000000000002'::uuid),
  ('project-execution-a','project-execution-org-a','88000000-0000-4000-8000-000000000003'::uuid),
  ('project-execution-b','project-execution-org-b','88000000-0000-4000-8000-000000000004'::uuid)
) seed(tenant_slug,organization_slug,user_id)
join public.tenants tenant on tenant.slug=seed.tenant_slug
join public.organizations organization on organization.tenant_id=tenant.id and organization.slug=seed.organization_slug;
insert into public.employee_profiles(
  public_id,tenant_id,organization_id,organization_member_id,employee_no,display_name,
  job_title,employment_status,skills
)
select seed.public_id,member.tenant_id,member.organization_id,member.id,
       'EXECUTION-'||member.id,seed.display_name,'Project delivery','active','{}'::text[]
from (values
  ('88000000-0000-4000-8000-000000000001'::uuid,'89000000-0000-4000-8000-000000000001'::uuid,'Execution manager A'),
  ('88000000-0000-4000-8000-000000000002'::uuid,'89000000-0000-4000-8000-000000000002'::uuid,'Execution owner A'),
  ('88000000-0000-4000-8000-000000000003'::uuid,'89000000-0000-4000-8000-000000000003'::uuid,'Execution unrelated A'),
  ('88000000-0000-4000-8000-000000000004'::uuid,'89000000-0000-4000-8000-000000000004'::uuid,'Execution user B')
) seed(user_id,public_id,display_name)
join public.organization_members member on member.user_id=seed.user_id;
insert into public.external_identities(
  tenant_id,organization_id,organization_member_id,identity_provider_id,
  provider_subject,provider_tenant_key,auth_user_id,status
)
select member.tenant_id,member.organization_id,member.id,provider.id,member.user_id::text,
       provider.provider_tenant_key,member.user_id,'active'
from public.organization_members member
join public.identity_providers provider
  on provider.tenant_id=member.tenant_id and provider.provider_code='projectexecution';
insert into public.roles(tenant_id,organization_id,code,name,description,is_system,is_enabled)
select tenant.id,organization.id,'project_execution_manager','Project execution manager','Project execution manager',false,true
from public.tenants tenant join public.organizations organization on organization.tenant_id=tenant.id
where tenant.slug='project-execution-a';
insert into public.member_roles(tenant_id,member_id,role_id,assignment_source)
select member.tenant_id,member.id,role.id,'manual'
from public.organization_members member
join public.roles role on role.tenant_id=member.tenant_id and role.organization_id=member.organization_id
where member.user_id='88000000-0000-4000-8000-000000000001'
  and role.code='project_execution_manager';
insert into public.role_permissions(tenant_id,role_id,permission_id)
select role.tenant_id,role.id,permission.id
from public.roles role join public.permissions permission on permission.code='project.manage'
where role.code='project_execution_manager';

select set_config('request.jwt.claim.sub','88000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select set_config('test.project.execution.project_result',public.create_current_project_v2(
  'Execution project','Commercial execution chain','Delivery',
  '89000000-0000-4000-8000-000000000002',50000.00,'active','high',
  '2026-09-01','2026-10-31',0,'Create execution fixture',
  '8a000000-0000-4000-8000-000000000001','8a000000-0000-4000-8000-000000000002'
)::text,true);
reset role;
select set_config('test.project.execution.project_id',current_setting('test.project.execution.project_result')::jsonb->>'id',true);

select set_config('request.jwt.claim.sub','88000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select set_config('test.project.execution.task_batch',public.create_current_task_batch_v3(
  jsonb_build_array(
    jsonb_build_object('projectId',current_setting('test.project.execution.project_id')::uuid,'title','Task A','description','Dependency A','assigneeMemberId',(select id from public.organization_members where user_id='88000000-0000-4000-8000-000000000002'),'dueDate',to_char(current_date + 90,'YYYY-MM-DD'),'priority','high','acceptanceCriteria','Acceptance A'),
    jsonb_build_object('projectId',current_setting('test.project.execution.project_id')::uuid,'title','Task B','description','Dependency B','assigneeMemberId',(select id from public.organization_members where user_id='88000000-0000-4000-8000-000000000002'),'dueDate',to_char(current_date + 91,'YYYY-MM-DD'),'priority','high','acceptanceCriteria','Acceptance B'),
    jsonb_build_object('projectId',current_setting('test.project.execution.project_id')::uuid,'title','Task C','description','Dependency C','assigneeMemberId',(select id from public.organization_members where user_id='88000000-0000-4000-8000-000000000002'),'dueDate',to_char(current_date + 92,'YYYY-MM-DD'),'priority','high','acceptanceCriteria','Acceptance C')
  ),
  '8a000000-0000-4000-8000-000000000030','8a000000-0000-4000-8000-000000000031'
)::text,true);
select set_config('test.project.execution.task_a',current_setting('test.project.execution.task_batch')::jsonb#>>'{taskIds,0}',true);
select set_config('test.project.execution.task_b',current_setting('test.project.execution.task_batch')::jsonb#>>'{taskIds,1}',true);
select set_config('test.project.execution.task_c',current_setting('test.project.execution.task_batch')::jsonb#>>'{taskIds,2}',true);
select set_config('test.project.execution.milestone_result',public.create_current_project_milestone(
  current_setting('test.project.execution.project_id')::uuid,'Commercial acceptance','Formal acceptance',
  '89000000-0000-4000-8000-000000000002','2026-09-01','2026-09-30',0,
  'Create milestone','8a000000-0000-4000-8000-000000000003','8a000000-0000-4000-8000-000000000004'
)::text,true);
select set_config('test.project.execution.milestone_replay',public.create_current_project_milestone(
  current_setting('test.project.execution.project_id')::uuid,'Commercial acceptance','Formal acceptance',
  '89000000-0000-4000-8000-000000000002','2026-09-01','2026-09-30',0,
  'Create milestone','8a000000-0000-4000-8000-000000000005','8a000000-0000-4000-8000-000000000004'
)::text,true);
select set_config('test.project.execution.milestone_payload_conflict',public.create_current_project_milestone(
  current_setting('test.project.execution.project_id')::uuid,'Changed replay','Must not replace',
  '89000000-0000-4000-8000-000000000002','2026-09-01','2026-10-01',50,
  'Replay milestone','8a000000-0000-4000-8000-000000000030','8a000000-0000-4000-8000-000000000004'
)::text,true);
select set_config('test.project.execution.milestone_target_conflict',public.create_current_project_milestone(
  '8a000000-0000-4000-8000-000000000031','Commercial acceptance','Formal acceptance',
  '89000000-0000-4000-8000-000000000002','2026-09-01','2026-09-30',0,
  'Create milestone','8a000000-0000-4000-8000-000000000032','8a000000-0000-4000-8000-000000000004'
)::text,true);
reset role;
select is(current_setting('test.project.execution.milestone_result')::jsonb->>'outcome','success','manager creates milestone');
select is(current_setting('test.project.execution.milestone_replay')::jsonb->>'id',current_setting('test.project.execution.milestone_result')::jsonb->>'id','same key replays canonical milestone');
select is(current_setting('test.project.execution.milestone_payload_conflict')::jsonb->>'error','scope_conflict','same key cannot be reused with a different canonical payload');
select is(current_setting('test.project.execution.milestone_target_conflict')::jsonb->>'error','scope_conflict','same key cannot be reused for another target');
select is((select count(*) from public.milestones where project_id=(select id from public.projects where public_id=current_setting('test.project.execution.project_id')::uuid)),1::bigint,'milestone replay creates no duplicate');
select ok(exists(select 1 from public.project_activities where action_type='milestone_updated' and content like '新增里程碑：%'),'milestone and project activity commit together');
select ok(exists(select 1 from public.audit_logs where request_id='8a000000-0000-4000-8000-000000000003' and action='project.milestone_created'),'milestone command is audited');

select set_config('request.jwt.claim.sub','88000000-0000-4000-8000-000000000003',true);
set local role authenticated;
select set_config('test.project.execution.milestone_actor_conflict',public.create_current_project_milestone(
  current_setting('test.project.execution.project_id')::uuid,'Commercial acceptance','Formal acceptance',
  '89000000-0000-4000-8000-000000000002','2026-09-01','2026-09-30',0,
  'Create milestone','8a000000-0000-4000-8000-000000000033','8a000000-0000-4000-8000-000000000004'
)::text,true);
select set_config('test.project.execution.forbidden_risk',public.create_current_project_risk(
  current_setting('test.project.execution.project_id')::uuid,'Unrelated risk','high',
  '89000000-0000-4000-8000-000000000002','2026-09-30','Unauthorized risk',
  '8a000000-0000-4000-8000-000000000006','8a000000-0000-4000-8000-000000000007'
)::text,true);
reset role;
select ok(
  current_setting('test.project.execution.milestone_actor_conflict')::jsonb->>'error'='scope_conflict'
  and not (current_setting('test.project.execution.milestone_actor_conflict')::jsonb ? 'entity'),
  'another same-organization actor cannot replay or read a successful entity'
);
select is(current_setting('test.project.execution.forbidden_risk')::jsonb->>'error','forbidden','unrelated same-organization employee cannot manage risk');

select set_config('request.jwt.claim.sub','88000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select set_config('test.project.execution.risk_result',public.create_current_project_risk(
  current_setting('test.project.execution.project_id')::uuid,'Delivery delay','critical',
  '89000000-0000-4000-8000-000000000002','2026-09-30','Register delivery risk',
  '8a000000-0000-4000-8000-000000000008','8a000000-0000-4000-8000-000000000009'
)::text,true);
reset role;
select is(current_setting('test.project.execution.risk_result')::jsonb->>'outcome','success','manager creates project risk');
select is((select count(*) from public.project_risks where title='Delivery delay'),1::bigint,'risk row persists exactly once');

select set_config('request.jwt.claim.sub','88000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select set_config('test.project.execution.activity_result',public.record_current_project_activity(
  current_setting('test.project.execution.project_id')::uuid,'Completed API integration','Record project note',
  '8a000000-0000-4000-8000-000000000010','8a000000-0000-4000-8000-000000000011'
)::text,true);
select set_config('test.project.execution.report_result',public.submit_current_project_report(
  current_setting('test.project.execution.project_id')::uuid,'2026-08-27','Completed integration','Complete acceptance','','',
  'Submit daily report','8a000000-0000-4000-8000-000000000012','8a000000-0000-4000-8000-000000000013'
)::text,true);
select set_config('test.project.execution.comment_result',public.create_current_task_comment(
  current_setting('test.project.execution.task_a')::uuid,'Attach acceptance screenshot','Record collaboration note',
  '8a000000-0000-4000-8000-000000000014','8a000000-0000-4000-8000-000000000015'
)::text,true);
reset role;
select is(current_setting('test.project.execution.activity_result')::jsonb->>'outcome','success','project member records activity');
select is(current_setting('test.project.execution.report_result')::jsonb->>'outcome','success','project member submits report');
select is(current_setting('test.project.execution.comment_result')::jsonb->>'outcome','success','project member creates task comment');
select is(current_setting('test.project.execution.report_result')::jsonb#>>'{entity,authorPublicId}','89000000-0000-4000-8000-000000000002','report author is derived from server identity');

select set_config('request.jwt.claim.sub','88000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select set_config('test.project.execution.large_report_result',public.submit_current_project_report(
  current_setting('test.project.execution.project_id')::uuid,'2026-08-28',repeat('界',2500),'Complete acceptance','','',
  'Submit large daily report','8a000000-0000-4000-8000-000000000034','8a000000-0000-4000-8000-000000000035'
)::text,true);
reset role;
select is(current_setting('test.project.execution.large_report_result')::jsonb->>'outcome','success','large valid report is not rolled back by audit metadata limits');
select ok(exists(
  select 1 from public.audit_logs
  where request_id='8a000000-0000-4000-8000-000000000034'
    and action='project.report_submitted'
    and metadata#>>'{after,entityDigest}' ~ '^[0-9a-f]{64}$'
    and octet_length(metadata::text) <= 8192
),'success audit stores a bounded entity digest instead of the full report');

select set_config('request.jwt.claim.sub','88000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select set_config('test.project.execution.dep_ab',public.create_current_task_dependency(
  current_setting('test.project.execution.task_a')::uuid,current_setting('test.project.execution.task_b')::uuid,
  'A depends on B','8a000000-0000-4000-8000-000000000016','8a000000-0000-4000-8000-000000000017'
)::text,true);
select set_config('test.project.execution.dep_bc',public.create_current_task_dependency(
  current_setting('test.project.execution.task_b')::uuid,current_setting('test.project.execution.task_c')::uuid,
  'B depends on C','8a000000-0000-4000-8000-000000000018','8a000000-0000-4000-8000-000000000019'
)::text,true);
select set_config('test.project.execution.dep_cycle',public.create_current_task_dependency(
  current_setting('test.project.execution.task_c')::uuid,current_setting('test.project.execution.task_a')::uuid,
  'Cycle attempt','8a000000-0000-4000-8000-000000000020','8a000000-0000-4000-8000-000000000021'
)::text,true);
reset role;
select is(current_setting('test.project.execution.dep_ab')::jsonb->>'outcome','success','first dependency persists');
select is(current_setting('test.project.execution.dep_bc')::jsonb->>'outcome','success','second dependency persists');
select is(current_setting('test.project.execution.dep_cycle')::jsonb->>'error','task_dependency_cycle','transitive dependency cycle is rejected');
select is((select count(*) from public.task_dependencies),2::bigint,'rejected cycle leaves no dependency row');

select set_config('request.jwt.claim.sub','88000000-0000-4000-8000-000000000004',true);
set local role authenticated;
select set_config('test.project.execution.foreign_result',public.record_current_project_activity(
  current_setting('test.project.execution.project_id')::uuid,'Foreign note','Cross tenant attempt',
  '8a000000-0000-4000-8000-000000000022','8a000000-0000-4000-8000-000000000023'
)::text,true);
reset role;
select is(current_setting('test.project.execution.foreign_result')::jsonb->>'error','not_found','cross-tenant target is not disclosed');

create or replace function public.test_project_execution_activity_failure()
returns trigger language plpgsql set search_path='' as $$
begin
  if current_setting('test.project.execution.activity_failure',true)='on' then
    raise exception 'injected_project_activity_failure';
  end if;
  return new;
end;
$$;
create trigger test_project_execution_activity_failure before insert on public.project_activities
for each row execute function public.test_project_execution_activity_failure();
select set_config('test.project.execution.activity_failure','on',true);
select set_config('request.jwt.claim.sub','88000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select set_config('test.project.execution.failure_result',public.create_current_project_milestone(
  current_setting('test.project.execution.project_id')::uuid,'Must roll back','Injected activity failure',
  '89000000-0000-4000-8000-000000000002','2026-09-01','2026-09-30',0,
  'Atomic rollback proof','8a000000-0000-4000-8000-000000000024','8a000000-0000-4000-8000-000000000025'
)::text,true);
reset role;
select set_config('test.project.execution.activity_failure','off',true);
select is(current_setting('test.project.execution.failure_result')::jsonb->>'error','command_failed','injected activity failure returns sanitized command failure');
select is((select count(*) from public.milestones where name='Must roll back'),0::bigint,'activity failure rolls back resource mutation');
select ok(exists(select 1 from public.audit_logs where request_id='8a000000-0000-4000-8000-000000000024' and action='project.execution_failed' and metadata->>'failure'='command_failed'),'rolled-back mutation leaves durable failure audit');
drop trigger test_project_execution_activity_failure on public.project_activities;
drop function public.test_project_execution_activity_failure();

select set_config('request.jwt.claim.sub','88000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select throws_ok($$ select public.create_current_project_milestone(
  current_setting('test.project.execution.project_id')::uuid,'Invalid reason','',
  '89000000-0000-4000-8000-000000000002',null,'2026-09-30',0,
  null,'8a000000-0000-4000-8000-000000000026','8a000000-0000-4000-8000-000000000027'
) $$,'22023','Milestone command input is invalid','null business reason is rejected');
select throws_ok($$ select public.create_current_project_milestone(
  current_setting('test.project.execution.project_id')::uuid,'Invalid progress','',
  '89000000-0000-4000-8000-000000000002',null,'2026-09-30','NaN'::numeric,
  'Invalid progress','8a000000-0000-4000-8000-000000000028','8a000000-0000-4000-8000-000000000029'
) $$,'22023','Milestone command input is invalid','NaN progress is rejected');
select throws_ok($$ select public.create_current_project_milestone(
  current_setting('test.project.execution.project_id')::uuid,'Invalid correlation','',
  '89000000-0000-4000-8000-000000000002',null,'2026-09-30',0,
  'Invalid correlation','8a000000-0000-4000-8000-000000000036','8a000000-0000-4000-8000-000000000036'
) $$,'22023','Milestone command input is invalid','request id and idempotency key must be distinct');
reset role;

select * from finish();
rollback;
