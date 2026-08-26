begin;
select plan(31);

insert into public.tenants (name,slug,status) values ('Organization command A','organization-command-a','active'),('Organization command B','organization-command-b','active');
insert into public.organizations (tenant_id,name,slug)
select tenant.id, seed.name, seed.slug from public.tenants tenant join (values
 ('organization-command-a','Organization command A','organization-command-org-a'),
 ('organization-command-a','Organization command A secondary','organization-command-org-a-secondary'),
 ('organization-command-b','Organization command B','organization-command-org-b')
) seed(tenant_slug,name,slug) on seed.tenant_slug=tenant.slug;
insert into public.identity_providers (tenant_id,provider_code,auth_provider,provider_tenant_key,display_name)
select id,'organizationcommand','custom:organizationcommand',slug||'-key','Organization command auth' from public.tenants where slug like 'organization-command-%';
insert into public.roles (tenant_id,organization_id,code,name,description,is_system,is_enabled)
select tenant.id,null,seed.code,seed.name,seed.name,true,true from public.tenants tenant cross join (values ('owner','Owner'),('admin','Admin'),('employee','Employee'),('hr','HR')) seed(code,name) where tenant.slug like 'organization-command-%';
insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-0000-0000-000000000000','97000000-0000-4000-8000-000000000001','authenticated','authenticated','organization-employee@example.test',crypt('local-e2e-password',gen_salt('bf')),now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','97000000-0000-4000-8000-000000000002','authenticated','authenticated','organization-admin@example.test',crypt('local-e2e-password',gen_salt('bf')),now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','97000000-0000-4000-8000-000000000003','authenticated','authenticated','organization-directory@example.test',crypt('local-e2e-password',gen_salt('bf')),now(),'{}','{}',now(),now());
insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-0000-0000-000000000000','97000000-0000-4000-8000-000000000004','authenticated','authenticated','organization-secondary-admin@example.test',crypt('local-e2e-password',gen_salt('bf')),now(),'{}','{}',now(),now());
insert into public.organization_members (tenant_id,organization_id,user_id,status)
select tenant.id,organization.id,seed.user_id,'active' from (values
 ('organization-command-a','organization-command-org-a','97000000-0000-4000-8000-000000000001'::uuid),
 ('organization-command-a','organization-command-org-a','97000000-0000-4000-8000-000000000002'::uuid),
 ('organization-command-a','organization-command-org-a','97000000-0000-4000-8000-000000000003'::uuid)
 ,('organization-command-a','organization-command-org-a-secondary','97000000-0000-4000-8000-000000000004'::uuid)
) seed(tenant_slug,organization_slug,user_id) join public.tenants tenant on tenant.slug=seed.tenant_slug join public.organizations organization on organization.tenant_id=tenant.id and organization.slug=seed.organization_slug;
insert into public.member_roles (tenant_id,member_id,role_id,assignment_source)
select member.tenant_id,member.id,role.id,case when member.user_id='97000000-0000-4000-8000-000000000003'::uuid then 'directory' else 'manual' end
from public.organization_members member join public.roles role on role.tenant_id=member.tenant_id join (values
 ('97000000-0000-4000-8000-000000000001'::uuid,'employee'),('97000000-0000-4000-8000-000000000002'::uuid,'admin'),('97000000-0000-4000-8000-000000000003'::uuid,'employee')
 ,('97000000-0000-4000-8000-000000000004'::uuid,'admin')
) seed(user_id,role_name) on seed.user_id=member.user_id and seed.role_name=role.code;
insert into public.role_permissions (tenant_id,role_id,permission_id)
select role.tenant_id,role.id,permission.id from public.roles role join public.permissions permission on permission.code in ('organization.manage','role.manage')
where role.code='admin' and role.tenant_id=(select id from public.tenants where slug='organization-command-a');
insert into public.employee_profiles (tenant_id,organization_id,organization_member_id,employee_no,display_name,job_title,employment_status,skills)
select member.tenant_id,member.organization_id,member.id,'ORG-'||member.id,'Organization member','Tester','active','{}'::text[] from public.organization_members member where member.user_id between '97000000-0000-4000-8000-000000000001'::uuid and '97000000-0000-4000-8000-000000000003'::uuid or member.user_id='97000000-0000-4000-8000-000000000004'::uuid;
insert into public.external_identities (tenant_id,organization_id,organization_member_id,identity_provider_id,provider_subject,provider_tenant_key,auth_user_id,status)
select member.tenant_id,member.organization_id,member.id,provider.id,member.user_id::text,provider.provider_tenant_key,member.user_id,'active' from public.organization_members member join public.identity_providers provider on provider.tenant_id=member.tenant_id and provider.provider_code='organizationcommand';
insert into public.departments (tenant_id,organization_id,code,name,description)
select tenant.id,organization.id,'FOREIGN','Foreign target','Real foreign fixture' from public.tenants tenant join public.organizations organization on organization.tenant_id=tenant.id where tenant.slug='organization-command-b';
select set_config('test.organization.foreign_department',(select public_id::text from public.departments where code='FOREIGN'),true);

