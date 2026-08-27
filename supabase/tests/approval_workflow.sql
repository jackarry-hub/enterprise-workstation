begin;
select plan(86);

select ok(has_table('public','approval_templates'),'versioned approval templates exist');
select ok(has_table('public','approval_command_idempotency'),'approval command ledger exists');
select ok(has_table('public','approval_action_idempotency'),'approval action replay ledger exists');
select ok((select relforcerowsecurity from pg_class
  where oid='public.approval_action_idempotency'::regclass),
  'approval action ledger forces RLS');
select ok(has_function('public','act_on_current_approval',array[
  'uuid','text','integer','text','uuid'
]::name[]),'optimistic approval action RPC exists');
select ok(has_function_privilege(
    'authenticated','public.act_on_current_approval(uuid,text,integer,text,uuid)','EXECUTE'
  ) and not has_function_privilege(
    'anon','public.act_on_current_approval(uuid,text,integer,text,uuid)','EXECUTE'
  ) and not has_function_privilege(
    'service_role','public.act_on_current_approval(uuid,text,integer,text,uuid)','EXECUTE'
  ),'only authenticated sessions can enter approval decisions');
select ok(not has_function_privilege('authenticated','public.current_approval_actor_identity()','EXECUTE')
  and not has_function_privilege('authenticated',
    'public.claim_approval_action(bigint,bigint,bigint,uuid,text,bigint,text,uuid)','EXECUTE')
  and not has_function_privilege('authenticated',
    'public.complete_approval_action(bigint,bigint,uuid,bigint,uuid,uuid,text,text,text,jsonb)','EXECUTE'),
  'approval actor ledger and completion helpers remain internal');
select ok(not has_table_privilege('authenticated','public.approval_action_idempotency','SELECT')
  and not has_table_privilege('service_role','public.approval_action_idempotency','SELECT'),
  'approval action replay internals are private');
select ok(exists(select 1 from pg_trigger where not tgisinternal
    and tgrelid='public.approval_actions'::regclass and tgname='approval_actions_reject_mutation')
  and exists(select 1 from pg_trigger where not tgisinternal
    and tgrelid='public.approval_actions'::regclass and tgname='approval_actions_reject_truncate'),
  'approval actions reject update delete and truncate');
select ok(has_column('public','approvals','tenant_id') and has_column('public','approvals','template_id')
  and has_column('public','approvals','template_version') and has_column('public','approvals','version'),
  'approval instances carry exact tenant template version and optimistic version');
select ok(has_column('public','approval_steps','tenant_id') and has_column('public','approval_actions','tenant_id'),
  'approval child facts carry tenant ownership');
select ok((select bool_and(relforcerowsecurity) from pg_class where oid=any(array[
  'public.approval_templates'::regclass,'public.approval_command_idempotency'::regclass
])), 'template and ledger tables force RLS');
select ok(has_function('public','submit_current_approval',array['uuid','jsonb','uuid','uuid']::name[]),
  'transactional approval submission RPC exists');
select ok(has_function_privilege('authenticated','public.submit_current_approval(uuid,jsonb,uuid,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.submit_current_approval(uuid,jsonb,uuid,uuid)','EXECUTE')
  and not has_function_privilege('service_role','public.submit_current_approval(uuid,jsonb,uuid,uuid)','EXECUTE'),
  'only authenticated sessions can enter approval submission');
select ok(not has_table_privilege('authenticated','public.approvals','INSERT')
  and not has_table_privilege('authenticated','public.approval_steps','INSERT')
  and not has_table_privilege('authenticated','public.approval_actions','INSERT'),
  'browser sessions cannot bypass approval commands with direct writes');
select ok(not has_table_privilege('authenticated','public.approval_command_idempotency','SELECT')
  and not has_table_privilege('service_role','public.approval_command_idempotency','SELECT'),
  'approval idempotency internals are private');
select ok(has_table_privilege('authenticated','public.approval_templates','SELECT')
  and not has_table_privilege('anon','public.approval_templates','SELECT')
  and not has_table_privilege('service_role','public.approval_templates','SELECT'),
  'only authenticated members can read active approval templates through RLS');
select ok(not has_function_privilege('authenticated','public.is_valid_approval_form(jsonb,jsonb)','EXECUTE')
  and not has_function_privilege('authenticated','public.claim_approval_command(bigint,bigint,bigint,text,jsonb,uuid,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.complete_approval_submission(bigint,bigint,uuid,bigint,uuid,uuid,uuid,text,text,jsonb)','EXECUTE'),
  'approval validation ledger and completion helpers remain internal');
select ok(has_function_privilege('authenticated','public.can_read_current_approval_template(bigint,bigint)','EXECUTE')
  and not has_function_privilege('anon','public.can_read_current_approval_template(bigint,bigint)','EXECUTE')
  and not has_function_privilege('service_role','public.can_read_current_approval_template(bigint,bigint)','EXECUTE'),
  'only authenticated RLS evaluation can use the exact template organization helper');
select ok((select qual::text ilike '%can_read_current_approval_template%'
  from pg_policies where schemaname='public' and tablename='approval_templates'
    and policyname='approval_templates_member_select'),
  'template RLS binds reads to the exact current external identity organization');
select ok(exists(select 1 from pg_trigger where not tgisinternal
  and tgrelid='public.approval_templates'::regclass and tgname='approval_templates_reject_update_delete'),
  'template versions reject ordinary mutation');
select ok(exists(select 1 from pg_trigger where not tgisinternal
  and tgrelid='public.organizations'::regclass and tgname='organizations_seed_default_approval_templates'),
  'future organizations receive bounded default templates');
