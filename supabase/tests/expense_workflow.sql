begin;
select plan(86);

select ok(has_table('public','expense_receipts'),'normalized verified expense receipts exist');
select ok(has_table('public','expense_command_idempotency'),'private expense command ledger exists');
select ok((select bool_and(relforcerowsecurity) from pg_class where oid=any(array[
  'public.expense_reports'::regclass,'public.expense_receipts'::regclass,
  'public.expense_command_idempotency'::regclass
])), 'expense report receipt and ledger tables force RLS');
select ok(has_column('public','expense_reports','version')
  and has_column('public','expense_reports','paid_by_member_id')
  and has_column('public','expense_reports','payment_reference')
  and has_column('public','expense_reports','payment_evidence_status')
  and has_column('public','expense_reports','cancelled_at')
  and has_column('public','expense_reports','cancellation_reason'),
  'expense reports carry optimistic payment and cancellation facts');
select ok(exists(select 1 from pg_constraint where conrelid='public.expense_reports'::regclass
  and conname='expense_reports_terminal_state_check'),
  'terminal expense states require coherent metadata');
select ok(exists(select 1 from pg_constraint where conrelid='public.expense_reports'::regclass
  and conname='expense_reports_exact_approval_fkey'),
  'expense approval linkage is exact tenant and organization scoped');
select ok(exists(select 1 from pg_constraint where conrelid='public.expense_reports'::regclass
  and conname='expense_reports_exact_requester_fkey'),
  'expense requester linkage is exact tenant and organization scoped');
select ok(exists(select 1 from pg_constraint where conrelid='public.expense_reports'::regclass
  and conname='expense_reports_exact_owner_fkey'),
  'expense owner linkage is exact tenant and organization scoped');
select ok(exists(select 1 from pg_constraint where conrelid='public.expense_reports'::regclass
  and conname='expense_reports_exact_project_fkey'),
  'expense project linkage is exact tenant and organization scoped');
select ok(exists(select 1 from pg_constraint where conrelid='public.expense_receipts'::regclass
  and conname='expense_receipts_exact_expense_fkey'),
  'receipt relation references an exact scoped expense');
select ok(exists(select 1 from pg_constraint where conrelid='public.expense_receipts'::regclass
  and conname='expense_receipts_exact_file_fkey'),
  'receipt relation references an exact scoped file');

select ok(has_function('public','create_current_expense',array[
  'uuid','text','text','date','text','uuid[]','uuid','uuid'
]::name[]),'draft create RPC exists');
select ok(has_function('public','update_current_expense',array[
  'uuid','integer','text','text','date','text','uuid[]','uuid','uuid'
]::name[]),'draft update RPC exists without ownership parameters');
select ok(has_function('public','submit_current_expense',array[
  'uuid','integer','uuid','uuid'
]::name[]),'approval-linked submission RPC exists');
select ok(has_function('public','mark_current_expense_paid',array[
  'uuid','integer','text','uuid','uuid'
]::name[]),'finance payment RPC exists');
select ok(has_function('public','cancel_current_expense',array[
  'uuid','integer','text','uuid','uuid'
]::name[]),'applicant cancellation RPC exists');
select ok(has_function_privilege('authenticated',
  'public.create_current_expense(uuid,text,text,date,text,uuid[],uuid,uuid)','EXECUTE')
  and has_function_privilege('authenticated',
    'public.update_current_expense(uuid,integer,text,text,date,text,uuid[],uuid,uuid)','EXECUTE')
  and has_function_privilege('authenticated',
    'public.submit_current_expense(uuid,integer,uuid,uuid)','EXECUTE'),
  'authenticated sessions can enter applicant expense commands');
select ok(has_function_privilege('authenticated',
  'public.mark_current_expense_paid(uuid,integer,text,uuid,uuid)','EXECUTE')
  and has_function_privilege('authenticated',
    'public.cancel_current_expense(uuid,integer,text,uuid,uuid)','EXECUTE'),
  'authenticated sessions can enter finance and cancellation commands');
select ok(not has_function_privilege('anon',
  'public.create_current_expense(uuid,text,text,date,text,uuid[],uuid,uuid)','EXECUTE')
  and not has_function_privilege('service_role',
    'public.mark_current_expense_paid(uuid,integer,text,uuid,uuid)','EXECUTE')
  and not has_function_privilege('authenticated',
    'public.submit_approval_for_command_identity(bigint,bigint,bigint,uuid,bigint,uuid,jsonb,uuid,uuid)',
    'EXECUTE')
  and not has_function_privilege('service_role',
    'public.submit_approval_for_command_identity(bigint,bigint,bigint,uuid,bigint,uuid,jsonb,uuid,uuid)',
    'EXECUTE'),
  'external roles cannot enter private expense or approval helpers');
select ok(not has_table_privilege('authenticated','public.expense_reports','INSERT')
  and not has_table_privilege('authenticated','public.expense_reports','UPDATE')
  and not has_table_privilege('authenticated','public.expense_reports','DELETE')
  and not has_table_privilege('authenticated','public.expense_reports','TRUNCATE')
  and not has_table_privilege('authenticated','public.expense_reports','REFERENCES')
  and not has_table_privilege('authenticated','public.expense_reports','TRIGGER')
  and not has_table_privilege('anon','public.expense_reports','SELECT')
  and not has_table_privilege('service_role','public.expense_reports','SELECT')
  and not has_sequence_privilege('authenticated','public.expense_reports_id_seq','USAGE')
  and not has_sequence_privilege('authenticated','public.expense_reports_id_seq','SELECT'),
  'browser and privileged bypass paths cannot mutate expenses or inspect its sequence');
