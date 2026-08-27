begin;
select plan(129);

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
select tenant.id,null,seed.code,seed.name,seed.name,true,true from public.tenants tenant cross join (values ('owner','Owner'),('admin','Admin'),('department_head','Department head'),('employee','Employee'),('hr','HR')) seed(code,name) where tenant.slug like 'organization-command-%';
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
 ('97000000-0000-4000-8000-000000000001'::uuid,'employee'),('97000000-0000-4000-8000-000000000002'::uuid,'admin'),('97000000-0000-4000-8000-000000000003'::uuid,'department_head')
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
insert into public.departments (tenant_id,organization_id,code,name,description,sort_order)
select tenant.id,organization.id,seed.code,seed.name,'Task 8 manager scope',seed.sort_order
from public.tenants tenant join public.organizations organization on organization.tenant_id=tenant.id
cross join (values ('ENGINEERING','Engineering',10),('SALES','Sales',20)) seed(code,name,sort_order)
where tenant.slug='organization-command-a' and organization.slug='organization-command-org-a';
update public.employee_profiles profile set department_id=case
  when member.user_id='97000000-0000-4000-8000-000000000005'::uuid
    then (select id from public.departments where tenant_id=profile.tenant_id and organization_id=profile.organization_id and code='SALES')
  else (select id from public.departments where tenant_id=profile.tenant_id and organization_id=profile.organization_id and code='ENGINEERING')
end
from public.organization_members member
where member.id=profile.organization_member_id and member.organization_id=profile.organization_id
  and member.user_id in (
    '97000000-0000-4000-8000-000000000001'::uuid,
    '97000000-0000-4000-8000-000000000002'::uuid,
    '97000000-0000-4000-8000-000000000003'::uuid,
    '97000000-0000-4000-8000-000000000005'::uuid
  );
insert into public.member_roles (tenant_id,member_id,role_id,assignment_source)
select member.tenant_id,member.id,role.id,'manual'
from public.organization_members member join public.roles role on role.tenant_id=member.tenant_id
where member.user_id='97000000-0000-4000-8000-000000000002'::uuid
  and role.code='supervisor' and role.organization_id is null and role.is_system and role.is_enabled;
update public.departments department set leader_member_id=(
  select member.id from public.organization_members member
  where member.tenant_id=department.tenant_id and member.organization_id=department.organization_id
    and member.user_id='97000000-0000-4000-8000-000000000002'::uuid
)
where department.code='ENGINEERING' and department.organization_id=(select id from public.organizations where slug='organization-command-org-a');
select set_config('test.organization.manager_target',(select profile.public_id::text from public.employee_profiles profile join public.organization_members member on member.id=profile.organization_member_id where member.user_id='97000000-0000-4000-8000-000000000001'::uuid),true);
select set_config('test.organization.supervisor_profile',(select profile.public_id::text from public.employee_profiles profile join public.organization_members member on member.id=profile.organization_member_id where member.user_id='97000000-0000-4000-8000-000000000002'::uuid),true);
select set_config('test.organization.department_head_profile',(select profile.public_id::text from public.employee_profiles profile join public.organization_members member on member.id=profile.organization_member_id where member.user_id='97000000-0000-4000-8000-000000000003'::uuid),true);
select set_config('test.organization.sales_profile',(select profile.public_id::text from public.employee_profiles profile join public.organization_members member on member.id=profile.organization_member_id where member.user_id='97000000-0000-4000-8000-000000000005'::uuid),true);
insert into public.external_identities (tenant_id,organization_id,organization_member_id,identity_provider_id,provider_subject,provider_tenant_key,auth_user_id,status)
select member.tenant_id,member.organization_id,member.id,provider.id,member.user_id::text,provider.provider_tenant_key,member.user_id,'active' from public.organization_members member join public.identity_providers provider on provider.tenant_id=member.tenant_id and provider.provider_code='organizationcommand';
insert into public.organization_members (tenant_id,organization_id,user_id,status)
select tenant.id,organization.id,'97000000-0000-4000-8000-000000000002'::uuid,'active'
from public.tenants tenant join public.organizations organization on organization.tenant_id=tenant.id
where tenant.slug='organization-command-a' and organization.slug='organization-command-org-a-secondary';
insert into public.member_roles (tenant_id,member_id,role_id,assignment_source)
select member.tenant_id,member.id,role.id,'manual'
from public.organization_members member join public.roles role on role.tenant_id=member.tenant_id
where member.user_id='97000000-0000-4000-8000-000000000002'::uuid
  and member.organization_id=(select id from public.organizations where slug='organization-command-org-a-secondary')
  and role.code='admin' and role.organization_id is null;
insert into public.employee_profiles (tenant_id,organization_id,organization_member_id,employee_no,display_name,job_title,employment_status,skills)
select member.tenant_id,member.organization_id,member.id,'ORG-SECOND-SAME-USER','Same user secondary member','Secondary administrator','active','{}'::text[]
from public.organization_members member
where member.user_id='97000000-0000-4000-8000-000000000002'::uuid
  and member.organization_id=(select id from public.organizations where slug='organization-command-org-a-secondary');
select set_config('test.organization.same_user_secondary_member',(select member.id::text from public.organization_members member where member.user_id='97000000-0000-4000-8000-000000000002'::uuid and member.organization_id=(select id from public.organizations where slug='organization-command-org-a-secondary')),true);
select set_config('test.organization.same_user_secondary_profile',(select profile.public_id::text from public.employee_profiles profile where profile.organization_member_id=current_setting('test.organization.same_user_secondary_member')::bigint),true);
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
insert into public.employee_work_profiles (tenant_id,organization_id,employee_profile_id,summary,preferred_task_types,growth_goals,weekly_capacity_hours,self_skills)
select profile.tenant_id,profile.organization_id,profile.id,
  case when member.user_id='97000000-0000-4000-8000-000000000006'::uuid then 'Foreign work profile' else 'Initial current work profile' end,
  array['Analysis']::text[],array['Growth']::text[],36,'[{"name":"Analysis","level":3}]'::jsonb