select ok(has_function('public','create_current_department',array['text','text','text','integer','bigint','text','uuid','uuid']::name[]),'department command carries version reason request and idempotency');
select ok(has_function('public','assign_current_member_role',array['bigint','text','bigint','text','uuid','uuid']::name[]),'role command carries version reason request and idempotency');
select ok(exists (select 1 from pg_constraint where conrelid='public.organization_command_idempotency'::regclass and pg_get_constraintdef(oid) like '%FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id)%'),'idempotency ledger has the exact composite tenant organization ownership foreign key');
select ok(not public.jsonb_has_sensitive_key(jsonb_build_object('departmentLabel','OPS','roleSet',jsonb_build_array('HR'),'permissionScope','organization.manage')),'safe organization audit keys do not trigger sensitive-key detector');
select ok(public.jsonb_has_sensitive_key(jsonb_build_object('accessCode','secret')),'sensitive-key detector remains strict for secret-like code keys');

select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000001',true); set local role authenticated;
select throws_ok($$ select public.create_current_department('OPS','Operations','',0,0,'Need department','97000000-0000-4000-8000-000000000011'::uuid,'97000000-0000-4000-8000-000000000012'::uuid) $$,'42501','Organization command permission required','employee is denied'); reset role;

select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000002',true); set local role authenticated;
select lives_ok($$ select public.create_current_department('OPS','Operations','',0,0,'Need department','97000000-0000-4000-8000-000000000021'::uuid,'97000000-0000-4000-8000-000000000022'::uuid) $$,'seeded admin creates department and audit commits');
select is((select version from public.departments where code='OPS'),1::bigint,'create version zero produces stored version one');
select ok(exists(select 1 from public.audit_logs where request_id='97000000-0000-4000-8000-000000000021'::uuid and metadata->>'outcome'='success' and metadata->>'idempotencyKey'='97000000-0000-4000-8000-000000000022'),'success audit stores distinct request and idempotency identifiers');
select lives_ok($$ select public.update_current_department((select public_id from public.departments where code='OPS'),'Operations 2','',0,1,'Rename','97000000-0000-4000-8000-000000000031'::uuid,'97000000-0000-4000-8000-000000000032'::uuid) $$,'department update succeeds');
select is((select version from public.departments where code='OPS'),2::bigint,'update increments version');
select is((select public.update_current_department((select public_id from public.departments where code='OPS'),'Ignored','',0,1,'Replay','97000000-0000-4000-8000-000000000041'::uuid,'97000000-0000-4000-8000-000000000032'::uuid)->>'outcome'),'success','same idempotency key replays after version changes');
select is((select version from public.departments where code='OPS'),2::bigint,'replay does not overwrite current version');
select is((select public.update_current_department(current_setting('test.organization.foreign_department')::uuid,'No','',0,1,'Foreign target','97000000-0000-4000-8000-000000000051'::uuid,'97000000-0000-4000-8000-000000000052'::uuid)->>'error'),'not_found','foreign real target returns stable not found');
select ok(exists(select 1 from public.audit_logs where request_id='97000000-0000-4000-8000-000000000051'::uuid and metadata->>'outcome'='failure'),'domain failure persists an audit row');
select lives_ok($$ select public.upsert_current_position(null,'OPS-1','Operations specialist','Operations','',null,0,'Create role','97000000-0000-4000-8000-000000000061'::uuid,'97000000-0000-4000-8000-000000000062'::uuid) $$,'position create and audit commits');
select ok(exists(select 1 from public.audit_logs where request_id='97000000-0000-4000-8000-000000000061'::uuid and metadata->>'outcome'='success'),'position success audit exists');
select lives_ok($$ select public.upsert_current_position(null,'OPS-2','Operations analyst','Operations','',null,0,'Create second position','97000000-0000-4000-8000-000000000063'::uuid,'97000000-0000-4000-8000-000000000064'::uuid) $$,'second manual position exists for conflict proof');
select is((select public.upsert_current_position((select public_id from public.position_templates where code='OPS-2'),'OPS-1','Operations analyst','Operations','',null,1,'Conflicting label','97000000-0000-4000-8000-000000000081'::uuid,'97000000-0000-4000-8000-000000000082'::uuid)->>'error'),'conflict','conflicting position update returns stable conflict');
select is((select code from public.position_templates where code='OPS-2'),'OPS-2','conflicting position update leaves business data unchanged');
select is((select public.upsert_current_position((select public_id from public.position_templates where code='OPS-2'),'OPS-1','Operations analyst','Operations','',null,1,'Replay conflict','97000000-0000-4000-8000-000000000083'::uuid,'97000000-0000-4000-8000-000000000082'::uuid)->>'error'),'conflict','conflicting update replay returns the stored stable failure');
select is((select count(*) from public.audit_logs where request_id='97000000-0000-4000-8000-000000000081'::uuid),1::bigint,'conflicting position update commits exactly one safe failure audit');
select ok((select result->>'error'='conflict' and result::text !~ '(duplicate|unique|23505)' from public.organization_command_idempotency where operation='upsert_current_position' and idempotency_key='97000000-0000-4000-8000-000000000082'::uuid),'conflicting position failure is durably stored without raw SQL detail');
select is((select public.assign_current_member_role((select id from public.organization_members where user_id='97000000-0000-4000-8000-000000000001'::uuid),'hr',1,'New HR responsibility','97000000-0000-4000-8000-000000000065'::uuid,'97000000-0000-4000-8000-000000000066'::uuid)->>'outcome'),'success','manual role assignment succeeds');
select ok(exists(select 1 from public.audit_logs where request_id='97000000-0000-4000-8000-000000000065'::uuid and metadata->>'outcome'='success' and metadata->'after' ? 'roleSet'),'manual role assignment success audit exists');
select is((select public.assign_current_member_role((select id from public.organization_members where user_id='97000000-0000-4000-8000-000000000003'::uuid),'hr',1,'Manual override','97000000-0000-4000-8000-000000000071'::uuid,'97000000-0000-4000-8000-000000000072'::uuid)->>'error'),'directory_role_owned','directory assignment conflict fails closed');
select is((select assignment_source from public.member_roles where member_id=(select id from public.organization_members where user_id='97000000-0000-4000-8000-000000000003'::uuid)),'directory','directory assignment is preserved');
select ok(exists(select 1 from public.audit_logs where request_id='97000000-0000-4000-8000-000000000071'::uuid and metadata->>'outcome'='failure'),'directory ownership rejection is audited');
reset role;
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000004',true); set local role authenticated;
select is((select public.create_current_department('SECOND','Secondary','',0,0,'Cross organization collision','97000000-0000-4000-8000-000000000091'::uuid,'97000000-0000-4000-8000-000000000022'::uuid)->>'error'),'scope_conflict','same tenant key from another organization does not replay the first result');
select is((select count(*) from public.departments where code='SECOND'),0::bigint,'cross organization collision leaves current organization business data unchanged');
select ok(exists(select 1 from public.audit_logs audit join public.organizations organization on organization.id=audit.organization_id where audit.request_id='97000000-0000-4000-8000-000000000091'::uuid and organization.slug='organization-command-org-a-secondary' and audit.metadata->>'failure'='scope_conflict'),'cross organization collision writes only a current organization safe failure audit');
reset role;
select * from finish(); rollback;