select ok(not has_table_privilege('authenticated','public.expense_receipts','INSERT')
  and not has_table_privilege('authenticated','public.expense_receipts','UPDATE')
  and not has_table_privilege('authenticated','public.expense_receipts','DELETE')
  and not has_table_privilege('authenticated','public.expense_receipts','TRUNCATE')
  and not has_table_privilege('authenticated','public.expense_receipts','REFERENCES')
  and not has_table_privilege('authenticated','public.expense_receipts','TRIGGER')
  and not has_table_privilege('anon','public.expense_receipts','SELECT')
  and not has_table_privilege('service_role','public.expense_receipts','SELECT')
  and not has_sequence_privilege('authenticated','public.expense_receipts_id_seq','USAGE')
  and not has_sequence_privilege('authenticated','public.expense_receipts_id_seq','SELECT'),
  'browser sessions cannot rewrite receipt evidence or inspect its sequence');
select ok(not has_table_privilege('authenticated','public.expense_command_idempotency','SELECT')
  and not has_table_privilege('service_role','public.expense_command_idempotency','SELECT'),
  'expense replay ledger remains private');
select ok(not has_function_privilege('authenticated','public.current_expense_command_identity(text)','EXECUTE')
  and not has_function_privilege('service_role','public.current_expense_command_identity(text)','EXECUTE'),
  'exact actor identity resolver remains internal');
select ok(not has_function_privilege('authenticated',
  'public.claim_expense_command(bigint,bigint,bigint,text,uuid,jsonb,uuid,uuid)','EXECUTE')
  and not has_function_privilege('authenticated',
    'public.complete_expense_command(bigint,bigint,uuid,bigint,text,uuid,uuid,uuid,text,text,jsonb)','EXECUTE'),
  'expense ledger claim and completion helpers remain internal');
select ok(has_table_privilege('authenticated','public.expense_reports','SELECT')
  and has_table_privilege('authenticated','public.expense_receipts','SELECT'),
  'authenticated participants can read reports and receipt relations through RLS');
select ok((select qual::text ilike '%can_read_current_expense%'
  from pg_policies where schemaname='public' and tablename='expense_reports'
    and policyname='expense_reports_exact_participant_select'),
  'expense report RLS uses exact current identity participant scope');
select ok((select qual::text ilike '%can_read_current_expense%'
  from pg_policies where schemaname='public' and tablename='expense_receipts'
    and policyname='expense_receipts_exact_participant_select'),
  'receipt RLS inherits the linked expense participant scope');
select ok(exists(select 1 from pg_trigger where not tgisinternal
  and tgrelid='public.expense_reports'::regclass
  and tgname='expense_reports_reject_completed_mutation'),
  'paid and cancelled reports reject mutation');
select ok(exists(select 1 from pg_trigger where not tgisinternal
  and tgrelid='public.expense_receipts'::regclass
  and tgname='expense_receipts_reject_mutation')
  and exists(select 1 from pg_trigger where not tgisinternal
    and tgrelid='public.expense_receipts'::regclass
    and tgname='expense_receipts_reject_truncate'),
  'receipt evidence rejects ordinary mutation and truncate');
select ok(exists(select 1 from pg_trigger where not tgisinternal
  and tgrelid='public.approvals'::regclass and tgname='approvals_sync_linked_expense'),
  'approval decisions synchronize linked expense state');
select ok(exists(select 1 from pg_trigger where not tgisinternal
  and tgrelid='public.roles'::regclass and tgname='roles_expense_permissions_after_insert'),
  'future canonical roles receive bounded expense permissions');
select ok(exists(select 1 from public.permissions where code='expense.submit'
  and module='expenses' and action='submit'),
  'expense submission is a first-class permission');
select ok(public.is_expense_baseline_role(true,true,null,'finance','expense.manage')
  and not public.is_expense_baseline_role(true,true,null,'employee','expense.manage'),
  'only finance and administrative baseline roles manage payments');
select ok(public.is_expense_baseline_role(true,true,null,'employee','expense.submit')
  and not public.is_expense_baseline_role(true,false,null,'employee','expense.submit'),
  'active canonical employees receive submission permission');

select ok(public.is_valid_expense_input(
  'travel','12.30','2026-08-28','客户现场差旅','{}'::uuid[]
),'fixed two-decimal positive expense input is valid');
select ok(not public.is_valid_expense_input(
  'travel','12.345','2026-08-28','客户现场差旅','{}'::uuid[]
),'over-precision amount is rejected in PostgreSQL');
select ok(not public.is_valid_expense_input(
  'travel','01.00','2026-08-28','客户现场差旅','{}'::uuid[]
),'noncanonical leading-zero amount is rejected');
select ok(not public.is_valid_expense_input(
  'travel','0','2026-08-28','客户现场差旅','{}'::uuid[]
),'zero amount is rejected');
select ok(not public.is_valid_expense_input(
  'travel','1000000000000.00','2026-08-28','客户现场差旅','{}'::uuid[]
),'amount beyond numeric 14,2 business bound is rejected');
select ok(not public.is_valid_expense_input(
  'travel','12.30','2026-08-28','客户现场差旅',array[
    '10000000-0000-4000-8000-000000000001'::uuid,
    '10000000-0000-4000-8000-000000000001'::uuid
  ]
),'duplicate receipt identifiers are rejected');
select ok(not public.is_valid_expense_input(
  'leave','12.30','2026-08-28','不在范围','{}'::uuid[]
),'leave and attendance are excluded from expense types');
select ok(not public.is_valid_expense_input(
  'other','12.30','2026-08-28','   ','{}'::uuid[]
),'blank descriptions are rejected after full normalization');
select is(public.normalize_expense_text(E' \t真实说明\r\n'),'真实说明',
  'expense text normalization removes bounded surrounding whitespace');
