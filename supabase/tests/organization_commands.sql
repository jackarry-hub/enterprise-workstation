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
 ('00000000-0000-0000-0000-000000000000','97000000-0000-4000-8000-000000000004','authenticated','authenticated','organization-secondary-admin@example.test',crypt('local-e2e-password',gen_salt('bf')),now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','97000000-0000-4000-8000-000000000005','authenticated','authenticated','organization-hr@example.test',crypt('local-e2e-password',gen_salt('bf')),now(),'{}','{}',now(),now()),
 ('00000000-0000-0000-0000-000000000000','97000000-0000-4000-8000-000000000006','authenticated','authenticated','organization-foreign@example.test',crypt('local-e2e-password',gen_salt('bf')),now(),'{}','{}',now(),now());
insert into public.organization_members (tenant_id,organization_id,user_id,status)
select tenant.id,organization.id,seed.user_id,'active' from (values
 ('organization-command-a','organization-command-org-a','97000000-0000-4000-8000-000000000001'::uuid),
 ('organization-command-a','organization-command-org-a','97000000-0000-4000-8000-000000000002'::uuid),
 ('organization-command-a','organization-command-org-a','97000000-0000-4000-8000-000000000003'::uuid)
 ,('organization-command-a','organization-command-org-a-secondary','97000000-0000-4000-8000-000000000004'::uuid),
 ('organization-command-a','organization-command-org-a','97000000-0000-4000-8000-000000000005'::uuid),
 ('organization-command-b','organization-command-org-b','97000000-0000-4000-8000-000000000006'::uuid)
) seed(tenant_slug,organization_slug,user_id) join public.tenants tenant on tenant.slug=seed.tenant_slug join public.organizations organization on organization.tenant_id=tenant.id and organization.slug=seed.organization_slug;
insert into public.member_roles (tenant_id,member_id,role_id,assignment_source)
select member.tenant_id,member.id,role.id,case when member.user_id='97000000-0000-4000-8000-000000000003'::uuid then 'directory' else 'manual' end
from public.organization_members member join public.roles role on role.tenant_id=member.tenant_id join (values
 ('97000000-0000-4000-8000-000000000001'::uuid,'employee'),('97000000-0000-4000-8000-000000000002'::uuid,'admin'),('97000000-0000-4000-8000-000000000003'::uuid,'employee')
 ,('97000000-0000-4000-8000-000000000004'::uuid,'admin'),
 ('97000000-0000-4000-8000-000000000005'::uuid,'hr'),
 ('97000000-0000-4000-8000-000000000006'::uuid,'employee')
) seed(user_id,role_name) on seed.user_id=member.user_id and seed.role_name=role.code;
insert into public.role_permissions (tenant_id,role_id,permission_id)
select role.tenant_id,role.id,permission.id from public.roles role join public.permissions permission
  on (role.code='admin' and permission.code in ('organization.manage','role.manage'))
  or (role.code='hr' and permission.code='hr.manage')
where role.tenant_id=(select id from public.tenants where slug='organization-command-a');
insert into public.employee_profiles (tenant_id,organization_id,organization_member_id,employee_no,display_name,job_title,employment_status,skills)
select member.tenant_id,member.organization_id,member.id,'ORG-'||member.id,'Organization member','Tester','active','{}'::text[] from public.organization_members member where member.user_id in (
 '97000000-0000-4000-8000-000000000001'::uuid, '97000000-0000-4000-8000-000000000002'::uuid,
 '97000000-0000-4000-8000-000000000003'::uuid, '97000000-0000-4000-8000-000000000004'::uuid,
 '97000000-0000-4000-8000-000000000005'::uuid, '97000000-0000-4000-8000-000000000006'::uuid
);
insert into public.external_identities (tenant_id,organization_id,organization_member_id,identity_provider_id,provider_subject,provider_tenant_key,auth_user_id,status)
select member.tenant_id,member.organization_id,member.id,provider.id,member.user_id::text,provider.provider_tenant_key,member.user_id,'active' from public.organization_members member join public.identity_providers provider on provider.tenant_id=member.tenant_id and provider.provider_code='organizationcommand';
insert into public.departments (tenant_id,organization_id,code,name,description)
select tenant.id,organization.id,'FOREIGN','Foreign target','Real foreign fixture' from public.tenants tenant join public.organizations organization on organization.tenant_id=tenant.id where tenant.slug='organization-command-b';
select set_config('test.organization.foreign_department',(select public_id::text from public.departments where code='FOREIGN'),true);
insert into public.skill_categories (tenant_id,organization_id,code,name)
select tenant.id,organization.id,'VERIFY','Verification' from public.tenants tenant join public.organizations organization on organization.tenant_id=tenant.id where tenant.slug in ('organization-command-a','organization-command-b');
insert into public.skill_tags (tenant_id,organization_id,category_id,code,name)
select category.tenant_id,category.organization_id,category.id,'VERIFY','Verification' from public.skill_categories category where category.code='VERIFY';
insert into public.employee_skills (tenant_id,organization_id,employee_profile_id,skill_tag_id,proficiency_level)
select profile.tenant_id,profile.organization_id,profile.id,tag.id,3 from public.employee_profiles profile
join public.organization_members member on member.id=profile.organization_member_id
join public.skill_tags tag on tag.tenant_id=profile.tenant_id and tag.organization_id=profile.organization_id and tag.code='VERIFY'
where member.user_id in ('97000000-0000-4000-8000-000000000001'::uuid,'97000000-0000-4000-8000-000000000006'::uuid);
select set_config('test.organization.employee_skill',(select skill.public_id::text from public.employee_skills skill join public.employee_profiles profile on profile.id=skill.employee_profile_id join public.organization_members member on member.id=profile.organization_member_id where member.user_id='97000000-0000-4000-8000-000000000001'::uuid),true);
select set_config('test.organization.foreign_employee_skill',(select skill.public_id::text from public.employee_skills skill join public.employee_profiles profile on profile.id=skill.employee_profile_id join public.organization_members member on member.id=profile.organization_member_id where member.user_id='97000000-0000-4000-8000-000000000006'::uuid),true);

select ok(has_function('public','create_current_department',array['text','text','text','integer','bigint','text','uuid','uuid']::name[]) and has_function('public','verify_current_employee_skill',array['uuid','text','text','uuid']::name[]),'organization and employee skill commands carry their required inputs');
select ok(has_function('public','assign_current_member_role',array['bigint','text','bigint','text','uuid','uuid']::name[]) and has_function_privilege('authenticated','public.verify_current_employee_skill(uuid,text,text,uuid)','EXECUTE') and not has_function_privilege('anon','public.verify_current_employee_skill(uuid,text,text,uuid)','EXECUTE'),'role and employee skill commands have authenticated-only execution paths');
select ok(exists (select 1 from pg_constraint where conrelid='public.organization_command_idempotency'::regclass and pg_get_constraintdef(oid) like '%FOREIGN KEY (tenant_id, organization_id) REFERENCES organizations(tenant_id, id)%') and exists (select 1 from pg_index where indexrelid='public.employee_skills_public_id_uidx'::regclass),'organization idempotency and skill public identity are durable');
select ok(not public.jsonb_has_sensitive_key(jsonb_build_object('departmentLabel','OPS','roleSet',jsonb_build_array('HR'),'permissionScope','organization.manage','verifierMemberRef',8,'verificationStatus','verified')),'safe organization and skill audit keys do not trigger sensitive-key detector');
select ok(public.jsonb_has_sensitive_key(jsonb_build_object('accessCode','secret')),'sensitive-key detector remains strict for secret-like code keys');

select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000001',true); set local role authenticated;
select throws_ok($$ select public.verify_current_employee_skill(current_setting('test.organization.employee_skill')::uuid,'verified','Employee may not verify','97000000-0000-4000-8000-000000000011'::uuid) $$,'42501','Employee skill verification permission required','employee is denied skill verification'); reset role;

select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000005',true); set local role authenticated;
select lives_ok($$ select public.verify_current_employee_skill(current_setting('test.organization.employee_skill')::uuid,'verified','HR reviewed evidence','97000000-0000-4000-8000-000000000013'::uuid) $$,'HR verifies an employee skill and audit commits'); reset role;

select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000002',true); set local role authenticated;
select public.create_current_department('OPS','Operations','',0,0,'Need department','97000000-0000-4000-8000-000000000021'::uuid,'97000000-0000-4000-8000-000000000022'::uuid);
select is((select version from public.departments where code='OPS'),1::bigint,'create version zero produces stored version one');
select ok(exists(select 1 from public.audit_logs where request_id='97000000-0000-4000-8000-000000000021'::uuid and metadata->>'outcome'='success' and metadata->>'idempotencyKey'='97000000-0000-4000-8000-000000000022') and exists(select 1 from public.audit_logs where request_id='97000000-0000-4000-8000-000000000013'::uuid and actor_member_id=(select id from public.organization_members where user_id='97000000-0000-4000-8000-000000000005'::uuid) and metadata->>'decision'='verified' and metadata->'before'->>'verificationStatus'='unverified' and metadata->'after'->>'verificationStatus'='verified'),'department and employee skill success audits preserve business evidence');
select lives_ok($$ select public.update_current_department((select public_id from public.departments where code='OPS'),'Operations 2','',0,1,'Rename','97000000-0000-4000-8000-000000000031'::uuid,'97000000-0000-4000-8000-000000000032'::uuid) $$,'department update succeeds');
select is((select version from public.departments where code='OPS'),2::bigint,'update increments version');
select is((select public.update_current_department((select public_id from public.departments where code='OPS'),'Ignored','',0,1,'Replay','97000000-0000-4000-8000-000000000041'::uuid,'97000000-0000-4000-8000-000000000032'::uuid)->>'outcome'),'success','same idempotency key replays after version changes');
select is((select version from public.departments where code='OPS'),2::bigint,'replay does not overwrite current version');
select set_config('test.organization.foreign_department_result',(select public.update_current_department(current_setting('test.organization.foreign_department')::uuid,'No','',0,1,'Foreign target','97000000-0000-4000-8000-000000000051'::uuid,'97000000-0000-4000-8000-000000000052'::uuid)->>'error'),true);
reset role;
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000005',true); set local role authenticated;
do $$ begin
  perform public.verify_current_employee_skill(current_setting('test.organization.foreign_employee_skill')::uuid,'verified','Foreign target','97000000-0000-4000-8000-000000000053'::uuid);
  raise exception 'Foreign employee skill lookup unexpectedly succeeded';
exception when sqlstate 'P0002' then null;
end $$;
reset role;
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000002',true); set local role authenticated;
select is((current_setting('test.organization.foreign_department_result')='not_found' and (select verification_status from public.employee_skills where public_id=current_setting('test.organization.foreign_employee_skill')::uuid)='unverified'),true,'foreign real targets stay not found with zero business mutation');
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
