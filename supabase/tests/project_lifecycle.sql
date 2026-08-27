begin;
select plan(52);

select ok(has_column('public','projects','tenant_id'),'projects carry tenant ownership');
select ok(has_column('public','projects','budget_amount'),'projects persist fixed-precision budget');
select ok(has_column('public','projects','version'),'projects carry optimistic version');
select ok(has_column('public','projects','updated_by_member_id'),'projects carry the last updater');
select ok(has_column('public','projects','archived_at'),'projects carry archive state');
select ok(has_column('public','project_members','tenant_id'),'project memberships carry tenant ownership');
select ok(has_table('public','project_command_idempotency'),'project command ledger exists');
select ok(has_function('public','create_current_project_v2',array['text','text','text','uuid','numeric','text','text','date','date','bigint','text','uuid','uuid']::name[]),'transactional project create exists');
select ok(has_function('public','update_current_project',array['uuid','text','text','text','uuid','numeric','text','date','date','bigint','text','uuid','uuid']::name[]),'versioned project update exists');
select ok(has_function('public','archive_current_project',array['uuid','bigint','text','uuid','uuid']::name[]),'versioned project archive exists');
select ok(has_function('public','create_current_project_task_v2',array['uuid','text','text','bigint','date','text','text']::name[]),'existing task create remains compatible');
select ok(
  has_function_privilege('authenticated','public.create_current_project_v2(text,text,text,uuid,numeric,text,text,date,date,bigint,text,uuid,uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.update_current_project(uuid,text,text,text,uuid,numeric,text,date,date,bigint,text,uuid,uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.archive_current_project(uuid,bigint,text,uuid,uuid)','EXECUTE'),
  'authenticated users can enter only the controlled lifecycle commands'
);
select ok(
  not has_function_privilege('service_role','public.create_current_project_v2(text,text,text,uuid,numeric,text,text,date,date,bigint,text,uuid,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.create_current_project(text,text,bigint,bigint[],text,text,date,date)','EXECUTE'),
  'service and legacy create bypasses are closed'
);
select ok(
  not exists (
    select 1
    from unnest(array['anon','authenticated','service_role']) as roles(role_name)
    cross join unnest(array['public.projects','public.project_members']) as tables(table_name)
    cross join unnest(array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) as privileges(privilege_name)
    where has_table_privilege(role_name,table_name,privilege_name)
  )
  and not exists (
    select 1
    from unnest(array['anon','authenticated','service_role']) as roles(role_name)
    cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) as privileges(privilege_name)
    where has_table_privilege(role_name,'public.project_command_idempotency',privilege_name)
  ),
  'browser and bypass roles cannot directly mutate lifecycle tables or access the command ledger'
);
select ok(
  (select relforcerowsecurity from pg_class where oid='public.projects'::regclass)
  and (select relforcerowsecurity from pg_class where oid='public.project_members'::regclass)
  and (select relforcerowsecurity from pg_class where oid='public.project_command_idempotency'::regclass),
  'all project lifecycle tables force row level security'
);

insert into public.tenants(name,slug,status) values
  ('Project lifecycle A','project-lifecycle-a','active'),
  ('Project lifecycle B','project-lifecycle-b','active');
insert into public.organizations(tenant_id,name,slug)
select tenant.id,seed.name,seed.slug
from public.tenants tenant
join (values
  ('project-lifecycle-a','Project lifecycle A','project-lifecycle-org-a'),
  ('project-lifecycle-b','Project lifecycle B','project-lifecycle-org-b')
) seed(tenant_slug,name,slug) on seed.tenant_slug=tenant.slug;
insert into public.identity_providers(tenant_id,provider_code,auth_provider,provider_tenant_key,display_name,status)
select id,'projectlifecycle','custom:projectlifecycle',slug||'-key','Project lifecycle identity','active'
from public.tenants where slug like 'project-lifecycle-%';
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
  ('00000000-0000-0000-0000-000000000000','83000000-0000-4000-8000-000000000001','authenticated','authenticated','project-manager-a@example.test',crypt('local-e2e-password',gen_salt('bf')),now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','83000000-0000-4000-8000-000000000002','authenticated','authenticated','project-owner-a@example.test',crypt('local-e2e-password',gen_salt('bf')),now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','83000000-0000-4000-8000-000000000003','authenticated','authenticated','project-owner-next@example.test',crypt('local-e2e-password',gen_salt('bf')),now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','83000000-0000-4000-8000-000000000004','authenticated','authenticated','project-manager-b@example.test',crypt('local-e2e-password',gen_salt('bf')),now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','83000000-0000-4000-8000-000000000006','authenticated','authenticated','project-assignee-a@example.test',crypt('local-e2e-password',gen_salt('bf')),now(),'{}','{}',now(),now());
