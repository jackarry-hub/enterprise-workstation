begin;
select plan(167);

select ok(has_table('public','customers'),'customers table exists');
select ok(has_table('public','customer_contacts'),'customer contacts table exists');
select ok(has_table('public','opportunities'),'opportunities table exists');
select ok(has_table('public','customer_follow_ups'),'customer follow ups table exists');
select ok(has_table('public','customer_project_links'),'customer project links table exists');
select ok(has_view('public','current_customer_opportunity_metrics'),'opportunity list metrics view exists');
select ok(has_view('public','current_customer_follow_up_metrics'),'follow-up list metrics view exists');
select ok(has_view('public','current_customer_opportunities'),'decimal-safe opportunity detail view exists');
select ok(has_view('public','current_customer_industries'),'customer industry filter view exists');
select ok(
  has_table_privilege('authenticated','public.current_customer_opportunity_metrics','SELECT')
  and has_table_privilege('authenticated','public.current_customer_follow_up_metrics','SELECT')
  and has_table_privilege('authenticated','public.current_customer_opportunities','SELECT')
  and has_table_privilege('authenticated','public.current_customer_industries','SELECT')
  and not has_table_privilege('anon','public.current_customer_opportunities','SELECT'),
  'only authenticated sessions can read the RLS-invoker CRM projections'
);
select ok(
  not exists (
    select 1 from pg_class projection
    where projection.oid=any(array[
      'public.current_customer_opportunity_metrics'::regclass,
      'public.current_customer_follow_up_metrics'::regclass,
      'public.current_customer_opportunities'::regclass,
      'public.current_customer_industries'::regclass
    ]) and not (coalesce(projection.reloptions,array[]::text[])
      @> array['security_invoker=true','security_barrier=true'])
  ),
  'all CRM projections preserve caller RLS and security barriers'
);
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
select ok(
  has_table('public','customer_ownership_history')
  and has_table('public','opportunity_stage_history')
  and has_table('public','customer_contracts')
  and has_table('public','crm_source_links')
  and has_table('public','crm_import_jobs')
  and has_table('public','crm_import_rows')
  and has_table('public','crm_export_jobs'),
  'commercial CRM governance and exchange tables exist'
);
select ok(
  (select bool_and(relforcerowsecurity) from pg_class where oid=any(array[
    'public.customer_ownership_history'::regclass,'public.opportunity_stage_history'::regclass,
    'public.customer_contracts'::regclass,'public.crm_source_links'::regclass,
    'public.crm_import_jobs'::regclass,'public.crm_import_rows'::regclass,
    'public.crm_export_jobs'::regclass
  ])),
  'all CRM governance and exchange tables force RLS'
);
select ok(
  not exists (
    select 1 from unnest(array['anon','authenticated','service_role']) role_name
    cross join unnest(array[
      'public.customer_ownership_history','public.opportunity_stage_history',
      'public.customer_contracts','public.crm_source_links','public.crm_import_jobs',
      'public.crm_import_rows','public.crm_export_jobs'
    ]) table_name
    cross join unnest(array['INSERT','UPDATE','DELETE','TRUNCATE']) privilege_name
    where has_table_privilege(role_name,table_name,privilege_name)
  ),
  'browser and service roles cannot mutate governance or exchange tables'
);
select ok(
  not has_table_privilege('authenticated','public.crm_import_jobs','SELECT')
  and not has_table_privilege('authenticated','public.crm_import_rows','SELECT')
  and not has_table_privilege('authenticated','public.crm_export_jobs','SELECT')
  and not has_table_privilege('service_role','public.crm_export_jobs','SELECT'),
  'durable exchange internals are private'
);
select ok(
  not has_table_privilege('authenticated','public.customer_contacts','SELECT')
  and has_function_privilege('authenticated',
    'public.list_current_customer_contacts(uuid[],boolean,integer)','EXECUTE'),
  'contact PII requires the controlled projection RPC'
);
select ok(
  not has_function_privilege('anon','public.list_current_customer_contacts(uuid[],boolean,integer)','EXECUTE')
  and not has_function_privilege('service_role','public.list_current_customer_contacts(uuid[],boolean,integer)','EXECUTE'),
  'contact PII projection is closed to anonymous and service roles'
);
select ok(
  has_function_privilege('authenticated','public.transfer_current_customer_owner(uuid,uuid,bigint,text,uuid,uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.archive_current_customer(uuid,bigint,text,uuid,uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.restore_current_customer(uuid,bigint,text,uuid,uuid)','EXECUTE'),
  'authenticated sessions can enter customer governance commands'
);
select ok(
  not has_function_privilege('anon','public.transfer_current_customer_owner(uuid,uuid,bigint,text,uuid,uuid)','EXECUTE')
  and not has_function_privilege('service_role','public.archive_current_customer(uuid,bigint,text,uuid,uuid)','EXECUTE'),
  'customer governance commands reject bypass roles'
);
select ok(
  exists(select 1 from public.permissions where code='customer.import')
  and exists(select 1 from public.permissions where code='customer.export')
  and exists(select 1 from public.permissions where code='customer.export_pii'),
  'import, export and PII export use distinct permissions'
);
select ok(
  has_function_privilege('authenticated',
    'public.begin_current_crm_import(text,integer,integer,jsonb,jsonb,text,uuid,uuid)','EXECUTE')
  and has_function_privilege('authenticated',
    'public.finalize_current_crm_import(uuid,text,uuid,uuid)','EXECUTE'),
  'authenticated sessions can enter the durable import job lifecycle'
);
select ok(
  has_function_privilege('authenticated',
    'public.request_current_crm_export(uuid,boolean,text,uuid,uuid)','EXECUTE')
  and has_function_privilege('authenticated',
    'public.download_current_crm_export(uuid,uuid)','EXECUTE'),
  'authenticated sessions use separate export request and download RPCs'
);
select ok(
  has_function_privilege('service_role','public.purge_expired_crm_exports(integer)','EXECUTE')
  and not has_function_privilege('authenticated','public.purge_expired_crm_exports(integer)','EXECUTE')
  and not has_function_privilege('anon','public.purge_expired_crm_exports(integer)','EXECUTE'),
  'only the service worker can purge expired CRM export snapshots'
);
select ok(
  (select qual::text like '%archived_at IS NULL%' or qual::text like '%archived_at is null%'
   from pg_policies where schemaname='public' and tablename='customers'
     and policyname='customers_current_scope_select'),
  'ordinary customer reads exclude archived roots'
);
select ok(
  (select count(*) from pg_policies
   where schemaname='public' and tablename in (
     'customer_contacts','opportunities','customer_follow_ups','customer_project_links'
   ) and qual::text ilike '%archived_at%')=4,
  'all child read policies enforce active customer lifecycle'
);
select ok(
  (select count(*) from pg_trigger
   where not tgisinternal and tgrelid=any(array[
     'public.customer_ownership_history'::regclass,
     'public.opportunity_stage_history'::regclass,
     'public.crm_source_links'::regclass
   ]))=6,
  'ownership, stage and provenance facts reject mutation and truncate'
);
select ok(
  exists(select 1 from pg_trigger where not tgisinternal
    and tgrelid='public.customers'::regclass and tgname='customers_guard_owner_transfer')
  and exists(select 1 from pg_trigger where not tgisinternal
    and tgrelid='public.customers'::regclass and tgname='customers_append_ownership_baseline'),
  'customer ownership changes are guarded and new customers receive a baseline event'
);
select ok(
  exists(select 1 from pg_trigger where not tgisinternal
    and tgrelid='public.opportunities'::regclass
    and tgname='opportunities_append_stage_history'
    and pg_get_triggerdef(oid) ilike '%AFTER INSERT OR UPDATE%'),
  'opportunity create and transition append immutable stage history'
);
select ok(
  exists(select 1 from pg_constraint
    where conrelid='public.customer_contracts'::regclass
      and contype='f'
      and pg_get_constraintdef(oid) ilike
        '%FOREIGN KEY (tenant_id, organization_id, customer_id, opportunity_id, project_id)%'
      and pg_get_constraintdef(oid) ilike
        '%REFERENCES customer_project_links(tenant_id, organization_id, customer_id, opportunity_id, project_id)%'),
  'contracts reference an exact customer-project delivery link'
);
select ok(
  exists(select 1 from pg_constraint
    where conrelid='public.crm_source_links'::regclass
      and pg_get_constraintdef(oid) ilike '%customer_project_links%'),
  'project provenance references an exact customer-project link'
);
select ok(
  not exists(select 1 from information_schema.columns
    where table_schema='public' and table_name='crm_import_rows'
      and column_name in ('name','phone','email','raw_row','payload')),
  'durable import row results do not store source PII'
);
select ok(
  has_column('public','crm_export_jobs','snapshot')
  and has_column('public','crm_export_jobs','purged_at')
  and has_column('public','crm_import_jobs','accepted_manifest')
  and not has_table_privilege('authenticated','public.crm_export_jobs','SELECT'),
  'exchange jobs bind accepted manifests and support private snapshot purge'
);
select ok(
  not has_function_privilege('authenticated','public.current_crm_exchange_identity(text)','EXECUTE')
  and not has_function_privilege('authenticated',
    'public.change_current_customer_archive_state(uuid,bigint,text,uuid,uuid,boolean)','EXECUTE'),
  'exchange identity and lifecycle helpers remain internal'
);
select ok(
  not has_function_privilege('authenticated','public.reject_immutable_crm_fact_mutation()','EXECUTE')
  and not has_function_privilege('authenticated','public.guard_customer_owner_transfer()','EXECUTE')
  and not has_function_privilege('authenticated','public.append_customer_ownership_baseline()','EXECUTE')
  and not has_function_privilege('authenticated','public.append_opportunity_stage_history()','EXECUTE')
  and not has_function_privilege('authenticated','public.crm_import_digest_part(text)','EXECUTE'),
  'trigger and digest helpers are not callable by browser roles'
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
join public.permissions permission on permission.code in (
  'customer.manage','project.manage','customer.import','customer.export','customer.export_pii'
)
where role.code='crm_schema_manager';
insert into public.member_roles(tenant_id,member_id,role_id)
select member.tenant_id,member.id,role.id
from public.organization_members member
join auth.users user_row on user_row.id=member.user_id
join public.roles role on role.tenant_id=member.tenant_id
  and role.organization_id=member.organization_id and role.code='crm_schema_manager'
where user_row.email='crm-manager-a@example.test';
insert into public.roles(tenant_id,organization_id,code,name,description,is_system,is_enabled)
select tenant.id,organization.id,'crm_export_no_pii','CRM export without PII','Least privilege export role',false,true
from public.tenants tenant
join public.organizations organization on organization.tenant_id=tenant.id
where tenant.slug='crm-schema-a' and organization.slug='crm-schema-org-a';
insert into public.role_permissions(tenant_id,role_id,permission_id)
select role.tenant_id,role.id,permission.id
from public.roles role
join public.permissions permission on permission.code='customer.export'
where role.code='crm_export_no_pii';
insert into public.member_roles(tenant_id,member_id,role_id)
select member.tenant_id,member.id,role.id
from public.organization_members member
join auth.users user_row on user_row.id=member.user_id
join public.roles role on role.tenant_id=member.tenant_id
  and role.organization_id=member.organization_id and role.code='crm_export_no_pii'
where user_row.email='crm-owner-a@example.test';

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
select is((select count(*) from public.list_current_customer_contacts(
  array(select public_id from public.customers),false,101)),1::bigint,
  'assigned member sees assigned contact PII but not manager-only PII');
select is((select phone from public.list_current_customer_contacts(
  array(select public_id from public.customers),false,101) limit 1),'13800000000',
  'assigned contact projection retains real PII');
select ok(
  (select count(*) from public.opportunities)=1
  and (select count(*) from public.customer_follow_ups)=1
  and (select count(*) from public.customer_project_links)=1,
  'assigned member reads the owned opportunity, follow-up and delivery link'
);
select ok(
  (select count(*) from public.current_customer_opportunity_metrics)=1
  and (select count(*) from public.current_customer_follow_up_metrics)=1
  and (select count(*) from public.current_customer_opportunities)=1
  and (select count(*) from public.current_customer_industries)=1,
  'assigned member reads only owned CRM projections'
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
select is((select count(*) from public.list_current_customer_contacts(
  array(select public_id from public.customers),false,101)),2::bigint,
  'customer manager reads both assigned and manager-only contact rows');
select ok(
  (select count(*) from public.opportunities)=1
  and (select count(*) from public.customer_follow_ups)=1
  and (select count(*) from public.customer_project_links)=1,
  'customer manager reads the organization opportunity, follow-up and delivery link'
);
select ok(
  (select count(*) from public.current_customer_opportunity_metrics)=1
  and (select count(*) from public.current_customer_follow_up_metrics)=1
  and (select count(*) from public.current_customer_opportunities)=1
  and (select count(*) from public.current_customer_industries)=1,
  'customer manager reads only organization CRM projections'
);
reset role;

select set_config('request.jwt.claim.sub','a4000000-0000-4000-8000-000000000003',true);
set local role authenticated;
select is((select count(*) from public.customers),0::bigint,'unassigned employee cannot read customer PII');
select is((select count(*) from public.list_current_customer_contacts(
  array['a4100000-0000-4000-8000-000000000001'::uuid],false,101)),0::bigint,
  'unassigned employee cannot read contact PII');
select ok(
  (select count(*) from public.opportunities)=0
  and (select count(*) from public.customer_follow_ups)=0
  and (select count(*) from public.customer_project_links)=0,
  'unassigned employee cannot read customer workflow children'
);
select ok(
  (select count(*) from public.current_customer_opportunity_metrics)=0
  and (select count(*) from public.current_customer_follow_up_metrics)=0
  and (select count(*) from public.current_customer_opportunities)=0
  and (select count(*) from public.current_customer_industries)=0,
  'unassigned employee cannot read CRM projections'
);
reset role;

select set_config('request.jwt.claim.sub','a4000000-0000-4000-8000-000000000004',true);
set local role authenticated;
select is((select count(*) from public.customers),1::bigint,'second tenant member reads only the second tenant customer');
select is((select count(*) from public.customers where public_id='a4100000-0000-4000-8000-000000000001'),0::bigint,'cross-tenant customer is invisible');
select is((select count(*) from public.list_current_customer_contacts(
  array['a4100000-0000-4000-8000-000000000001'::uuid],false,101)),0::bigint,
  'cross-tenant contact PII is invisible');
select ok(
  (select count(*) from public.opportunities)=0
  and (select count(*) from public.customer_follow_ups)=0
  and (select count(*) from public.customer_project_links)=0,
  'cross-tenant opportunity, follow-up and delivery links are invisible'
);
select ok(
  (select count(*) from public.current_customer_opportunity_metrics)=0
  and (select count(*) from public.current_customer_follow_up_metrics)=0
  and (select count(*) from public.current_customer_opportunities)=0
  and (select count(*) from public.current_customer_industries)=1,
  'second tenant member sees only its own tenant CRM projections'
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

create or replace function public.test_crm_reject_ownership_history()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if new.change_kind='transfer'
     and current_setting('test.crm.inject_owner_history_failure',true)='on' then
    raise exception 'injected ownership history failure';
  end if;
  return new;
end;
$$;
create trigger test_crm_reject_ownership_history
before insert on public.customer_ownership_history
for each row execute function public.test_crm_reject_ownership_history();

create or replace function public.test_crm_reject_import_source()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if new.source_system='import'
     and current_setting('test.crm.inject_import_source_failure',true)='on' then
    raise exception 'injected import source failure';
  end if;
  return new;
end;
$$;
create trigger test_crm_reject_import_source
before insert on public.crm_source_links
for each row execute function public.test_crm_reject_import_source();

create or replace function public.test_crm_reject_export_job()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if current_setting('test.crm.inject_export_failure',true)='on' then
    raise exception 'injected CRM export job failure';
  end if;
  return new;
end;
$$;
create trigger test_crm_reject_export_job
before insert on public.crm_export_jobs
for each row execute function public.test_crm_reject_export_job();

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

select set_config('request.jwt.claim.sub','a4000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select throws_ok(
  $$select public.request_current_crm_export(null,true,'不应允许联系人隐私导出',
    'b5100000-0000-4000-8000-000000000001','b5100000-0000-4000-8000-000000000002')$$,
  '42501',null,'customer.export alone cannot request contact PII'
);
select set_config('test.crm.owner_export_job',public.request_current_crm_export(
  (current_setting('test.crm.created')::jsonb->>'id')::uuid,false,'负责人权限范围快照',
  'b5100000-0000-4000-8000-000000000005','b5100000-0000-4000-8000-000000000006'
)::text,true);
reset role;

select set_config('test.crm.manager_employee',(
  select profile.public_id::text from public.employee_profiles profile
  join public.organization_members member on member.tenant_id=profile.tenant_id
    and member.organization_id=profile.organization_id and member.id=profile.organization_member_id
  where member.user_id='a4000000-0000-4000-8000-000000000002'
),true);
select set_config('quantxy.crm_owner_transfer','',true);
select throws_ok(
  $$update public.customers customer set owner_member_id=(
      select profile.organization_member_id from public.employee_profiles profile
      where profile.public_id=current_setting('test.crm.manager_employee')::uuid
    ) where customer.public_id=(current_setting('test.crm.created')::jsonb->>'id')::uuid$$,
  '42501',null,'owner guard rejects direct changes when the transfer GUC is unset'
);
select set_config('test.crm.import_digest',public.compute_crm_import_row_digest(
  '导入客户 C','91310000-C',current_setting('test.crm.manager_employee')::uuid,
  'enterprise','referral','杭州','周负责人','采购经理','13611112222','buyer-c@example.test',
  'assigned',true
),true);
select set_config('test.crm.rollback_import_digest',public.compute_crm_import_row_digest(
  '导入回滚客户','91310000-ROLLBACK',current_setting('test.crm.manager_employee')::uuid,
  'enterprise','referral','杭州','回滚联系人','采购经理','13611113333','rollback@example.test',
  'assigned',true
),true);
select set_config('request.jwt.claim.sub','a4000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select set_config('test.crm.owner_bypass',public.update_current_customer(
  (current_setting('test.crm.created')::jsonb->>'id')::uuid,
  'B 客户升级','91310000-B',current_setting('test.crm.manager_employee')::uuid,
  'manufacturing','outbound','苏州','proposal',2,'尝试绕过负责人转移',
  'b5000000-0000-4000-8000-000000000001','b5000000-0000-4000-8000-000000000002'
)::text,true);
select set_config('test.crm.inject_owner_history_failure','on',true);
select set_config('test.crm.transfer_failure',public.transfer_current_customer_owner(
  (current_setting('test.crm.created')::jsonb->>'id')::uuid,
  current_setting('test.crm.manager_employee')::uuid,2,'注入负责人历史失败',
  'b5100000-0000-4000-8000-000000000003','b5100000-0000-4000-8000-000000000004'
)::text,true);
select set_config('test.crm.inject_owner_history_failure','off',true);
select set_config('test.crm.transfer_failure_replay',public.transfer_current_customer_owner(
  (current_setting('test.crm.created')::jsonb->>'id')::uuid,
  current_setting('test.crm.manager_employee')::uuid,2,'注入负责人历史失败',
  'b5100000-0000-4000-8000-000000000003','b5100000-0000-4000-8000-000000000004'
)::text,true);
select set_config('test.crm.version_after_transfer_failure',(
  select customer.version::text from public.customers customer
  where customer.public_id=(current_setting('test.crm.created')::jsonb->>'id')::uuid
),true);
select set_config('test.crm.transferred',public.transfer_current_customer_owner(
  (current_setting('test.crm.created')::jsonb->>'id')::uuid,
  current_setting('test.crm.manager_employee')::uuid,2,'正式调整客户负责人',
  'b5000000-0000-4000-8000-000000000003','b5000000-0000-4000-8000-000000000004'
)::text,true);
select set_config('test.crm.contract_mismatch',public.create_current_customer_contract(
  (current_setting('test.crm.created')::jsonb->>'id')::uuid,
  'a4900000-0000-4000-8000-000000000001',
  (current_setting('test.crm.converted')::jsonb#>>'{entity,projectId}')::uuid,
  'HT-CRM-2026-MISMATCH','错配交付合同','active',660000.00,'CNY',
  '2026-08-28','2026-09-01','2026-10-31',0,'拒绝跨商机项目错配',
  'b5400000-0000-4000-8000-000000000001','b5400000-0000-4000-8000-000000000002'
)::text,true);
select set_config('test.crm.contract',public.create_current_customer_contract(
  (current_setting('test.crm.created')::jsonb->>'id')::uuid,
  (current_setting('test.crm.opportunity')::jsonb->>'id')::uuid,
  (current_setting('test.crm.converted')::jsonb#>>'{entity,projectId}')::uuid,
  'HT-CRM-2026-001','智能工厂交付合同','active',880000.00,'CNY',
  '2026-08-28','2026-09-01','2026-10-31',0,'登记真实交付合同',
  'b5000000-0000-4000-8000-000000000005','b5000000-0000-4000-8000-000000000006'
)::text,true);
select set_config('test.crm.source_link',public.create_current_crm_source_link(
  (current_setting('test.crm.created')::jsonb->>'id')::uuid,null,
  (current_setting('test.crm.opportunity')::jsonb->>'id')::uuid,null,
  'feishu','crm-opportunity-2026-001','https://example.test/crm/opportunity/2026-001',
  0,'登记飞书原始来源',
  'b5000000-0000-4000-8000-000000000007','b5000000-0000-4000-8000-000000000008'
)::text,true);
select throws_ok(
  $$select public.create_current_crm_source_link(
    (current_setting('test.crm.created')::jsonb->>'id')::uuid,null,
    (current_setting('test.crm.opportunity')::jsonb->>'id')::uuid,null,
    'external_crm','unsafe-source','https://example.test/source?access_token=secret',
    0,'敏感来源 URL 应拒绝','b5300000-0000-4000-8000-000000000001',
    'b5300000-0000-4000-8000-000000000002')$$,
  '22023',null,'source provenance rejects credentials and sensitive URL query parameters'
);
select throws_ok(
  $$select public.create_current_crm_source_link(
    (current_setting('test.crm.created')::jsonb->>'id')::uuid,null,
    (current_setting('test.crm.opportunity')::jsonb->>'id')::uuid,null,
    'external_crm','unsafe-fragment','https://example.test/source#access%5Ftoken=secret',
    0,'敏感片段 URL 应拒绝','b5400000-0000-4000-8000-000000000003',
    'b5400000-0000-4000-8000-000000000004')$$,
  '22023',null,'source provenance rejects credentials in encoded URL fragments'
);
select throws_ok(
  $$select public.create_current_crm_source_link(
    (current_setting('test.crm.created')::jsonb->>'id')::uuid,null,
    (current_setting('test.crm.opportunity')::jsonb->>'id')::uuid,null,
    'external_crm','unsafe-valueless-key','https://example.test/source?access_token',
    0,'无值敏感参数也应拒绝','b5400000-0000-4000-8000-000000000009',
    'b5400000-0000-4000-8000-000000000010')$$,
  '22023',null,'source provenance rejects valueless sensitive URL query keys'
);
select set_config('test.crm.archived',public.archive_current_customer(
  (current_setting('test.crm.created')::jsonb->>'id')::uuid,3,'合作阶段结束',
  'b5000000-0000-4000-8000-000000000009','b5000000-0000-4000-8000-000000000010'
)::text,true);
select set_config('test.crm.archived_visible_count',(
  select count(*)::text from public.customers
  where public_id=(current_setting('test.crm.created')::jsonb->>'id')::uuid
),true);
select set_config('test.crm.archived_child_count',(
  select ((select count(*) from public.opportunities opportunity
      where opportunity.public_id=(current_setting('test.crm.opportunity')::jsonb->>'id')::uuid)
    +(select count(*) from public.customer_follow_ups follow_up
      where follow_up.public_id=(current_setting('test.crm.follow_up')::jsonb->>'id')::uuid)
    +(select count(*) from public.customer_project_links link
      where link.public_id=(current_setting('test.crm.converted')::jsonb#>>'{entity,customerProjectLinkId}')::uuid)
    +(select count(*) from public.customer_contracts contract
      where contract.public_id=(current_setting('test.crm.contract')::jsonb->>'id')::uuid)
    +(select count(*) from public.crm_source_links source_link
      where source_link.public_id=(current_setting('test.crm.source_link')::jsonb->>'id')::uuid))::text
),true);
select set_config('test.crm.restored',public.restore_current_customer(
  (current_setting('test.crm.created')::jsonb->>'id')::uuid,4,'客户重新启动合作',
  'b5000000-0000-4000-8000-000000000011','b5000000-0000-4000-8000-000000000012'
)::text,true);
select throws_ok(
  $$select public.begin_current_crm_import(repeat('d',64),2,0,'[]'::jsonb,
    '[{"index":0,"errors":["invalid_row"]},{"index":0,"errors":["invalid_name"]}]'::jsonb,
    '重复拒绝索引','b5200000-0000-4000-8000-000000000001','b5200000-0000-4000-8000-000000000002')$$,
  '22023',null,'import manifest rejects duplicate validation rejection indexes'
);
select throws_ok(
  $$select public.begin_current_crm_import(repeat('e',64),2,1,
    jsonb_build_array(jsonb_build_object('index',0,'rowDigest',repeat('a',64))),
    '[{"index":0,"errors":["invalid_row"]}]'::jsonb,
    '重叠清单索引','b5200000-0000-4000-8000-000000000003','b5200000-0000-4000-8000-000000000004')$$,
  '22023',null,'import manifest rejects accepted and rejected index overlap'
);
select set_config('test.crm.mismatch_import_job',public.begin_current_crm_import(
  repeat('f',64),1,1,jsonb_build_array(jsonb_build_object(
    'index',0,'rowDigest',current_setting('test.crm.import_digest'))),'[]'::jsonb,
  '摘要不匹配验证','b5200000-0000-4000-8000-000000000005','b5200000-0000-4000-8000-000000000006'
)::text,true);
select set_config('test.crm.mismatch_import_row',public.import_current_customer_row(
  (current_setting('test.crm.mismatch_import_job')::jsonb->>'id')::uuid,0,
  current_setting('test.crm.import_digest'),'被篡改的客户名','91310000-C',
  current_setting('test.crm.manager_employee')::uuid,'enterprise','referral','杭州',
  '周负责人','采购经理','13611112222','buyer-c@example.test','assigned',true,0,
  '摘要不匹配验证','b5200000-0000-4000-8000-000000000007','b5200000-0000-4000-8000-000000000008'
)::text,true);
select set_config('test.crm.rollback_import_job',public.begin_current_crm_import(
  repeat('1',64),1,1,jsonb_build_array(jsonb_build_object(
    'index',0,'rowDigest',current_setting('test.crm.rollback_import_digest'))),'[]'::jsonb,
  '导入原子回滚验证','b5200000-0000-4000-8000-000000000009','b5200000-0000-4000-8000-000000000010'
)::text,true);
select set_config('test.crm.inject_import_source_failure','on',true);
select set_config('test.crm.rollback_import_row',public.import_current_customer_row(
  (current_setting('test.crm.rollback_import_job')::jsonb->>'id')::uuid,0,
  current_setting('test.crm.rollback_import_digest'),'导入回滚客户','91310000-ROLLBACK',
  current_setting('test.crm.manager_employee')::uuid,'enterprise','referral','杭州',
  '回滚联系人','采购经理','13611113333','rollback@example.test','assigned',true,0,
  '导入原子回滚验证','b5200000-0000-4000-8000-000000000011','b5200000-0000-4000-8000-000000000012'
)::text,true);
select set_config('test.crm.inject_import_source_failure','off',true);
select set_config('test.crm.import_job',public.begin_current_crm_import(
  repeat('b',64),1,1,jsonb_build_array(jsonb_build_object(
    'index',0,'rowDigest',current_setting('test.crm.import_digest'))),'[]'::jsonb,'首批客户迁移',
  'b5000000-0000-4000-8000-000000000013','b5000000-0000-4000-8000-000000000014'
)::text,true);
select set_config('test.crm.import_row',public.import_current_customer_row(
  (current_setting('test.crm.import_job')::jsonb->>'id')::uuid,0,current_setting('test.crm.import_digest'),
  '导入客户 C','91310000-C',current_setting('test.crm.manager_employee')::uuid,
  'enterprise','referral','杭州','周负责人','采购经理','13611112222','buyer-c@example.test',
  'assigned',true,0,'真实客户迁移',
  'b5000000-0000-4000-8000-000000000015','b5000000-0000-4000-8000-000000000016'
)::text,true);
select set_config('test.crm.import_final',public.finalize_current_crm_import(
  (current_setting('test.crm.import_job')::jsonb->>'id')::uuid,'完成客户迁移',
  'b5000000-0000-4000-8000-000000000017','b5000000-0000-4000-8000-000000000018'
)::text,true);
select set_config('test.crm.inject_export_failure','on',true);
select set_config('test.crm.export_failure',public.request_current_crm_export(
  null,false,'注入导出持久化失败',
  'b5400000-0000-4000-8000-000000000005','b5400000-0000-4000-8000-000000000006'
)::text,true);
select set_config('test.crm.inject_export_failure','off',true);
select set_config('test.crm.export_failure_replay',public.request_current_crm_export(
  null,false,'注入导出持久化失败',
  'b5400000-0000-4000-8000-000000000005','b5400000-0000-4000-8000-000000000006'
)::text,true);
select set_config('test.crm.export_job',public.request_current_crm_export(
  (current_setting('test.crm.created')::jsonb->>'id')::uuid,true,'法务归档导出',
  'b5000000-0000-4000-8000-000000000019','b5000000-0000-4000-8000-000000000020'
)::text,true);
select set_config('test.crm.export_download',public.download_current_crm_export(
  (current_setting('test.crm.export_job')::jsonb->>'id')::uuid,
  'b5000000-0000-4000-8000-000000000021'
)::text,true);
reset role;
update public.crm_export_jobs job set created_at=clock_timestamp()-interval '2 hours',
  expires_at=clock_timestamp()-interval '1 hour'
where job.public_id=(current_setting('test.crm.export_job')::jsonb->>'id')::uuid;
select set_config('request.jwt.claim.sub','a4000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select set_config('test.crm.expired_export_download',public.download_current_crm_export(
  (current_setting('test.crm.export_job')::jsonb->>'id')::uuid,
  'b5300000-0000-4000-8000-000000000003'
)::text,true);
reset role;

select set_config('request.jwt.claim.sub','a4000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select set_config('test.crm.owner_export_download_after_transfer',public.download_current_crm_export(
  (current_setting('test.crm.owner_export_job')::jsonb->>'id')::uuid,
  'b5400000-0000-4000-8000-000000000007'
)::text,true);
reset role;

select is(current_setting('test.crm.owner_bypass')::jsonb->>'error','ownership_transfer_required',
  'legacy customer update cannot bypass ownership history');
select is(current_setting('test.crm.transfer_failure')::jsonb->>'error','command_failed',
  'ownership history failure returns a durable command failure');
select is(current_setting('test.crm.transfer_failure_replay')::jsonb,
  current_setting('test.crm.transfer_failure')::jsonb,
  'failed ownership transfer replays the exact terminal result');
select is(current_setting('test.crm.version_after_transfer_failure')::bigint,2::bigint,
  'failed ownership history append rolls back the customer owner and version');
select ok(exists(select 1 from public.audit_logs
  where request_id='b5100000-0000-4000-8000-000000000003'
    and action='customer.command_failed' and metadata->>'failure'='command_failed'),
  'failed ownership transfer persists audit evidence');
select is(current_setting('test.crm.transferred')::jsonb->>'outcome','success',
  'dedicated ownership transfer succeeds');
select is(current_setting('test.crm.contract_mismatch')::jsonb->>'error','not_found',
  'contract creation rejects a project linked to a different opportunity');
select ok(exists(select 1 from public.customer_ownership_history history
  where history.customer_id=(select id from public.customers
      where public_id=(current_setting('test.crm.created')::jsonb->>'id')::uuid)
    and history.change_kind='transfer' and history.customer_version=3),
  'ownership transfer appends an immutable versioned event');
select is(current_setting('test.crm.contract')::jsonb->>'outcome','success',
  'contract creation accepts the exact customer opportunity and project link');
select is(current_setting('test.crm.source_link')::jsonb->>'outcome','success',
  'source provenance accepts an exact customer opportunity target');
select is(current_setting('test.crm.archived')::jsonb#>>'{entity,archived}','true',
  'customer archive changes only the authoritative root lifecycle');
select is(current_setting('test.crm.archived_visible_count')::bigint,0::bigint,
  'archived customer is immediately invisible through RLS');
select is(current_setting('test.crm.archived_child_count')::bigint,0::bigint,
  'archived customer children are immediately invisible through RLS');
select is(current_setting('test.crm.restored')::jsonb#>>'{entity,archived}','false',
  'authorized restore reactivates the customer root');
select is(current_setting('test.crm.import_job')::jsonb#>>'{entity,status}','running',
  'import starts a durable scoped job');
select is(current_setting('test.crm.mismatch_import_row')::jsonb->>'error','invalid_request',
  'import row content must match the accepted manifest digest');
select is((select count(*) from public.crm_import_rows row_result
  where row_result.import_job_id=(select job.id from public.crm_import_jobs job
    where job.public_id=(current_setting('test.crm.mismatch_import_job')::jsonb->>'id')::uuid)),0::bigint,
  'an unapproved import row index or digest cannot poison job progress');
select is(current_setting('test.crm.rollback_import_row')::jsonb->>'error','command_failed',
  'import source failure becomes a durable row failure');
select ok(not exists(select 1 from public.customers customer where customer.name_normalized='导入回滚客户')
  and not exists(select 1 from public.customer_contacts contact where contact.email='rollback@example.test')
  and not exists(select 1 from public.crm_source_links source_link
    where source_link.external_record_id=(current_setting('test.crm.rollback_import_job')::jsonb->>'id')||':0'),
  'customer contact and source writes roll back atomically when import provenance fails');
select is(current_setting('test.crm.import_row')::jsonb->>'outcome','success',
  'one accepted import row commits atomically');
select is(current_setting('test.crm.import_final')::jsonb#>>'{entity,status}','completed',
  'import finalization derives durable row totals');
select ok(not exists(select 1 from public.crm_import_jobs job
    where job.validation_rejections::text like '%13611112222%'
      or job.validation_rejections::text like '%buyer-c@example.test%')
  and not exists(select 1 from public.crm_import_rows row_result
    where row_result::text like '%13611112222%' or row_result::text like '%buyer-c@example.test%'),
  'durable import job and row records exclude raw contact PII');
select is(current_setting('test.crm.export_failure')::jsonb->>'error','command_failed',
  'export persistence failure returns a durable command failure');
select is(current_setting('test.crm.export_failure_replay')::jsonb,
  current_setting('test.crm.export_failure')::jsonb,
  'failed export request replays its exact terminal result');
select ok(not exists(select 1 from public.crm_export_jobs job
    where job.public_id=(select ledger.target_public_id from public.crm_command_idempotency ledger
      where ledger.operation='request_current_crm_export'
        and ledger.idempotency_key='b5400000-0000-4000-8000-000000000006')),
  'failed export request leaves no partial export job');
select ok(exists(select 1 from public.audit_logs
    where request_id='b5400000-0000-4000-8000-000000000005'
      and action='customer.command_failed' and metadata->>'failure'='command_failed'),
  'failed export request persists audit evidence');
select is(current_setting('test.crm.owner_export_job')::jsonb->>'outcome','success',
  'customer owner can create a least-privilege non-PII export snapshot');
select is(current_setting('test.crm.owner_export_download_after_transfer')::jsonb->>'error','scope_revoked',
  'export download revalidates current customer visibility after ownership transfer');
select ok(exists(select 1 from public.crm_export_jobs job
    where job.public_id=(current_setting('test.crm.owner_export_job')::jsonb->>'id')::uuid
      and job.state='expired' and job.snapshot is null and job.purged_at is not null),
  'scope-revoked export is purged while retaining job metadata');
select ok(exists(select 1 from public.audit_logs
    where request_id='b5400000-0000-4000-8000-000000000007'
      and action='customer.command_failed' and metadata->>'failure'='scope_revoked'),
  'scope-revoked export download persists failure audit evidence');
select ok(not (current_setting('test.crm.export_job')::jsonb#>'{entity}') ? 'rows'
  and (current_setting('test.crm.export_job')::jsonb#>>'{entity,downloadUrl}') like '/api/workstation/customers/export/%',
  'export request returns only job metadata and a separate download URL');
select is((current_setting('test.crm.export_download')::jsonb->>'rowCount')::bigint,1::bigint,
  'audited export download returns the fixed scoped snapshot');
select ok(exists(select 1 from public.audit_logs
  where request_id='b5000000-0000-4000-8000-000000000021'
    and action='customer.export_downloaded'),
  'every export snapshot download appends audit evidence');
select ok(current_setting('test.crm.expired_export_download')::jsonb->>'error'='export_expired'
  and exists(select 1 from public.crm_export_jobs job
    where job.public_id=(current_setting('test.crm.export_job')::jsonb->>'id')::uuid
      and job.state='expired' and job.snapshot is null and job.purged_at is not null),
  'expired export download purges the stored snapshot while preserving metadata');
select ok((select count(*)>=4 from public.opportunity_stage_history history
  where history.opportunity_id=(select id from public.opportunities
    where public_id=(current_setting('test.crm.opportunity')::jsonb->>'id')::uuid)
    and history.change_kind in ('initial','migration_snapshot','transition')),
  'opportunity lifecycle preserves an explicit initial or migration snapshot plus every successful stage transition');
select ok(not exists(select 1 from public.audit_logs
  where request_id=any(array[
    'b5000000-0000-4000-8000-000000000003'::uuid,
    'b5000000-0000-4000-8000-000000000009'::uuid,
    'b5000000-0000-4000-8000-000000000011'::uuid
  ]) and metadata ? 'businessReason' and metadata->>'businessReason' is not null),
  'governance audit stores reason digests instead of raw commercial text');

select * from finish();
rollback;
