begin;
select plan(43);

select ok(has_column('public','tasks','tenant_id'),'tasks carry tenant ownership');
select ok(has_column('public','tasks','created_by_member_id'),'tasks carry creator ownership');
select ok(has_column('public','tasks','updated_by_member_id'),'tasks carry last updater ownership');
select ok(has_column('public','tasks','version'),'tasks carry optimistic version');
select ok(has_table('public','task_command_idempotency'),'task command ledger exists');
select ok(has_function('public','create_current_task_batch_v3',array['jsonb','uuid','uuid']::name[]),'membership-safe atomic task batch command exists');
select ok(has_function('public','transition_current_task',array['uuid','text','integer','jsonb','uuid']::name[]),'versioned task transition exists');
select is((select relforcerowsecurity from pg_class where oid='public.tasks'::regclass),true,'tasks force row security');
select ok(
  has_function_privilege('authenticated','public.create_current_task_batch_v3(jsonb,uuid,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.create_current_task_batch_v2(jsonb,uuid,uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.transition_current_task(uuid,text,integer,jsonb,uuid)','EXECUTE'),
  'authenticated users enter only controlled task commands'
);
select ok(
  not has_function_privilege('authenticated','public.create_current_project_task(uuid,text,text,bigint,date,text)','EXECUTE')
  and not has_function_privilege('authenticated','public.create_current_project_task_v2(uuid,text,text,bigint,date,text,text)','EXECUTE'),
  'all legacy non-idempotent task create commands are closed'
);
select ok(
  not has_table_privilege('authenticated','public.tasks','INSERT')
  and not has_table_privilege('authenticated','public.tasks','UPDATE')
  and not has_table_privilege('service_role','public.tasks','UPDATE'),
  'direct task writes are closed'
);
select ok(
  not has_function_privilege('authenticated','public.claim_task_command(bigint,bigint,bigint,text,uuid,jsonb,uuid,uuid)','EXECUTE')
  and not has_function_privilege('service_role','public.task_command_entity(bigint)','EXECUTE'),
  'task command helpers remain private'
);

insert into public.tenants(name,slug,status) values
  ('Task workflow tenant','task-workflow-tenant','active'),
  ('Task workflow foreign','task-workflow-foreign','active');
insert into public.organizations(tenant_id,name,slug)
select id,'Task workflow organization','task-workflow-org' from public.tenants where slug='task-workflow-tenant';
insert into public.organizations(tenant_id,name,slug)
select id,'Task workflow foreign','task-workflow-foreign-org' from public.tenants where slug='task-workflow-foreign';
insert into public.identity_providers(
  tenant_id,provider_code,auth_provider,provider_tenant_key,display_name,status
)
select id,'taskworkflow','custom:taskworkflow',slug||'-provider','Task workflow provider','active'
from public.tenants where slug in ('task-workflow-tenant','task-workflow-foreign');