from public.employee_profiles profile
join public.organization_members member on member.id=profile.organization_member_id
where member.user_id in ('97000000-0000-4000-8000-000000000001'::uuid,'97000000-0000-4000-8000-000000000006'::uuid);
select set_config('test.organization.employee_work_profile',(select work_profile.public_id::text from public.employee_work_profiles work_profile join public.employee_profiles profile on profile.id=work_profile.employee_profile_id join public.organization_members member on member.id=profile.organization_member_id where member.user_id='97000000-0000-4000-8000-000000000001'::uuid),true);
select set_config('test.organization.foreign_employee_profile',(select profile.public_id::text from public.employee_profiles profile join public.organization_members member on member.id=profile.organization_member_id where member.user_id='97000000-0000-4000-8000-000000000006'::uuid),true);
select set_config('test.organization.foreign_work_profile',(select work_profile.public_id::text from public.employee_work_profiles work_profile join public.employee_profiles profile on profile.id=work_profile.employee_profile_id join public.organization_members member on member.id=profile.organization_member_id where member.user_id='97000000-0000-4000-8000-000000000006'::uuid),true);
select set_config('test.organization.foreign_work_profile_summary',(select summary from public.employee_work_profiles where public_id=current_setting('test.organization.foreign_work_profile')::uuid),true);

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

select ok(has_function('public','update_current_employee_work_profile',array['text','text[]','text[]','smallint','jsonb','uuid']::name[]) and has_function('public','verify_current_employee_skill',array['uuid','text','text','uuid']::name[]),'Task5 work-profile and skill commands carry the controlled inputs');
select ok(has_function_privilege('authenticated','public.update_current_employee_work_profile(text,text[],text[],smallint,jsonb,uuid)','EXECUTE') and has_function_privilege('authenticated','public.verify_current_employee_skill(uuid,text,text,uuid)','EXECUTE') and not has_function_privilege('anon','public.verify_current_employee_skill(uuid,text,text,uuid)','EXECUTE'),'Task5 command functions are authenticated-only');
select ok(not has_column_privilege('authenticated','public.employee_skills','verification_status','UPDATE') and not has_column_privilege('authenticated','public.employee_skills','verified_by_member_id','UPDATE') and not has_column_privilege('authenticated','public.employee_skills','verification_reason','SELECT') and not has_table_privilege('authenticated','public.employee_work_profiles','UPDATE'),'verification state, evidence, and work profiles are not direct authenticated writes');
select ok(has_column_privilege('authenticated','public.employee_skills','proficiency_level','UPDATE') and has_column_privilege('authenticated','public.employee_skills','verification_status','SELECT'),'safe skill facts and status retain the required authenticated projection');
select ok(exists (select 1 from pg_constraint where conrelid='public.employee_skills'::regclass and pg_get_constraintdef(oid) like '%FOREIGN KEY (tenant_id, organization_id, verified_by_member_id) REFERENCES organization_members(tenant_id, organization_id, id)%'),'verifier foreign key carries the exact tenant and organization scope');

select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000001',true); set local role authenticated;
select throws_ok($$ select public.verify_current_employee_skill(current_setting('test.organization.employee_skill')::uuid,'verified','Employee may not verify','97000000-0000-4000-8000-000000000101'::uuid) $$,'42501','Employee skill verification permission required','employee cannot call the verification RPC');
select throws_ok($$ update public.employee_skills set verification_status='verified' where public_id=current_setting('test.organization.employee_skill')::uuid $$,'42501',null,'employee cannot directly update verification status');
select throws_ok($$ insert into public.employee_skills (tenant_id,organization_id,employee_profile_id,skill_tag_id,proficiency_level,verification_status) select skill.tenant_id,skill.organization_id,skill.employee_profile_id,skill.skill_tag_id,3,'verified' from public.employee_skills skill where skill.public_id=current_setting('test.organization.employee_skill')::uuid $$,'42501',null,'employee cannot directly insert a verified skill');
select lives_ok($$ update public.employee_skills set proficiency_level=4 where public_id=current_setting('test.organization.employee_skill')::uuid $$,'employee retains a safe self skill edit');
select lives_ok($$ select public.update_current_employee_work_profile('Current profile',array['Analysis']::text[],array['Growth']::text[],36,'[{"name":"Analysis","level":4}]'::jsonb,'97000000-0000-4000-8000-000000000102'::uuid) $$,'employee work profile is atomically saved by current authenticated context');
reset role;
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000002',true); set local role authenticated;
select ok(exists(select 1 from public.audit_logs audit where audit.request_id='97000000-0000-4000-8000-000000000102'::uuid and audit.action='profile.updated' and audit.target_type='employee_work_profile' and audit.target_id=current_setting('test.organization.employee_work_profile') and audit.metadata->>'permissionScope'='profile.self.update' and audit.metadata->>'businessReason'='current_employee_self_service' and audit.metadata->>'outcome'='success' and audit.metadata->'before'->>'summary'='Initial current work profile' and audit.metadata->'after'->>'summary'='Current profile'),'work profile audit records exact work-profile target, scope, reason, request, before, after, and success');
reset role;
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000001',true); set local role authenticated;
select is((select count(*) from public.employee_work_profiles where public_id=current_setting('test.organization.foreign_work_profile')::uuid),0::bigint,'employee cannot access the captured real foreign work profile');
reset role;
select is((select summary from public.employee_work_profiles where public_id=current_setting('test.organization.foreign_work_profile')::uuid),current_setting('test.organization.foreign_work_profile_summary'),'current self command leaves the real foreign work profile unchanged');
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000001',true); set local role authenticated;
select throws_ok($$ select public.update_current_employee_work_profile('Rejected extra key',array['Analysis']::text[],array['Growth']::text[],36,'[{"name":"Analysis","level":4,"untrusted":"extra"}]'::jsonb,'97000000-0000-4000-8000-000000000108'::uuid) $$,'22023','Employee work profile request is invalid','work-profile RPC rejects an extra self-skill object key');
select is((select self_skills from public.employee_work_profiles where public_id=current_setting('test.organization.employee_work_profile')::uuid),'[{"name":"Analysis","level":4}]'::jsonb,'invalid self-skill payload leaves the current work profile unchanged');
reset role;
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000002',true); set local role authenticated;
select is((select count(*) from public.audit_logs where request_id='97000000-0000-4000-8000-000000000108'::uuid),0::bigint,'invalid self-skill payload writes no profile audit');
reset role;
update public.organization_members set status='suspended' where user_id='97000000-0000-4000-8000-000000000001'::uuid;
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000001',true); set local role authenticated;
select is((select public.update_current_employee_work_profile('Suspended profile',array[]::text[],array[]::text[],36,'[]'::jsonb,'97000000-0000-4000-8000-000000000107'::uuid)->>'error'),'profile_not_found','work profile command checks active membership at database time');
reset role;
update public.organization_members set status='active' where user_id='97000000-0000-4000-8000-000000000001'::uuid;
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000001',true); set local role authenticated;
select throws_ok($$ select verification_reason from public.employee_skills where public_id=current_setting('test.organization.employee_skill')::uuid $$,'42501',null,'employee cannot read verification evidence directly');
reset role;

