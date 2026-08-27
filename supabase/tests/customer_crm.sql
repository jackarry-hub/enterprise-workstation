begin;
select plan(36);

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
join public.permissions permission on permission.code='customer.manage'
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

select * from finish();
rollback;