insert into public.organization_members(tenant_id,organization_id,user_id,status)
select tenant.id,organization.id,seed.user_id,'active'
from (values
  ('project-lifecycle-a','project-lifecycle-org-a','83000000-0000-4000-8000-000000000001'::uuid),
  ('project-lifecycle-a','project-lifecycle-org-a','83000000-0000-4000-8000-000000000002'::uuid),
  ('project-lifecycle-a','project-lifecycle-org-a','83000000-0000-4000-8000-000000000003'::uuid),
  ('project-lifecycle-b','project-lifecycle-org-b','83000000-0000-4000-8000-000000000004'::uuid),
  ('project-lifecycle-a','project-lifecycle-org-a','83000000-0000-4000-8000-000000000006'::uuid)
) seed(tenant_slug,organization_slug,user_id)
join public.tenants tenant on tenant.slug=seed.tenant_slug
join public.organizations organization on organization.tenant_id=tenant.id and organization.slug=seed.organization_slug;
insert into public.employee_profiles(
  public_id,tenant_id,organization_id,organization_member_id,employee_no,display_name,
  job_title,employment_status,skills
)
select seed.public_id,member.tenant_id,member.organization_id,member.id,
       'PROJECT-'||member.id,seed.display_name,'Project delivery','active','{}'::text[]
from (values
  ('83000000-0000-4000-8000-000000000001'::uuid,'84000000-0000-4000-8000-000000000001'::uuid,'Manager A'),
  ('83000000-0000-4000-8000-000000000002'::uuid,'84000000-0000-4000-8000-000000000002'::uuid,'Owner A'),
  ('83000000-0000-4000-8000-000000000003'::uuid,'84000000-0000-4000-8000-000000000003'::uuid,'Owner next'),
  ('83000000-0000-4000-8000-000000000004'::uuid,'84000000-0000-4000-8000-000000000004'::uuid,'Manager B'),
  ('83000000-0000-4000-8000-000000000006'::uuid,'84000000-0000-4000-8000-000000000006'::uuid,'Assignee A')
) seed(user_id,public_id,display_name)
join public.organization_members member on member.user_id=seed.user_id;
insert into public.external_identities(
  tenant_id,organization_id,organization_member_id,identity_provider_id,
  provider_subject,provider_tenant_key,auth_user_id,status
)
select member.tenant_id,member.organization_id,member.id,provider.id,member.user_id::text,
       provider.provider_tenant_key,member.user_id,'active'
from public.organization_members member
join public.identity_providers provider on provider.tenant_id=member.tenant_id and provider.provider_code='projectlifecycle';
insert into public.roles(tenant_id,organization_id,code,name,description,is_system,is_enabled)
select tenant.id,organization.id,'project_lifecycle_manager','Project manager','Project lifecycle manager',false,true
from public.tenants tenant join public.organizations organization on organization.tenant_id=tenant.id
where tenant.slug like 'project-lifecycle-%';
insert into public.member_roles(tenant_id,member_id,role_id,assignment_source)
select member.tenant_id,member.id,role.id,'manual'
from public.organization_members member
join public.roles role on role.tenant_id=member.tenant_id and role.organization_id=member.organization_id
where member.user_id in (
  '83000000-0000-4000-8000-000000000001'::uuid,
  '83000000-0000-4000-8000-000000000004'::uuid
);
insert into public.role_permissions(tenant_id,role_id,permission_id)
select role.tenant_id,role.id,permission.id
from public.roles role join public.permissions permission on permission.code='project.manage'
where role.code='project_lifecycle_manager';

-- A second organization in the same tenant proves the tenant-scoped idempotency
-- key cannot be replayed across organizations.
insert into public.organizations(tenant_id,name,slug)
select id,'Project lifecycle A second','project-lifecycle-org-a-second'
from public.tenants where slug='project-lifecycle-a';
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
  ('00000000-0000-0000-0000-000000000000','83000000-0000-4000-8000-000000000005','authenticated','authenticated','project-manager-a-second@example.test',crypt('local-e2e-password',gen_salt('bf')),now(),'{}','{}',now(),now());