select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000005',true); set local role authenticated;
select lives_ok($$ select public.verify_current_employee_skill(current_setting('test.organization.employee_skill')::uuid,'verified','HR reviewed evidence','97000000-0000-4000-8000-000000000103'::uuid) $$,'HR with real hr.manage verifies the employee skill');
select is((select count(*) from public.current_organization_skill_verifications() where skill_public_id=current_setting('test.organization.employee_skill')::uuid),1::bigint,'HR manager projection exposes same-organization verification evidence');
select is((select count(*) from public.current_organization_skill_verifications() where skill_public_id=current_setting('test.organization.foreign_employee_skill')::uuid),0::bigint,'HR manager projection does not disclose a real foreign skill');
reset role;
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000002',true); set local role authenticated;
select is((select metadata->>'businessReason' from public.audit_logs where request_id='97000000-0000-4000-8000-000000000103'::uuid),'HR reviewed evidence','verification audit persists the business reason');
select ok((select metadata->>'verifiedAt' is not null from public.audit_logs where request_id='97000000-0000-4000-8000-000000000103'::uuid),'verification audit persists a non-null timestamp');
select is((select actor_member_id from public.audit_logs where request_id='97000000-0000-4000-8000-000000000103'::uuid),(select id from public.organization_members where user_id='97000000-0000-4000-8000-000000000005'::uuid),'verification audit persists the exact verifier member');
select is((select request_id from public.audit_logs where request_id='97000000-0000-4000-8000-000000000103'::uuid),'97000000-0000-4000-8000-000000000103'::uuid,'verification audit persists the request identifier');
select is((select metadata->'before'->>'verificationStatus' from public.audit_logs where request_id='97000000-0000-4000-8000-000000000103'::uuid),'unverified','verification audit persists the prior verification state');
select is((select metadata->'after'->>'verificationStatus' from public.audit_logs where request_id='97000000-0000-4000-8000-000000000103'::uuid),'verified','verification audit persists the new verification state');
select is((select metadata->>'outcome' from public.audit_logs where request_id='97000000-0000-4000-8000-000000000103'::uuid),'success','verification audit persists the success outcome');
reset role;
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000005',true); set local role authenticated;
select throws_ok($$ select public.verify_current_employee_skill(current_setting('test.organization.employee_skill')::uuid,null,'Missing decision','97000000-0000-4000-8000-000000000104'::uuid) $$,'22023','Employee skill verification request is invalid','NULL verification decision is rejected');
select throws_ok($$ select public.verify_current_employee_skill(current_setting('test.organization.employee_skill')::uuid,'rejected','Unsupported decision','97000000-0000-4000-8000-000000000105'::uuid) $$,'22023','Employee skill verification request is invalid','unsupported verification decision is rejected');
select is((select public.verify_current_employee_skill(current_setting('test.organization.foreign_employee_skill')::uuid,'verified','Foreign target','97000000-0000-4000-8000-000000000106'::uuid)->>'error'),'not_found','real foreign skill returns stable not found');
reset role;
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000002',true); set local role authenticated;
select ok(exists(select 1 from public.audit_logs where request_id='97000000-0000-4000-8000-000000000106'::uuid and action='employee_skill.verification_failed' and metadata->>'failure'='not_found' and metadata->>'outcome'='failure'),'foreign not-found commits a safe durable failure audit');
reset role;

-- Task 8: canonical supervisor, protected projection and manager command behavior.
delete from public.roles
where tenant_id=(select id from public.tenants where slug='organization-command-b')
  and organization_id is null and code='supervisor';
alter table public.roles disable trigger roles_canonical_workspace_role_shape;
insert into public.roles (tenant_id,organization_id,code,name,description,is_system,is_enabled)
select tenant.id,null,'supervisor','Legacy custom supervisor','Pre-migration custom lookalike',false,true
from public.tenants tenant where tenant.slug='organization-command-b';
alter table public.roles enable trigger roles_canonical_workspace_role_shape;
select set_config('test.organization.legacy_supervisor_role',(select role.id::text from public.roles role join public.tenants tenant on tenant.id=role.tenant_id where tenant.slug='organization-command-b' and role.code='supervisor'),true);
insert into public.member_roles (tenant_id,member_id,role_id,assignment_source)
select member.tenant_id,member.id,current_setting('test.organization.legacy_supervisor_role')::bigint,'manual'
from public.organization_members member where member.user_id='97000000-0000-4000-8000-000000000006'::uuid;
select public.quarantine_legacy_supervisor_roles();
select public.ensure_supervisor_role_for_tenant((select id from public.tenants where slug='organization-command-b'));
select ok(exists(select 1 from public.roles where id=current_setting('test.organization.legacy_supervisor_role')::bigint and code like 'legacy_supervisor_%' and not is_enabled and not is_system),'legacy custom supervisor role keeps its original id under a disabled collision-safe code');
select ok(exists(select 1 from public.member_roles where role_id=current_setting('test.organization.legacy_supervisor_role')::bigint),'legacy custom supervisor assignment remains attached to the quarantined role id');
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000006',true); set local role authenticated;
select ok(not ((public.current_workspace_access()->'roleCodes') ? 'supervisor') and not exists(select 1 from public.member_roles assignment join public.roles role on role.tenant_id=assignment.tenant_id and role.id=assignment.role_id where assignment.member_id=(select id from public.organization_members where user_id='97000000-0000-4000-8000-000000000006'::uuid) and role.code='supervisor' and role.is_system),'legacy supervisor assignment remains quarantined without canonical scope escalation');
reset role;

insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select '00000000-0000-0000-0000-000000000000'::uuid,seed.user_id,'authenticated','authenticated',seed.email,crypt('local-e2e-password',gen_salt('bf')),now(),'{}','{}',now(),now()
from (values
  ('97000000-0000-4000-8000-000000000301'::uuid,'manager-upgrade-301@example.test'),
  ('97000000-0000-4000-8000-000000000302'::uuid,'manager-upgrade-302@example.test'),
  ('97000000-0000-4000-8000-000000000303'::uuid,'manager-upgrade-303@example.test'),
  ('97000000-0000-4000-8000-000000000304'::uuid,'manager-upgrade-304@example.test'),
  ('97000000-0000-4000-8000-000000000305'::uuid,'manager-upgrade-305@example.test'),
  ('97000000-0000-4000-8000-000000000306'::uuid,'manager-upgrade-306@example.test'),
  ('97000000-0000-4000-8000-000000000307'::uuid,'manager-upgrade-307@example.test'),
  ('97000000-0000-4000-8000-000000000308'::uuid,'manager-upgrade-308@example.test'),
  ('97000000-0000-4000-8000-000000000309'::uuid,'manager-upgrade-309@example.test'),
  ('97000000-0000-4000-8000-000000000310'::uuid,'manager-upgrade-310@example.test'),
  ('97000000-0000-4000-8000-000000000311'::uuid,'manager-upgrade-311@example.test')
) seed(user_id,email);
insert into public.organization_members (tenant_id,organization_id,user_id,status)
select tenant.id,organization.id,seed.user_id,'active'
from public.tenants tenant join public.organizations organization on organization.tenant_id=tenant.id
cross join (values
  ('97000000-0000-4000-8000-000000000301'::uuid),('97000000-0000-4000-8000-000000000302'::uuid),
  ('97000000-0000-4000-8000-000000000303'::uuid),('97000000-0000-4000-8000-000000000304'::uuid),
  ('97000000-0000-4000-8000-000000000305'::uuid),('97000000-0000-4000-8000-000000000306'::uuid),
  ('97000000-0000-4000-8000-000000000307'::uuid),('97000000-0000-4000-8000-000000000308'::uuid),
  ('97000000-0000-4000-8000-000000000309'::uuid),('97000000-0000-4000-8000-000000000310'::uuid),
  ('97000000-0000-4000-8000-000000000311'::uuid)
) seed(user_id)
where tenant.slug='organization-command-a' and organization.slug='organization-command-org-a';
insert into public.departments (tenant_id,organization_id,code,name,description,sort_order)
select tenant.id,organization.id,seed.code,seed.name,'Manager upgrade invariant fixture',seed.sort_order
from public.tenants tenant join public.organizations organization on organization.tenant_id=tenant.id
cross join (values ('UPGRADE_A','Upgrade A',301),('UPGRADE_B','Upgrade B',302)) seed(code,name,sort_order)
where tenant.slug='organization-command-a' and organization.slug='organization-command-org-a';
insert into public.employee_profiles (public_id,tenant_id,organization_id,organization_member_id,employee_no,display_name,department_id,job_title,employment_status,skills)
select seed.public_id,member.tenant_id,member.organization_id,member.id,seed.employee_no,seed.display_name,department.id,'Upgrade fixture',seed.employment_status,'{}'::text[]
from (values
  ('97000000-0000-4000-8000-000000000401'::uuid,'97000000-0000-4000-8000-000000000301'::uuid,'UP-301','Upgrade manager','UPGRADE_A','active'),
  ('97000000-0000-4000-8000-000000000402'::uuid,'97000000-0000-4000-8000-000000000302'::uuid,'UP-302','Valid manual target','UPGRADE_A','active'),
  ('97000000-0000-4000-8000-000000000403'::uuid,'97000000-0000-4000-8000-000000000303'::uuid,'UP-303','Cycle A','UPGRADE_A','active'),
  ('97000000-0000-4000-8000-000000000404'::uuid,'97000000-0000-4000-8000-000000000304'::uuid,'UP-304','Cycle B','UPGRADE_A','active'),
  ('97000000-0000-4000-8000-000000000405'::uuid,'97000000-0000-4000-8000-000000000305'::uuid,'UP-305','Cycle upstream','UPGRADE_A','active'),
  ('97000000-0000-4000-8000-000000000406'::uuid,'97000000-0000-4000-8000-000000000306'::uuid,'UP-306','Cross target','UPGRADE_A','active'),
  ('97000000-0000-4000-8000-000000000407'::uuid,'97000000-0000-4000-8000-000000000307'::uuid,'UP-307','Cross manager','UPGRADE_B','active'),
  ('97000000-0000-4000-8000-000000000408'::uuid,'97000000-0000-4000-8000-000000000308'::uuid,'UP-308','Departed manager','UPGRADE_A','departed'),
  ('97000000-0000-4000-8000-000000000409'::uuid,'97000000-0000-4000-8000-000000000309'::uuid,'UP-309','Departed manager report','UPGRADE_A','active'),
  ('97000000-0000-4000-8000-000000000410'::uuid,'97000000-0000-4000-8000-000000000310'::uuid,'UP-310','Departed target','UPGRADE_A','departed'),
  ('97000000-0000-4000-8000-000000000411'::uuid,'97000000-0000-4000-8000-000000000311'::uuid,'UP-311','Directory target','UPGRADE_A','active')
) seed(public_id,user_id,employee_no,display_name,department_code,employment_status)
join public.organization_members member on member.user_id=seed.user_id
join public.departments department on department.tenant_id=member.tenant_id and department.organization_id=member.organization_id and department.code=seed.department_code;
update public.departments set leader_member_id=(select organization_member_id from public.employee_profiles where public_id='97000000-0000-4000-8000-000000000401'::uuid)
where code='UPGRADE_A' and organization_id=(select id from public.organizations where slug='organization-command-org-a');
alter table public.employee_profiles disable trigger user;
update public.employee_profiles target set manager_employee_id=manager.id,manager_source='manual'
from public.employee_profiles manager
where (target.public_id,manager.public_id) in (
  (('97000000-0000-4000-8000-000000000402'::uuid),('97000000-0000-4000-8000-000000000401'::uuid)),
  (('97000000-0000-4000-8000-000000000403'::uuid),('97000000-0000-4000-8000-000000000404'::uuid)),
  (('97000000-0000-4000-8000-000000000404'::uuid),('97000000-0000-4000-8000-000000000403'::uuid)),
  (('97000000-0000-4000-8000-000000000405'::uuid),('97000000-0000-4000-8000-000000000403'::uuid)),
  (('97000000-0000-4000-8000-000000000406'::uuid),('97000000-0000-4000-8000-000000000407'::uuid)),
  (('97000000-0000-4000-8000-000000000409'::uuid),('97000000-0000-4000-8000-000000000408'::uuid)),
  (('97000000-0000-4000-8000-000000000410'::uuid),('97000000-0000-4000-8000-000000000401'::uuid))
);
update public.employee_profiles target set manager_employee_id=manager.id,manager_source='directory'
from public.employee_profiles manager
where target.public_id='97000000-0000-4000-8000-000000000411'::uuid and manager.public_id='97000000-0000-4000-8000-000000000401'::uuid;
alter table public.employee_profiles enable trigger user;
select public.repair_legacy_manager_relationships();
select ok(not exists(select 1 from public.employee_profiles where public_id in ('97000000-0000-4000-8000-000000000406'::uuid,'97000000-0000-4000-8000-000000000409'::uuid,'97000000-0000-4000-8000-000000000410'::uuid) and manager_employee_id is not null),'legacy upgrade clears direct invalid and departed manager relationships');
select ok(not exists(select 1 from public.employee_profiles where public_id in ('97000000-0000-4000-8000-000000000403'::uuid,'97000000-0000-4000-8000-000000000404'::uuid,'97000000-0000-4000-8000-000000000405'::uuid) and manager_employee_id is not null),'legacy upgrade clears direct and transitive reporting cycles');
select ok(exists(select 1 from public.employee_profiles target join public.employee_profiles manager on manager.id=target.manager_employee_id where target.public_id='97000000-0000-4000-8000-000000000402'::uuid and manager.public_id='97000000-0000-4000-8000-000000000401'::uuid and target.manager_source='manual'),'legacy upgrade preserves a valid same-department manual relationship');
select ok(exists(select 1 from public.employee_profiles target join public.employee_profiles manager on manager.id=target.manager_employee_id where target.public_id='97000000-0000-4000-8000-000000000411'::uuid and manager.public_id='97000000-0000-4000-8000-000000000401'::uuid and target.manager_source='directory'),'legacy upgrade never rewrites a directory-owned relationship');
set constraints employee_profiles_manager_invariants immediate;
select throws_ok($$ update public.employee_profiles set department_id=(select id from public.departments where code='UPGRADE_B' and organization_id=(select id from public.organizations where slug='organization-command-org-a')) where public_id='97000000-0000-4000-8000-000000000402'::uuid $$,'23514',null,'target department move cannot strand a cross-department manual manager');
select throws_ok($$ update public.employee_profiles set department_id=(select id from public.departments where code='UPGRADE_B' and organization_id=(select id from public.organizations where slug='organization-command-org-a')) where public_id='97000000-0000-4000-8000-000000000401'::uuid $$,'23514',null,'manager department move cannot strand cross-department reports');
set constraints employee_profiles_manager_invariants deferred;
update public.departments set leader_member_id=(select organization_member_id from public.employee_profiles where public_id='97000000-0000-4000-8000-000000000401'::uuid)
where code='UPGRADE_B' and organization_id=(select id from public.organizations where slug='organization-command-org-a');
select lives_ok($$ update public.employee_profiles set department_id=(select id from public.departments where code='UPGRADE_B' and organization_id=(select id from public.organizations where slug='organization-command-org-a')) where public_id in ('97000000-0000-4000-8000-000000000401'::uuid,'97000000-0000-4000-8000-000000000402'::uuid,'97000000-0000-4000-8000-000000000411'::uuid) $$,'multi-row target and manager department move is accepted against final state');
select lives_ok($$ set constraints employee_profiles_manager_invariants immediate $$,'multi-row manager invariants validate after the full directory move');
select ok(exists(select 1 from public.employee_profiles target join public.employee_profiles manager on manager.id=target.manager_employee_id where target.public_id='97000000-0000-4000-8000-000000000411'::uuid and manager.public_id='97000000-0000-4000-8000-000000000401'::uuid and target.manager_source='directory'),'multi-row directory move preserves the directory-owned manager mapping');
update public.employee_profiles set employment_status='departed' where public_id='97000000-0000-4000-8000-000000000402'::uuid;
select ok((select manager_employee_id is null and manager_source='unassigned' from public.employee_profiles where public_id='97000000-0000-4000-8000-000000000402'::uuid),'target departure clears its stale manager relationship');
update public.employee_profiles set employment_status='departed' where public_id='97000000-0000-4000-8000-000000000401'::uuid;
select ok((select manager_employee_id is null and manager_source='unassigned' from public.employee_profiles where public_id='97000000-0000-4000-8000-000000000411'::uuid),'manager departure clears both manual and directory-owned reports');
update public.employee_profiles set employment_status='active',deleted_at=null where public_id in ('97000000-0000-4000-8000-000000000401'::uuid,'97000000-0000-4000-8000-000000000402'::uuid);
update public.employee_profiles target set manager_employee_id=manager.id,manager_source='manual' from public.employee_profiles manager where target.public_id='97000000-0000-4000-8000-000000000402'::uuid and manager.public_id='97000000-0000-4000-8000-000000000401'::uuid;
update public.employee_profiles set deleted_at=clock_timestamp() where public_id='97000000-0000-4000-8000-000000000401'::uuid;
select ok((select manager_employee_id is null and manager_source='unassigned' from public.employee_profiles where public_id='97000000-0000-4000-8000-000000000402'::uuid),'manager soft deletion clears active direct reports');
update public.employee_profiles set deleted_at=null where public_id='97000000-0000-4000-8000-000000000401'::uuid;
update public.employee_profiles target set manager_employee_id=manager.id,manager_source='manual' from public.employee_profiles manager where target.public_id='97000000-0000-4000-8000-000000000402'::uuid and manager.public_id='97000000-0000-4000-8000-000000000401'::uuid;
update public.employee_profiles set deleted_at=clock_timestamp() where public_id='97000000-0000-4000-8000-000000000402'::uuid;
select ok((select manager_employee_id is null and manager_source='unassigned' from public.employee_profiles where public_id='97000000-0000-4000-8000-000000000402'::uuid),'target soft deletion clears its stale manager relationship');
set constraints employee_profiles_manager_invariants deferred;

