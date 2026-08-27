begin;
select plan(91);

select ok(has_table('public','customers'),'customers table exists');
select ok(has_table('public','customer_contacts'),'customer contacts table exists');
select ok(has_table('public','opportunities'),'opportunities table exists');
select ok(has_table('public','customer_follow_ups'),'customer follow ups table exists');
select ok(has_table('public','customer_project_links'),'customer project links table exists');
select ok(has_column('public','customers','tenant_id'),'customers carry tenant ownership');
select ok(has_column('public','customers','name_normalized'),'customers persist a normalized name');
select ok(has_column('public','customers','registration_code_normalized'),'registration code has a normalized key');
select ok(has_column('public','opportunities','amount'),'opportunities persist fixed precision amount');
select ok(has_column('public','customer_contacts','visibility'),'contact PII has explicit visibility');
select ok(has_function('public','can_read_current_customer',array['bigint','bigint','bigint']::name[]),'customer RLS helper exists');
select ok(has_table('public','crm_command_idempotency'),'CRM command ledger exists');
select ok(
  (select relforcerowsecurity from pg_class where oid='public.crm_command_idempotency'::regclass),
  'CRM command ledger forces row level security'
);
select ok(
  has_function('public','create_current_customer',array['text','text','uuid','text','text','text','text','bigint','text','uuid','uuid']::name[])
  and has_function('public','update_current_customer',array['uuid','text','text','uuid','text','text','text','text','bigint','text','uuid','uuid']::name[])
  and has_function('public','create_current_customer_contact',array['uuid','text','text','text','text','text','boolean','bigint','text','uuid','uuid']::name[]),
  'customer and contact command RPCs exist'
);
select ok(
  has_function_privilege('authenticated','public.create_current_customer(text,text,uuid,text,text,text,text,bigint,text,uuid,uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.update_current_customer(uuid,text,text,uuid,text,text,text,text,bigint,text,uuid,uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.create_current_customer_contact(uuid,text,text,text,text,text,boolean,bigint,text,uuid,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.create_current_customer(text,text,uuid,text,text,text,text,bigint,text,uuid,uuid)','EXECUTE')
  and not has_function_privilege('service_role','public.update_current_customer(uuid,text,text,uuid,text,text,text,text,bigint,text,uuid,uuid)','EXECUTE'),
  'only authenticated sessions can enter CRM commands'
);
select ok(
  not has_table_privilege('authenticated','public.crm_command_idempotency','SELECT')
  and not has_table_privilege('authenticated','public.crm_command_idempotency','INSERT')
  and not has_table_privilege('service_role','public.crm_command_idempotency','SELECT'),
  'command ledger is unreachable outside security-definer commands'
);
select ok(
  has_function_privilege('authenticated','public.create_current_opportunity(uuid,text,uuid,numeric,text,date,bigint,text,uuid,uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.transition_current_opportunity_stage(uuid,text,text,bigint,text,uuid,uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.create_current_customer_follow_up(uuid,uuid,text,text,timestamptz,bigint,text,uuid,uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.convert_current_opportunity_to_project(uuid,text,text,text,text,text,date,date,bigint,text,uuid,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.create_current_opportunity(uuid,text,uuid,numeric,text,date,bigint,text,uuid,uuid)','EXECUTE')
  and not has_function_privilege('service_role','public.convert_current_opportunity_to_project(uuid,text,text,text,text,text,date,date,bigint,text,uuid,uuid)','EXECUTE'),
  'only authenticated sessions can enter opportunity workflow commands'
);
select ok(
  exists(select 1 from pg_indexes where schemaname='public'
    and indexname='customer_project_links_one_active_opportunity_uidx'),
  'one active delivery project is allowed per opportunity'
);
select ok(
  (select bool_and(relforcerowsecurity) from pg_class
   where oid=any(array[
     'public.customers'::regclass,'public.customer_contacts'::regclass,
     'public.opportunities'::regclass,'public.customer_follow_ups'::regclass,
     'public.customer_project_links'::regclass
   ])),
  'all CRM tables force row level security'
);
select ok(
  not exists (
    select 1
    from unnest(array['anon','authenticated','service_role']) as roles(role_name)
    cross join unnest(array[
      'public.customers','public.customer_contacts','public.opportunities',
      'public.customer_follow_ups','public.customer_project_links'
    ]) as crm_tables(table_name)
    cross join unnest(array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) as privileges(privilege_name)
    where has_table_privilege(role_name,table_name,privilege_name)
  ),
  'browser and service roles cannot directly mutate CRM tables'
);
select ok(
  not has_sequence_privilege('authenticated','public.customers_id_seq','USAGE')
  and not has_sequence_privilege('service_role','public.customer_contacts_id_seq','SELECT'),
  'CRM internal identities are not exposed through sequences'
);

insert into public.tenants(name,slug,status) values
  ('CRM tenant A','crm-schema-a','active'),
  ('CRM tenant B','crm-schema-b','active');
