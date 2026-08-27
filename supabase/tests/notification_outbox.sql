begin;
select plan(59);

select ok(has_table('public','task_notification_delivery_attempts'),'durable delivery attempts exist');
select is(
  (select relforcerowsecurity from pg_class where oid='public.task_notification_delivery_attempts'::regclass),
  true,
  'delivery attempts force row security'
);
select ok(has_column('public','task_notification_delivery_attempts','lease_token'),'lease owner token exists');
select ok(has_column('public','task_notification_delivery_attempts','lease_generation'),'lease generation exists');
select is(
  (select count(*) from pg_indexes where schemaname='public' and indexname='task_notification_attempt_notification_scope_idx'),
  1::bigint,
  'attempt history has a notification scope index'
);
select ok(has_function('public','claim_task_notification_delivery_v2',array['uuid','uuid','uuid','uuid']::name[]),'delivery claim RPC exists');
select ok(has_function('public','record_task_notification_provider_acceptance_v2',array['uuid','uuid','uuid','uuid','uuid','integer','uuid','text']::name[]),'provider acceptance RPC exists');
select ok(has_function('public','complete_task_notification_delivery_v2',array['uuid','uuid','uuid','uuid','uuid','integer']::name[]),'terminal completion RPC exists');
select ok(has_function('public','fail_task_notification_delivery_v2',array['uuid','uuid','uuid','uuid','uuid','integer','text']::name[]),'failure RPC exists');
select ok(has_function('public','authorize_current_task_notification_retry',array['uuid']::name[]),'project authorization RPC exists');
select ok(
  not has_table_privilege('authenticated','public.task_notification_delivery_attempts','SELECT')
  and not has_table_privilege('authenticated','public.task_notification_delivery_attempts','INSERT')
  and not has_table_privilege('service_role','public.task_notification_delivery_attempts','INSERT')
  and not has_table_privilege('anon','public.task_notification_delivery_attempts','SELECT'),
  'attempt rows are reachable only through security-definer commands'
);
select ok(
  has_function_privilege('service_role','public.claim_task_notification_delivery_v2(uuid,uuid,uuid,uuid)','EXECUTE')
  and has_function_privilege('service_role','public.record_task_notification_provider_acceptance_v2(uuid,uuid,uuid,uuid,uuid,integer,uuid,text)','EXECUTE')
  and has_function_privilege('service_role','public.complete_task_notification_delivery_v2(uuid,uuid,uuid,uuid,uuid,integer)','EXECUTE')
  and has_function_privilege('service_role','public.fail_task_notification_delivery_v2(uuid,uuid,uuid,uuid,uuid,integer,text)','EXECUTE')
  and not has_function_privilege('authenticated','public.claim_task_notification_delivery_v2(uuid,uuid,uuid,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.complete_task_notification_delivery_v2(uuid,uuid,uuid,uuid,uuid,integer)','EXECUTE'),
  'only the service delivery boundary can mutate attempts'
);
select ok(
  has_function_privilege('authenticated','public.authorize_current_task_notification_retry(uuid)','EXECUTE')
  and not has_function_privilege('anon','public.authorize_current_task_notification_retry(uuid)','EXECUTE'),
  'only authenticated users can request task retry authorization'
);
select ok(
  not has_function_privilege('service_role','public.get_task_notification_delivery_context(uuid,uuid,uuid)','EXECUTE')
  and not has_function_privilege('service_role','public.record_task_notification_delivery(uuid,uuid,uuid,text,text,text)','EXECUTE'),
  'legacy non-claim delivery mutations are retired'
);
select is(
  (select count(*) from pg_indexes where schemaname='public' and indexname='task_notification_one_active_attempt_uidx'),
  1::bigint,
  'one active attempt is enforced per notification'
);

insert into public.tenants(name,slug,status)
values ('Notification outbox tenant','notification-outbox-tenant','active');
insert into public.organizations(tenant_id,name,slug)
select id,'Notification outbox organization','notification-outbox-org'
from public.tenants where slug='notification-outbox-tenant';
insert into public.identity_providers(
  tenant_id,provider_code,auth_provider,provider_tenant_key,display_name,status
)
select id,'feishu','custom:feishu','notification-outbox-provider','Feishu','active'
from public.tenants where slug='notification-outbox-tenant';