select ok(exists(select 1 from public.roles role join public.tenants tenant on tenant.id=role.tenant_id where tenant.slug='organization-command-a' and role.code='supervisor' and role.name='主管' and role.is_system and role.is_enabled and role.organization_id is null),'new tenants receive the distinct canonical supervisor role');
select ok(exists(select 1 from public.roles role join public.role_permissions grant_row on grant_row.tenant_id=role.tenant_id and grant_row.role_id=role.id join public.permissions permission on permission.id=grant_row.permission_id join public.tenants tenant on tenant.id=role.tenant_id where tenant.slug='organization-command-a' and role.code='supervisor' and permission.code='employee.supervisor.read') and not exists(select 1 from public.roles role join public.role_permissions grant_row on grant_row.tenant_id=role.tenant_id and grant_row.role_id=role.id join public.permissions permission on permission.id=grant_row.permission_id join public.tenants tenant on tenant.id=role.tenant_id where tenant.slug='organization-command-a' and role.code='supervisor' and permission.code in ('organization.manage','role.manage')),'supervisor receives only its narrow scope permission, never organization administration');
select ok(has_function('public','current_supervisor_employee_projection',array['uuid']::name[]),'protected supervisor projection exists');
select ok(has_function_privilege('authenticated','public.current_supervisor_employee_projection(uuid)','EXECUTE') and not has_function_privilege('anon','public.current_supervisor_employee_projection(uuid)','EXECUTE'),'protected supervisor projection is authenticated-only');
select ok(has_function('public','assign_current_member_manager',array['uuid','uuid','bigint','text','uuid','uuid']::name[]),'manager command carries exact public IDs, version, reason, request and idempotency');
select ok(exists(select 1 from pg_constraint where conrelid='public.employee_profiles'::regclass and conname='employee_profiles_exact_manager_fkey' and pg_get_constraintdef(oid) like '%FOREIGN KEY (tenant_id, organization_id, manager_employee_id) REFERENCES employee_profiles(tenant_id, organization_id, id)%'),'manager foreign key enforces exact tenant and organization');
select ok(not has_column_privilege('authenticated','public.employee_profiles','manager_employee_id','UPDATE') and not has_column_privilege('authenticated','public.employee_profiles','manager_source','UPDATE') and not has_column_privilege('authenticated','public.employee_profiles','manager_version','UPDATE'),'browser roles cannot directly write manager authority or version');
select throws_ok($$ insert into public.roles (tenant_id,organization_id,code,name,description,is_system,is_enabled) select tenant.id,organization.id,'supervisor','Scoped supervisor','Must fail',false,true from public.tenants tenant join public.organizations organization on organization.tenant_id=tenant.id where organization.slug='organization-command-org-a' $$,'23514','Canonical workspace role codes require a global system role','custom scoped supervisor lookalike is rejected');
select is((select count(*) from public.external_identities where organization_member_id=current_setting('test.organization.same_user_secondary_member')::bigint),0::bigint,'second organization membership has no alternate external identity');
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000002',true); set local role authenticated;
select is((public.current_workspace_access()->>'organizationId')::uuid,(select public_id from public.organizations where slug='organization-command-org-a'),'active external identity remains the only selected workspace for a multi-membership user');
select is((select public.assign_current_member_manager(current_setting('test.organization.same_user_secondary_profile')::uuid,current_setting('test.organization.same_user_secondary_profile')::uuid,1,'Attempt alternate membership selection','97000000-0000-4000-8000-000000000191'::uuid,'97000000-0000-4000-8000-000000000192'::uuid)->>'error'),'not_found','active-workspace user cannot select its second membership by target id');
select is((select count(*) from public.current_supervisor_employee_projection(current_setting('test.organization.same_user_secondary_profile')::uuid)),0::bigint,'active-workspace user cannot project its second membership by target id');
reset role;