insert into public.organizations(tenant_id,name,slug)
select tenant.id,seed.name,seed.slug
from public.tenants tenant
join (values
  ('crm-schema-a','CRM org A','crm-schema-org-a'),
  ('crm-schema-b','CRM org B','crm-schema-org-b')
) seed(tenant_slug,name,slug) on seed.tenant_slug=tenant.slug;
insert into public.identity_providers(
  tenant_id,provider_code,auth_provider,provider_tenant_key,display_name,status
)
select id,'crm-schema','custom:crm-schema',slug||'-provider','CRM schema identity','active'
from public.tenants where slug in ('crm-schema-a','crm-schema-b');
insert into auth.users(
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
  ('00000000-0000-0000-0000-000000000000','a4000000-0000-4000-8000-000000000001','authenticated','authenticated','crm-owner-a@example.test',crypt('local-e2e-password',gen_salt('bf')),now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','a4000000-0000-4000-8000-000000000002','authenticated','authenticated','crm-manager-a@example.test',crypt('local-e2e-password',gen_salt('bf')),now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','a4000000-0000-4000-8000-000000000003','authenticated','authenticated','crm-outsider-a@example.test',crypt('local-e2e-password',gen_salt('bf')),now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','a4000000-0000-4000-8000-000000000004','authenticated','authenticated','crm-owner-b@example.test',crypt('local-e2e-password',gen_salt('bf')),now(),'{}','{}',now(),now());
insert into public.organization_members(tenant_id,organization_id,user_id,status)
select tenant.id,organization.id,seed.user_id,'active'
from (values
  ('crm-schema-a','crm-schema-org-a','a4000000-0000-4000-8000-000000000001'::uuid),
  ('crm-schema-a','crm-schema-org-a','a4000000-0000-4000-8000-000000000002'::uuid),
  ('crm-schema-a','crm-schema-org-a','a4000000-0000-4000-8000-000000000003'::uuid),
  ('crm-schema-b','crm-schema-org-b','a4000000-0000-4000-8000-000000000004'::uuid)
) seed(tenant_slug,organization_slug,user_id)
join public.tenants tenant on tenant.slug=seed.tenant_slug
join public.organizations organization on organization.tenant_id=tenant.id
  and organization.slug=seed.organization_slug;
insert into public.employee_profiles(
  tenant_id,organization_id,organization_member_id,employee_no,display_name,
  job_title,employment_type,employment_status
)
select member.tenant_id,member.organization_id,member.id,'CRM-'||member.id,
  split_part(user_row.email,'@',1),'CRM member','full_time','active'
from public.organization_members member
join auth.users user_row on user_row.id=member.user_id
where user_row.email like 'crm-%@example.test';
insert into public.external_identities(
  tenant_id,organization_id,organization_member_id,identity_provider_id,
  provider_subject,provider_tenant_key,auth_user_id,status
)
select member.tenant_id,member.organization_id,member.id,provider.id,
  user_row.id::text,provider.provider_tenant_key,user_row.id,'active'
from public.organization_members member
join auth.users user_row on user_row.id=member.user_id
join public.identity_providers provider on provider.tenant_id=member.tenant_id
  and provider.provider_code='crm-schema'
where user_row.email like 'crm-%@example.test';
insert into public.roles(tenant_id,organization_id,code,name,description,is_system,is_enabled)
select tenant.id,organization.id,'crm_schema_manager','CRM schema manager','CRM schema test role',false,true
from public.tenants tenant
join public.organizations organization on organization.tenant_id=tenant.id
where tenant.slug='crm-schema-a';
insert into public.role_permissions(tenant_id,role_id,permission_id)
select role.tenant_id,role.id,permission.id
from public.roles role
join public.permissions permission on permission.code in ('customer.manage','project.manage')
where role.code='crm_schema_manager';
insert into public.member_roles(tenant_id,member_id,role_id)
select member.tenant_id,member.id,role.id
from public.organization_members member
join auth.users user_row on user_row.id=member.user_id
join public.roles role on role.tenant_id=member.tenant_id
  and role.organization_id=member.organization_id and role.code='crm_schema_manager'
where user_row.email='crm-manager-a@example.test';

insert into public.customers(
  public_id,tenant_id,organization_id,owner_member_id,created_by_member_id,updated_by_member_id,
  name,registration_code,industry,source,region,status
)
select seed.public_id,tenant.id,organization.id,member.id,member.id,member.id,
  seed.name,seed.registration_code,'technology','referral','上海','following'
from (values
  ('crm-schema-a','crm-schema-org-a','crm-owner-a@example.test','a4100000-0000-4000-8000-000000000001'::uuid,'A 客户','  uscc-a  '),
  ('crm-schema-b','crm-schema-org-b','crm-owner-b@example.test','a4100000-0000-4000-8000-000000000002'::uuid,'A 客户','USCC-A')
) seed(tenant_slug,organization_slug,owner_email,public_id,name,registration_code)
join public.tenants tenant on tenant.slug=seed.tenant_slug
join public.organizations organization on organization.tenant_id=tenant.id and organization.slug=seed.organization_slug
join auth.users user_row on user_row.email=seed.owner_email
join public.organization_members member on member.tenant_id=tenant.id
  and member.organization_id=organization.id and member.user_id=user_row.id;

insert into public.customer_contacts(
  public_id,tenant_id,organization_id,customer_id,created_by_member_id,updated_by_member_id,
  name,title,phone,email,visibility,is_primary
)
select 'a4200000-0000-4000-8000-000000000001',customer.tenant_id,customer.organization_id,
  customer.id,customer.owner_member_id,customer.owner_member_id,'张联系人','采购负责人',
  '13800000000','contact@example.test','assigned',true
from public.customers customer where customer.public_id='a4100000-0000-4000-8000-000000000001';

insert into public.opportunities(
  public_id,tenant_id,organization_id,customer_id,owner_member_id,
  created_by_member_id,updated_by_member_id,name,stage,amount,currency,expected_close_on
)
select 'a4300000-0000-4000-8000-000000000001',customer.tenant_id,customer.organization_id,
  customer.id,customer.owner_member_id,customer.owner_member_id,customer.owner_member_id,
  '首期交付商机','qualified',880000.00,'CNY','2026-10-31'
from public.customers customer where customer.public_id='a4100000-0000-4000-8000-000000000001';
insert into public.customer_follow_ups(
  public_id,tenant_id,organization_id,customer_id,opportunity_id,actor_member_id,
  kind,content,occurred_at,next_follow_up_at
)
select 'a4400000-0000-4000-8000-000000000001',customer.tenant_id,customer.organization_id,
  customer.id,opportunity.id,customer.owner_member_id,'meeting','确认正式需求范围',
  '2026-08-28T08:00:00Z','2026-08-29T08:00:00Z'
from public.customers customer
join public.opportunities opportunity on opportunity.tenant_id=customer.tenant_id
  and opportunity.organization_id=customer.organization_id and opportunity.customer_id=customer.id
where customer.public_id='a4100000-0000-4000-8000-000000000001';
insert into public.projects(
  public_id,tenant_id,organization_id,code,name,description,category,
  owner_member_id,created_by_member_id,updated_by_member_id,status,health,priority,
  start_date,due_date,budget_amount,version
)
select 'a4500000-0000-4000-8000-000000000001',customer.tenant_id,customer.organization_id,
  'CRM-DELIVERY-A','客户正式交付','CRM RLS test project','客户交付',
  customer.owner_member_id,customer.owner_member_id,customer.owner_member_id,
  'active','on_track','high','2026-08-28','2026-10-31',880000.00,1
from public.customers customer where customer.public_id='a4100000-0000-4000-8000-000000000001';
insert into public.customer_project_links(
  public_id,tenant_id,organization_id,customer_id,opportunity_id,project_id,
  linked_by_member_id,link_type
)
select 'a4600000-0000-4000-8000-000000000001',customer.tenant_id,customer.organization_id,
  customer.id,opportunity.id,project.id,customer.owner_member_id,'delivery'
from public.customers customer
join public.opportunities opportunity on opportunity.tenant_id=customer.tenant_id
  and opportunity.organization_id=customer.organization_id and opportunity.customer_id=customer.id
join public.projects project on project.tenant_id=customer.tenant_id
  and project.organization_id=customer.organization_id
  and project.public_id='a4500000-0000-4000-8000-000000000001'
where customer.public_id='a4100000-0000-4000-8000-000000000001';
insert into public.customer_contacts(
  public_id,tenant_id,organization_id,customer_id,created_by_member_id,updated_by_member_id,
  name,title,phone,email,visibility,is_primary
)
select 'a4200000-0000-4000-8000-000000000002',customer.tenant_id,customer.organization_id,
  customer.id,customer.owner_member_id,customer.owner_member_id,'管理联系人','法务负责人',
  '13900000000','legal@example.test','managers',false
from public.customers customer where customer.public_id='a4100000-0000-4000-8000-000000000001';

select set_config('request.jwt.claim.sub','a4000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select is((select count(*) from public.customers),1::bigint,'assigned member reads only the owned customer in the exact tenant');
select is((select count(*) from public.customer_contacts),1::bigint,'assigned member sees assigned contact PII but not manager-only PII');
select is((select phone from public.customer_contacts limit 1),'13800000000','assigned contact projection retains real PII');
select ok(
  (select count(*) from public.opportunities)=1
  and (select count(*) from public.customer_follow_ups)=1
  and (select count(*) from public.customer_project_links)=1,
  'assigned member reads the owned opportunity, follow-up and delivery link'
);
select throws_ok(
  $$ insert into public.customers(tenant_id,organization_id,owner_member_id,created_by_member_id,updated_by_member_id,name)
     values (1,1,1,1,1,'Blocked browser write') $$,
  '42501',null,'authenticated user cannot directly insert a customer'
);
reset role;

select set_config('request.jwt.claim.sub','a4000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select is((select count(*) from public.customers),1::bigint,'customer manager reads its organization customer only');
select is((select count(*) from public.customer_contacts),2::bigint,'customer manager reads both assigned and manager-only contact rows');
select ok(
  (select count(*) from public.opportunities)=1
  and (select count(*) from public.customer_follow_ups)=1
  and (select count(*) from public.customer_project_links)=1,
  'customer manager reads the organization opportunity, follow-up and delivery link'
);
reset role;

select set_config('request.jwt.claim.sub','a4000000-0000-4000-8000-000000000003',true);
set local role authenticated;
select is((select count(*) from public.customers),0::bigint,'unassigned employee cannot read customer PII');
select is((select count(*) from public.customer_contacts),0::bigint,'unassigned employee cannot read contact PII');
select ok(
  (select count(*) from public.opportunities)=0
  and (select count(*) from public.customer_follow_ups)=0
  and (select count(*) from public.customer_project_links)=0,
  'unassigned employee cannot read customer workflow children'
);
reset role;

select set_config('request.jwt.claim.sub','a4000000-0000-4000-8000-000000000004',true);
set local role authenticated;
select is((select count(*) from public.customers),1::bigint,'second tenant member reads only the second tenant customer');
select is((select count(*) from public.customers where public_id='a4100000-0000-4000-8000-000000000001'),0::bigint,'cross-tenant customer is invisible');
select is((select count(*) from public.customer_contacts),0::bigint,'cross-tenant contact PII is invisible');
select ok(
  (select count(*) from public.opportunities)=0
  and (select count(*) from public.customer_follow_ups)=0
  and (select count(*) from public.customer_project_links)=0,
  'cross-tenant opportunity, follow-up and delivery links are invisible'
);
reset role;

select throws_ok(
  $$ insert into public.customers(
       tenant_id,organization_id,owner_member_id,created_by_member_id,updated_by_member_id,name
     )
     select tenant_id,organization_id,owner_member_id,owner_member_id,owner_member_id,'  A 客户  '
     from public.customers where public_id='a4100000-0000-4000-8000-000000000001' $$,
  '23505',null,'active customer names are unique after normalization inside one organization'
);
select throws_ok(
  $$ insert into public.customers(
       tenant_id,organization_id,owner_member_id,created_by_member_id,updated_by_member_id,
       name,registration_code
     )
     select tenant_id,organization_id,owner_member_id,owner_member_id,owner_member_id,
       '不同客户','USCC-A'
     from public.customers where public_id='a4100000-0000-4000-8000-000000000001' $$,
  '23505',null,'active registration codes are unique after normalization inside one organization'
);
select lives_ok(
  $$ insert into public.customers(
       tenant_id,organization_id,owner_member_id,created_by_member_id,updated_by_member_id,
       name,registration_code,archived_at
     )
     select tenant_id,organization_id,owner_member_id,owner_member_id,owner_member_id,
       ' A 客户 ',' uscc-a ',clock_timestamp()
     from public.customers where public_id='a4100000-0000-4000-8000-000000000001' $$,
  'archived history can preserve a formerly active dedupe key'
);
select throws_ok(
  $$ insert into public.customer_contacts(
       tenant_id,organization_id,customer_id,created_by_member_id,updated_by_member_id,name
     )
     select tenant_b.id,organization_b.id,customer_a.id,member_b.id,member_b.id,'Cross tenant contact'
     from public.tenants tenant_b
     join public.organizations organization_b on organization_b.tenant_id=tenant_b.id
     join auth.users user_b on user_b.email='crm-owner-b@example.test'
     join public.organization_members member_b on member_b.tenant_id=tenant_b.id
       and member_b.organization_id=organization_b.id and member_b.user_id=user_b.id
     cross join public.customers customer_a
     where tenant_b.slug='crm-schema-b'
       and customer_a.public_id='a4100000-0000-4000-8000-000000000001' $$,
  '23503',null,'composite foreign keys reject a cross-tenant contact link'
);
select throws_ok(
  $$ insert into public.opportunities(
       tenant_id,organization_id,customer_id,owner_member_id,
       created_by_member_id,updated_by_member_id,name,stage,amount
     )
     select tenant_id,organization_id,id,owner_member_id,
       owner_member_id,owner_member_id,'NaN amount','lead','NaN'::numeric
     from public.customers where public_id='a4100000-0000-4000-8000-000000000001' $$,
  '23514',null,'opportunity amount rejects numeric NaN'
);

select set_config('test.crm.owner_employee',(
  select profile.public_id::text from public.employee_profiles profile
  join public.organization_members member on member.tenant_id=profile.tenant_id
    and member.organization_id=profile.organization_id and member.id=profile.organization_member_id
  where member.user_id='a4000000-0000-4000-8000-000000000001'
),true);
select set_config('request.jwt.claim.sub','a4000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select throws_ok(
  $$ select public.create_current_customer(
    'Forbidden customer',null,
    current_setting('test.crm.owner_employee')::uuid,
    'technology','referral','上海','lead',0,'普通员工不得创建',
    'a4700000-0000-4000-8000-000000000001','a4700000-0000-4000-8000-000000000002'
  ) $$,
  '42501','CRM command permission required','assigned employee without customer.manage cannot create a customer'
);
reset role;

select set_config('request.jwt.claim.sub','a4000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select set_config('test.crm.created',public.create_current_customer(
  'B 客户','91310000-B',
  current_setting('test.crm.owner_employee')::uuid,
  'manufacturing','outbound','苏州','following',0,'创建正式客户',
  'a4700000-0000-4000-8000-000000000003','a4700000-0000-4000-8000-000000000004'
)::text,true);
select set_config('test.crm.created_replay',public.create_current_customer(
  'B 客户','91310000-B',
  current_setting('test.crm.owner_employee')::uuid,
  'manufacturing','outbound','苏州','following',0,'创建正式客户',
  'a4700000-0000-4000-8000-000000000003','a4700000-0000-4000-8000-000000000004'
)::text,true);
select set_config('test.crm.scope_conflict',public.create_current_customer(
  '篡改后的 B 客户','91310000-B',
  current_setting('test.crm.owner_employee')::uuid,
  'manufacturing','outbound','苏州','following',0,'创建正式客户',
  'a4700000-0000-4000-8000-000000000005','a4700000-0000-4000-8000-000000000004'
)::text,true);
select set_config('test.crm.duplicate',public.create_current_customer(
  '  B 客户  ',null,
  current_setting('test.crm.owner_employee')::uuid,
  'manufacturing','referral','苏州','lead',0,'重复客户检查',
  'a4700000-0000-4000-8000-000000000006','a4700000-0000-4000-8000-000000000007'
)::text,true);
select set_config('test.crm.updated',public.update_current_customer(
  (current_setting('test.crm.created')::jsonb->>'id')::uuid,
  'B 客户升级','91310000-B',
  current_setting('test.crm.owner_employee')::uuid,
  'manufacturing','outbound','苏州','proposal',1,'进入方案阶段',
  'a4700000-0000-4000-8000-000000000008','a4700000-0000-4000-8000-000000000009'
)::text,true);
select set_config('test.crm.stale',public.update_current_customer(
  (current_setting('test.crm.created')::jsonb->>'id')::uuid,
  '过期更新','91310000-B',
  current_setting('test.crm.owner_employee')::uuid,
  'manufacturing','outbound','苏州','proposal',1,'过期版本',
  'a4700000-0000-4000-8000-000000000010','a4700000-0000-4000-8000-000000000011'
)::text,true);
select set_config('test.crm.contact',public.create_current_customer_contact(
  (current_setting('test.crm.created')::jsonb->>'id')::uuid,
  '李采购','采购负责人','13700000000','buyer-b@example.test','assigned',true,0,
  '录入主要联系人 13700000000 buyer-b@example.test','a4700000-0000-4000-8000-000000000012','a4700000-0000-4000-8000-000000000013'
)::text,true);
select set_config('test.crm.contact_replay',public.create_current_customer_contact(
  (current_setting('test.crm.created')::jsonb->>'id')::uuid,
  '李采购','采购负责人','13700000000','buyer-b@example.test','assigned',true,0,
  '录入主要联系人 13700000000 buyer-b@example.test','a4700000-0000-4000-8000-000000000012','a4700000-0000-4000-8000-000000000013'
)::text,true);
select set_config('test.crm.contact_second',public.create_current_customer_contact(
  (current_setting('test.crm.created')::jsonb->>'id')::uuid,
  '赵法务','法务负责人',null,'legal-b@example.test','managers',true,0,
  '更换主要联系人','a4700000-0000-4000-8000-000000000014','a4700000-0000-4000-8000-000000000015'
)::text,true);
reset role;

select is(current_setting('test.crm.created')::jsonb->>'outcome','success','customer manager creates a customer');
select is(current_setting('test.crm.created_replay')::jsonb,current_setting('test.crm.created')::jsonb,'same customer command replays the canonical result');
select is((select count(*) from public.customers where name_normalized='b 客户'),1::bigint,'idempotent create persists one customer');
select ok(exists(select 1 from public.audit_logs where request_id='a4700000-0000-4000-8000-000000000003' and action='customer.created'),'customer create is audited');
select is(current_setting('test.crm.scope_conflict')::jsonb->>'error','scope_conflict','changed payload cannot reuse a customer idempotency key');
select ok(exists(select 1 from public.audit_logs where request_id='a4700000-0000-4000-8000-000000000005' and action='customer.command_failed' and metadata->>'failure'='scope_conflict'),'scope conflict leaves durable audit evidence');
select is(current_setting('test.crm.duplicate')::jsonb->>'error','conflict','normalized duplicate customer returns a stable conflict');
select is((current_setting('test.crm.updated')::jsonb->>'version')::bigint,2::bigint,'customer update uses optimistic versioning');
select is(current_setting('test.crm.stale')::jsonb->>'error','stale_version','stale customer update is rejected');
select is(current_setting('test.crm.contact')::jsonb->>'outcome','success','customer manager creates restricted contact PII');
select is(current_setting('test.crm.contact_replay')::jsonb,current_setting('test.crm.contact')::jsonb,'contact create replays without duplication');
select is((select count(*) from public.customer_contacts contact
  join public.customers customer on customer.id=contact.customer_id
  where customer.name_normalized='b 客户升级'),2::bigint,'two distinct contact commands create exactly two contacts');
select is((select contact.created_by_member_id from public.customer_contacts contact
  where contact.public_id=(current_setting('test.crm.contact')::jsonb->>'id')::uuid),
  (select member.id from public.organization_members member where member.user_id='a4000000-0000-4000-8000-000000000002'),
  'contact actor is derived from the authenticated session');
select ok(not exists(select 1 from public.audit_logs where request_id='a4700000-0000-4000-8000-000000000012'
  and (metadata::text like '%13700000000%' or metadata::text like '%buyer-b@example.test%')),
  'contact audit excludes raw PII even when caller reason repeats it');
select is(current_setting('test.crm.contact_second')::jsonb->>'outcome','success','a later primary contact command succeeds');
select ok(
  (select count(*) from public.customer_contacts contact
    join public.customers customer on customer.id=contact.customer_id
    where customer.name_normalized='b 客户升级' and contact.is_primary and contact.archived_at is null)=1
  and (select version from public.customer_contacts
    where public_id=(current_setting('test.crm.contact')::jsonb->>'id')::uuid)=2,
  'primary contact replacement is atomic and versions the prior row'
);
select is(
  (select count(*) from pg_indexes where schemaname='public'
    and indexname in ('customers_active_normalized_name_uidx','customers_active_registration_code_uidx')),
  2::bigint,
  'customer normalized dedupe indexes exist'
);
select ok(
  has_function_privilege('authenticated','public.can_read_current_customer(bigint,bigint,bigint)','EXECUTE')
  and not has_function_privilege('anon','public.can_read_current_customer(bigint,bigint,bigint)','EXECUTE'),
  'only authenticated sessions can evaluate customer RLS scope'
);

insert into public.opportunities(
  public_id,tenant_id,organization_id,customer_id,owner_member_id,
  created_by_member_id,updated_by_member_id,name,stage,amount,currency,expected_close_on,version
)
select 'a4900000-0000-4000-8000-000000000001',customer.tenant_id,customer.organization_id,
  customer.id,customer.owner_member_id,customer.owner_member_id,customer.owner_member_id,
  '回滚验证商机','won',660000.00,'CNY','2026-11-30',1
from public.customers customer where customer.name_normalized='b 客户升级';

select set_config('test.crm.historical_owner_employee',(
  select profile.public_id::text from public.employee_profiles profile
  join public.organization_members member on member.tenant_id=profile.tenant_id
    and member.organization_id=profile.organization_id and member.id=profile.organization_member_id
  where member.user_id='a4000000-0000-4000-8000-000000000003'
),true);
insert into public.opportunities(
  public_id,tenant_id,organization_id,customer_id,owner_member_id,
  created_by_member_id,updated_by_member_id,name,stage,amount,currency,expected_close_on,version
)
select 'a4900000-0000-4000-8000-000000000002',customer.tenant_id,customer.organization_id,
  customer.id,owner_member.id,customer.owner_member_id,customer.owner_member_id,
  '历史负责人商机','lead',120000.00,'CNY','2026-12-31',1
from public.customers customer
join public.organization_members owner_member on owner_member.tenant_id=customer.tenant_id
  and owner_member.organization_id=customer.organization_id
  and owner_member.user_id='a4000000-0000-4000-8000-000000000003'
where customer.name_normalized='b 客户升级';
update public.employee_profiles profile set deleted_at=clock_timestamp()
where profile.public_id=current_setting('test.crm.historical_owner_employee')::uuid;

create or replace function public.test_crm_reject_project_link()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if current_setting('test.crm.inject_link_failure',true)='on' then
    raise exception 'injected customer project link failure';
  end if;
  return new;
end;
$$;
create trigger test_crm_reject_project_link
before insert on public.customer_project_links
for each row execute function public.test_crm_reject_project_link();

select set_config('request.jwt.claim.sub','a4000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select throws_ok(
  $$ select public.create_current_opportunity(
    (current_setting('test.crm.created')::jsonb->>'id')::uuid,'无限日期商机',
    current_setting('test.crm.owner_employee')::uuid,1.00,'CNY','infinity'::date,0,'拒绝无限日期',
    'a4800000-0000-4000-8000-000000000021','a4800000-0000-4000-8000-000000000022'
  ) $$,
  '22023','CRM command is invalid','opportunity close date rejects PostgreSQL infinity'
);
select throws_ok(
  $$ select public.create_current_customer_follow_up(
    (current_setting('test.crm.created')::jsonb->>'id')::uuid,null,'note','无限时间跟进',
    'infinity'::timestamptz,0,'拒绝无限时间',
    'a4800000-0000-4000-8000-000000000023','a4800000-0000-4000-8000-000000000024'
  ) $$,
  '22023','CRM command is invalid','follow-up next action rejects PostgreSQL infinity'
);
select throws_ok(
  $$ select public.convert_current_opportunity_to_project(
    'a4900000-0000-4000-8000-000000000001','无限日期项目','拒绝无限日期','客户交付',
    'planning','medium','infinity'::date,'infinity'::date,1,'拒绝无限日期',
    'a4800000-0000-4000-8000-000000000025','a4800000-0000-4000-8000-000000000026'
  ) $$,
  '22023','CRM command is invalid','opportunity conversion rejects PostgreSQL infinite project dates'
);
select set_config('test.crm.historical_transition',public.transition_current_opportunity_stage(
  'a4900000-0000-4000-8000-000000000002','qualified',null,1,'推进历史负责人商机',
  'a4800000-0000-4000-8000-000000000027','a4800000-0000-4000-8000-000000000028'
)::text,true);
select set_config('test.crm.opportunity',public.create_current_opportunity(
  (current_setting('test.crm.created')::jsonb->>'id')::uuid,'智能工厂二期',
  current_setting('test.crm.owner_employee')::uuid,880000.00,'CNY',current_date+60,0,
  '登记真实商机','a4800000-0000-4000-8000-000000000001','a4800000-0000-4000-8000-000000000002'
)::text,true);
select set_config('test.crm.opportunity_replay',public.create_current_opportunity(
  (current_setting('test.crm.created')::jsonb->>'id')::uuid,'智能工厂二期',
  current_setting('test.crm.owner_employee')::uuid,880000.00,'CNY',current_date+60,0,
  '登记真实商机','a4800000-0000-4000-8000-000000000001','a4800000-0000-4000-8000-000000000002'
)::text,true);
select set_config('test.crm.opportunity_invalid',public.transition_current_opportunity_stage(
  (current_setting('test.crm.opportunity')::jsonb->>'id')::uuid,'won',null,1,'禁止跳级',
  'a4800000-0000-4000-8000-000000000003','a4800000-0000-4000-8000-000000000004'
)::text,true);
select set_config('test.crm.opportunity_qualified',public.transition_current_opportunity_stage(
  (current_setting('test.crm.opportunity')::jsonb->>'id')::uuid,'qualified',null,1,'完成资格确认',
  'a4800000-0000-4000-8000-000000000005','a4800000-0000-4000-8000-000000000006'
)::text,true);
select set_config('test.crm.opportunity_proposal',public.transition_current_opportunity_stage(
  (current_setting('test.crm.opportunity')::jsonb->>'id')::uuid,'proposal',null,2,'提交正式方案',
  'a4800000-0000-4000-8000-000000000007','a4800000-0000-4000-8000-000000000008'
)::text,true);
select set_config('test.crm.opportunity_won',public.transition_current_opportunity_stage(
  (current_setting('test.crm.opportunity')::jsonb->>'id')::uuid,'won',null,3,'客户正式签约',
  'a4800000-0000-4000-8000-000000000009','a4800000-0000-4000-8000-000000000010'
)::text,true);
select set_config('test.crm.opportunity_stale',public.transition_current_opportunity_stage(
  (current_setting('test.crm.opportunity')::jsonb->>'id')::uuid,'lost','过期请求',3,'过期版本',
  'a4800000-0000-4000-8000-000000000011','a4800000-0000-4000-8000-000000000012'
)::text,true);
select set_config('test.crm.follow_up',public.create_current_customer_follow_up(
  (current_setting('test.crm.created')::jsonb->>'id')::uuid,
  (current_setting('test.crm.opportunity')::jsonb->>'id')::uuid,
  'meeting','确认正式交付范围',clock_timestamp()+interval '1 day',0,
  '客户 13600000000 delivery@example.test',
  'a4800000-0000-4000-8000-000000000013','a4800000-0000-4000-8000-000000000014'
)::text,true);
select set_config('test.crm.converted',public.convert_current_opportunity_to_project(
  (current_setting('test.crm.opportunity')::jsonb->>'id')::uuid,
  '智能工厂二期交付','正式交付项目','客户交付','planning','high',
  '2026-09-01','2026-10-31',4,'赢单转交付项目',
  'a4800000-0000-4000-8000-000000000015','a4800000-0000-4000-8000-000000000016'
)::text,true);
select set_config('test.crm.converted_replay',public.convert_current_opportunity_to_project(
  (current_setting('test.crm.opportunity')::jsonb->>'id')::uuid,
  '智能工厂二期交付','正式交付项目','客户交付','planning','high',
  '2026-09-01','2026-10-31',4,'赢单转交付项目',
  'a4800000-0000-4000-8000-000000000015','a4800000-0000-4000-8000-000000000016'
)::text,true);
select set_config('test.crm.converted_again',public.convert_current_opportunity_to_project(
  (current_setting('test.crm.opportunity')::jsonb->>'id')::uuid,
  '重复交付','不应创建','客户交付','planning','high',
  '2026-09-01','2026-10-31',5,'重复转换检查',
  'a4800000-0000-4000-8000-000000000017','a4800000-0000-4000-8000-000000000018'
)::text,true);
reset role;
select set_config('test.crm.project_count_before_failure',(select count(*)::text from public.projects),true);
set local role authenticated;
select set_config('test.crm.inject_link_failure','on',true);
select set_config('test.crm.conversion_rollback',public.convert_current_opportunity_to_project(
  'a4900000-0000-4000-8000-000000000001','回滚验证项目','应整体回滚','客户交付',
  'planning','medium','2026-09-01','2026-11-30',1,'注入关联失败',
  'a4800000-0000-4000-8000-000000000019','a4800000-0000-4000-8000-000000000020'
)::text,true);
select set_config('test.crm.inject_link_failure','off',true);
select set_config('test.crm.conversion_rollback_replay',public.convert_current_opportunity_to_project(
  'a4900000-0000-4000-8000-000000000001','回滚验证项目','应整体回滚','客户交付',
  'planning','medium','2026-09-01','2026-11-30',1,'注入关联失败',
  'a4800000-0000-4000-8000-000000000019','a4800000-0000-4000-8000-000000000020'
)::text,true);
reset role;

select is(current_setting('test.crm.opportunity')::jsonb->>'outcome','success','manager creates a lead opportunity');
select is(current_setting('test.crm.historical_transition')::jsonb->>'outcome','success',
  'opportunity remains transitionable after its historical owner profile is soft deleted');
select is(current_setting('test.crm.historical_transition')::jsonb#>>'{entity,ownerEmployeePublicId}',
  current_setting('test.crm.historical_owner_employee'),
  'stage response preserves the soft-deleted historical owner public id');
select is(current_setting('test.crm.opportunity_replay')::jsonb,current_setting('test.crm.opportunity')::jsonb,'opportunity create replays exactly');
select is((select count(*) from public.opportunities where name='智能工厂二期'),1::bigint,'opportunity create is idempotent');
select is(current_setting('test.crm.opportunity_invalid')::jsonb->>'error','invalid_stage','lead cannot jump directly to won');
select is((current_setting('test.crm.opportunity_qualified')::jsonb->>'version')::bigint,2::bigint,'lead advances to qualified');
select is((current_setting('test.crm.opportunity_proposal')::jsonb->>'version')::bigint,3::bigint,'qualified advances to proposal');
select is((current_setting('test.crm.opportunity_won')::jsonb->>'version')::bigint,4::bigint,'proposal advances to won');
select is(current_setting('test.crm.opportunity_stale')::jsonb->>'error','stale_version','stale stage transition is rejected');
select is(current_setting('test.crm.follow_up')::jsonb->>'outcome','success','manager records a customer follow-up');
select is((select follow_up.actor_member_id from public.customer_follow_ups follow_up
  where follow_up.public_id=(current_setting('test.crm.follow_up')::jsonb->>'id')::uuid),
  (select member.id from public.organization_members member where member.user_id='a4000000-0000-4000-8000-000000000002'),
  'follow-up actor is derived from the authenticated member');
select ok((select follow_up.occurred_at<=follow_up.next_follow_up_at
  from public.customer_follow_ups follow_up
  where follow_up.public_id=(current_setting('test.crm.follow_up')::jsonb->>'id')::uuid),
  'follow-up occurrence uses server time before its next action');
select ok(not exists(select 1 from public.audit_logs
  where request_id='a4800000-0000-4000-8000-000000000013'
    and (metadata::text like '%13600000000%' or metadata::text like '%delivery@example.test%')),
  'follow-up audit excludes raw PII repeated in the caller reason');
select is(current_setting('test.crm.converted')::jsonb->>'outcome','success','won opportunity converts to a project');
select is(current_setting('test.crm.converted_replay')::jsonb,current_setting('test.crm.converted')::jsonb,'conversion replays both canonical ids');
select ok(exists(select 1 from public.projects project
  where project.public_id=(current_setting('test.crm.converted')::jsonb#>>'{entity,projectId}')::uuid
    and project.budget_amount=880000.00),'converted project uses the authoritative opportunity amount');
select ok(exists(select 1 from public.customer_project_links link
  where link.public_id=(current_setting('test.crm.converted')::jsonb#>>'{entity,customerProjectLinkId}')::uuid
    and link.opportunity_id=(select id from public.opportunities
      where public_id=(current_setting('test.crm.opportunity')::jsonb->>'id')::uuid)),
  'conversion writes the exact opportunity-project delivery link');
select is((select version from public.opportunities
  where public_id=(current_setting('test.crm.opportunity')::jsonb->>'id')::uuid),5::bigint,
  'conversion versions the won opportunity');
select is(current_setting('test.crm.converted_again')::jsonb->>'error','already_converted','one opportunity cannot create a second active project');
select is(current_setting('test.crm.conversion_rollback')::jsonb->>'error','command_failed','injected link failure returns a durable command failure');
select is(current_setting('test.crm.conversion_rollback_replay')::jsonb,
  current_setting('test.crm.conversion_rollback')::jsonb,
  'failed conversion replays the durable outer command result without creating a project');
select is((select result->>'error' from public.crm_command_idempotency
  where operation='convert_current_opportunity_to_project'
    and idempotency_key='a4800000-0000-4000-8000-000000000020'),
  'command_failed','outer CRM ledger persists the failed conversion result');
select ok(exists(select 1 from public.audit_logs
  where request_id='a4800000-0000-4000-8000-000000000019'
    and action='customer.command_failed' and metadata->>'failure'='command_failed'),
  'outer CRM failure audit persists after nested rollback');
select ok(not exists(select 1 from public.project_command_idempotency
  where request_id='a4800000-0000-4000-8000-000000000019'),
  'nested project idempotency ledger rolls back with the failed delivery link');
select is((select count(*) from public.projects),current_setting('test.crm.project_count_before_failure')::bigint,
  'link failure rolls back the nested project creation');
select ok(not exists(select 1 from public.projects where name='回滚验证项目')
  and not exists(select 1 from public.customer_project_links link
    join public.opportunities opportunity on opportunity.id=link.opportunity_id
    where opportunity.public_id='a4900000-0000-4000-8000-000000000001'),
  'failed conversion leaves neither project nor delivery link');
select ok(not exists(select 1 from public.audit_logs
  where request_id='a4800000-0000-4000-8000-000000000019' and action='project.created'),
  'rolled-back nested project audit is not persisted');

select * from finish();
rollback;