insert into auth.users(
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
  ('00000000-0000-0000-0000-000000000000','93000000-0000-4000-8000-000000000001','authenticated','authenticated','notification-owner@example.test',crypt('local-e2e-password',gen_salt('bf')),now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','93000000-0000-4000-8000-000000000002','authenticated','authenticated','notification-employee@example.test',crypt('local-e2e-password',gen_salt('bf')),now(),'{}','{}',now(),now());

insert into public.organization_members(tenant_id,organization_id,user_id,status)
select tenant.id,organization.id,seed.user_id,'active'
from (values
  ('93000000-0000-4000-8000-000000000001'::uuid),
  ('93000000-0000-4000-8000-000000000002'::uuid)
) seed(user_id)
join public.tenants tenant on tenant.slug='notification-outbox-tenant'
join public.organizations organization on organization.tenant_id=tenant.id;

insert into public.employee_profiles(
  public_id,tenant_id,organization_id,organization_member_id,employee_no,
  display_name,job_title,employment_status,skills
)
select seed.public_id,member.tenant_id,member.organization_id,member.id,
       seed.employee_no,seed.display_name,seed.job_title,'active','{}'::text[]
from (values
  ('93010000-0000-4000-8000-000000000001'::uuid,'93000000-0000-4000-8000-000000000001'::uuid,'NOTIFY-OWNER','Notification owner','Project owner'),
  ('93010000-0000-4000-8000-000000000002'::uuid,'93000000-0000-4000-8000-000000000002'::uuid,'NOTIFY-EMPLOYEE','Notification employee','Engineer')
) seed(public_id,user_id,employee_no,display_name,job_title)
join public.organization_members member on member.user_id=seed.user_id;

insert into public.external_identities(
  tenant_id,organization_id,organization_member_id,identity_provider_id,
  provider_subject,provider_tenant_key,auth_user_id,status
)
select member.tenant_id,member.organization_id,member.id,provider.id,
       'open_id:ou_notification_employee',provider.provider_tenant_key,member.user_id,'active'
from public.organization_members member
join public.identity_providers provider on provider.tenant_id=member.tenant_id
where member.user_id='93000000-0000-4000-8000-000000000002';

insert into public.projects(
  public_id,tenant_id,organization_id,code,name,category,description,
  owner_member_id,created_by_member_id,updated_by_member_id,budget_amount,
  status,health,priority,start_date,due_date,progress,version
)
select '93020000-0000-4000-8000-000000000001',tenant.id,organization.id,
       'NOTIFY-PROJECT','Notification project','Delivery','Durable notification fixture',
       owner.id,owner.id,owner.id,0,'active','on_track','medium',
       current_date,current_date+90,0,1
from public.tenants tenant
join public.organizations organization on organization.tenant_id=tenant.id
join public.organization_members owner
  on owner.organization_id=organization.id
 and owner.user_id='93000000-0000-4000-8000-000000000001'
where tenant.slug='notification-outbox-tenant';

insert into public.project_members(
  tenant_id,organization_id,project_id,member_id,role,allocation_percent,
  created_by_member_id,updated_by_member_id,version
)
select project.tenant_id,project.organization_id,project.id,member.id,
       case when member.id=project.owner_member_id then 'owner' else 'viewer' end,
       case when member.id=project.owner_member_id then 100 else 0 end,
       project.owner_member_id,project.owner_member_id,1
from public.projects project
join public.organization_members member
  on member.tenant_id=project.tenant_id
 and member.organization_id=project.organization_id
where project.public_id='93020000-0000-4000-8000-000000000001';

insert into public.tasks(
  public_id,tenant_id,organization_id,project_id,title,description,
  assignee_member_id,reporter_member_id,status,priority,start_date,due_date,
  progress,acceptance_criteria,created_by_member_id,updated_by_member_id,version
)
select seed.public_id,project.tenant_id,project.organization_id,project.id,
       seed.title,'Notification delivery fixture',employee.id,owner.id,
       'todo','high',current_date,current_date+30,0,'Delivery accepted',owner.id,owner.id,1
from (values
  ('93030000-0000-4000-8000-000000000001'::uuid,'Notification task A'),
  ('93030000-0000-4000-8000-000000000002'::uuid,'Notification task B'),
  ('93030000-0000-4000-8000-000000000003'::uuid,'Notification task C'),
  ('93030000-0000-4000-8000-000000000004'::uuid,'Notification task D')
) seed(public_id,title)
join public.projects project on project.public_id='93020000-0000-4000-8000-000000000001'
join public.organization_members owner
  on owner.organization_id=project.organization_id
 and owner.user_id='93000000-0000-4000-8000-000000000001'
join public.organization_members employee
  on employee.organization_id=project.organization_id
 and employee.user_id='93000000-0000-4000-8000-000000000002';

select is((select count(*) from public.task_notifications),4::bigint,'task inserts queue one notification each');
select set_config('test.notify.tenant',(select public_id::text from public.tenants where slug='notification-outbox-tenant'),true);
select set_config('test.notify.organization',(select public_id::text from public.organizations where slug='notification-outbox-org'),true);

select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select set_config('test.notify.claim_a',public.claim_task_notification_delivery_v2(
  current_setting('test.notify.tenant')::uuid,current_setting('test.notify.organization')::uuid,
  '93030000-0000-4000-8000-000000000001','93040000-0000-4000-8000-000000000001'
)::text,true);
reset role;
select is(current_setting('test.notify.claim_a')::jsonb->>'outcome','success','first delivery claim succeeds');
select is(current_setting('test.notify.claim_a')::jsonb->>'action','send','first delivery claim requests provider send');
select is(current_setting('test.notify.claim_a')::jsonb->>'providerRequestId','93040000-0000-4000-8000-000000000001','fresh attempt token is the provider UUID');
select isnt(current_setting('test.notify.claim_a')::jsonb->>'leaseToken','93040000-0000-4000-8000-000000000001','database assigns a lease token separate from the provider identity');
select is((current_setting('test.notify.claim_a')::jsonb->>'leaseGeneration')::integer,1,'fresh claim starts lease generation one');
select is((select count(*) from public.task_notification_delivery_attempts where attempt_token='93040000-0000-4000-8000-000000000001'),1::bigint,'claim is persisted before provider send');
select is((select attempt_count from public.task_notifications where public_id=(current_setting('test.notify.claim_a')::jsonb->>'notificationId')::uuid),1,'new claim increments attempt count once');
select set_config('test.notify.lease_a',current_setting('test.notify.claim_a')::jsonb->>'leaseToken',true);

select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select set_config('test.notify.concurrent',public.claim_task_notification_delivery_v2(
  current_setting('test.notify.tenant')::uuid,current_setting('test.notify.organization')::uuid,
  '93030000-0000-4000-8000-000000000001','93040000-0000-4000-8000-000000000099'
)::text,true);
reset role;
select is(current_setting('test.notify.concurrent')::jsonb->>'action','in_progress','an additional sequential claim cannot send during the active lease');
select is((select count(*) from public.task_notification_delivery_attempts where notification_id=(select id from public.task_notifications where public_id=(current_setting('test.notify.claim_a')::jsonb->>'notificationId')::uuid)),1::bigint,'active claim creates no second attempt');

update public.task_notification_delivery_attempts
set lease_expires_at=clock_timestamp()-interval '1 second'
where attempt_token='93040000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select set_config('test.notify.recovered',public.claim_task_notification_delivery_v2(
  current_setting('test.notify.tenant')::uuid,current_setting('test.notify.organization')::uuid,
  '93030000-0000-4000-8000-000000000001','93040000-0000-4000-8000-000000000001'
)::text,true);
reset role;
select is(current_setting('test.notify.recovered')::jsonb->>'attemptToken','93040000-0000-4000-8000-000000000001','recovery preserves the durable attempt identity');
select is(current_setting('test.notify.recovered')::jsonb->>'providerRequestId','93040000-0000-4000-8000-000000000001','recovery preserves the provider UUID');
select isnt(current_setting('test.notify.recovered')::jsonb->>'leaseToken',current_setting('test.notify.lease_a'),'recovery rotates the lease owner even when the caller reuses its attempt token');
select is((current_setting('test.notify.recovered')::jsonb->>'leaseGeneration')::integer,2,'recovery increments the lease generation');
select is((current_setting('test.notify.recovered')::jsonb->>'isFresh')::boolean,false,'recovered claim is not a new provider attempt');
select set_config('test.notify.recovered_lease',current_setting('test.notify.recovered')::jsonb->>'leaseToken',true);