select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000001',true); set local role authenticated;
select throws_ok($$ select public.assign_current_member_manager(current_setting('test.organization.manager_target')::uuid,current_setting('test.organization.supervisor_profile')::uuid,1,'Employee override','97000000-0000-4000-8000-000000000201'::uuid,'97000000-0000-4000-8000-000000000202'::uuid) $$,'42501','Organization command permission required','ordinary employee cannot assign a manager');
reset role;
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000002',true); set local role authenticated;
select is((select public.assign_current_member_manager(current_setting('test.organization.manager_target')::uuid,current_setting('test.organization.supervisor_profile')::uuid,1,'Establish direct reporting','97000000-0000-4000-8000-000000000211'::uuid,'97000000-0000-4000-8000-000000000212'::uuid)->>'outcome'),'success','authorized manager assignment succeeds');
reset role;
select is((select manager.public_id from public.employee_profiles target join public.employee_profiles manager on manager.id=target.manager_employee_id where target.public_id=current_setting('test.organization.manager_target')::uuid),current_setting('test.organization.supervisor_profile')::uuid,'manager assignment stores the exact selected public manager');
select is((select manager_source from public.employee_profiles where public_id=current_setting('test.organization.manager_target')::uuid),'manual','audited manager assignment records manual authority');
select is((select manager_version from public.employee_profiles where public_id=current_setting('test.organization.manager_target')::uuid),2::bigint,'manager assignment increments its independent optimistic version');
select ok(exists(select 1 from public.audit_logs where request_id='97000000-0000-4000-8000-000000000211'::uuid and action='organization.manager_assigned' and metadata->>'outcome'='success' and metadata->>'businessReason'='Establish direct reporting' and metadata->'before'->>'version'='1' and metadata->'after'->>'version'='2' and metadata->'after'->>'managerSource'='manual'),'manager assignment audit stores safe before, after, reason and version evidence');
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000002',true); set local role authenticated;
select is((select public.assign_current_member_manager(current_setting('test.organization.manager_target')::uuid,current_setting('test.organization.supervisor_profile')::uuid,1,'Lost response replay','97000000-0000-4000-8000-000000000213'::uuid,'97000000-0000-4000-8000-000000000212'::uuid)->>'outcome'),'success','manager assignment lost-response retry replays its stored result');
reset role;
select is((select manager_version from public.employee_profiles where public_id=current_setting('test.organization.manager_target')::uuid),2::bigint,'manager assignment replay does not mutate the version twice');
select is((select count(*) from public.audit_logs where request_id='97000000-0000-4000-8000-000000000211'::uuid and action='organization.manager_assigned'),1::bigint,'manager assignment replay does not duplicate its audit');
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000002',true); set local role authenticated;
select is((select public.assign_current_member_manager(current_setting('test.organization.manager_target')::uuid,current_setting('test.organization.supervisor_profile')::uuid,1,'Stale edit','97000000-0000-4000-8000-000000000221'::uuid,'97000000-0000-4000-8000-000000000222'::uuid)->>'error'),'stale_version','manager assignment rejects a stale manager version');
select is((select public.assign_current_member_manager(current_setting('test.organization.foreign_employee_profile')::uuid,current_setting('test.organization.supervisor_profile')::uuid,1,'Foreign target','97000000-0000-4000-8000-000000000223'::uuid,'97000000-0000-4000-8000-000000000224'::uuid)->>'error'),'not_found','manager assignment hides a cross-organization target');
select is((select public.assign_current_member_manager(current_setting('test.organization.department_head_profile')::uuid,current_setting('test.organization.sales_profile')::uuid,1,'Cross department','97000000-0000-4000-8000-000000000225'::uuid,'97000000-0000-4000-8000-000000000226'::uuid)->>'error'),'forbidden','manager assignment rejects a forbidden cross-department manager');
select is((select public.assign_current_member_manager(current_setting('test.organization.manager_target')::uuid,current_setting('test.organization.manager_target')::uuid,2,'Self manager','97000000-0000-4000-8000-000000000227'::uuid,'97000000-0000-4000-8000-000000000228'::uuid)->>'error'),'manager_cycle','manager assignment rejects a direct reporting cycle');
select is((select public.assign_current_member_manager(current_setting('test.organization.supervisor_profile')::uuid,current_setting('test.organization.manager_target')::uuid,1,'Reverse reporting','97000000-0000-4000-8000-000000000229'::uuid,'97000000-0000-4000-8000-000000000230'::uuid)->>'error'),'manager_cycle','manager assignment rejects a transitive reporting cycle');
reset role;