insert into public.organization_members(tenant_id,organization_id,user_id,status)
select tenant.id,organization.id,'83000000-0000-4000-8000-000000000005','active'
from public.tenants tenant join public.organizations organization
  on organization.tenant_id=tenant.id and organization.slug='project-lifecycle-org-a-second'
where tenant.slug='project-lifecycle-a';
insert into public.employee_profiles(
  public_id,tenant_id,organization_id,organization_member_id,employee_no,display_name,
  job_title,employment_status,skills
)
select '84000000-0000-4000-8000-000000000005',member.tenant_id,member.organization_id,member.id,
       'PROJECT-'||member.id,'Manager A second','Project delivery','active','{}'::text[]
from public.organization_members member where member.user_id='83000000-0000-4000-8000-000000000005';
insert into public.external_identities(
  tenant_id,organization_id,organization_member_id,identity_provider_id,
  provider_subject,provider_tenant_key,auth_user_id,status
)
select member.tenant_id,member.organization_id,member.id,provider.id,member.user_id::text,
       provider.provider_tenant_key,member.user_id,'active'
from public.organization_members member join public.identity_providers provider
  on provider.tenant_id=member.tenant_id and provider.provider_code='projectlifecycle'
where member.user_id='83000000-0000-4000-8000-000000000005';
insert into public.roles(tenant_id,organization_id,code,name,description,is_system,is_enabled)
select tenant.id,organization.id,'project_lifecycle_manager_a_second','Project manager A second','Project lifecycle manager',false,true
from public.tenants tenant join public.organizations organization
  on organization.tenant_id=tenant.id and organization.slug='project-lifecycle-org-a-second'
where tenant.slug='project-lifecycle-a';
insert into public.member_roles(tenant_id,member_id,role_id,assignment_source)
select member.tenant_id,member.id,role.id,'manual'
from public.organization_members member join public.roles role
  on role.tenant_id=member.tenant_id and role.organization_id=member.organization_id
where member.user_id='83000000-0000-4000-8000-000000000005'
  and role.code='project_lifecycle_manager_a_second';
insert into public.role_permissions(tenant_id,role_id,permission_id)
select role.tenant_id,role.id,permission.id
from public.roles role join public.permissions permission on permission.code='project.manage'
where role.code='project_lifecycle_manager_a_second';

select set_config('request.jwt.claim.sub','83000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select set_config('test.project.lifecycle.create_result',public.create_current_project_v2(
  'Commercial project','Atomic project creation','Delivery',
  '84000000-0000-4000-8000-000000000002',125000.25,'active','high',
  '2026-09-01','2026-09-30',0,'Create delivery project',
  '85000000-0000-4000-8000-000000000001','85000000-0000-4000-8000-000000000002'
)::text,true);
reset role;

select is((current_setting('test.project.lifecycle.create_result')::jsonb->>'outcome'),'success','authorized create succeeds');
select is((current_setting('test.project.lifecycle.create_result')::jsonb->>'version')::bigint,1::bigint,'new project starts at version one');
select set_config('test.project.lifecycle.project_id',current_setting('test.project.lifecycle.create_result')::jsonb->>'id',true);
select is((select count(*) from public.projects where public_id=current_setting('test.project.lifecycle.project_id')::uuid),1::bigint,'one real project row persists');
select is((select budget_amount from public.projects where public_id=current_setting('test.project.lifecycle.project_id')::uuid),125000.25::numeric,'budget retains exact numeric precision');
select is((select count(*) from public.project_members membership join public.projects project on project.id=membership.project_id where project.public_id=current_setting('test.project.lifecycle.project_id')::uuid),2::bigint,'owner and creator memberships commit atomically');
select ok(exists(select 1 from public.audit_logs where request_id='85000000-0000-4000-8000-000000000001' and action='project.created' and metadata->>'outcome'='success'),'successful create is audited with request evidence');