select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select set_config('test.notify.stale_fail',public.fail_task_notification_delivery_v2(
  current_setting('test.notify.tenant')::uuid,current_setting('test.notify.organization')::uuid,
  (current_setting('test.notify.claim_a')::jsonb->>'notificationId')::uuid,
  '93040000-0000-4000-8000-000000000001',current_setting('test.notify.lease_a')::uuid,1,'send_failed'
)::text,true);
reset role;
select is(current_setting('test.notify.stale_fail')::jsonb->>'outcome','failure','expired worker cannot fail a recovered attempt');
select is(current_setting('test.notify.stale_fail')::jsonb->>'error','claim_conflict','stale lease owner is fenced');
select is((select state from public.task_notification_delivery_attempts where attempt_token='93040000-0000-4000-8000-000000000001'),'claimed','stale mutation leaves recovered attempt claimed');

select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select set_config('test.notify.accepted',public.record_task_notification_provider_acceptance_v2(
  current_setting('test.notify.tenant')::uuid,current_setting('test.notify.organization')::uuid,
  (current_setting('test.notify.claim_a')::jsonb->>'notificationId')::uuid,
  '93040000-0000-4000-8000-000000000001',current_setting('test.notify.recovered_lease')::uuid,2,
  '93040000-0000-4000-8000-000000000001','om_notification_a'
)::text,true);
reset role;
select is(current_setting('test.notify.accepted')::jsonb->>'state','provider_accepted','current lease records provider acceptance');
select ok(exists(
  select 1 from public.task_notifications
  where public_id=(current_setting('test.notify.claim_a')::jsonb->>'notificationId')::uuid
    and status='pending' and feishu_message_id='om_notification_a'
),'message ID persists before terminal completion');