select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000002',true); set local role authenticated;
select ok((public.current_workspace_access()->'roleCodes') ? 'supervisor','workspace access preserves the exact supervisor role code');
select ok((public.current_workspace_access()->'supervisorScopeEmployeeIds') ? current_setting('test.organization.manager_target'),'supervisor workspace scope contains the exact active direct report');
select ok(not ((public.current_workspace_access()->'supervisorScopeEmployeeIds') ? current_setting('test.organization.department_head_profile')),'supervisor workspace scope excludes an active peer who is not a direct report');
select is((select count(*) from public.current_supervisor_employee_projection(current_setting('test.organization.manager_target')::uuid)),1::bigint,'supervisor protected projection reads an exact direct report');
select is((select count(*) from public.current_supervisor_employee_projection(current_setting('test.organization.department_head_profile')::uuid)),0::bigint,'supervisor protected projection hides an active peer outside direct-report scope');
select is((select count(*) from public.current_supervisor_employee_projection(current_setting('test.organization.foreign_employee_profile')::uuid)),0::bigint,'cross-organization protected projection returns no row');
reset role;
update public.tenants set status='suspended' where slug='organization-command-a';
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000002',true); set local role authenticated;
select is((select count(*) from public.current_supervisor_employee_projection(current_setting('test.organization.manager_target')::uuid)),0::bigint,'suspended tenant denies the direct supervisor projection rpc');
reset role;
update public.tenants set status='active' where slug='organization-command-a';
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000003',true); set local role authenticated;
select ok((public.current_workspace_access()->'supervisorScopeEmployeeIds') ? current_setting('test.organization.manager_target'),'department head workspace scope includes the exact active department');
select is((select count(*) from public.current_supervisor_employee_projection(current_setting('test.organization.manager_target')::uuid)),1::bigint,'department head projection includes the exact active department');
select is((select count(*) from public.current_supervisor_employee_projection(current_setting('test.organization.sales_profile')::uuid)),0::bigint,'department head projection rejects another department');
reset role;
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000005',true); set local role authenticated;
select is(jsonb_array_length(public.current_workspace_access()->'supervisorScopeEmployeeIds'),0,'HR receives no implicit supervisor scope from its separate HR authority');
select ok(exists(select 1 from public.current_employee_directory((select public_id from public.organizations where slug='organization-command-org-a')) where employee_public_id=current_setting('test.organization.manager_target')::uuid),'safe company-wide public directory remains visible across department scope');
reset role;
update public.roles set is_enabled=false where tenant_id=(select id from public.tenants where slug='organization-command-a') and code='supervisor' and organization_id is null;
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000002',true); set local role authenticated;
select is(jsonb_array_length(public.current_workspace_access()->'supervisorScopeEmployeeIds'),0,'disabled supervisor role never authorizes direct-report scope');
reset role;
update public.roles set is_enabled=true where tenant_id=(select id from public.tenants where slug='organization-command-a') and code='supervisor' and organization_id is null;