select set_config('request.jwt.claim.sub','83000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select set_config('test.project.lifecycle.replay_result',public.create_current_project_v2(
  'Changed retry payload','Must replay','Changed',
  '84000000-0000-4000-8000-000000000003',1.00,'planning','low',
  '2026-10-01','2026-10-02',0,'Retry delivery project',
  '85000000-0000-4000-8000-000000000003','85000000-0000-4000-8000-000000000002'
)::text,true);
reset role;
select is(current_setting('test.project.lifecycle.replay_result')::jsonb->>'id',current_setting('test.project.lifecycle.project_id'),'same idempotency key replays the original entity');
select is(current_setting('test.project.lifecycle.replay_result')::jsonb#>>'{project,name}','Commercial project','idempotent replay returns the original canonical project DTO');
select is((select count(*) from public.projects where tenant_id=(select id from public.tenants where slug='project-lifecycle-a')),1::bigint,'idempotent replay creates no duplicate project');

select set_config('request.jwt.claim.sub','83000000-0000-4000-8000-000000000005',true);
set local role authenticated;
select set_config('test.project.lifecycle.cross_org_key_result',public.create_current_project_v2(
  'Cross organization retry','Must not replay','Delivery',
  '84000000-0000-4000-8000-000000000005',1.00,'planning','low',
  '2026-10-01','2026-10-02',0,'Cross organization key proof',
  '85000000-0000-4000-8000-000000000016','85000000-0000-4000-8000-000000000002'
)::text,true);
reset role;
select is(current_setting('test.project.lifecycle.cross_org_key_result')::jsonb->>'error','scope_conflict','same-tenant cross-organization idempotency keys fail closed');

select set_config('request.jwt.claim.sub','83000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select set_config('test.project.lifecycle.stale_result',public.update_current_project(
  current_setting('test.project.lifecycle.project_id')::uuid,'Stale update','','Delivery',
  '84000000-0000-4000-8000-000000000003',99.00,'medium','2026-09-01','2026-09-30',
  9,'Stale edit','85000000-0000-4000-8000-000000000004','85000000-0000-4000-8000-000000000005'
)::text,true);
select set_config('test.project.lifecycle.update_result',public.update_current_project(
  current_setting('test.project.lifecycle.project_id')::uuid,'Updated project','Updated scope','Delivery',
  '84000000-0000-4000-8000-000000000003',88.20,'critical','2026-09-02','2026-10-05',
  1,'Approved scope change','85000000-0000-4000-8000-000000000006','85000000-0000-4000-8000-000000000007'
)::text,true);
reset role;
select is(current_setting('test.project.lifecycle.stale_result')::jsonb->>'error','stale_version','stale update is rejected');
select is((current_setting('test.project.lifecycle.update_result')::jsonb->>'version')::bigint,2::bigint,'valid update increments version');
select is((select budget_amount from public.projects where public_id=current_setting('test.project.lifecycle.project_id')::uuid),88.20::numeric,'valid update persists exact money');
select is((select count(*) from public.project_members membership join public.projects project on project.id=membership.project_id where project.public_id=current_setting('test.project.lifecycle.project_id')::uuid and membership.role='owner' and membership.left_at is null),1::bigint,'owner transfer keeps exactly one active owner');
select ok(exists(select 1 from public.audit_logs where request_id='85000000-0000-4000-8000-000000000006' and action='project.updated' and metadata->>'businessReason'='Approved scope change'),'update audit carries the business reason');

select set_config('request.jwt.claim.sub','83000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select set_config('test.project.lifecycle.task_result',public.create_current_project_task_v2(
  current_setting('test.project.lifecycle.project_id')::uuid,'Compatibility task','Task after project hardening',
  (select id from public.organization_members where user_id='83000000-0000-4000-8000-000000000006'),
  '2026-10-10','high','Task row and membership commit'
)::text,true);
reset role;
select ok(
  exists(select 1 from public.tasks where public_id=current_setting('test.project.lifecycle.task_result')::uuid),
  'existing task create RPC still creates a real task'
);
select ok(
  exists(
    select 1 from public.project_members membership
    join public.projects project on project.id=membership.project_id
    join public.organization_members member on member.id=membership.member_id
      and member.organization_id=membership.organization_id
    where project.public_id=current_setting('test.project.lifecycle.project_id')::uuid
      and member.user_id='83000000-0000-4000-8000-000000000006'
      and membership.tenant_id=project.tenant_id
      and membership.created_by_member_id is not null
      and membership.updated_by_member_id is not null
      and membership.version=1
  ),
  'task assignment fills hardened project membership ownership fields'
);