insert into auth.users(
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
  ('00000000-0000-0000-0000-000000000000','91000000-0000-4000-8000-000000000001','authenticated','authenticated','task-manager@example.test',crypt('local-e2e-password',gen_salt('bf')),now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','91000000-0000-4000-8000-000000000002','authenticated','authenticated','task-employee@example.test',crypt('local-e2e-password',gen_salt('bf')),now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','91000000-0000-4000-8000-000000000003','authenticated','authenticated','task-foreign@example.test',crypt('local-e2e-password',gen_salt('bf')),now(),'{}','{}',now(),now());

insert into public.organization_members(tenant_id,organization_id,user_id,status)
select tenant.id,organization.id,seed.user_id,'active'
from (values
  ('task-workflow-tenant','91000000-0000-4000-8000-000000000001'::uuid),
  ('task-workflow-tenant','91000000-0000-4000-8000-000000000002'::uuid),
  ('task-workflow-foreign','91000000-0000-4000-8000-000000000003'::uuid)
) seed(tenant_slug,user_id)
join public.tenants tenant on tenant.slug=seed.tenant_slug
join public.organizations organization on organization.tenant_id=tenant.id;

insert into public.employee_profiles(
  public_id,tenant_id,organization_id,organization_member_id,employee_no,
  display_name,job_title,employment_status,skills
)
select seed.public_id,member.tenant_id,member.organization_id,member.id,
       seed.employee_no,seed.display_name,seed.job_title,'active','{}'::text[]
from (values
  ('91010000-0000-4000-8000-000000000001'::uuid,'91000000-0000-4000-8000-000000000001'::uuid,'TASK-MANAGER','Task manager','Project owner'),
  ('91010000-0000-4000-8000-000000000002'::uuid,'91000000-0000-4000-8000-000000000002'::uuid,'TASK-EMPLOYEE','Task employee','Engineer'),
  ('91010000-0000-4000-8000-000000000003'::uuid,'91000000-0000-4000-8000-000000000003'::uuid,'TASK-FOREIGN','Task foreign','Engineer')
) seed(public_id,user_id,employee_no,display_name,job_title)
join public.organization_members member on member.user_id=seed.user_id;

insert into public.external_identities(
  tenant_id,organization_id,organization_member_id,identity_provider_id,
  provider_subject,provider_tenant_key,auth_user_id,status
)
select member.tenant_id,member.organization_id,member.id,provider.id,
       member.user_id::text,provider.provider_tenant_key,member.user_id,'active'
from public.organization_members member
join public.identity_providers provider on provider.tenant_id=member.tenant_id
where member.user_id in (
  '91000000-0000-4000-8000-000000000001',
  '91000000-0000-4000-8000-000000000002',
  '91000000-0000-4000-8000-000000000003'
);

insert into public.projects(
  public_id,tenant_id,organization_id,code,name,category,description,
  owner_member_id,created_by_member_id,updated_by_member_id,budget_amount,
  status,health,priority,start_date,due_date,progress,version
)
select seed.public_id,tenant.id,organization.id,seed.code,seed.name,'Delivery','Task workflow fixture',
       member.id,member.id,member.id,0,'active','on_track','medium',
       '2026-09-01','2026-12-31',0,1
from (values
  ('task-workflow-tenant','91000000-0000-4000-8000-000000000001'::uuid,'91020000-0000-4000-8000-000000000001'::uuid,'TASK-WORKFLOW','Task workflow project'),
  ('task-workflow-foreign','91000000-0000-4000-8000-000000000003'::uuid,'91020000-0000-4000-8000-000000000002'::uuid,'TASK-FOREIGN','Task foreign project')
) seed(tenant_slug,user_id,public_id,code,name)
join public.tenants tenant on tenant.slug=seed.tenant_slug
join public.organizations organization on organization.tenant_id=tenant.id
join public.organization_members member on member.tenant_id=tenant.id and member.user_id=seed.user_id;

insert into public.project_members(
  tenant_id,organization_id,project_id,member_id,role,allocation_percent,
  created_by_member_id,updated_by_member_id,version
)
select project.tenant_id,project.organization_id,project.id,project.owner_member_id,
       'owner',100,project.owner_member_id,project.owner_member_id,1
from public.projects project where project.public_id in (
  '91020000-0000-4000-8000-000000000001','91020000-0000-4000-8000-000000000002'
);

select set_config('quantxy.explicit_project_member_mutation','on',true);
insert into public.project_members(
  tenant_id,organization_id,project_id,member_id,role,allocation_percent,
  created_by_member_id,updated_by_member_id,version
)
select project.tenant_id,project.organization_id,project.id,employee.id,
       'member',100,project.owner_member_id,project.owner_member_id,1
from public.projects project
join public.organization_members employee
  on employee.tenant_id=project.tenant_id
 and employee.organization_id=project.organization_id
 and employee.user_id='91000000-0000-4000-8000-000000000002'
where project.public_id='91020000-0000-4000-8000-000000000001';
select set_config('quantxy.explicit_project_member_mutation','off',true);

insert into public.tasks(
  public_id,tenant_id,organization_id,project_id,title,description,
  assignee_member_id,reporter_member_id,status,priority,start_date,due_date,
  progress,acceptance_criteria,created_by_member_id,updated_by_member_id,version
)
select '91030000-0000-4000-8000-000000000099',project.tenant_id,project.organization_id,
       project.id,'Foreign task','Must remain hidden',project.owner_member_id,
       project.owner_member_id,'todo','medium','2026-09-01','2026-09-20',0,
       'Foreign acceptance',project.owner_member_id,project.owner_member_id,1
from public.projects project where project.public_id='91020000-0000-4000-8000-000000000002';

select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select set_config('test.task.workflow.batch',public.create_current_task_batch_v3(
  jsonb_build_array(
    jsonb_build_object('projectId','91020000-0000-4000-8000-000000000001','assigneeMemberId',(select id from public.organization_members where user_id='91000000-0000-4000-8000-000000000002'),'title','Workflow task A','description','Atomic A','acceptanceCriteria','Acceptance A','dueDate',to_char(current_date + 90,'YYYY-MM-DD'),'priority','high'),
    jsonb_build_object('projectId','91020000-0000-4000-8000-000000000001','assigneeMemberId',(select id from public.organization_members where user_id='91000000-0000-4000-8000-000000000002'),'title','Workflow task B','description','Atomic B','acceptanceCriteria','Acceptance B','dueDate',to_char(current_date + 91,'YYYY-MM-DD'),'priority','low')
  ),
  '91040000-0000-4000-8000-000000000001','91040000-0000-4000-8000-000000000002'
)::text,true);
select set_config('test.task.workflow.replay',public.create_current_task_batch_v3(
  jsonb_build_array(
    jsonb_build_object('projectId','91020000-0000-4000-8000-000000000001','assigneeMemberId',(select id from public.organization_members where user_id='91000000-0000-4000-8000-000000000002'),'title','Workflow task A','description','Atomic A','acceptanceCriteria','Acceptance A','dueDate',to_char(current_date + 90,'YYYY-MM-DD'),'priority','high'),
    jsonb_build_object('projectId','91020000-0000-4000-8000-000000000001','assigneeMemberId',(select id from public.organization_members where user_id='91000000-0000-4000-8000-000000000002'),'title','Workflow task B','description','Atomic B','acceptanceCriteria','Acceptance B','dueDate',to_char(current_date + 91,'YYYY-MM-DD'),'priority','low')
  ),
  '91040000-0000-4000-8000-000000000001','91040000-0000-4000-8000-000000000003'
)::text,true);
select set_config('test.task.workflow.conflict',public.create_current_task_batch_v3(
  jsonb_build_array(jsonb_build_object('projectId','91020000-0000-4000-8000-000000000001','assigneeMemberId',(select id from public.organization_members where user_id='91000000-0000-4000-8000-000000000002'),'title','Changed payload','description','','acceptanceCriteria','Changed','dueDate',to_char(current_date + 92,'YYYY-MM-DD'),'priority','high')),
  '91040000-0000-4000-8000-000000000001','91040000-0000-4000-8000-000000000004'
)::text,true);
reset role;

select is(current_setting('test.task.workflow.batch')::jsonb->>'outcome','success','manager creates one atomic task batch');
select is(current_setting('test.task.workflow.replay')::jsonb->'taskIds',current_setting('test.task.workflow.batch')::jsonb->'taskIds','same key replays canonical task ids');
select is((select count(*) from public.tasks where title in ('Workflow task A','Workflow task B')),2::bigint,'batch replay creates no duplicate tasks');
select is((select priority from public.tasks where title='Workflow task B'),'low','P3 task priority survives the hardened v3 compatibility boundary');
select is(current_setting('test.task.workflow.conflict')::jsonb->>'error','scope_conflict','same batch key rejects a changed payload');
select is((select count(*) from public.audit_logs where action='task.created' and request_id='91040000-0000-4000-8000-000000000002'),2::bigint,'every task in the batch is audited');
select ok(exists(select 1 from public.audit_logs where action='task.batch_created' and request_id='91040000-0000-4000-8000-000000000002'),'batch completion is audited');
select is(
  (select membership.role from public.project_members membership
   join public.projects project on project.id=membership.project_id
   join public.organization_members member on member.id=membership.member_id
   where project.public_id='91020000-0000-4000-8000-000000000001'
     and member.user_id='91000000-0000-4000-8000-000000000002'),
  'member','task assignment preserves an explicitly managed contributor membership'
);

create function public.test_reject_second_task()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.title='Injected task failure' then raise exception 'injected task failure'; end if;
  return new;
end;
$$;
create trigger test_reject_second_task before insert on public.tasks
for each row execute function public.test_reject_second_task();
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select set_config('test.task.workflow.failure',public.create_current_task_batch_v3(
  jsonb_build_array(
    jsonb_build_object('projectId','91020000-0000-4000-8000-000000000001','assigneeMemberId',(select id from public.organization_members where user_id='91000000-0000-4000-8000-000000000002'),'title','Must roll back task','description','','acceptanceCriteria','Rollback','dueDate',to_char(current_date + 93,'YYYY-MM-DD'),'priority','high'),
    jsonb_build_object('projectId','91020000-0000-4000-8000-000000000001','assigneeMemberId',(select id from public.organization_members where user_id='91000000-0000-4000-8000-000000000002'),'title','Injected task failure','description','','acceptanceCriteria','Rollback','dueDate',to_char(current_date + 94,'YYYY-MM-DD'),'priority','high')
  ),
  '91040000-0000-4000-8000-000000000005','91040000-0000-4000-8000-000000000006'
)::text,true);
reset role;
drop trigger test_reject_second_task on public.tasks;
drop function public.test_reject_second_task();
select is(current_setting('test.task.workflow.failure')::jsonb->>'error','command_failed','injected item failure returns a sanitized command failure');
select is((select count(*) from public.tasks where title in ('Must roll back task','Injected task failure')),0::bigint,'injected second-item failure rolls back the whole batch');

select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select set_config('test.task.workflow.forbidden_batch',public.create_current_task_batch_v3(
  jsonb_build_array(jsonb_build_object('projectId','91020000-0000-4000-8000-000000000001','assigneeMemberId',(select id from public.organization_members where user_id='91000000-0000-4000-8000-000000000002'),'title','Forbidden manager task','description','','acceptanceCriteria','Denied','dueDate',to_char(current_date + 95,'YYYY-MM-DD'),'priority','medium')),
  '91040000-0000-4000-8000-000000000007','91040000-0000-4000-8000-000000000008'
)::text,true);
reset role;
select is(current_setting('test.task.workflow.forbidden_batch')::jsonb->>'error','forbidden','ordinary project member cannot create task batches');

select set_config('test.task.workflow.task_a',current_setting('test.task.workflow.batch')::jsonb#>>'{taskIds,0}',true);
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select set_config('test.task.workflow.claim',public.transition_current_task(current_setting('test.task.workflow.task_a')::uuid,'claim',1,'{}','91050000-0000-4000-8000-000000000001')::text,true);
select set_config('test.task.workflow.claim_replay',public.transition_current_task(current_setting('test.task.workflow.task_a')::uuid,'claim',1,'{}','91050000-0000-4000-8000-000000000001')::text,true);
select set_config('test.task.workflow.claim_conflict',public.transition_current_task(current_setting('test.task.workflow.task_a')::uuid,'claim',2,'{}','91050000-0000-4000-8000-000000000001')::text,true);
select set_config('test.task.workflow.progress',public.transition_current_task(current_setting('test.task.workflow.task_a')::uuid,'progress',2,jsonb_build_object('progress',40,'blocker','','nextStep','Complete delivery'),'91050000-0000-4000-8000-000000000002')::text,true);
select set_config('test.task.workflow.stale',public.transition_current_task(current_setting('test.task.workflow.task_a')::uuid,'progress',2,jsonb_build_object('progress',50,'blocker','','nextStep','Stale'),'91050000-0000-4000-8000-000000000003')::text,true);
select set_config('test.task.workflow.submit',public.transition_current_task(current_setting('test.task.workflow.task_a')::uuid,'submit',3,jsonb_build_object('resultText','Delivered','resultLink','https://example.test/evidence','resultFiles','[]'::jsonb),'91050000-0000-4000-8000-000000000004')::text,true);
reset role;

select is(current_setting('test.task.workflow.claim')::jsonb#>>'{entity,status}','in_progress','assignee claims a pending task');
select is((current_setting('test.task.workflow.claim_replay')::jsonb->>'version')::bigint,2::bigint,'transition request replay returns the same canonical version');
select is(current_setting('test.task.workflow.claim_conflict')::jsonb->>'error','scope_conflict','same transition request id rejects changed expected version');
select is((current_setting('test.task.workflow.progress')::jsonb->>'version')::bigint,3::bigint,'progress transition increments version');
select is(current_setting('test.task.workflow.stale')::jsonb->>'error','version_conflict','stale transition fails optimistic locking');
select is(current_setting('test.task.workflow.submit')::jsonb#>>'{entity,status}','in_review','assignee submits task for review');

select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select set_config('test.task.workflow.bad_review',public.transition_current_task(current_setting('test.task.workflow.task_a')::uuid,'review',4,jsonb_build_object('decision','pass','note',''),'91050000-0000-4000-8000-000000000005')::text,true);
reset role;
select is(current_setting('test.task.workflow.bad_review')::jsonb->>'error','forbidden','assignee cannot review their own task');

select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select set_config('test.task.workflow.review',public.transition_current_task(current_setting('test.task.workflow.task_a')::uuid,'review',4,jsonb_build_object('decision','pass','note','Accepted'),'91050000-0000-4000-8000-000000000006')::text,true);
select set_config('test.task.workflow.reopen',public.transition_current_task(current_setting('test.task.workflow.task_a')::uuid,'reopen',5,jsonb_build_object('note','Production correction'),'91050000-0000-4000-8000-000000000007')::text,true);
reset role;
select is(current_setting('test.task.workflow.review')::jsonb#>>'{entity,status}','done','reporter accepts a submitted task');
select is((current_setting('test.task.workflow.review')::jsonb#>>'{entity,progress}')::numeric,100::numeric,'accepted task reaches one hundred percent');
select is(current_setting('test.task.workflow.reopen')::jsonb#>>'{entity,status}','in_progress','reporter can reopen a completed task');

select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select set_config('test.task.workflow.resubmit',public.transition_current_task(current_setting('test.task.workflow.task_a')::uuid,'submit',6,jsonb_build_object('resultText','Corrected','resultLink','https://example.test/result','resultFiles','[]'::jsonb),'91050000-0000-4000-8000-000000000008')::text,true);
reset role;
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select set_config('test.task.workflow.reject',public.transition_current_task(current_setting('test.task.workflow.task_a')::uuid,'review',7,jsonb_build_object('decision','reject','note','Revise evidence'),'91050000-0000-4000-8000-000000000009')::text,true);
reset role;
select is(current_setting('test.task.workflow.resubmit')::jsonb#>>'{entity,status}','in_review','reopened task can be resubmitted');
select is(current_setting('test.task.workflow.reject')::jsonb#>>'{entity,status}','in_progress','reporter rejection returns task to execution');
select is((select submission_count from public.tasks where public_id=current_setting('test.task.workflow.task_a')::uuid),2,'submission evidence counts every submission');
select is((select rejection_count from public.tasks where public_id=current_setting('test.task.workflow.task_a')::uuid),2,'reopen and rejection evidence are both counted');
select is((select count(distinct action) from public.audit_logs where target_id=current_setting('test.task.workflow.task_a') and action in ('task.claimed','task.progress_updated','task.submitted','task.reviewed','task.reopened')),5::bigint,'every transition type is audited');
select is((select updated_by_member_id from public.tasks where public_id=current_setting('test.task.workflow.task_a')::uuid),(select id from public.organization_members where user_id='91000000-0000-4000-8000-000000000001'),'last updater is server-derived');

select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select set_config('test.task.workflow.foreign',public.transition_current_task('91030000-0000-4000-8000-000000000099','claim',1,'{}','91050000-0000-4000-8000-000000000010')::text,true);
select set_config('test.task.workflow.foreign_count',(select count(*)::text from public.tasks where public_id='91030000-0000-4000-8000-000000000099'),true);
reset role;
select is(current_setting('test.task.workflow.foreign')::jsonb->>'error','not_found','cross-tenant task transition discloses no target');
select is(current_setting('test.task.workflow.foreign_count')::bigint,0::bigint,'task RLS hides cross-tenant rows');
select ok(exists(select 1 from public.task_command_idempotency where result is not null),'task command ledger stores terminal results');

select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select throws_ok(
  $$select public.transition_current_task('91030000-0000-4000-8000-000000000099','submit',1,jsonb_build_object('resultText','x','resultLink','','resultFiles','[]'::jsonb,'unexpected',true),'91050000-0000-4000-8000-000000000011')$$,
  '22023', 'Task submit payload is invalid', 'database rejects unknown transition payload fields'
);
reset role;

select * from finish();
rollback;
