begin;
select plan(63);

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
select * from finish(); rollback;
