begin;
select plan(120);

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
  not has_function_privilege('public','public.enqueue_task_assigned_notification()','EXECUTE')
  and not has_function_privilege('anon','public.enqueue_task_assigned_notification()','EXECUTE')
  and not has_function_privilege('authenticated','public.enqueue_task_assigned_notification()','EXECUTE')
  and not has_function_privilege('service_role','public.enqueue_task_assigned_notification()','EXECUTE'),
  'task assignment trigger function is not directly executable'
);
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
select ok(has_table('public','task_acceptance_events'),'append-only acceptance event ledger exists');
select ok(has_column('public','task_notifications','acceptance_event_id'),'notifications bind an immutable acceptance event');
select ok(
  not has_sequence_privilege('authenticated','public.task_notifications_id_seq','USAGE')
  and not has_sequence_privilege('service_role','public.task_acceptance_events_id_seq','SELECT'),
  'notification and acceptance identities are not exposed through sequences'
);
select ok(exists(
  select 1 from pg_constraint constraint_row
  where constraint_row.conrelid='public.task_notifications'::regclass
    and constraint_row.conname='task_notifications_acceptance_event_fkey'
    and pg_get_constraintdef(constraint_row.oid) like 'FOREIGN KEY (tenant_id, organization_id, task_id, acceptance_event_id)%'
),'notification acceptance evidence is constrained to the same task');
select ok(has_function('public','retry_current_task_notification',array['uuid','bigint','text','uuid','uuid']::name[]),'versioned notification retry RPC exists');
select ok(has_function('public','current_task_notification_inbox',array[]::name[]),'recipient notification inbox RPC exists');
select ok(has_function('public','claim_task_notification_event_delivery_v3',array['uuid','uuid','uuid','uuid']::name[]),'event snapshot delivery claim exists');
select ok(has_function('public','due_task_notifications_for_delivery',array['integer']::name[]),'due notification recovery enumeration exists');
select ok(
  has_function_privilege('authenticated','public.retry_current_task_notification(uuid,bigint,text,uuid,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.retry_current_task_notification(uuid,bigint,text,uuid,uuid)','EXECUTE'),
  'notification retry is authenticated-only'
);
select ok(
  has_function_privilege('service_role','public.due_task_notifications_for_delivery(integer)','EXECUTE')
  and not has_function_privilege('authenticated','public.due_task_notifications_for_delivery(integer)','EXECUTE'),
  'only the recovery service can enumerate due notifications'
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
       case member.user_id
         when '93000000-0000-4000-8000-000000000001' then 'open_id:ou_notification_owner'
         else 'open_id:ou_notification_employee'
       end,provider.provider_tenant_key,member.user_id,'active'
from public.organization_members member
join public.identity_providers provider on provider.tenant_id=member.tenant_id
where member.user_id in (
  '93000000-0000-4000-8000-000000000001',
  '93000000-0000-4000-8000-000000000002'
);

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

select set_config('quantxy.explicit_project_member_mutation','on',true);
insert into public.project_members(
  tenant_id,organization_id,project_id,member_id,role,allocation_percent,
  created_by_member_id,updated_by_member_id,version
)
select project.tenant_id,project.organization_id,project.id,member.id,
       case when member.id=project.owner_member_id then 'owner' else 'member' end,
       100,
       project.owner_member_id,project.owner_member_id,1
from public.projects project
join public.organization_members member
  on member.tenant_id=project.tenant_id
 and member.organization_id=project.organization_id
where project.public_id='93020000-0000-4000-8000-000000000001';
select set_config('quantxy.explicit_project_member_mutation','off',true);

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
select is((select membership.version from public.project_members membership
  join public.projects project on project.id=membership.project_id
  join public.organization_members member on member.id=membership.member_id
  where project.public_id='93020000-0000-4000-8000-000000000001'
    and member.user_id='93000000-0000-4000-8000-000000000002'),1::bigint,'task creation leaves explicit contributor membership unchanged');
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
    and status='sending' and feishu_message_id='om_notification_a'
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
reset role;
select is(current_setting('test.notify.claim_b')::jsonb->>'action','send','failure-path task first claims normally');
select is(current_setting('test.notify.null_fail')::jsonb->>'error','invalid_request','NULL error code is rejected');
select is(current_setting('test.notify.failed_b')::jsonb->>'state','failed','provider failure closes its exact lease');
select ok(exists(select 1 from public.task_notifications
  where public_id=(current_setting('test.notify.claim_b')::jsonb->>'notificationId')::uuid
    and status='failed' and next_retry_at is not null),'confirmed failure persists a due retry schedule');

select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select set_config('test.notify.authorized_retry_b',public.retry_current_task_notification(
  (current_setting('test.notify.claim_b')::jsonb->>'notificationId')::uuid,
  (select version from public.task_notifications where public_id=(current_setting('test.notify.claim_b')::jsonb->>'notificationId')::uuid),
  'Recipient mapping corrected','93050000-0000-4000-8000-000000000001','93050000-0000-4000-8000-000000000002'
)::text,true);
reset role;
select is(current_setting('test.notify.authorized_retry_b')::jsonb->>'outcome','success','project owner authorizes a failed delivery retry');
select is(current_setting('test.notify.authorized_retry_b')::jsonb#>>'{entity,state}','pending','authorized retry returns the durable row to pending');

select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select set_config('test.notify.retry_b',public.claim_task_notification_delivery_v2(
  current_setting('test.notify.tenant')::uuid,current_setting('test.notify.organization')::uuid,
  '93030000-0000-4000-8000-000000000002','93040000-0000-4000-8000-000000000012'
)::text,true);
reset role;
select is((current_setting('test.notify.retry_b')::jsonb->>'isFresh')::boolean,true,'retry after a confirmed failure gets a new provider UUID');
select is((select attempt_count from public.task_notifications where public_id=(current_setting('test.notify.claim_b')::jsonb->>'notificationId')::uuid),1,'manual retry starts a fresh bounded delivery cycle');
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

select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select is((select count(*) from public.task_notifications),4::bigint,'recipient RLS exposes only the employee notifications');
select is((select bool_or(can_retry) from public.current_task_notification_inbox()),false,'inbox retry capability comes from project ACL');
select set_config('test.notify.marked_read',public.mark_current_task_notification_read(
  (current_setting('test.notify.claim_a')::jsonb->>'notificationId')::uuid,
  '93050000-0000-4000-8000-000000000003'
)::text,true);
select set_config('test.notify.task_claim',public.transition_current_task(
  '93030000-0000-4000-8000-000000000001','claim',1,'{}'::jsonb,
  '93050000-0000-4000-8000-000000000004'
)::text,true);
select set_config('test.notify.task_submit',public.transition_current_task(
  '93030000-0000-4000-8000-000000000001','submit',2,
  jsonb_build_object('resultText','Verified delivery','resultLink','https://example.test/evidence','resultFiles','[]'::jsonb),
  '93050000-0000-4000-8000-000000000005'
)::text,true);
reset role;
select is(current_setting('test.notify.marked_read')::jsonb->>'state','read','recipient can mark only a sent notification read');
select ok((select read_at is not null and read_by_member_id=recipient_member_id
  from public.task_notifications where public_id=(current_setting('test.notify.claim_a')::jsonb->>'notificationId')::uuid),'read evidence binds the exact recipient');
select is(current_setting('test.notify.task_claim')::jsonb->>'outcome','success','assignee claims the task before submission');
select is(current_setting('test.notify.task_submit')::jsonb->>'outcome','success','assignee submits link-backed acceptance evidence');
select is((select count(*) from public.task_acceptance_events where task_id=(select id from public.tasks where public_id='93030000-0000-4000-8000-000000000001')),1::bigint,'submission appends one acceptance event');
select ok((select note is null from public.task_acceptance_events where task_id=(select id from public.tasks where public_id='93030000-0000-4000-8000-000000000001')),'submitted event never copies an earlier review note');
select is((select request_id from public.task_acceptance_events where task_id=(select id from public.tasks where public_id='93030000-0000-4000-8000-000000000001')),'93050000-0000-4000-8000-000000000005'::uuid,'acceptance event retains the originating task request ID');
select ok(exists(select 1 from public.task_notifications notification
  join public.task_acceptance_events event on event.id=notification.acceptance_event_id
  where event.task_id=(select id from public.tasks where public_id='93030000-0000-4000-8000-000000000001')
    and notification.event_type='task.submitted'),'queued transition notification references its immutable acceptance event');
select set_config('test.notify.submitted_notification_id',(
  select notification.public_id::text from public.task_notifications notification
  where notification.task_id=(select id from public.tasks where public_id='93030000-0000-4000-8000-000000000001')
    and notification.event_type='task.submitted'
),true);
update public.employee_profiles set display_name='Notification employee renamed'
where public_id='93010000-0000-4000-8000-000000000002';
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select set_config('test.notify.submitted_pending',public.pending_task_notification_events_for_delivery(
  current_setting('test.notify.tenant')::uuid,current_setting('test.notify.organization')::uuid,
  '93030000-0000-4000-8000-000000000001'
)::text,true);
select set_config('test.notify.submitted_claim',public.claim_task_notification_event_delivery_v3(
  current_setting('test.notify.tenant')::uuid,current_setting('test.notify.organization')::uuid,
  current_setting('test.notify.submitted_notification_id')::uuid,
  '93040000-0000-4000-8000-000000000020'
)::text,true);
select set_config('test.notify.submitted_fail',public.fail_task_notification_delivery_v2(
  current_setting('test.notify.tenant')::uuid,current_setting('test.notify.organization')::uuid,
  current_setting('test.notify.submitted_notification_id')::uuid,
  (current_setting('test.notify.submitted_claim')::jsonb->>'attemptToken')::uuid,
  (current_setting('test.notify.submitted_claim')::jsonb->>'leaseToken')::uuid,
  (current_setting('test.notify.submitted_claim')::jsonb->>'leaseGeneration')::integer,'send_failed'
)::text,true);
reset role;
select ok((current_setting('test.notify.submitted_pending')::jsonb->'notificationIds')
  @> jsonb_build_array(current_setting('test.notify.submitted_notification_id')::uuid),'pending event enumeration returns the submitted acceptance notification');
select is(current_setting('test.notify.submitted_claim')::jsonb->>'action','send','non-assigned acceptance notification enters the fenced send branch');
select is(current_setting('test.notify.submitted_claim')::jsonb->>'actorName','Notification employee','delivery uses the immutable actor name captured before a later profile rename');
select is(current_setting('test.notify.submitted_fail')::jsonb->>'state','failed','acceptance-event delivery can close through the shared failure state machine');
select throws_ok(
  $$update public.task_acceptance_events set note='tampered' where task_id=(select id from public.tasks where public_id='93030000-0000-4000-8000-000000000001')$$,
  '42501','task acceptance history is append-only','acceptance evidence rejects mutation'
);

update public.external_identities set status='revoked'
where auth_user_id='93000000-0000-4000-8000-000000000002';
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select set_config('test.notify.missing_open_id_claim',public.claim_task_notification_delivery_v2(
  current_setting('test.notify.tenant')::uuid,current_setting('test.notify.organization')::uuid,
  '93030000-0000-4000-8000-000000000004','93040000-0000-4000-8000-000000000021'
)::text,true);
select set_config('test.notify.missing_open_id_fail',public.fail_task_notification_delivery_v2(
  current_setting('test.notify.tenant')::uuid,current_setting('test.notify.organization')::uuid,
  (current_setting('test.notify.missing_open_id_claim')::jsonb->>'notificationId')::uuid,
  (current_setting('test.notify.missing_open_id_claim')::jsonb->>'attemptToken')::uuid,
  (current_setting('test.notify.missing_open_id_claim')::jsonb->>'leaseToken')::uuid,
  (current_setting('test.notify.missing_open_id_claim')::jsonb->>'leaseGeneration')::integer,'recipient_unavailable'
)::text,true);
reset role;
update public.external_identities set status='active'
where auth_user_id='93000000-0000-4000-8000-000000000002';
select is(current_setting('test.notify.missing_open_id_claim')::jsonb->>'action','send','missing Feishu open ID still creates a fenced delivery attempt');
select is(current_setting('test.notify.missing_open_id_claim')::jsonb->'recipientOpenId','null'::jsonb,'missing Feishu open ID is returned explicitly for dispatcher failure handling');
select is(current_setting('test.notify.missing_open_id_fail')::jsonb->>'state','failed','dispatcher can durably close a missing-recipient attempt instead of leaving it pending');

select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select is((select count(*) from public.task_notifications),1::bigint,'non-recipient owner sees only the submitted notification addressed to them');
select is((select actor_name from public.current_task_acceptance_history('93020000-0000-4000-8000-000000000001') limit 1),'Notification employee','acceptance history remains visible with the immutable actor name after a directory rename');
select set_config('test.notify.viewer_downgrade',public.mutate_current_project_member(
  '93020000-0000-4000-8000-000000000001','93010000-0000-4000-8000-000000000002',
  'change_role','viewer',0,1,1,'Do not strand active work',
  '93050000-0000-4000-8000-000000000006','93050000-0000-4000-8000-000000000007'
)::text,true);
select set_config('test.notify.archive_blocked',public.archive_current_project_v2(
  '93020000-0000-4000-8000-000000000001',1,'Check active delivery lease',
  '93050000-0000-4000-8000-000000000008','93050000-0000-4000-8000-000000000009'
)::text,true);
reset role;
select is(current_setting('test.notify.viewer_downgrade')::jsonb->>'outcome','failure','viewer downgrade is rejected while responsibilities are active');
select is(current_setting('test.notify.viewer_downgrade')::jsonb->>'error','conflict','active responsibility downgrade returns a stable conflict');
select is(current_setting('test.notify.archive_blocked')::jsonb->>'outcome','failure','archive cannot cross an active delivery attempt');
select is(current_setting('test.notify.archive_blocked')::jsonb->>'error','conflict','active delivery archive race is fenced as conflict');

select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select set_config('test.notify.closed_retry_b',public.fail_task_notification_delivery_v2(
  current_setting('test.notify.tenant')::uuid,current_setting('test.notify.organization')::uuid,
  (current_setting('test.notify.claim_b')::jsonb->>'notificationId')::uuid,
  '93040000-0000-4000-8000-000000000012',
  (current_setting('test.notify.retry_b')::jsonb->>'leaseToken')::uuid,
  (current_setting('test.notify.retry_b')::jsonb->>'leaseGeneration')::integer,'send_failed'
)::text,true);
reset role;
select is(current_setting('test.notify.closed_retry_b')::jsonb->>'state','failed','active retry attempt is explicitly closed before archive');

select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select set_config('test.notify.failed_marked_read',public.mark_current_task_notification_read(
  (current_setting('test.notify.claim_b')::jsonb->>'notificationId')::uuid,
  '93050000-0000-4000-8000-000000000014'
)::text,true);
select ok((select can_retry from public.current_task_notification_inbox()
  where notification_public_id=(current_setting('test.notify.claim_b')::jsonb->>'notificationId')::uuid),'failed notification recipient can request a safe redelivery from the visible inbox');
reset role;
select is(current_setting('test.notify.failed_marked_read')::jsonb->>'state','read','recipient can acknowledge a terminal failed notification');
select ok((select status='failed' and read_at is not null and read_by_member_id=recipient_member_id
  from public.task_notifications where public_id=(current_setting('test.notify.claim_b')::jsonb->>'notificationId')::uuid),'failed notification retains delivery truth and records read evidence');

select set_config('quantxy.explicit_project_member_mutation','on',true);
update public.project_members membership set left_at=clock_timestamp()
from public.projects project,public.organization_members member
where membership.project_id=project.id and membership.member_id=member.id
  and project.public_id='93020000-0000-4000-8000-000000000001'
  and member.user_id='93000000-0000-4000-8000-000000000002';
select set_config('quantxy.explicit_project_member_mutation','off',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select set_config('test.notify.removed_recipient_retry',public.retry_current_task_notification(
  (current_setting('test.notify.claim_b')::jsonb->>'notificationId')::uuid,
  (current_setting('test.notify.failed_marked_read')::jsonb->>'version')::bigint,
  'Removed recipient must not reopen delivery',
  '93050000-0000-4000-8000-000000000022','93050000-0000-4000-8000-000000000023'
)::text,true);
reset role;
select is(current_setting('test.notify.removed_recipient_retry')::jsonb->>'error','forbidden','removed recipient cannot manually reopen a failed notification');
select ok((select status='failed' and read_at is not null from public.task_notifications
  where public_id=(current_setting('test.notify.claim_b')::jsonb->>'notificationId')::uuid),'removed recipient denial leaves notification state unchanged');
select set_config('quantxy.explicit_project_member_mutation','on',true);
update public.project_members membership set left_at=null
from public.projects project,public.organization_members member
where membership.project_id=project.id and membership.member_id=member.id
  and project.public_id='93020000-0000-4000-8000-000000000001'
  and member.user_id='93000000-0000-4000-8000-000000000002';
select set_config('quantxy.explicit_project_member_mutation','off',true);

create or replace function public.test_notification_retry_failure()
returns trigger language plpgsql set search_path='' as $$
begin
  if current_setting('test.notify.retry_failure',true)='on'
     and old.status='failed' and new.status='pending' then
    raise exception 'injected_notification_retry_failure';
  end if;
  return new;
end;
$$;
create trigger test_notification_retry_failure before update on public.task_notifications
for each row execute function public.test_notification_retry_failure();
select set_config('test.notify.retry_failure','on',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select set_config('test.notify.retry_failure_result',public.retry_current_task_notification(
  (current_setting('test.notify.claim_b')::jsonb->>'notificationId')::uuid,
  (current_setting('test.notify.failed_marked_read')::jsonb->>'version')::bigint,
  'Retry atomicity proof','93050000-0000-4000-8000-000000000024',
  '93050000-0000-4000-8000-000000000025'
)::text,true);
reset role;
select set_config('test.notify.retry_failure','off',true);
select is(current_setting('test.notify.retry_failure_result')::jsonb->>'error','command_failed','retry write failure returns a stable sanitized result');
select ok((select status='failed' and read_at is not null
  and version=(current_setting('test.notify.failed_marked_read')::jsonb->>'version')::bigint
  from public.task_notifications where public_id=(current_setting('test.notify.claim_b')::jsonb->>'notificationId')::uuid),'failed retry rolls back every notification mutation');
select ok(exists(select 1 from public.audit_logs where request_id='93050000-0000-4000-8000-000000000024'
  and action='project.execution_failed' and metadata->>'failure'='command_failed'),'failed retry leaves durable sanitized audit evidence');
drop trigger test_notification_retry_failure on public.task_notifications;
drop function public.test_notification_retry_failure();

select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select set_config('test.notify.failed_read_retry',public.retry_current_task_notification(
  (current_setting('test.notify.claim_b')::jsonb->>'notificationId')::uuid,
  (current_setting('test.notify.failed_marked_read')::jsonb->>'version')::bigint,
  'Retry after recipient acknowledgement',
  '93050000-0000-4000-8000-000000000015','93050000-0000-4000-8000-000000000016'
)::text,true);
reset role;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select set_config('test.notify.archived',public.archive_current_project_v2(
  '93020000-0000-4000-8000-000000000001',1,'Commercial archive verification',
  '93050000-0000-4000-8000-000000000010','93050000-0000-4000-8000-000000000011'
)::text,true);
select set_config('test.notify.archive_replay',public.archive_current_project_v2(
  '93020000-0000-4000-8000-000000000001',1,'Commercial archive verification',
  '93050000-0000-4000-8000-000000000010','93050000-0000-4000-8000-000000000011'
)::text,true);
select set_config('test.notify.restored',public.restore_current_project(
  '93020000-0000-4000-8000-000000000001',2,null,'Resume commercial delivery',
  '93050000-0000-4000-8000-000000000012','93050000-0000-4000-8000-000000000013'
)::text,true);
select set_config('test.notify.restore_replay',public.restore_current_project(
  '93020000-0000-4000-8000-000000000001',2,null,'Resume commercial delivery',
  '93050000-0000-4000-8000-000000000012','93050000-0000-4000-8000-000000000013'
)::text,true);
select set_config('test.notify.reopen_c',public.retry_current_task_notification(
  (select notification.public_id from public.task_notifications notification
    join public.tasks task on task.id=notification.task_id
    where task.public_id='93030000-0000-4000-8000-000000000003'
      and notification.event_type='task.assigned'),
  (select notification.version from public.task_notifications notification
    join public.tasks task on task.id=notification.task_id
    where task.public_id='93030000-0000-4000-8000-000000000003'
      and notification.event_type='task.assigned'),
  'Explicitly resume notification after project restore',
  '93050000-0000-4000-8000-000000000026','93050000-0000-4000-8000-000000000027'
)::text,true);
reset role;
select is(current_setting('test.notify.failed_read_retry')::jsonb#>>'{entity,state}','pending','authorized retry reopens an acknowledged failed notification');
select ok((select read_at is null and read_by_member_id is null
  from public.task_notifications where public_id=(current_setting('test.notify.claim_b')::jsonb->>'notificationId')::uuid),'retry atomically clears prior read evidence');
select is((select attempt_count from public.task_notifications
  where public_id=(current_setting('test.notify.claim_b')::jsonb->>'notificationId')::uuid),0,'authorized manual retry opens a fresh bounded delivery cycle');
select is(current_setting('test.notify.archived')::jsonb->>'outcome','success','archive succeeds after every provider attempt is terminal');
select is(current_setting('test.notify.archive_replay')::jsonb,current_setting('test.notify.archived')::jsonb,'archive replay survives the archived project visibility boundary');
select is(current_setting('test.notify.archived')::jsonb#>>'{entity,statusBeforeArchive}','active','archive retains the real pre-archive status');
select is(current_setting('test.notify.restored')::jsonb->>'outcome','success','owner restores an archived project');
select is(current_setting('test.notify.restored')::jsonb#>>'{entity,status}','active','restore uses the retained non-legacy status');
select is(current_setting('test.notify.restore_replay')::jsonb,current_setting('test.notify.restored')::jsonb,'restore command replay returns the same canonical result');
select is(current_setting('test.notify.reopen_c')::jsonb#>>'{entity,state}','pending','restored project notification requires and accepts an explicit authorized retry');

select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select set_config('test.notify.claim_c',public.claim_task_notification_delivery_v2(
  current_setting('test.notify.tenant')::uuid,current_setting('test.notify.organization')::uuid,
  '93030000-0000-4000-8000-000000000003','93040000-0000-4000-8000-000000000013'
)::text,true);
reset role;
update public.task_notification_delivery_attempts attempt
set lease_expires_at=clock_timestamp()-interval '1 second'
where attempt.attempt_token='93040000-0000-4000-8000-000000000013';
update public.task_notifications notification
set attempt_count=5
where notification.public_id=(current_setting('test.notify.claim_c')::jsonb->>'notificationId')::uuid;
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select set_config('test.notify.due_c_count',(
  select count(*)::text from public.due_task_notifications_for_delivery(50) due
  where due.notification_public_id=(current_setting('test.notify.claim_c')::jsonb->>'notificationId')::uuid
),true);
select set_config('test.notify.recovered_c',public.claim_task_notification_event_delivery_v3(
  current_setting('test.notify.tenant')::uuid,current_setting('test.notify.organization')::uuid,
  (current_setting('test.notify.claim_c')::jsonb->>'notificationId')::uuid,
  '93040000-0000-4000-8000-000000000014'
)::text,true);
select public.fail_task_notification_delivery_v2(
  current_setting('test.notify.tenant')::uuid,current_setting('test.notify.organization')::uuid,
  (current_setting('test.notify.claim_c')::jsonb->>'notificationId')::uuid,
  (current_setting('test.notify.recovered_c')::jsonb->>'attemptToken')::uuid,
  (current_setting('test.notify.recovered_c')::jsonb->>'leaseToken')::uuid,
  (current_setting('test.notify.recovered_c')::jsonb->>'leaseGeneration')::integer,'send_failed'
);
reset role;
select is(current_setting('test.notify.due_c_count')::integer,1,'fifth expired sending attempt remains visible to automatic recovery');
select is(current_setting('test.notify.recovered_c')::jsonb->>'action','send','expired capped attempt resumes its existing provider send');
select is((current_setting('test.notify.recovered_c')::jsonb->>'isFresh')::boolean,false,'capped recovery never creates a new provider identity');
select is((current_setting('test.notify.recovered_c')::jsonb->>'providerRequestId'),'93040000-0000-4000-8000-000000000013','capped recovery preserves the original provider UUID');

select * from finish();
rollback;