select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select set_config('test.notify.accepted_active',public.claim_task_notification_delivery_v2(
  current_setting('test.notify.tenant')::uuid,current_setting('test.notify.organization')::uuid,
  '93030000-0000-4000-8000-000000000001','93040000-0000-4000-8000-000000000097'
)::text,true);
reset role;
select is(current_setting('test.notify.accepted_active')::jsonb->>'action','in_progress','accepted attempt remains owned until its lease expires');

update public.task_notification_delivery_attempts
set lease_expires_at=clock_timestamp()-interval '1 second'
where attempt_token='93040000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select set_config('test.notify.finalize_claim',public.claim_task_notification_delivery_v2(
  current_setting('test.notify.tenant')::uuid,current_setting('test.notify.organization')::uuid,
  '93030000-0000-4000-8000-000000000001','93040000-0000-4000-8000-000000000001'
)::text,true);
select set_config('test.notify.completed',public.complete_task_notification_delivery_v2(
  current_setting('test.notify.tenant')::uuid,current_setting('test.notify.organization')::uuid,
  (current_setting('test.notify.claim_a')::jsonb->>'notificationId')::uuid,
  '93040000-0000-4000-8000-000000000001',
  (current_setting('test.notify.finalize_claim')::jsonb->>'leaseToken')::uuid,3
)::text,true);
select set_config('test.notify.replay_complete',public.complete_task_notification_delivery_v2(
  current_setting('test.notify.tenant')::uuid,current_setting('test.notify.organization')::uuid,
  (current_setting('test.notify.claim_a')::jsonb->>'notificationId')::uuid,
  '93040000-0000-4000-8000-000000000001',current_setting('test.notify.recovered_lease')::uuid,2
)::text,true);
select set_config('test.notify.sent_claim',public.claim_task_notification_delivery_v2(
  current_setting('test.notify.tenant')::uuid,current_setting('test.notify.organization')::uuid,
  '93030000-0000-4000-8000-000000000001','93040000-0000-4000-8000-000000000096'
)::text,true);
reset role;
select is(current_setting('test.notify.finalize_claim')::jsonb->>'action','finalize','restart finalizes a persisted provider message without resending');
select isnt(current_setting('test.notify.finalize_claim')::jsonb->>'leaseToken',current_setting('test.notify.recovered_lease'),'finalizer owns a newly fenced lease');
select is((current_setting('test.notify.finalize_claim')::jsonb->>'leaseGeneration')::integer,3,'finalizer advances lease generation');
select is(current_setting('test.notify.completed')::jsonb->>'state','sent','accepted attempt completes');
select ok(exists(select 1 from public.task_notifications where public_id=(current_setting('test.notify.claim_a')::jsonb->>'notificationId')::uuid and status='sent' and sent_at is not null),'notification reaches terminal sent state');
select ok(exists(select 1 from public.task_notification_delivery_attempts where attempt_token='93040000-0000-4000-8000-000000000001' and state='sent'),'attempt transition reaches sent');
select is(current_setting('test.notify.replay_complete')::jsonb->>'state','sent','completion replay is idempotent after terminal sent');
select is(current_setting('test.notify.sent_claim')::jsonb->>'action','sent','sent notification never claims another provider attempt');
select is((select count(*) from public.task_notification_delivery_attempts where notification_id=(select id from public.task_notifications where public_id=(current_setting('test.notify.claim_a')::jsonb->>'notificationId')::uuid)),1::bigint,'sent replay creates no duplicate attempt');