create or replace function public.test_project_update_failure()
returns trigger language plpgsql set search_path='' as $$
begin
  if current_setting('test.project.update_failure',true)='on' then
    raise exception 'injected_project_update_failure';
  end if;
  return new;
end;
$$;
create trigger test_project_update_failure before update on public.projects
for each row execute function public.test_project_update_failure();
select set_config('test.project.update_failure','on',true);
select set_config('request.jwt.claim.sub','83000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select set_config('test.project.lifecycle.update_failure_result',public.update_current_project(
  current_setting('test.project.lifecycle.project_id')::uuid,'Must roll back update','Injected update failure','Delivery',
  '84000000-0000-4000-8000-000000000003',77.77,'high','2026-09-02','2026-10-05',
  2,'Update atomicity proof','85000000-0000-4000-8000-000000000017','85000000-0000-4000-8000-000000000018'
)::text,true);
reset role;
select set_config('test.project.update_failure','off',true);
select is(current_setting('test.project.lifecycle.update_failure_result')::jsonb->>'error','command_failed','update injection returns a stable sanitized failure');
select is((select budget_amount from public.projects where public_id=current_setting('test.project.lifecycle.project_id')::uuid),88.20::numeric,'failed update rolls back all project changes');
select ok(exists(select 1 from public.audit_logs where request_id='85000000-0000-4000-8000-000000000017' and action='project.command_failed' and metadata->>'failure'='command_failed'),'failed update leaves durable sanitized audit evidence');
drop trigger test_project_update_failure on public.projects;
drop function public.test_project_update_failure();

create or replace function public.test_project_archive_failure()
returns trigger language plpgsql set search_path='' as $$
begin
  if current_setting('test.project.archive_failure',true)='on' and new.deleted_at is not null then
    raise exception 'injected_project_archive_failure';
  end if;
  return new;
end;
$$;
create trigger test_project_archive_failure before update on public.projects
for each row execute function public.test_project_archive_failure();
select set_config('test.project.archive_failure','on',true);
select set_config('request.jwt.claim.sub','83000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select set_config('test.project.lifecycle.archive_failure_result',public.archive_current_project(
  current_setting('test.project.lifecycle.project_id')::uuid,2,'Archive atomicity proof',
  '85000000-0000-4000-8000-000000000031','85000000-0000-4000-8000-000000000032'
)::text,true);
reset role;
select set_config('test.project.archive_failure','off',true);
select is(current_setting('test.project.lifecycle.archive_failure_result')::jsonb->>'error','command_failed','archive injection returns a stable sanitized failure');
select ok((select archived_at is null and deleted_at is null and version=2 from public.projects where public_id=current_setting('test.project.lifecycle.project_id')::uuid),'failed archive rolls back all project changes');
select ok(exists(select 1 from public.audit_logs where request_id='85000000-0000-4000-8000-000000000031' and action='project.command_failed' and metadata->>'failure'='command_failed'),'failed archive leaves durable sanitized audit evidence');
drop trigger test_project_archive_failure on public.projects;
drop function public.test_project_archive_failure();

select set_config('request.jwt.claim.sub','83000000-0000-4000-8000-000000000004',true);
set local role authenticated;
select set_config('test.project.lifecycle.foreign_result',public.archive_current_project(
  current_setting('test.project.lifecycle.project_id')::uuid,2,'Foreign archive',
  '85000000-0000-4000-8000-000000000008','85000000-0000-4000-8000-000000000009'
)::text,true);
reset role;
select is(current_setting('test.project.lifecycle.foreign_result')::jsonb->>'error','not_found','cross-tenant project mutation does not disclose the target');

create or replace function public.test_project_membership_failure()
returns trigger language plpgsql set search_path='' as $$
begin
  if current_setting('test.project.membership_failure',true)='on' then
    raise exception 'injected_project_membership_failure';
  end if;
  return new;