select ok(exists(select 1 from pg_trigger where not tgisinternal
  and tgrelid='public.roles'::regclass and tgname='roles_approval_submit_after_insert'),
  'future canonical employee roles receive submission permission');
select ok(not exists(select 1 from public.default_approval_template_catalog() template
  where template.approval_type='leave'),'commercial template catalog excludes leave');
select is((select count(*) from public.default_approval_template_catalog()),3::bigint,
  'default catalog is bounded to reimbursement purchase and contract');
select ok(not exists(select 1 from public.default_approval_template_catalog() template
  where not public.is_valid_approval_template_definition(template.form_schema,template.step_definitions)),
  'every default template satisfies the strict definition contract');
select ok(public.is_valid_approval_form(
  '{"fields":[{"key":"amount","label":"金额","type":"money","required":true}]}'::jsonb,
  '{"amount":"12.30"}'::jsonb),'fixed precision money passes template validation');
select ok(not public.is_valid_approval_form(
  '{"fields":[{"key":"amount","label":"金额","type":"money","required":true}]}'::jsonb,
  '{"amount":"12.345"}'::jsonb),'over-precision money fails template validation');
select ok(not public.is_valid_approval_form(
  '{"fields":[{"key":"amount","label":"金额","type":"money","required":true}]}'::jsonb,
  '{"amount":"12.30","actorId":"spoof"}'::jsonb),'unknown form fields fail closed');
select ok(not public.is_valid_approval_template_definition(
  '{"fields":[{"key":"reason","label":42,"type":"text","required":true,"maxLength":200}]}'::jsonb,
  '[{"name":"审批","approverRule":{"kind":"applicant_manager"}}]'::jsonb),
  'template labels must be nonblank bounded strings');
select ok(not public.is_valid_approval_template_definition(
  '{"fields":[{"key":"reason","label":"原因","type":"text","required":true,"maxLength":1.5}]}'::jsonb,
  '[{"name":"审批","approverRule":{"kind":"applicant_manager"}}]'::jsonb),
  'text maxLength must be a bounded positive integer');

insert into public.tenants(name,slug,status) values
  ('Approval tenant A','approval-workflow-a','active'),
  ('Approval tenant B','approval-workflow-b','active');