select is(public.expense_child_uuid(
  '10000000-0000-4000-8000-000000000001','approval'
),public.expense_child_uuid(
  '10000000-0000-4000-8000-000000000001','approval'
),'child command identifiers are deterministic for safe replay');
select isnt(public.expense_child_uuid(
  '10000000-0000-4000-8000-000000000001','approval'
),public.expense_child_uuid(
  '10000000-0000-4000-8000-000000000001','request'
),'child idempotency and request identifiers stay distinct');
select ok((select pg_get_functiondef('public.submit_current_expense(uuid,integer,uuid,uuid)'::regprocedure)
  ilike '%submit_approval_for_command_identity%'),
  'expense submission delegates to the private approval transaction helper');
select ok((select pg_get_functiondef('public.valid_expense_receipts(bigint,bigint,bigint,bigint,uuid[])'::regprocedure)
  ilike '%verified_at is not null%'),
  'receipt validation requires completed storage verification');
select ok((select pg_get_functiondef('public.update_current_expense(uuid,integer,text,text,date,text,uuid[],uuid,uuid)'::regprocedure)
  ilike '%expense.version<>expected_version%'),
  'draft updates enforce optimistic version matching');
select ok((select pg_get_functiondef('public.mark_current_expense_paid(uuid,integer,text,uuid,uuid)'::regprocedure)
  ilike '%is_valid_expense_approval_evidence%'),
  'payment requires an approved linked approval');

insert into public.tenants(name,slug,status)
values ('Expense workflow tenant','expense-workflow-a','active');
insert into public.roles(tenant_id,organization_id,code,name,description,is_system,is_enabled)
select tenant.id,null,seed.code,seed.name,seed.description,true,true
from public.tenants tenant
cross join (values
  ('employee','员工','费用流程员工测试角色'),
  ('finance','财务','费用流程财务测试角色')
) seed(code,name,description)
where tenant.slug='expense-workflow-a'
on conflict(tenant_id,code) where organization_id is null do update set
  name=excluded.name,description=excluded.description,is_system=true,is_enabled=true;