select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000002',true); set local role authenticated;
select is((select public.assign_current_member_manager(current_setting('test.organization.manager_target')::uuid,current_setting('test.organization.department_head_profile')::uuid,2,'Temporary manual manager before directory sync','97000000-0000-4000-8000-000000000231'::uuid,'97000000-0000-4000-8000-000000000232'::uuid)->>'outcome'),'success','manual relationship can be assigned before directory authority exists');
reset role;

insert into public.identity_providers (tenant_id,provider_code,auth_provider,provider_tenant_key,display_name)
select id,'feishu','custom:feishu','organization-command-feishu-key','Task 8 Feishu' from public.tenants where slug='organization-command-a';
insert into public.directory_connections (tenant_id,organization_id,identity_provider_id,provider_type,external_tenant_key,sync_mode,status)
select tenant.id,organization.id,provider.id,'feishu',provider.provider_tenant_key,'manual','active'
from public.tenants tenant join public.organizations organization on organization.tenant_id=tenant.id join public.identity_providers provider on provider.tenant_id=tenant.id and provider.provider_code='feishu'
where tenant.slug='organization-command-a' and organization.slug='organization-command-org-a';
insert into public.directory_entity_links (tenant_id,organization_id,connection_id,entity_type,external_id,department_id)
select department.tenant_id,department.organization_id,connection.id,'department','od-engineering',department.id
from public.departments department join public.directory_connections connection on connection.tenant_id=department.tenant_id and connection.organization_id=department.organization_id and connection.provider_type='feishu'
where department.code='ENGINEERING';
insert into public.directory_entity_links (tenant_id,organization_id,connection_id,entity_type,external_id,employee_profile_id)
select profile.tenant_id,profile.organization_id,connection.id,'employee','open-'||profile.employee_no,profile.id
from public.employee_profiles profile join public.directory_connections connection on connection.tenant_id=profile.tenant_id and connection.organization_id=profile.organization_id and connection.provider_type='feishu'
where profile.public_id in (current_setting('test.organization.manager_target')::uuid,current_setting('test.organization.supervisor_profile')::uuid,current_setting('test.organization.department_head_profile')::uuid);
insert into public.directory_sync_runs (public_id,tenant_id,organization_id,connection_id,actor_member_id,status,request_id)
select '97000000-0000-4000-8000-000000000240'::uuid,connection.tenant_id,connection.organization_id,connection.id,member.id,'running','97000000-0000-4000-8000-000000000240'::uuid
from public.directory_connections connection join public.organization_members member on member.tenant_id=connection.tenant_id and member.organization_id=connection.organization_id and member.user_id='97000000-0000-4000-8000-000000000002'::uuid
where connection.provider_type='feishu';
update public.directory_sync_runs set status='completed',completed_at=clock_timestamp() where public_id='97000000-0000-4000-8000-000000000240'::uuid;
select is((select manager.public_id from public.employee_profiles target join public.employee_profiles manager on manager.id=target.manager_employee_id where target.public_id=current_setting('test.organization.manager_target')::uuid),current_setting('test.organization.supervisor_profile')::uuid,'directory completion maps the synchronized department leader as manager');
select is((select manager_source from public.employee_profiles where public_id=current_setting('test.organization.manager_target')::uuid),'directory','directory completion records authoritative manager source');
select is((select manager_version from public.employee_profiles where public_id=current_setting('test.organization.manager_target')::uuid),4::bigint,'directory manager replacement increments the optimistic version');
select ok(exists(select 1 from public.feishu_sync_conflicts where organization_id=(select id from public.organizations where slug='organization-command-org-a') and code='RECONCILIATION_DIFFERENCE' and entity_type='user' and status='open'),'directory authority conflict is durable instead of silently overwritten');
select ok(exists(select 1 from public.audit_logs where request_id='97000000-0000-4000-8000-000000000240'::uuid and action='directory.manager_mapped' and metadata->>'outcome'='success'),'directory manager mapping is audited in the completed sync transaction');
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000002',true); set local role authenticated;
select is((select public.assign_current_member_manager(current_setting('test.organization.manager_target')::uuid,current_setting('test.organization.department_head_profile')::uuid,4,'Attempt directory overwrite','97000000-0000-4000-8000-000000000241'::uuid,'97000000-0000-4000-8000-000000000242'::uuid)->>'error'),'directory_manager_owned','manual command cannot silently overwrite directory authority');
reset role;
select is((select manager.public_id from public.employee_profiles target join public.employee_profiles manager on manager.id=target.manager_employee_id where target.public_id=current_setting('test.organization.manager_target')::uuid),current_setting('test.organization.supervisor_profile')::uuid,'directory-owned manager remains unchanged after rejected manual override');
select set_config('request.jwt.claim.sub','97000000-0000-4000-8000-000000000001',true); set local role authenticated;
select throws_ok($$ update public.employee_profiles set manager_employee_id=(select id from public.employee_profiles where public_id=current_setting('test.organization.department_head_profile')::uuid),manager_source='manual' where public_id=current_setting('test.organization.manager_target')::uuid $$,'42501',null,'authenticated browser cannot bypass the manager command with a direct update');
reset role;
select throws_ok($$ update public.employee_profiles set manager_employee_id=(select id from public.employee_profiles where public_id=current_setting('test.organization.manager_target')::uuid),manager_source='manual' where public_id=current_setting('test.organization.supervisor_profile')::uuid $$,'23514','manager_cycle','manager guard rejects a transitive direct-table reporting cycle');
select throws_ok($$ update public.employee_profiles set manager_employee_id=(select id from public.employee_profiles where public_id=current_setting('test.organization.foreign_employee_profile')::uuid),manager_source='manual' where public_id=current_setting('test.organization.department_head_profile')::uuid $$,'23514','Manager must be an active employee in the same tenant and organization','manager guard rejects cross-organization linkage before the exact manager foreign key');

select * from finish(); rollback;