insert into public.organizations(tenant_id,name,slug)
select tenant.id,seed.name,seed.slug from public.tenants tenant
join (values
  ('approval-workflow-a','Approval org A','approval-org-a'),
  ('approval-workflow-b','Approval org B','approval-org-b')
) seed(tenant_slug,name,slug) on seed.tenant_slug=tenant.slug;
insert into public.departments(tenant_id,organization_id,code,name)
select organization.tenant_id,organization.id,'APPROVAL','审批测试部'
from public.organizations organization where organization.slug='approval-org-a';
insert into public.identity_providers(
  tenant_id,provider_code,auth_provider,provider_tenant_key,display_name,status
)
select id,'approval-test','custom:approval-test',slug||'-provider','Approval test identity','active'
from public.tenants where slug in ('approval-workflow-a','approval-workflow-b');
insert into auth.users(
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
  ('00000000-0000-0000-0000-000000000000','c1000000-0000-4000-8000-000000000001','authenticated','authenticated','approval-applicant@example.test',crypt('local-e2e-password',gen_salt('bf')),now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','c1000000-0000-4000-8000-000000000002','authenticated','authenticated','approval-manager@example.test',crypt('local-e2e-password',gen_salt('bf')),now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','c1000000-0000-4000-8000-000000000003','authenticated','authenticated','approval-finance@example.test',crypt('local-e2e-password',gen_salt('bf')),now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','c1000000-0000-4000-8000-000000000004','authenticated','authenticated','approval-outsider@example.test',crypt('local-e2e-password',gen_salt('bf')),now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','c1000000-0000-4000-8000-000000000005','authenticated','authenticated','approval-other-tenant@example.test',crypt('local-e2e-password',gen_salt('bf')),now(),'{}','{}',now(),now());
insert into public.organization_members(tenant_id,organization_id,user_id,status)
select tenant.id,organization.id,seed.user_id,'active'
from (values
  ('approval-workflow-a','approval-org-a','c1000000-0000-4000-8000-000000000001'::uuid),
  ('approval-workflow-a','approval-org-a','c1000000-0000-4000-8000-000000000002'::uuid),
  ('approval-workflow-a','approval-org-a','c1000000-0000-4000-8000-000000000003'::uuid),
  ('approval-workflow-a','approval-org-a','c1000000-0000-4000-8000-000000000004'::uuid),
  ('approval-workflow-b','approval-org-b','c1000000-0000-4000-8000-000000000005'::uuid)
) seed(tenant_slug,organization_slug,user_id)
join public.tenants tenant on tenant.slug=seed.tenant_slug
join public.organizations organization on organization.tenant_id=tenant.id and organization.slug=seed.organization_slug;
insert into public.employee_profiles(
  tenant_id,organization_id,organization_member_id,employee_no,display_name,
  department_id,job_title,employment_type,employment_status
)
select member.tenant_id,member.organization_id,member.id,'APR-'||member.id,
  split_part(user_row.email,'@',1),case when user_row.email='approval-manager@example.test'
    then (select department.id from public.departments department
      where department.tenant_id=member.tenant_id and department.organization_id=member.organization_id
        and department.code='APPROVAL') else null end,
  'Approval member','full_time','active'
from public.organization_members member join auth.users user_row on user_row.id=member.user_id
where user_row.email in (
  'approval-manager@example.test','approval-finance@example.test',
  'approval-outsider@example.test','approval-other-tenant@example.test'
);
insert into public.employee_profiles(
  tenant_id,organization_id,organization_member_id,employee_no,display_name,
  department_id,job_title,employment_type,employment_status,manager_employee_id,manager_source
)
select member.tenant_id,member.organization_id,member.id,'APR-'||member.id,
  'approval-applicant',department.id,'Approval applicant','full_time','active',manager.id,'manual'
from public.organization_members member
join auth.users user_row on user_row.id=member.user_id and user_row.email='approval-applicant@example.test'
join public.employee_profiles manager on manager.tenant_id=member.tenant_id
  and manager.organization_id=member.organization_id and manager.display_name='approval-manager'
join public.departments department on department.tenant_id=member.tenant_id
  and department.organization_id=member.organization_id and department.code='APPROVAL';
insert into public.external_identities(
  tenant_id,organization_id,organization_member_id,identity_provider_id,
  provider_subject,provider_tenant_key,auth_user_id,status
)
select member.tenant_id,member.organization_id,member.id,provider.id,
  user_row.id::text,provider.provider_tenant_key,user_row.id,'active'
from public.organization_members member join auth.users user_row on user_row.id=member.user_id
join public.identity_providers provider on provider.tenant_id=member.tenant_id
  and provider.provider_code='approval-test'
where user_row.email like 'approval-%@example.test';
insert into public.member_roles(tenant_id,member_id,role_id)
select member.tenant_id,member.id,role.id
from public.organization_members member join auth.users user_row on user_row.id=member.user_id
join public.roles role on role.tenant_id=member.tenant_id and role.organization_id is null
  and role.code=case
    when user_row.email='approval-manager@example.test' then 'supervisor'
    when user_row.email='approval-finance@example.test' then 'finance'
    else 'employee' end
where user_row.email like 'approval-%@example.test';

insert into public.roles(tenant_id,organization_id,code,name,description,is_system,is_enabled)
select organization.tenant_id,organization.id,'approval_test_reviewer','审批测试复核人',
  'Approval workflow role availability fixture',false,true
from public.organizations organization where organization.slug='approval-org-a';
insert into public.member_roles(tenant_id,member_id,role_id)
select member.tenant_id,member.id,role.id
from public.organization_members member
join auth.users user_row on user_row.id=member.user_id
join public.roles role on role.tenant_id=member.tenant_id
  and role.organization_id=member.organization_id and role.code='approval_test_reviewer'
where user_row.email='approval-outsider@example.test';

select is((select count(*) from public.approval_templates template
  join public.organizations organization on organization.tenant_id=template.tenant_id
    and organization.id=template.organization_id
  where organization.slug in ('approval-org-a','approval-org-b')),6::bigint,
  'organization trigger provisions three real templates per new organization');
select ok(not exists(select 1 from public.roles role
  join public.permissions permission on permission.code='approval.submit'
  left join public.role_permissions assignment on assignment.tenant_id=role.tenant_id
    and assignment.role_id=role.id and assignment.permission_id=permission.id
  where role.tenant_id in (select id from public.tenants where slug like 'approval-workflow-%')
    and public.is_approval_submit_baseline_role(role.is_system,role.is_enabled,role.organization_id,role.code)
    and assignment.role_id is null),'new canonical roles receive approval.submit');
update public.roles role set is_enabled=false where role.code='employee' and role.is_system
  and role.organization_id is null
  and role.tenant_id=(select tenant.id from public.tenants tenant where tenant.slug='approval-workflow-a');
select ok(not exists(select 1 from public.roles role
  join public.role_permissions assignment on assignment.tenant_id=role.tenant_id
    and assignment.role_id=role.id
  join public.permissions permission on permission.id=assignment.permission_id
  where role.code='employee' and role.tenant_id=(
    select tenant.id from public.tenants tenant where tenant.slug='approval-workflow-a'
  ) and permission.code='approval.submit'),
  'disabling a canonical submission role revokes approval.submit');
update public.roles role set is_enabled=true where role.code='employee' and role.is_system
  and role.organization_id is null
  and role.tenant_id=(select tenant.id from public.tenants tenant where tenant.slug='approval-workflow-a');
select ok(exists(select 1 from public.roles role
  join public.role_permissions assignment on assignment.tenant_id=role.tenant_id
    and assignment.role_id=role.id
  join public.permissions permission on permission.id=assignment.permission_id
  where role.code='employee' and role.is_enabled and role.tenant_id=(
    select tenant.id from public.tenants tenant where tenant.slug='approval-workflow-a'
  ) and permission.code='approval.submit'),
  're-enabling a canonical submission role restores approval.submit');
select set_config('test.approval.template_a',(select template.public_id::text
  from public.approval_templates template join public.organizations organization
    on organization.tenant_id=template.tenant_id and organization.id=template.organization_id
where organization.slug='approval-org-a' and template.template_key='expense_reimbursement'),true);

insert into public.approval_templates(
  tenant_id,organization_id,template_key,version,approval_type,title,description,form_schema,step_definitions
)
select organization.tenant_id,organization.id,seed.template_key,1,'purchase',seed.title,
  'Approval workflow availability fixture',
  '{"fields":[{"key":"reason","label":"申请原因","type":"text","required":true,"maxLength":200}]}'::jsonb,
  seed.steps
from public.organizations organization
cross join (values
  ('fixed_reviewer_test','指定人员审批',jsonb_build_array(jsonb_build_object(
    'name','指定人员复核','approverRule',jsonb_build_object('kind','employee','employeePublicId',(
      select profile.public_id::text from public.employee_profiles profile
      join public.organization_members member on member.tenant_id=profile.tenant_id
        and member.organization_id=profile.organization_id and member.id=profile.organization_member_id
      join auth.users user_row on user_row.id=member.user_id
      where user_row.email='approval-outsider@example.test'
    ))))),
  ('role_reviewer_test','角色审批','[{"name":"角色复核","approverRule":{"kind":"role","roleCode":"approval_test_reviewer"}}]'::jsonb)
) seed(template_key,title,steps)
where organization.slug='approval-org-a';
select set_config('test.approval.fixed_template',(select template.public_id::text
  from public.approval_templates template join public.organizations organization
    on organization.tenant_id=template.tenant_id and organization.id=template.organization_id
  where organization.slug='approval-org-a' and template.template_key='fixed_reviewer_test'),true);
select set_config('test.approval.role_template',(select template.public_id::text
  from public.approval_templates template join public.organizations organization
    on organization.tenant_id=template.tenant_id and organization.id=template.organization_id
  where organization.slug='approval-org-a' and template.template_key='role_reviewer_test'),true);
insert into public.organizations(tenant_id,name,slug)
select tenant.id,'Approval shadow org','approval-org-a-shadow'
from public.tenants tenant where tenant.slug='approval-workflow-a';
insert into public.organization_members(tenant_id,organization_id,user_id,status)
select organization.tenant_id,organization.id,user_row.id,'active'
from public.organizations organization
join auth.users user_row on user_row.email='approval-applicant@example.test'
where organization.slug='approval-org-a-shadow';
insert into public.employee_profiles(
  tenant_id,organization_id,organization_member_id,employee_no,display_name,
  job_title,employment_type,employment_status
)
select member.tenant_id,member.organization_id,member.id,'APR-SHADOW-'||member.id,
  'approval-applicant-shadow','Approval shadow member','full_time','active'
from public.organization_members member
join public.organizations organization on organization.tenant_id=member.tenant_id
  and organization.id=member.organization_id and organization.slug='approval-org-a-shadow'
join auth.users user_row on user_row.id=member.user_id
  and user_row.email='approval-applicant@example.test';
insert into public.member_roles(tenant_id,member_id,role_id)
select member.tenant_id,member.id,role.id
from public.organization_members member
join public.organizations organization on organization.tenant_id=member.tenant_id
  and organization.id=member.organization_id and organization.slug='approval-org-a-shadow'
join auth.users user_row on user_row.id=member.user_id
  and user_row.email='approval-applicant@example.test'
join public.roles role on role.tenant_id=member.tenant_id and role.organization_id is null
  and role.code='employee';
select set_config('test.approval.shadow_org',(select organization.id::text
  from public.organizations organization where organization.slug='approval-org-a-shadow'),true);
select ok(exists(select 1 from public.organization_members member
  join public.employee_profiles profile on profile.tenant_id=member.tenant_id
    and profile.organization_id=member.organization_id and profile.organization_member_id=member.id
  join public.organizations organization on organization.tenant_id=member.tenant_id
    and organization.id=member.organization_id and organization.slug='approval-org-a-shadow'
  where member.user_id='c1000000-0000-4000-8000-000000000001'
    and member.status='active' and profile.employment_status='active'
    and not exists(select 1 from public.external_identities external
      where external.tenant_id=member.tenant_id and external.organization_id=member.organization_id
        and external.auth_user_id=member.user_id)),
  'same-tenant shadow membership is active but has no selected external identity');
update public.organization_members member set status='suspended'
from auth.users user_row where user_row.id=member.user_id
  and user_row.email='approval-outsider@example.test';

create or replace function public.test_approval_reject_step()
returns trigger language plpgsql set search_path='' as $$
begin
  if current_setting('test.approval.inject_step_failure',true)='on' then
    raise exception 'injected approval step failure';
  end if;
  return new;
end;
$$;
create trigger test_approval_reject_step before insert on public.approval_steps
for each row execute function public.test_approval_reject_step();
create or replace function public.test_approval_reject_action()
returns trigger language plpgsql set search_path='' as $$
begin
  if current_setting('test.approval.inject_action_failure',true)='on' then
    raise exception 'injected approval action failure';
  end if;
  return new;
end;
$$;
create trigger test_approval_reject_action before insert on public.approval_actions
for each row execute function public.test_approval_reject_action();

select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select set_config('test.approval.inject_step_failure','on',true);
select set_config('test.approval.failed',public.submit_current_approval(
  current_setting('test.approval.template_a')::uuid,
  '{"amount":"1280.50","purpose":"客户现场差旅","expenseDate":"2026-08-28","costType":"travel"}'::jsonb,
  'c2000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000002'
)::text,true);
select set_config('test.approval.inject_step_failure','off',true);
select set_config('test.approval.failed_replay',public.submit_current_approval(
  current_setting('test.approval.template_a')::uuid,
  '{"amount":"1280.50","purpose":"客户现场差旅","expenseDate":"2026-08-28","costType":"travel"}'::jsonb,
  'c2000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000002'
)::text,true);
select set_config('test.approval.valid',public.submit_current_approval(
  current_setting('test.approval.template_a')::uuid,
  '{"amount":"1280.50","purpose":"客户现场差旅","expenseDate":"2026-08-28","costType":"travel"}'::jsonb,
  'c2000000-0000-4000-8000-000000000003','c2000000-0000-4000-8000-000000000004'
)::text,true);
select set_config('test.approval.valid_replay',public.submit_current_approval(
  current_setting('test.approval.template_a')::uuid,
  '{"amount":"1280.50","purpose":"客户现场差旅","expenseDate":"2026-08-28","costType":"travel"}'::jsonb,
  'c2000000-0000-4000-8000-000000000003','c2000000-0000-4000-8000-000000000004'
)::text,true);
select set_config('test.approval.invalid_form',public.submit_current_approval(
  current_setting('test.approval.template_a')::uuid,
  '{"amount":"12.345","purpose":"精度非法","expenseDate":"2026-08-28","costType":"travel"}'::jsonb,
  'c2000000-0000-4000-8000-000000000005','c2000000-0000-4000-8000-000000000006'
)::text,true);
select set_config('test.approval.template_missing',public.submit_current_approval(
  'c3000000-0000-4000-8000-000000000001','{}'::jsonb,
  'c2000000-0000-4000-8000-000000000007','c2000000-0000-4000-8000-000000000008'
)::text,true);
select set_config('test.approval.suspended_approver',public.submit_current_approval(
  current_setting('test.approval.fixed_template')::uuid,
  '{"reason":"暂停成员不得审批"}'::jsonb,
  'c2000000-0000-4000-8000-000000000013','c2000000-0000-4000-8000-000000000014'
)::text,true);
select set_config('test.approval.applicant_visible',(select count(*)::text from public.approvals),true);
select set_config('test.approval.shadow_templates',(select count(*)::text
  from public.approval_templates template
  where template.organization_id=current_setting('test.approval.shadow_org')::bigint),true);
select set_config('test.approval.shadow_helper',public.can_read_current_approval_template(
  (select organization.tenant_id from public.organizations organization
    where organization.id=current_setting('test.approval.shadow_org')::bigint),
  current_setting('test.approval.shadow_org')::bigint
)::text,true);
select throws_ok(
  $$insert into public.approval_actions(tenant_id,organization_id,approval_id,actor_employee_id,action_type)
    select approval.tenant_id,approval.organization_id,approval.id,approval.applicant_employee_id,'comment'
    from public.approvals approval limit 1$$,
  '42501',null,'authenticated applicant cannot directly append approval actions'
);
select throws_ok(
  $$select public.act_on_current_approval(
    (current_setting('test.approval.valid')::jsonb->>'id')::uuid,
    'reject',1,E'\t\n','c4000000-0000-4000-8000-000000000011')$$,
  '22023','Approval action is invalid','tab and newline-only decision reason fails at the RPC boundary'
);
select throws_ok(
  $$select public.act_on_current_approval(
    (current_setting('test.approval.valid')::jsonb->>'id')::uuid,
    'return',1,U&'\00A0\3000','c4000000-0000-4000-8000-000000000012')$$,
  '22023','Approval action is invalid','unicode whitespace-only decision reason fails at the RPC boundary'
);
select set_config('test.approval.applicant_action',public.act_on_current_approval(
  (current_setting('test.approval.valid')::jsonb->>'id')::uuid,
  'approve',1,null,'c4000000-0000-4000-8000-000000000001'
)::text,true);
select set_config('test.approval.reject_case',public.submit_current_approval(
  current_setting('test.approval.template_a')::uuid,
  '{"amount":"200.00","purpose":"驳回链路","expenseDate":"2026-08-28","costType":"office"}'::jsonb,
  'c2000000-0000-4000-8000-000000000019','c2000000-0000-4000-8000-000000000020'
)::text,true);
select set_config('test.approval.return_case',public.submit_current_approval(
  current_setting('test.approval.template_a')::uuid,
  '{"amount":"300.00","purpose":"退回链路","expenseDate":"2026-08-28","costType":"other"}'::jsonb,
  'c2000000-0000-4000-8000-000000000021','c2000000-0000-4000-8000-000000000022'
)::text,true);
select set_config('test.approval.cancel_case',public.submit_current_approval(
  current_setting('test.approval.template_a')::uuid,
  '{"amount":"400.00","purpose":"取消链路","expenseDate":"2026-08-28","costType":"transport"}'::jsonb,
  'c2000000-0000-4000-8000-000000000023','c2000000-0000-4000-8000-000000000024'
)::text,true);
select set_config('test.approval.cancel_action',public.act_on_current_approval(
  (current_setting('test.approval.cancel_case')::jsonb->>'id')::uuid,
  'cancel',1,'申请内容有误','c4000000-0000-4000-8000-000000000002'
)::text,true);
select set_config('test.approval.self_case',public.submit_current_approval(
  current_setting('test.approval.template_a')::uuid,
  '{"amount":"500.00","purpose":"历史自审批防护","expenseDate":"2026-08-28","costType":"other"}'::jsonb,
  'c2000000-0000-4000-8000-000000000025','c2000000-0000-4000-8000-000000000026'
)::text,true);
select set_config('test.approval.action_failure_case',public.submit_current_approval(
  current_setting('test.approval.template_a')::uuid,
  '{"amount":"600.00","purpose":"动作回滚验证","expenseDate":"2026-08-28","costType":"other"}'::jsonb,
  'c2000000-0000-4000-8000-000000000027','c2000000-0000-4000-8000-000000000028'
)::text,true);
reset role;

select is(current_setting('test.approval.failed')::jsonb->>'error','command_failed',
  'nested step failure returns durable command failure');
select is(current_setting('test.approval.failed_replay')::jsonb,current_setting('test.approval.failed')::jsonb,
  'failed approval submission replays exact terminal result');
select ok(not exists(select 1 from public.approvals approval where approval.public_id=(
  select ledger.target_public_id from public.approval_command_idempotency ledger
  where ledger.idempotency_key='c2000000-0000-4000-8000-000000000001')),
  'failed step insert rolls back approval and child facts');
select ok(exists(select 1 from public.audit_logs where request_id='c2000000-0000-4000-8000-000000000002'
  and action='approval.command_failed' and metadata->>'failure'='command_failed'),
  'failed approval submission persists audit evidence');
select is(current_setting('test.approval.valid')::jsonb->>'outcome','success','valid approval submission succeeds');
select is(current_setting('test.approval.valid_replay')::jsonb,current_setting('test.approval.valid')::jsonb,
  'successful approval submission replays exact canonical result');
select is((select count(*) from public.approvals approval
  where approval.public_id=(current_setting('test.approval.valid')::jsonb->>'id')::uuid),1::bigint,
  'idempotent submission creates one approval instance');
select is((select count(*) from public.approval_steps step join public.approvals approval on approval.id=step.approval_id
  where approval.public_id=(current_setting('test.approval.valid')::jsonb->>'id')::uuid),2::bigint,
  'submission resolves and persists every server-owned approval step');
select ok((select approval.owner_employee_id=manager.id and approval.current_step_order=1 and approval.version=1
  from public.approvals approval join public.employee_profiles manager on manager.id=approval.owner_employee_id
  where approval.public_id=(current_setting('test.approval.valid')::jsonb->>'id')::uuid
    and manager.display_name='approval-manager'),'first resolved manager owns the pending approval');
select is((select count(*) from public.approval_actions action join public.approvals approval on approval.id=action.approval_id
  where approval.public_id=(current_setting('test.approval.valid')::jsonb->>'id')::uuid
    and action.action_type='submit'),1::bigint,'submission appends one immutable submit action');
select is(current_setting('test.approval.invalid_form')::jsonb->>'error','invalid_form',
  'stored template rejects invalid fixed precision form data');
select is(current_setting('test.approval.template_missing')::jsonb->>'error','template_not_found',
  'unknown template fails without tenant disclosure');
select is(current_setting('test.approval.suspended_approver')::jsonb->>'error','approver_unavailable',
  'suspended fixed approver fails closed');
select ok(exists(select 1 from public.audit_logs where request_id='c2000000-0000-4000-8000-000000000004'
  and action='approval.submitted' and not metadata::text like '%客户现场差旅%'),
  'approval audit records digests without raw form content');
select is(current_setting('test.approval.applicant_visible')::bigint,1::bigint,
  'applicant sees only the successfully committed participant approval');
select is(current_setting('test.approval.shadow_templates')::bigint,0::bigint,
  'authenticated member cannot read templates from another organization in the same tenant');
select is(current_setting('test.approval.shadow_helper'),'false',
  'exact external identity helper rejects the same-tenant shadow organization');
select is(current_setting('test.approval.applicant_action')::jsonb->>'error','forbidden',
  'applicant cannot approve their own pending request');
select ok((select approval.status='cancelled' and approval.version=2
    and approval.completed_at is not null and approval.current_step_order is null
    and not exists(select 1 from public.approval_steps step
      where step.approval_id=approval.id and step.status<>'skipped')
    and exists(select 1 from public.approval_actions action
      where action.approval_id=approval.id and action.action_type='cancel'
        and action.content='申请内容有误')
  from public.approvals approval
  where approval.public_id=(current_setting('test.approval.cancel_case')::jsonb->>'id')::uuid),
  'applicant cancellation terminates versions and closes every pending fact');

update public.approval_steps step set approver_employee_id=approval.applicant_employee_id
from public.approvals approval
where approval.id=step.approval_id and step.step_order=1
  and approval.public_id=(current_setting('test.approval.self_case')::jsonb->>'id')::uuid;
update public.approvals approval set owner_employee_id=approval.applicant_employee_id
where approval.public_id=(current_setting('test.approval.self_case')::jsonb->>'id')::uuid;
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select set_config('test.approval.self_action',public.act_on_current_approval(
  (current_setting('test.approval.self_case')::jsonb->>'id')::uuid,
  'approve',1,null,'c4000000-0000-4000-8000-000000000010'
)::text,true);
reset role;
select ok(current_setting('test.approval.self_action')::jsonb->>'error'='forbidden'
  and (select approval.version=1 and approval.status='pending'
    from public.approvals approval
    where approval.public_id=(current_setting('test.approval.self_case')::jsonb->>'id')::uuid),
  'historical self-approval rows remain impossible to decide');

update public.organization_members member set status='active'
from auth.users user_row where user_row.id=member.user_id
  and user_row.email='approval-outsider@example.test';
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000004',true);
set local role authenticated;
select set_config('test.approval.outsider_visible',(select count(*)::text from public.approvals),true);
select set_config('test.approval.no_manager',public.submit_current_approval(
  current_setting('test.approval.template_a')::uuid,
  '{"amount":"10.00","purpose":"无主管验证","expenseDate":"2026-08-28","costType":"other"}'::jsonb,
  'c2000000-0000-4000-8000-000000000009','c2000000-0000-4000-8000-000000000010'
)::text,true);
select set_config('test.approval.unrelated_action',public.act_on_current_approval(
  (current_setting('test.approval.reject_case')::jsonb->>'id')::uuid,
  'approve',1,null,'c4000000-0000-4000-8000-000000000003'
)::text,true);
reset role;
select is(current_setting('test.approval.outsider_visible')::bigint,0::bigint,
  'unrelated organization employee cannot read another approval');
select is(current_setting('test.approval.no_manager')::jsonb->>'error','approver_unavailable',
  'missing server-owned manager fails explicitly without fabricating an approver');
select is(current_setting('test.approval.unrelated_action')::jsonb->>'error','forbidden',
  'unrelated employee cannot decide another participant approval');

select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select set_config('test.approval.inject_action_failure','on',true);
select set_config('test.approval.action_failure',public.act_on_current_approval(
  (current_setting('test.approval.action_failure_case')::jsonb->>'id')::uuid,
  'reject',1,'注入动作写入失败','c4000000-0000-4000-8000-000000000009'
)::text,true);
select set_config('test.approval.inject_action_failure','off',true);
select set_config('test.approval.action_failure_replay',public.act_on_current_approval(
  (current_setting('test.approval.action_failure_case')::jsonb->>'id')::uuid,
  'reject',1,'注入动作写入失败','c4000000-0000-4000-8000-000000000009'
)::text,true);
select set_config('test.approval.manager_approve',public.act_on_current_approval(
  (current_setting('test.approval.valid')::jsonb->>'id')::uuid,
  'approve',1,'同意推进','c4000000-0000-4000-8000-000000000004'
)::text,true);
select set_config('test.approval.manager_replay',public.act_on_current_approval(
  (current_setting('test.approval.valid')::jsonb->>'id')::uuid,
  'approve',1,'同意推进','c4000000-0000-4000-8000-000000000004'
)::text,true);
select set_config('test.approval.manager_reject',public.act_on_current_approval(
  (current_setting('test.approval.reject_case')::jsonb->>'id')::uuid,
  'reject',1,'预算依据不足','c4000000-0000-4000-8000-000000000005'
)::text,true);
select set_config('test.approval.manager_return',public.act_on_current_approval(
  (current_setting('test.approval.return_case')::jsonb->>'id')::uuid,
  'return',1,'请补充业务说明','c4000000-0000-4000-8000-000000000006'
)::text,true);
reset role;
select is(current_setting('test.approval.action_failure')::jsonb->>'error','command_failed',
  'injected decision action failure returns a bounded durable failure');
select is(current_setting('test.approval.action_failure_replay')::jsonb,
  current_setting('test.approval.action_failure')::jsonb,
  'failed decision replays the exact terminal failure');
select ok((select approval.version=1 and approval.status='pending'
    and exists(select 1 from public.approval_steps step where step.approval_id=approval.id
      and step.step_order=1 and step.status='pending' and step.acted_at is null)
    and not exists(select 1 from public.approval_actions action
      where action.approval_id=approval.id and action.action_type='reject')
  from public.approvals approval
  where approval.public_id=(current_setting('test.approval.action_failure_case')::jsonb->>'id')::uuid),
  'decision action failure rolls back approval step and action facts atomically');
select ok(exists(select 1 from public.audit_logs audit
  where audit.request_id='c4000000-0000-4000-8000-000000000009'
    and audit.action='approval.command_failed' and audit.metadata->>'failure'='command_failed'),
  'failed decision persists bounded audit evidence outside the mutation subtransaction');
select ok(current_setting('test.approval.manager_approve')::jsonb->>'outcome'='success'
  and (current_setting('test.approval.manager_approve')::jsonb->>'version')::bigint=2
  and (current_setting('test.approval.manager_approve')::jsonb->'entity'->>'currentStepOrder')::integer=2,
  'current manager advances exactly one optimistic version and one step');
select is(current_setting('test.approval.manager_replay')::jsonb,
  current_setting('test.approval.manager_approve')::jsonb,
  'same approval action request replays the exact canonical result');
select ok((select action.actor_employee_id=manager.id
  from public.approval_actions action
  join public.approvals approval on approval.id=action.approval_id
  join public.employee_profiles manager on manager.id=action.actor_employee_id
  where approval.public_id=(current_setting('test.approval.valid')::jsonb->>'id')::uuid
    and action.action_type='approve' and manager.display_name='approval-manager'),
  'decision actor is derived from the exact authenticated employee');
select ok(current_setting('test.approval.manager_reject')::jsonb->'entity'->>'status'='rejected'
  and exists(select 1 from public.approvals approval
    join public.approval_steps step on step.approval_id=approval.id and step.step_order=1
    join public.approval_actions action on action.approval_id=approval.id and action.action_type='reject'
    where approval.public_id=(current_setting('test.approval.reject_case')::jsonb->>'id')::uuid
      and approval.completed_at is not null and step.status='rejected' and step.acted_at is not null
      and action.content='预算依据不足'
      and not exists(select 1 from public.approval_steps later
        where later.approval_id=approval.id and later.step_order>1 and later.status<>'skipped')),
  'current manager rejection persists terminal step action and skipped successors');
select ok(current_setting('test.approval.manager_return')::jsonb->'entity'->>'status'='returned'
  and exists(select 1 from public.approvals approval
    join public.approval_steps step on step.approval_id=approval.id and step.step_order=1
    join public.approval_actions action on action.approval_id=approval.id and action.action_type='return'
    where approval.public_id=(current_setting('test.approval.return_case')::jsonb->>'id')::uuid
      and approval.completed_at is not null and step.status='returned' and step.acted_at is not null
      and action.content='请补充业务说明'
      and not exists(select 1 from public.approval_steps later
        where later.approval_id=approval.id and later.step_order>1 and later.status<>'skipped')),
  'current manager return persists terminal step action and skipped successors');
select ok(exists(select 1 from public.audit_logs audit
  where audit.request_id='c4000000-0000-4000-8000-000000000004'
    and audit.action='approval.step_approved'
    and audit.metadata->>'resultingStatus'='pending'
    and (audit.metadata->>'resultingVersion')::bigint=2
    and (audit.metadata->>'currentStepOrder')::integer=2),
  'intermediate approval emits a distinct step audit with bounded next-state metadata');

select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000003',true);
set local role authenticated;
select set_config('test.approval.finance_conflict',public.act_on_current_approval(
  (current_setting('test.approval.valid')::jsonb->>'id')::uuid,
  'approve',1,null,'c4000000-0000-4000-8000-000000000007'
)::text,true);
select set_config('test.approval.finance_approve',public.act_on_current_approval(
  (current_setting('test.approval.valid')::jsonb->>'id')::uuid,
  'approve',2,'财务复核通过','c4000000-0000-4000-8000-000000000008'
)::text,true);
select set_config('test.approval.action_scope_conflict',public.act_on_current_approval(
  (current_setting('test.approval.valid')::jsonb->>'id')::uuid,
  'reject',2,'复用请求攻击','c4000000-0000-4000-8000-000000000008'
)::text,true);
reset role;
select is(current_setting('test.approval.finance_conflict')::jsonb->>'error','conflict',
  'stale current approver receives an optimistic version conflict');
select ok(current_setting('test.approval.finance_approve')::jsonb->'entity'->>'status'='approved'
  and (current_setting('test.approval.finance_approve')::jsonb->>'version')::bigint=3,
  'final approver completes the approval at the next version');
select is(current_setting('test.approval.action_scope_conflict')::jsonb->>'error','scope_conflict',
  'one action request id cannot be rebound to another command payload');
select ok(exists(select 1 from public.audit_logs audit
  where audit.request_id='c4000000-0000-4000-8000-000000000008'
    and audit.action='approval.command_failed' and audit.metadata->>'failure'='scope_conflict'),
  'action request rebinding attack appends bounded failure audit evidence');
select is((select count(*) from public.approval_actions action
  join public.approvals approval on approval.id=action.approval_id
  where approval.public_id=(current_setting('test.approval.valid')::jsonb->>'id')::uuid
    and action.action_type='approve'),2::bigint,
  'manager replay and stale writer create no duplicate decision actions');
select ok(exists(select 1 from public.audit_logs audit
  where audit.request_id='c4000000-0000-4000-8000-000000000008'
    and audit.action='approval.approved'
    and audit.metadata::text not like '%财务复核通过%'),
  'decision audit stores a digest without the raw private comment');
select is((select count(*) from public.approval_action_idempotency ledger
  where ledger.request_id='c4000000-0000-4000-8000-000000000004'),1::bigint,
  'replayed decision owns one private ledger record');
select ok(exists(select 1 from public.audit_logs audit
  where audit.request_id='c4000000-0000-4000-8000-000000000007'
    and audit.action='approval.command_failed' and audit.metadata->>'failure'='conflict'),
  'optimistic conflict persists bounded audit evidence');

update public.roles role set is_enabled=false where role.code='approval_test_reviewer'
  and role.tenant_id=(select tenant.id from public.tenants tenant where tenant.slug='approval-workflow-a');
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select set_config('test.approval.disabled_role',public.submit_current_approval(
  current_setting('test.approval.role_template')::uuid,
  '{"reason":"停用角色不得审批"}'::jsonb,
  'c2000000-0000-4000-8000-000000000015','c2000000-0000-4000-8000-000000000016'
)::text,true);
reset role;
select is(current_setting('test.approval.disabled_role')::jsonb->>'error','approver_unavailable',
  'disabled approver role fails closed');
update public.roles role set is_enabled=true where role.code='approval_test_reviewer'
  and role.tenant_id=(select tenant.id from public.tenants tenant where tenant.slug='approval-workflow-a');
set local role authenticated;
select set_config('test.approval.reenabled_role',public.submit_current_approval(
  current_setting('test.approval.role_template')::uuid,
  '{"reason":"恢复角色可正常审批"}'::jsonb,
  'c2000000-0000-4000-8000-000000000017','c2000000-0000-4000-8000-000000000018'
)::text,true);
reset role;
select is(current_setting('test.approval.reenabled_role')::jsonb->>'outcome','success',
  're-enabled approver role is resolved on the next submission');

select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000005',true);
set local role authenticated;
select set_config('test.approval.cross_tenant',public.submit_current_approval(
  current_setting('test.approval.template_a')::uuid,'{}'::jsonb,
  'c2000000-0000-4000-8000-000000000011','c2000000-0000-4000-8000-000000000012'
)::text,true);
select set_config('test.approval.other_tenant_visible',(select count(*)::text from public.approvals),true);
reset role;
select is(current_setting('test.approval.cross_tenant')::jsonb->>'error','template_not_found',
  'template lookup is tenant and organization scoped');
select is(current_setting('test.approval.other_tenant_visible')::bigint,0::bigint,
  'second tenant cannot read the first tenant approval');

select throws_ok(
  $$update public.approval_actions set content='tampered'
    where action_type in ('approve','reject','return','cancel')$$,
  '42501','Approval actions are append-only','completed approval actions reject mutation'
);
select throws_ok(
  $$update public.approval_templates set title='mutated' where public_id=current_setting('test.approval.template_a')::uuid$$,
  '42501','Approval template versions are immutable','template versions reject in-place edits'
);

select * from finish();
rollback;