insert into public.organizations(tenant_id,name,slug)
select tenant.id,'Expense workflow organization','expense-workflow-org'
from public.tenants tenant where tenant.slug='expense-workflow-a';
insert into public.departments(tenant_id,organization_id,code,name)
select organization.tenant_id,organization.id,'EXPENSE','费用测试部'
from public.organizations organization where organization.slug='expense-workflow-org';
insert into public.identity_providers(
  tenant_id,provider_code,auth_provider,provider_tenant_key,display_name,status
)
select tenant.id,'expense-test','custom:expense-test',tenant.slug||'-provider','Expense test identity','active'
from public.tenants tenant where tenant.slug='expense-workflow-a';
insert into auth.users(
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
  ('00000000-0000-0000-0000-000000000000','d1000000-0000-4000-8000-000000000001','authenticated','authenticated','expense-applicant@example.test',crypt('local-e2e-password',gen_salt('bf')),now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','d1000000-0000-4000-8000-000000000002','authenticated','authenticated','expense-manager@example.test',crypt('local-e2e-password',gen_salt('bf')),now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','d1000000-0000-4000-8000-000000000003','authenticated','authenticated','expense-finance@example.test',crypt('local-e2e-password',gen_salt('bf')),now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','d1000000-0000-4000-8000-000000000004','authenticated','authenticated','expense-outsider@example.test',crypt('local-e2e-password',gen_salt('bf')),now(),'{}','{}',now(),now());
insert into public.organization_members(tenant_id,organization_id,user_id,status)
select organization.tenant_id,organization.id,seed.user_id,'active'
from (values
  ('d1000000-0000-4000-8000-000000000001'::uuid),
  ('d1000000-0000-4000-8000-000000000002'::uuid),
  ('d1000000-0000-4000-8000-000000000003'::uuid),
  ('d1000000-0000-4000-8000-000000000004'::uuid)
) seed(user_id)
cross join public.organizations organization
where organization.slug='expense-workflow-org';
insert into public.employee_profiles(
  public_id,tenant_id,organization_id,organization_member_id,employee_no,display_name,
  department_id,job_title,employment_type,employment_status
)
select seed.public_id,member.tenant_id,member.organization_id,member.id,seed.employee_no,
  seed.display_name,department.id,seed.job_title,'full_time','active'
from (values
  ('d1100000-0000-4000-8000-000000000002'::uuid,'d1000000-0000-4000-8000-000000000002'::uuid,'EXP-MANAGER','expense-manager','费用经理'),
  ('d1100000-0000-4000-8000-000000000003'::uuid,'d1000000-0000-4000-8000-000000000003'::uuid,'EXP-FINANCE','expense-finance','财务专员'),
  ('d1100000-0000-4000-8000-000000000004'::uuid,'d1000000-0000-4000-8000-000000000004'::uuid,'EXP-OUTSIDER','expense-outsider','普通员工')
) seed(public_id,user_id,employee_no,display_name,job_title)
join public.organization_members member on member.user_id=seed.user_id
join public.departments department on department.tenant_id=member.tenant_id
  and department.organization_id=member.organization_id and department.code='EXPENSE';
insert into public.employee_profiles(
  public_id,tenant_id,organization_id,organization_member_id,employee_no,display_name,
  department_id,job_title,employment_type,employment_status,manager_employee_id,manager_source
)
select 'd1100000-0000-4000-8000-000000000001',member.tenant_id,member.organization_id,
  member.id,'EXP-APPLICANT','expense-applicant',department.id,'项目员工','full_time','active',
  manager.id,'manual'
from public.organization_members member
join public.departments department on department.tenant_id=member.tenant_id
  and department.organization_id=member.organization_id and department.code='EXPENSE'
join public.employee_profiles manager on manager.tenant_id=member.tenant_id
  and manager.organization_id=member.organization_id and manager.display_name='expense-manager'
where member.user_id='d1000000-0000-4000-8000-000000000001';
insert into public.external_identities(
  tenant_id,organization_id,organization_member_id,identity_provider_id,
  provider_subject,provider_tenant_key,auth_user_id,status
)
select member.tenant_id,member.organization_id,member.id,provider.id,member.user_id::text,
  provider.provider_tenant_key,member.user_id,'active'
from public.organization_members member
join public.identity_providers provider on provider.tenant_id=member.tenant_id
  and provider.provider_code='expense-test'
where member.user_id in (
  'd1000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000002',
  'd1000000-0000-4000-8000-000000000003','d1000000-0000-4000-8000-000000000004'
);
insert into public.member_roles(tenant_id,member_id,role_id)
select member.tenant_id,member.id,role.id
from public.organization_members member
join public.roles role on role.tenant_id=member.tenant_id and role.organization_id is null
  and role.code=case member.user_id
    when 'd1000000-0000-4000-8000-000000000002'::uuid then 'supervisor'
    when 'd1000000-0000-4000-8000-000000000003'::uuid then 'finance'
    else 'employee' end
where member.user_id in (
  'd1000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000002',
  'd1000000-0000-4000-8000-000000000003','d1000000-0000-4000-8000-000000000004'
);
insert into public.projects(
  public_id,tenant_id,organization_id,code,name,category,description,
  owner_member_id,created_by_member_id,updated_by_member_id,budget_amount,
  status,health,priority,start_date,due_date,progress,version
)
select 'd1200000-0000-4000-8000-000000000001',organization.tenant_id,organization.id,
  'EXPENSE-PROJECT','费用验证项目','Delivery','Expense workflow fixture',member.id,member.id,
  member.id,100000,'active','on_track','medium',current_date,current_date+90,0,1
from public.organizations organization
join public.organization_members member on member.tenant_id=organization.tenant_id
  and member.organization_id=organization.id
  and member.user_id='d1000000-0000-4000-8000-000000000001'
where organization.slug='expense-workflow-org';
insert into public.project_members(
  tenant_id,organization_id,project_id,member_id,role,allocation_percent,
  created_by_member_id,updated_by_member_id,version
)
select project.tenant_id,project.organization_id,project.id,project.owner_member_id,
  'owner',100,project.owner_member_id,project.owner_member_id,1
from public.projects project where project.public_id='d1200000-0000-4000-8000-000000000001';
insert into public.files(
  public_id,tenant_id,organization_id,project_id,bucket,object_path,original_name,mime_type,
  size_bytes,access_scope,uploaded_by,uploaded_by_member_id,sha256,storage_object_id,
  storage_object_version,storage_etag,verified_at,version
)
select seed.public_id,project.tenant_id,project.organization_id,project.id,'workbench-files',
  seed.object_path,seed.original_name,seed.mime_type,128,'restricted',member.user_id,member.id,
  repeat(seed.digest_char,64),seed.storage_id,'v1','etag-'||seed.digest_char,seed.verified_at,1
from (values
  ('d1300000-0000-4000-8000-000000000001'::uuid,'expenses/verified.pdf','verified.pdf','application/pdf','a','d1400000-0000-4000-8000-000000000001'::uuid,clock_timestamp()),
  ('d1300000-0000-4000-8000-000000000002'::uuid,'expenses/pending.pdf','pending.pdf','application/pdf','b','d1400000-0000-4000-8000-000000000002'::uuid,null::timestamptz)
) seed(public_id,object_path,original_name,mime_type,digest_char,storage_id,verified_at)
cross join public.projects project
join public.organization_members member on member.tenant_id=project.tenant_id
  and member.organization_id=project.organization_id and member.id=project.owner_member_id
where project.public_id='d1200000-0000-4000-8000-000000000001';

insert into public.approvals(
  public_id,tenant_id,organization_id,applicant_employee_id,owner_employee_id,
  approval_code,approval_type,title,summary,form_data,current_step,current_step_order,
  status,submitted_at,completed_at,template_id,template_version,version,deleted_at
)
select seed.public_id,organization.tenant_id,organization.id,applicant.id,null,
  seed.approval_code,'reimbursement',seed.title,'Invalid payment evidence fixture','{}',null,null,
  'approved',clock_timestamp()-interval '1 minute',clock_timestamp(),template.id,template.version,1,
  seed.deleted_at
from (values
  ('d1800000-0000-4000-8000-000000000001'::uuid,'EXP-WRONG-TEMPLATE','Wrong template approval','purchase_request',null::timestamptz),
  ('d1800000-0000-4000-8000-000000000002'::uuid,'EXP-DELETED-APPROVAL','Deleted approval evidence','expense_reimbursement',clock_timestamp())
) seed(public_id,approval_code,title,template_key,deleted_at)
cross join public.organizations organization
join public.employee_profiles applicant on applicant.tenant_id=organization.tenant_id
  and applicant.organization_id=organization.id and applicant.display_name='expense-applicant'
join public.approval_templates template on template.tenant_id=organization.tenant_id
  and template.organization_id=organization.id and template.template_key=seed.template_key
  and template.is_active
where organization.slug='expense-workflow-org';
insert into public.expense_reports(
  public_id,tenant_id,organization_id,approval_id,requester_employee_id,project_id,
  expense_code,expense_type,amount,currency,expense_date,description,status,version
)
select seed.public_id,approval.tenant_id,approval.organization_id,approval.id,approval.applicant_employee_id,
  project.id,seed.expense_code,'office',10,'CNY','2026-08-28',seed.description,'approved',1
from (values
  ('d1900000-0000-4000-8000-000000000001'::uuid,'EXP-WRONG-TEMPLATE-ROW','错误模板付款证据','d1800000-0000-4000-8000-000000000001'::uuid),
  ('d1900000-0000-4000-8000-000000000002'::uuid,'EXP-DELETED-APPROVAL-ROW','软删除付款证据','d1800000-0000-4000-8000-000000000002'::uuid)
) seed(public_id,expense_code,description,approval_public_id)
join public.approvals approval on approval.public_id=seed.approval_public_id
join public.projects project on project.tenant_id=approval.tenant_id
  and project.organization_id=approval.organization_id
  and project.public_id='d1200000-0000-4000-8000-000000000001';

select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select set_config('test.expense.create',public.create_current_expense(
  'd1200000-0000-4000-8000-000000000001','travel','1280.50','2026-08-28',
  '客户现场差旅',array['d1300000-0000-4000-8000-000000000001'::uuid],
  'd1500000-0000-4000-8000-000000000001','d1600000-0000-4000-8000-000000000001'
)::text,true);
select set_config('test.expense.create_replay',public.create_current_expense(
  'd1200000-0000-4000-8000-000000000001','travel','1280.50','2026-08-28',
  '客户现场差旅',array['d1300000-0000-4000-8000-000000000001'::uuid],
  'd1500000-0000-4000-8000-000000000001','d1600000-0000-4000-8000-000000000002'
)::text,true);
select set_config('test.expense.create_scope_conflict',public.create_current_expense(
  'd1200000-0000-4000-8000-000000000001','travel','1280.51','2026-08-28',
  '重绑同一幂等键',array['d1300000-0000-4000-8000-000000000001'::uuid],
  'd1500000-0000-4000-8000-000000000001','d1600000-0000-4000-8000-000000000013'
)::text,true);
select set_config('test.expense.update',public.update_current_expense(
  (current_setting('test.expense.create')::jsonb->>'id')::uuid,1,'meal','88.20','2026-08-28',
  '客户工作餐',array['d1300000-0000-4000-8000-000000000001'::uuid],
  'd1500000-0000-4000-8000-000000000002','d1600000-0000-4000-8000-000000000003'
)::text,true);
select set_config('test.expense.update_conflict',public.update_current_expense(
  (current_setting('test.expense.create')::jsonb->>'id')::uuid,1,'meal','90.00','2026-08-28',
  '并发覆盖',array['d1300000-0000-4000-8000-000000000001'::uuid],
  'd1500000-0000-4000-8000-000000000003','d1600000-0000-4000-8000-000000000004'
)::text,true);
select set_config('test.expense.invalid_receipt',public.create_current_expense(
  'd1200000-0000-4000-8000-000000000001','office','20.00','2026-08-28',
  '未验证附件',array['d1300000-0000-4000-8000-000000000002'::uuid],
  'd1500000-0000-4000-8000-000000000004','d1600000-0000-4000-8000-000000000005'
)::text,true);
select set_config('test.expense.submit',public.submit_current_expense(
  (current_setting('test.expense.create')::jsonb->>'id')::uuid,2,
  'd1500000-0000-4000-8000-000000000005','d1600000-0000-4000-8000-000000000006'
)::text,true);
reset role;

select is(current_setting('test.expense.create')::jsonb->>'outcome','success',
  'verified project receipt creates a real applicant-owned draft');
select is(current_setting('test.expense.create_replay')::jsonb,current_setting('test.expense.create')::jsonb,
  'draft create replays the exact canonical result');
select is(current_setting('test.expense.create_scope_conflict')::jsonb->>'error','scope_conflict',
  'one create idempotency key cannot be rebound to another expense payload');
select ok(exists(select 1 from public.audit_logs audit
  where audit.request_id='d1600000-0000-4000-8000-000000000013'
    and audit.action='expense.command_failed' and audit.metadata->>'failure'='scope_conflict'),
  'idempotency rebinding attack appends bounded audit evidence');
select is((select count(*) from public.expense_receipts receipt
  join public.expense_reports expense on expense.tenant_id=receipt.tenant_id
    and expense.organization_id=receipt.organization_id and expense.id=receipt.expense_id
  where expense.public_id=(current_setting('test.expense.create')::jsonb->>'id')::uuid),1::bigint,
  'verified receipt persists as one normalized relation');
select ok(current_setting('test.expense.update')::jsonb->>'outcome'='success'
  and (current_setting('test.expense.update')::jsonb->>'version')::bigint=2
  and current_setting('test.expense.update')::jsonb->'entity'->>'amount'='88.20'
  and current_setting('test.expense.update')::jsonb->'entity'->>'expenseType'='meal',
  'requester updates editable draft facts through one optimistic version');
select is(current_setting('test.expense.update_conflict')::jsonb->>'error','conflict',
  'stale draft update receives an optimistic conflict');
select is(current_setting('test.expense.invalid_receipt')::jsonb->>'error','invalid_receipt',
  'unverified receipt fails before an expense row is created');
select ok(current_setting('test.expense.submit')::jsonb->>'outcome'='success'
  and current_setting('test.expense.submit')::jsonb->'entity'->>'status'='submitted'
  and current_setting('test.expense.submit')::jsonb->'entity'->>'approvalId' is not null,
  'expense submission creates and links a real pending approval');

select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000004',true);
set local role authenticated;
select set_config('test.expense.outsider_visible',(select count(*)::text from public.expense_reports),true);
reset role;
select is(current_setting('test.expense.outsider_visible')::bigint,0::bigint,
  'unrelated employee cannot read another applicant expense');

select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select set_config('test.expense.cancel',public.cancel_current_expense(
  (current_setting('test.expense.create')::jsonb->>'id')::uuid,3,'重复提交',
  'd1500000-0000-4000-8000-000000000006','d1600000-0000-4000-8000-000000000007'
)::text,true);
select set_config('test.expense.pay_create',public.create_current_expense(
  'd1200000-0000-4000-8000-000000000001','transport','300.00','2026-08-28',
  '客户交通',array['d1300000-0000-4000-8000-000000000001'::uuid],
  'd1500000-0000-4000-8000-000000000007','d1600000-0000-4000-8000-000000000008'
)::text,true);
select set_config('test.expense.pay_submit',public.submit_current_expense(
  (current_setting('test.expense.pay_create')::jsonb->>'id')::uuid,1,
  'd1500000-0000-4000-8000-000000000008','d1600000-0000-4000-8000-000000000009'
)::text,true);
select set_config('test.expense.rollback_create',public.create_current_expense(
  'd1200000-0000-4000-8000-000000000001','other','66.00','2026-08-28',
  '取消原子回滚',array['d1300000-0000-4000-8000-000000000001'::uuid],
  'd1500000-0000-4000-8000-000000000020','d1600000-0000-4000-8000-000000000020'
)::text,true);
select set_config('test.expense.rollback_submit',public.submit_current_expense(
  (current_setting('test.expense.rollback_create')::jsonb->>'id')::uuid,1,
  'd1500000-0000-4000-8000-000000000021','d1600000-0000-4000-8000-000000000021'
)::text,true);
reset role;
select ok(current_setting('test.expense.cancel')::jsonb->'entity'->>'status'='cancelled'
  and (current_setting('test.expense.cancel')::jsonb->>'version')::bigint=4
  and exists(select 1 from public.approvals approval
    where approval.public_id=(current_setting('test.expense.submit')::jsonb->'entity'->>'approvalId')::uuid
      and approval.status='cancelled'),
  'submitted cancellation atomically cancels both approval and expense');
select is(current_setting('test.expense.pay_create')::jsonb->>'outcome','success',
  'second verified draft is available for the payment lifecycle');
select is(current_setting('test.expense.pay_submit')::jsonb->'entity'->>'status','submitted',
  'payment lifecycle expense starts with a pending approval');

alter table public.approvals disable trigger approvals_sync_linked_expense;
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select set_config('test.expense.rollback_cancel',public.cancel_current_expense(
  (current_setting('test.expense.rollback_create')::jsonb->>'id')::uuid,2,'触发同步回滚',
  'd1500000-0000-4000-8000-000000000022','d1600000-0000-4000-8000-000000000022'
)::text,true);
reset role;
alter table public.approvals enable trigger approvals_sync_linked_expense;
set local role authenticated;
select set_config('test.expense.rollback_cancel_replay',public.cancel_current_expense(
  (current_setting('test.expense.rollback_create')::jsonb->>'id')::uuid,2,'触发同步回滚',
  'd1500000-0000-4000-8000-000000000022','d1600000-0000-4000-8000-000000000023'
)::text,true);
reset role;
select is(current_setting('test.expense.rollback_cancel')::jsonb->>'error','command_failed',
  'missing approval-to-expense synchronization returns a bounded command failure');
select is(current_setting('test.expense.rollback_cancel_replay')::jsonb,
  current_setting('test.expense.rollback_cancel')::jsonb,
  'failed cancellation replays the exact terminal failure');
select ok(exists(select 1 from public.expense_reports expense
  join public.approvals approval on approval.tenant_id=expense.tenant_id
    and approval.organization_id=expense.organization_id and approval.id=expense.approval_id
  where expense.public_id=(current_setting('test.expense.rollback_create')::jsonb->>'id')::uuid
    and expense.status='submitted' and expense.version=2 and approval.status='pending'
    and not exists(select 1 from public.approval_actions action
      where action.tenant_id=approval.tenant_id and action.organization_id=approval.organization_id
        and action.approval_id=approval.id and action.action_type='cancel')),
  'failed synchronization rolls back approval action and expense mutation atomically');
select ok(exists(select 1 from public.audit_logs audit
  where audit.request_id='d1600000-0000-4000-8000-000000000022'
    and audit.action='expense.command_failed' and audit.metadata->>'failure'='command_failed'),
  'failed synchronization leaves only bounded outer expense audit evidence');

select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select set_config('test.expense.manager_approve',public.act_on_current_approval(
  (current_setting('test.expense.pay_submit')::jsonb->'entity'->>'approvalId')::uuid,
  'approve',1,'主管同意','d1700000-0000-4000-8000-000000000001'
)::text,true);
reset role;
select ok(current_setting('test.expense.manager_approve')::jsonb->'entity'->>'status'='pending'
  and exists(select 1 from public.expense_reports expense
    where expense.public_id=(current_setting('test.expense.pay_create')::jsonb->>'id')::uuid
      and expense.status='submitted' and expense.version=3),
  'manager approval advances and synchronizes one expense version');

select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select throws_ok(
  format($command$select public.mark_current_expense_paid(%L,3,'PAY-DENIED',%L,%L)$command$,
    (current_setting('test.expense.pay_create')::jsonb->>'id')::uuid,
    'd1500000-0000-4000-8000-000000000009'::uuid,
    'd1600000-0000-4000-8000-000000000010'::uuid),
  '42501','Expense command permission required','ordinary employee cannot mark an expense paid'
);
reset role;

select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000003',true);
set local role authenticated;
select set_config('test.expense.finance_approve',public.act_on_current_approval(
  (current_setting('test.expense.pay_submit')::jsonb->'entity'->>'approvalId')::uuid,
  'approve',2,'财务复核通过','d1700000-0000-4000-8000-000000000002'
)::text,true);
select set_config('test.expense.pay',public.mark_current_expense_paid(
  (current_setting('test.expense.pay_create')::jsonb->>'id')::uuid,4,'PAY-20260828-001',
  'd1500000-0000-4000-8000-000000000010','d1600000-0000-4000-8000-000000000011'
)::text,true);
select set_config('test.expense.pay_replay',public.mark_current_expense_paid(
  (current_setting('test.expense.pay_create')::jsonb->>'id')::uuid,4,'PAY-20260828-001',
  'd1500000-0000-4000-8000-000000000010','d1600000-0000-4000-8000-000000000012'
)::text,true);
select set_config('test.expense.wrong_template_pay',public.mark_current_expense_paid(
  'd1900000-0000-4000-8000-000000000001',1,'PAY-WRONG-TEMPLATE',
  'd1500000-0000-4000-8000-000000000030','d1600000-0000-4000-8000-000000000030'
)::text,true);
select set_config('test.expense.deleted_approval_pay',public.mark_current_expense_paid(
  'd1900000-0000-4000-8000-000000000002',1,'PAY-DELETED-APPROVAL',
  'd1500000-0000-4000-8000-000000000031','d1600000-0000-4000-8000-000000000031'
)::text,true);
reset role;
select ok(current_setting('test.expense.finance_approve')::jsonb->'entity'->>'status'='approved'
  and exists(select 1 from public.expense_reports expense
    where expense.public_id=(current_setting('test.expense.pay_create')::jsonb->>'id')::uuid
      and expense.status='paid' and expense.version=5),
  'finance approval synchronizes approval then payment closes the expense');
select ok(current_setting('test.expense.pay')::jsonb->'entity'->>'status'='paid'
  and current_setting('test.expense.pay')::jsonb->'entity'->>'paymentReference'='PAY-20260828-001',
  'finance payment returns bounded server-owned payment metadata');
select is(current_setting('test.expense.pay_replay')::jsonb,current_setting('test.expense.pay')::jsonb,
  'payment idempotency replays the exact terminal result');
select is(current_setting('test.expense.wrong_template_pay')::jsonb->>'error','invalid_state',
  'approved non-expense template cannot serve as payment evidence');
select is(current_setting('test.expense.deleted_approval_pay')::jsonb->>'error','invalid_state',
  'soft-deleted approval cannot serve as payment evidence');
select ok(exists(select 1 from public.expense_reports expense
  join public.organization_members member on member.tenant_id=expense.tenant_id
    and member.organization_id=expense.organization_id and member.id=expense.paid_by_member_id
  where expense.public_id=(current_setting('test.expense.pay_create')::jsonb->>'id')::uuid
    and member.user_id='d1000000-0000-4000-8000-000000000003'
    and expense.payment_evidence_status='verified' and expense.paid_at is not null),
  'paid actor time and verified evidence are derived from finance identity');
select ok(exists(select 1 from public.audit_logs audit
  where audit.request_id='d1600000-0000-4000-8000-000000000011'
    and audit.action='expense.paid' and audit.metadata::text not like '%PAY-20260828-001%'),
  'payment audit stores a digest without raw bank reference');
select is((select count(*) from public.expense_command_idempotency ledger
  where ledger.idempotency_key='d1500000-0000-4000-8000-000000000001'),1::bigint,
  'replayed draft create owns one private ledger record');
select ok(exists(select 1 from public.audit_logs audit
  where audit.request_id='d1600000-0000-4000-8000-000000000005'
    and audit.action='expense.command_failed' and audit.metadata->>'failure'='invalid_receipt'),
  'invalid receipt failure persists bounded audit evidence');

update public.tenants tenant set status='suspended' where tenant.slug='expense-workflow-a';
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select set_config('test.expense.suspended_tenant_visible',(select count(*)::text from public.expense_reports),true);
reset role;
select is(current_setting('test.expense.suspended_tenant_visible')::bigint,0::bigint,
  'suspended tenant cannot retain read access through an existing authenticated identity');
update public.tenants tenant set status='active' where tenant.slug='expense-workflow-a';

update public.roles role set is_enabled=false
where role.tenant_id=(select tenant.id from public.tenants tenant where tenant.slug='expense-workflow-a')
  and role.organization_id is null and role.code='finance';
select ok(not exists(select 1 from public.roles role
  join public.role_permissions assignment on assignment.tenant_id=role.tenant_id
    and assignment.role_id=role.id
  join public.permissions permission on permission.id=assignment.permission_id
  where role.tenant_id=(select tenant.id from public.tenants tenant where tenant.slug='expense-workflow-a')
    and role.code='finance' and permission.code='expense.manage'),
  'disabling finance revokes expense management permission');
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000003',true);
set local role authenticated;
select throws_ok(
  format($command$select public.mark_current_expense_paid(%L,5,'PAY-DISABLED',%L,%L)$command$,
    (current_setting('test.expense.pay_create')::jsonb->>'id')::uuid,
    'd1500000-0000-4000-8000-000000000040'::uuid,
    'd1600000-0000-4000-8000-000000000040'::uuid),
  '42501','Expense command permission required','disabled finance cannot enter payment command'
);
reset role;
update public.roles role set is_enabled=true
where role.tenant_id=(select tenant.id from public.tenants tenant where tenant.slug='expense-workflow-a')
  and role.organization_id is null and role.code='finance';
select ok(exists(select 1 from public.roles role
  join public.role_permissions assignment on assignment.tenant_id=role.tenant_id
    and assignment.role_id=role.id
  join public.permissions permission on permission.id=assignment.permission_id
  where role.tenant_id=(select tenant.id from public.tenants tenant where tenant.slug='expense-workflow-a')
    and role.code='finance' and role.is_enabled and permission.code='expense.manage'),
  're-enabling finance restores expense management permission');
set local role authenticated;
select set_config('test.expense.reenabled_finance',public.mark_current_expense_paid(
  (current_setting('test.expense.pay_create')::jsonb->>'id')::uuid,5,'PAY-ALREADY-PAID',
  'd1500000-0000-4000-8000-000000000041','d1600000-0000-4000-8000-000000000041'
)::text,true);
reset role;
select is(current_setting('test.expense.reenabled_finance')::jsonb->>'error','invalid_state',
  're-enabled finance reaches the state machine instead of failing identity authorization');

insert into public.roles(
  tenant_id,organization_id,code,name,description,is_system,is_enabled
)
select organization.tenant_id,organization.id,'expense_only_submitter','费用提交专员',
  'Only expense.submit is granted for contract verification',false,true
from public.organizations organization where organization.slug='expense-workflow-org';
insert into public.role_permissions(tenant_id,role_id,permission_id)
select role.tenant_id,role.id,permission.id from public.roles role
join public.permissions permission on permission.code='expense.submit'
where role.code='expense_only_submitter'
  and role.organization_id=(select id from public.organizations where slug='expense-workflow-org');
insert into public.member_roles(tenant_id,member_id,role_id)
select member.tenant_id,member.id,role.id from public.organization_members member
join public.roles role on role.tenant_id=member.tenant_id
  and role.organization_id=member.organization_id and role.code='expense_only_submitter'
where member.user_id='d1000000-0000-4000-8000-000000000001';
update public.roles role set is_enabled=false
where role.tenant_id=(select tenant.id from public.tenants tenant where tenant.slug='expense-workflow-a')
  and role.organization_id is null and role.code='employee';
select ok(
  exists(select 1 from public.organization_members member
    join public.member_roles assignment on assignment.tenant_id=member.tenant_id
      and assignment.member_id=member.id
    join public.roles role on role.tenant_id=assignment.tenant_id
      and role.id=assignment.role_id and role.is_enabled
    join public.role_permissions role_grant on role_grant.tenant_id=role.tenant_id
      and role_grant.role_id=role.id
    join public.permissions permission on permission.id=role_grant.permission_id
    where member.user_id='d1000000-0000-4000-8000-000000000001'
      and permission.code='expense.submit')
  and not exists(select 1 from public.organization_members member
    join public.member_roles assignment on assignment.tenant_id=member.tenant_id
      and assignment.member_id=member.id
    join public.roles role on role.tenant_id=assignment.tenant_id
      and role.id=assignment.role_id and role.is_enabled
    join public.role_permissions role_grant on role_grant.tenant_id=role.tenant_id
      and role_grant.role_id=role.id
    join public.permissions permission on permission.id=role_grant.permission_id
    where member.user_id='d1000000-0000-4000-8000-000000000001'
      and permission.code='approval.submit'),
  'expense-only custom role has expense.submit without broader approval.submit'
);
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select set_config('test.expense.expense_only_create',public.create_current_expense(
  'd1200000-0000-4000-8000-000000000001','other','21.00','2026-08-28',
  '仅费用权限提交','{}'::uuid[],'d1500000-0000-4000-8000-000000000050',
  'd1600000-0000-4000-8000-000000000050'
)::text,true);
select set_config('test.expense.expense_only_submit',case
  when current_setting('test.expense.expense_only_create')::jsonb->>'outcome'='success'
  then public.submit_current_expense(
    (current_setting('test.expense.expense_only_create')::jsonb->>'id')::uuid,1,
    'd1500000-0000-4000-8000-000000000051','d1600000-0000-4000-8000-000000000051'
  )::text else '{"outcome":"failure","error":"draft_failed"}' end,true);
reset role;
select ok(
  current_setting('test.expense.expense_only_create')::jsonb->>'outcome'='success'
  and current_setting('test.expense.expense_only_submit')::jsonb->>'outcome'='success'
  and current_setting('test.expense.expense_only_submit')::jsonb->'entity'->>'status'='submitted'
  and current_setting('test.expense.expense_only_submit')::jsonb->'entity'->>'approvalId' is not null,
  'expense.submit independently creates the linked approval transaction'
);
update public.roles role set is_enabled=true
where role.tenant_id=(select tenant.id from public.tenants tenant where tenant.slug='expense-workflow-a')
  and role.organization_id is null and role.code='employee';

select set_config('quantxy.expense_command','off',true);
select throws_ok(
  format($command$update public.expense_reports set description='tampered' where public_id=%L$command$,
    (current_setting('test.expense.pay_create')::jsonb->>'id')::uuid),
  '42501','Expense reports are command-owned','ordinary direct report mutation fails closed'
);
select throws_ok(
  format($command$delete from public.expense_receipts where expense_id=(
    select id from public.expense_reports where public_id=%L)$command$,
    (current_setting('test.expense.pay_create')::jsonb->>'id')::uuid),
  '42501','Expense receipts are command-owned','ordinary receipt evidence mutation fails closed'
);

select * from finish();
rollback;