end;
$$;
create trigger test_project_membership_failure before insert on public.project_members
for each row execute function public.test_project_membership_failure();
select set_config('test.project.membership_failure','on',true);
select set_config('request.jwt.claim.sub','83000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select set_config('test.project.lifecycle.failure_result',public.create_current_project_v2(
  'Must roll back','Injected membership failure','Delivery',
  '84000000-0000-4000-8000-000000000002',10.00,'active','medium',
  '2026-11-01','2026-11-30',0,'Atomicity proof',
  '85000000-0000-4000-8000-000000000010','85000000-0000-4000-8000-000000000011'
)::text,true);
reset role;
select set_config('test.project.membership_failure','off',true);
select is(current_setting('test.project.lifecycle.failure_result')::jsonb->>'error','command_failed','membership failure returns a stable failure');
select is((select count(*) from public.projects where name='Must roll back'),0::bigint,'membership failure rolls back the project row');
select ok(exists(select 1 from public.audit_logs where request_id='85000000-0000-4000-8000-000000000010' and action='project.command_failed' and metadata->>'failure'='command_failed'),'rolled-back create leaves durable sanitized failure evidence');
drop trigger test_project_membership_failure on public.project_members;
drop function public.test_project_membership_failure();

select set_config('request.jwt.claim.sub','83000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select throws_ok($$ select public.create_current_project_v2(
  'Bad money','','Delivery','84000000-0000-4000-8000-000000000002',1.001,
  'active','medium','2026-11-01','2026-11-30',0,'Bad money',
  '85000000-0000-4000-8000-000000000012','85000000-0000-4000-8000-000000000013'
) $$,'22023','Project command is invalid','database rejects money beyond two decimal places');
select throws_ok($$ select public.create_current_project_v2(
  'Null version','','Delivery','84000000-0000-4000-8000-000000000002',1.00,
  'active','medium','2026-11-01','2026-11-30',null,'Null version',
  '85000000-0000-4000-8000-000000000019','85000000-0000-4000-8000-000000000020'
) $$,'22023','Project command is invalid','database rejects null create version');
select throws_ok($$ select public.create_current_project_v2(
  'Null status','','Delivery','84000000-0000-4000-8000-000000000002',1.00,
  null,'medium','2026-11-01','2026-11-30',0,'Null status',
  '85000000-0000-4000-8000-000000000021','85000000-0000-4000-8000-000000000022'
) $$,'22023','Project command is invalid','database rejects null create status');
select throws_ok($$ select public.create_current_project_v2(
  'Null priority','','Delivery','84000000-0000-4000-8000-000000000002',1.00,
  'active',null,'2026-11-01','2026-11-30',0,'Null priority',
  '85000000-0000-4000-8000-000000000023','85000000-0000-4000-8000-000000000024'
) $$,'22023','Project command is invalid','database rejects null create priority');
select throws_ok($$ select public.create_current_project_v2(
  'NaN budget','','Delivery','84000000-0000-4000-8000-000000000002','NaN'::numeric,
  'active','medium','2026-11-01','2026-11-30',0,'NaN budget',
  '85000000-0000-4000-8000-000000000025','85000000-0000-4000-8000-000000000026'
) $$,'22023','Project command is invalid','database rejects numeric NaN');
select throws_ok($$ select public.create_current_project_v2(
  'Oversized budget','','Delivery','84000000-0000-4000-8000-000000000002',10000000000000000::numeric,
  'active','medium','2026-11-01','2026-11-30',0,'Oversized budget',
  '85000000-0000-4000-8000-000000000027','85000000-0000-4000-8000-000000000028'
) $$,'22023','Project command is invalid','database rejects amounts beyond numeric eighteen two');
select throws_ok($$ select public.update_current_project(
  current_setting('test.project.lifecycle.project_id')::uuid,'Null update priority','','Delivery',
  '84000000-0000-4000-8000-000000000003',1.00,null,'2026-09-02','2026-10-05',
  2,'Null update priority','85000000-0000-4000-8000-000000000029','85000000-0000-4000-8000-000000000030'
) $$,'22023','Project command is invalid','database rejects null update priority');
select set_config('test.project.lifecycle.archive_result',public.archive_current_project(
  current_setting('test.project.lifecycle.project_id')::uuid,2,'Delivery closed',
  '85000000-0000-4000-8000-000000000014','85000000-0000-4000-8000-000000000015'
)::text,true);
reset role;
select is((current_setting('test.project.lifecycle.archive_result')::jsonb->>'version')::bigint,3::bigint,'archive increments project version');
select ok((select archived_at is not null and deleted_at is not null and status='cancelled' from public.projects where public_id=current_setting('test.project.lifecycle.project_id')::uuid),'archive is durable and internally consistent');
select ok(exists(select 1 from public.audit_logs where request_id='85000000-0000-4000-8000-000000000014' and action='project.archived'),'archive is audited');
select * from finish();
rollback;