select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select set_config('test.notify.claim_b',public.claim_task_notification_delivery_v2(
  current_setting('test.notify.tenant')::uuid,current_setting('test.notify.organization')::uuid,
  '93030000-0000-4000-8000-000000000002','93040000-0000-4000-8000-000000000002'
)::text,true);
select set_config('test.notify.lease_b',current_setting('test.notify.claim_b')::jsonb->>'leaseToken',true);
select set_config('test.notify.null_fail',public.fail_task_notification_delivery_v2(
  current_setting('test.notify.tenant')::uuid,current_setting('test.notify.organization')::uuid,
  (current_setting('test.notify.claim_b')::jsonb->>'notificationId')::uuid,
  '93040000-0000-4000-8000-000000000002',current_setting('test.notify.lease_b')::uuid,1,null
)::text,true);
select set_config('test.notify.failed_b',public.fail_task_notification_delivery_v2(
  current_setting('test.notify.tenant')::uuid,current_setting('test.notify.organization')::uuid,
  (current_setting('test.notify.claim_b')::jsonb->>'notificationId')::uuid,
  '93040000-0000-4000-8000-000000000002',current_setting('test.notify.lease_b')::uuid,1,'send_failed'
)::text,true);
select set_config('test.notify.retry_b',public.claim_task_notification_delivery_v2(
  current_setting('test.notify.tenant')::uuid,current_setting('test.notify.organization')::uuid,
  '93030000-0000-4000-8000-000000000002','93040000-0000-4000-8000-000000000012'
)::text,true);
reset role;
select is(current_setting('test.notify.claim_b')::jsonb->>'action','send','failure-path task first claims normally');
select is(current_setting('test.notify.null_fail')::jsonb->>'error','invalid_request','NULL error code is rejected');
select is(current_setting('test.notify.failed_b')::jsonb->>'state','failed','provider failure closes its exact lease');
select ok(exists(select 1 from public.task_notifications where public_id=(current_setting('test.notify.claim_b')::jsonb->>'notificationId')::uuid and status='pending'),'retry claim returns a failed notification to pending');
select is((current_setting('test.notify.retry_b')::jsonb->>'isFresh')::boolean,true,'retry after a confirmed failure gets a new provider UUID');
select is((select attempt_count from public.task_notifications where public_id=(current_setting('test.notify.claim_b')::jsonb->>'notificationId')::uuid),2,'confirmed failure retry increments attempt count');
select is(current_setting('test.notify.retry_b')::jsonb->>'providerRequestId','93040000-0000-4000-8000-000000000012','confirmed failure retry has an independent provider identity');

select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select set_config('test.notify.cross_tenant',public.claim_task_notification_delivery_v2(
  '93000000-0000-4000-8000-000000000099',current_setting('test.notify.organization')::uuid,
  '93030000-0000-4000-8000-000000000003','93040000-0000-4000-8000-000000000003'
)::text,true);
reset role;
select is(current_setting('test.notify.cross_tenant')::jsonb->>'outcome','failure','cross-tenant claim fails closed');
select is(current_setting('test.notify.cross_tenant')::jsonb->>'error','not_found','cross-tenant claim discloses no task context');
select is((select count(*) from public.task_notification_delivery_attempts attempt join public.task_notifications notification on notification.id=attempt.notification_id where notification.task_id=(select id from public.tasks where public_id='93030000-0000-4000-8000-000000000003')),0::bigint,'cross-tenant claim writes no attempt');

select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select set_config('test.notify.owner_auth',public.authorize_current_task_notification_retry(
  '93030000-0000-4000-8000-000000000001'
)::text,true);
reset role;
select is(current_setting('test.notify.owner_auth')::jsonb->>'outcome','success','project owner may retry its task notification');
select is(current_setting('test.notify.owner_auth')::jsonb->>'taskId','93030000-0000-4000-8000-000000000001','authorization returns only the verified task ID');

select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select set_config('test.notify.employee_auth',public.authorize_current_task_notification_retry(
  '93030000-0000-4000-8000-000000000001'
)::text,true);
reset role;
select is(current_setting('test.notify.employee_auth')::jsonb->>'outcome','failure','ordinary employee cannot retry an arbitrary project task');
select is(current_setting('test.notify.employee_auth')::jsonb->>'error','not_found','denied project authorization avoids task disclosure');

select * from finish();
rollback;
