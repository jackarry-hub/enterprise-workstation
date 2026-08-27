begin;
select plan(42);

select ok(has_column('public','files','tenant_id'),'files carry tenant ownership');
select ok(has_column('public','files','uploaded_by_member_id'),'files carry canonical uploader membership');
select ok(has_column('public','files','sha256'),'files carry verified content digest');
select ok(has_column('public','files','verified_at'),'files carry verification time');
select ok(has_column('public','file_relations','tenant_id'),'file relations carry tenant ownership');
select ok(has_table('public','file_upload_reservations'),'durable file upload reservations exist');
select is((select relforcerowsecurity from pg_class where oid='public.files'::regclass),true,'files force row security');
select is((select relforcerowsecurity from pg_class where oid='public.file_upload_reservations'::regclass),true,'file reservations force row security');
select ok(has_function('public','reserve_current_project_file_upload',array['uuid','text','text','bigint','text','text','uuid','uuid']::name[]),'signed upload reservation command exists');
select ok(has_function('public','inspect_current_file_upload',array['uuid']::name[]),'authenticated upload inspection exists');
select ok(
  has_function_privilege('service_role','public.record_current_file_upload_signed(uuid,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.record_current_file_upload_signed(uuid,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.record_current_file_upload_signed(uuid,uuid)','EXECUTE'),
  'only the server records real signed-token expiry'
);
select ok(has_function('public','complete_current_project_file_upload',array['uuid','uuid','uuid','text','text','bigint','text','text','uuid']::name[]),'verified completion command exists');
select ok(has_function('public','authorize_current_project_file_download',array['uuid','uuid']::name[]),'audited download authorization exists');
select ok(has_function('public','claim_file_upload_cleanup',array['integer','uuid']::name[]),'expired object cleanup claim exists');
select ok(
  not has_table_privilege('authenticated','public.files','INSERT')
  and not has_table_privilege('authenticated','public.files','UPDATE')
  and not has_table_privilege('authenticated','public.files','DELETE')
  and not has_table_privilege('authenticated','public.files','TRUNCATE')
  and not has_table_privilege('authenticated','public.files','REFERENCES')
  and not has_table_privilege('authenticated','public.files','TRIGGER')
  and not has_table_privilege('authenticated','public.file_relations','INSERT')
  and not has_table_privilege('anon','public.files','SELECT')
  and not has_table_privilege('anon','public.file_relations','SELECT')
  and not has_table_privilege('service_role','public.files','INSERT')
  and not has_table_privilege('service_role','public.file_relations','INSERT'),
  'browser direct file and relation writes are closed'
);
select ok(
  not has_function_privilege('authenticated','public.claim_current_file_upload_verification(uuid,uuid,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.claim_current_file_upload_verification(uuid,uuid,uuid)','EXECUTE')
  and has_function_privilege('service_role','public.claim_current_file_upload_verification(uuid,uuid,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.release_current_file_upload_verification(uuid,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.release_current_file_upload_verification(uuid,uuid)','EXECUTE')
  and has_function_privilege('service_role','public.release_current_file_upload_verification(uuid,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.fail_current_file_upload(uuid,uuid,text,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.fail_current_file_upload(uuid,uuid,text,uuid)','EXECUTE')
  and has_function_privilege('service_role','public.fail_current_file_upload(uuid,uuid,text,uuid)','EXECUTE')
  and not has_function_privilege('authenticated','public.complete_current_project_file_upload(uuid,uuid,uuid,text,text,bigint,text,text,uuid)','EXECUTE')
  and not has_function_privilege('anon','public.complete_current_project_file_upload(uuid,uuid,uuid,text,text,bigint,text,text,uuid)','EXECUTE')
  and has_function_privilege('service_role','public.complete_current_project_file_upload(uuid,uuid,uuid,text,text,bigint,text,text,uuid)','EXECUTE'),
  'only the server verification boundary can complete files'
);
select ok(
  not has_function_privilege('anon','public.project_file_entity(bigint)','EXECUTE')
  and not has_function_privilege('authenticated','public.project_file_entity(bigint)','EXECUTE')
  and not has_function_privilege('service_role','public.project_file_entity(bigint)','EXECUTE')
  and not has_function_privilege('anon','public.file_upload_reservation_result(public.file_upload_reservations)','EXECUTE')
  and not has_function_privilege('authenticated','public.file_upload_reservation_result(public.file_upload_reservations)','EXECUTE'),
  'security-definer helper functions are not exposed through the Data API'
);
select is(
  (select count(*) from pg_policies where schemaname='storage' and policyname like 'workbench_files_owner_%'),
  0::bigint,
  'legacy direct browser storage policies are removed'
);

insert into public.tenants(name,slug,status)
values ('File storage tenant','file-storage-tenant','active'),
       ('File storage foreign','file-storage-foreign','active');
insert into public.organizations(tenant_id,name,slug)
select id,'File storage organization','file-storage-org'
from public.tenants where slug='file-storage-tenant';
insert into public.organizations(tenant_id,name,slug)
select id,'File storage foreign','file-storage-foreign-org'
from public.tenants where slug='file-storage-foreign';
insert into public.identity_providers(
  tenant_id,provider_code,auth_provider,provider_tenant_key,display_name,status
)
select id,'filestorage','custom:filestorage',slug||'-provider','File storage provider','active'
from public.tenants where slug in ('file-storage-tenant','file-storage-foreign');

insert into auth.users(
  instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at
) values
  ('00000000-0000-0000-0000-000000000000','92000000-0000-4000-8000-000000000001','authenticated','authenticated','file-owner@example.test',crypt('local-e2e-password',gen_salt('bf')),now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','92000000-0000-4000-8000-000000000002','authenticated','authenticated','file-outsider@example.test',crypt('local-e2e-password',gen_salt('bf')),now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','92000000-0000-4000-8000-000000000003','authenticated','authenticated','file-foreign@example.test',crypt('local-e2e-password',gen_salt('bf')),now(),'{}','{}',now(),now());

insert into public.organization_members(tenant_id,organization_id,user_id,status)
select tenant.id,organization.id,seed.user_id,'active'
from (values
  ('file-storage-tenant','92000000-0000-4000-8000-000000000001'::uuid),
  ('file-storage-tenant','92000000-0000-4000-8000-000000000002'::uuid),
  ('file-storage-foreign','92000000-0000-4000-8000-000000000003'::uuid)
) seed(tenant_slug,user_id)
join public.tenants tenant on tenant.slug=seed.tenant_slug
join public.organizations organization on organization.tenant_id=tenant.id;

insert into public.employee_profiles(
  public_id,tenant_id,organization_id,organization_member_id,employee_no,
  display_name,job_title,employment_status,skills
)
select seed.public_id,member.tenant_id,member.organization_id,member.id,
       seed.employee_no,seed.display_name,seed.job_title,'active','{}'::text[]
from (values
  ('92010000-0000-4000-8000-000000000001'::uuid,'92000000-0000-4000-8000-000000000001'::uuid,'FILE-OWNER','File owner','Project owner'),
  ('92010000-0000-4000-8000-000000000002'::uuid,'92000000-0000-4000-8000-000000000002'::uuid,'FILE-OUTSIDER','File outsider','Engineer'),
  ('92010000-0000-4000-8000-000000000003'::uuid,'92000000-0000-4000-8000-000000000003'::uuid,'FILE-FOREIGN','File foreign','Engineer')
) seed(public_id,user_id,employee_no,display_name,job_title)
join public.organization_members member on member.user_id=seed.user_id;

insert into public.external_identities(
  tenant_id,organization_id,organization_member_id,identity_provider_id,
  provider_subject,provider_tenant_key,auth_user_id,status
)
select member.tenant_id,member.organization_id,member.id,provider.id,
       member.user_id::text,provider.provider_tenant_key,member.user_id,'active'
from public.organization_members member
join public.identity_providers provider on provider.tenant_id=member.tenant_id
where member.user_id in (
  '92000000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000002',
  '92000000-0000-4000-8000-000000000003'
);

insert into public.projects(
  public_id,tenant_id,organization_id,code,name,category,description,
  owner_member_id,created_by_member_id,updated_by_member_id,budget_amount,
  status,health,priority,start_date,due_date,progress,version
)
select seed.public_id,tenant.id,organization.id,seed.code,seed.name,'Delivery','File verification fixture',
       member.id,member.id,member.id,0,'active','on_track','medium',
       current_date,current_date + 90,0,1
from (values
  ('file-storage-tenant','92000000-0000-4000-8000-000000000001'::uuid,'92020000-0000-4000-8000-000000000001'::uuid,'FILE-PROJECT','File project'),
  ('file-storage-foreign','92000000-0000-4000-8000-000000000003'::uuid,'92020000-0000-4000-8000-000000000002'::uuid,'FILE-FOREIGN','File foreign project')
) seed(tenant_slug,user_id,public_id,code,name)
join public.tenants tenant on tenant.slug=seed.tenant_slug
join public.organizations organization on organization.tenant_id=tenant.id
join public.organization_members member on member.tenant_id=tenant.id and member.user_id=seed.user_id;

insert into public.project_members(
  tenant_id,organization_id,project_id,member_id,role,allocation_percent,
  created_by_member_id,updated_by_member_id,version
)
select project.tenant_id,project.organization_id,project.id,project.owner_member_id,
       'owner',100,project.owner_member_id,project.owner_member_id,1
from public.projects project where project.public_id in (
  '92020000-0000-4000-8000-000000000001','92020000-0000-4000-8000-000000000002'
);

select set_config('request.jwt.claim.sub','92000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select set_config('test.file.reserve',public.reserve_current_project_file_upload(
  '92020000-0000-4000-8000-000000000001','contract.pdf','application/pdf',16,
  repeat('a',64),'restricted','92030000-0000-4000-8000-000000000001',
  '92040000-0000-4000-8000-000000000001'
)::text,true);
select set_config('test.file.replay',public.reserve_current_project_file_upload(
  '92020000-0000-4000-8000-000000000001','contract.pdf','application/pdf',16,
  repeat('a',64),'restricted','92030000-0000-4000-8000-000000000001',
  '92040000-0000-4000-8000-000000000002'
)::text,true);
select set_config('test.file.conflict',public.reserve_current_project_file_upload(
  '92020000-0000-4000-8000-000000000001','contract.pdf','application/pdf',17,
  repeat('a',64),'restricted','92030000-0000-4000-8000-000000000001',
  '92040000-0000-4000-8000-000000000003'
)::text,true);
select set_config('test.file.bad_type',public.reserve_current_project_file_upload(
  '92020000-0000-4000-8000-000000000001','payload.exe','application/x-msdownload',16,
  repeat('a',64),'restricted','92030000-0000-4000-8000-000000000002',
  '92040000-0000-4000-8000-000000000004'
)::text,true);
select set_config('test.file.foreign',public.reserve_current_project_file_upload(
  '92020000-0000-4000-8000-000000000002','foreign.pdf','application/pdf',16,
  repeat('a',64),'restricted','92030000-0000-4000-8000-000000000003',
  '92040000-0000-4000-8000-000000000005'
)::text,true);
select set_config('test.file.inspect',public.inspect_current_file_upload(
  (current_setting('test.file.reserve')::jsonb->>'uploadId')::uuid
)::text,true);
reset role;

select is(current_setting('test.file.reserve')::jsonb->>'state','pending','project owner reserves an upload');
select like(current_setting('test.file.reserve')::jsonb->>'objectPath','tenants/%/organizations/%/projects/92020000-0000-4000-8000-000000000001/uploads/%','object path is server-derived and tenant scoped');
select is(current_setting('test.file.replay')::jsonb->>'uploadId',current_setting('test.file.reserve')::jsonb->>'uploadId','same key replays one reservation');
select is((select count(*) from public.file_upload_reservations where idempotency_key='92030000-0000-4000-8000-000000000001'),1::bigint,'reservation replay creates no duplicate');
select is(current_setting('test.file.conflict')::jsonb->>'error','scope_conflict','same key rejects changed metadata');
select is(current_setting('test.file.bad_type')::jsonb->>'error','invalid_request','database rejects dangerous type and extension');
select is(current_setting('test.file.foreign')::jsonb->>'error','not_found','cross-tenant project is not disclosed');
select is(current_setting('test.file.inspect')::jsonb->>'uploadId',current_setting('test.file.reserve')::jsonb->>'uploadId','uploader can inspect only the canonical reservation');

select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select set_config('test.file.signed',public.record_current_file_upload_signed(
  (current_setting('test.file.reserve')::jsonb->>'uploadId')::uuid,
  '92040000-0000-4000-8000-000000000005'
)::text,true);
select set_config('test.file.verification_claim',public.claim_current_file_upload_verification(
  (current_setting('test.file.reserve')::jsonb->>'uploadId')::uuid,
  '92070000-0000-4000-8000-000000000001',
  '92040000-0000-4000-8000-000000000005'
)::text,true);
select set_config('test.file.concurrent_claim',public.claim_current_file_upload_verification(
  (current_setting('test.file.reserve')::jsonb->>'uploadId')::uuid,
  '92070000-0000-4000-8000-000000000002',
  '92040000-0000-4000-8000-000000000005'
)::text,true);
select set_config('test.file.complete',public.complete_current_project_file_upload(
  (current_setting('test.file.reserve')::jsonb->>'uploadId')::uuid,
  '92070000-0000-4000-8000-000000000001',
  '92050000-0000-4000-8000-000000000001','v1','etag-1',16,'application/pdf',
  repeat('a',64),'92040000-0000-4000-8000-000000000006'
)::text,true);
select set_config('test.file.complete_replay',public.complete_current_project_file_upload(
  (current_setting('test.file.reserve')::jsonb->>'uploadId')::uuid,
  '92070000-0000-4000-8000-000000000001',
  '92050000-0000-4000-8000-000000000001','v1','etag-1',16,'application/pdf',
  repeat('a',64),'92040000-0000-4000-8000-000000000007'
)::text,true);
reset role;

select is(current_setting('test.file.signed')::jsonb->>'state','pending','server records signing intent before issuing an external token');
select ok(
  (current_setting('test.file.signed')::jsonb->>'uploadTokenExpiresAt')::timestamptz > clock_timestamp() + interval '1 hour 59 minutes'
  and (current_setting('test.file.signed')::jsonb->>'expiresAt')::timestamptz > (current_setting('test.file.signed')::jsonb->>'uploadTokenExpiresAt')::timestamptz,
  'public token expiry stays distinct from the longer cleanup safety horizon'
);
select is(current_setting('test.file.concurrent_claim')::jsonb->>'error','verification_in_progress','a durable lease fences concurrent storage verification');
select is(current_setting('test.file.complete')::jsonb->>'state','completed','server verification completes the reservation');
select is(current_setting('test.file.complete_replay')::jsonb->'file'->>'id',current_setting('test.file.complete')::jsonb->'file'->>'id','completion replay returns one canonical file');
select is((select count(*) from public.files where public_id=(current_setting('test.file.complete')::jsonb->'file'->>'id')::uuid and verified_at is not null),1::bigint,'verified metadata is persisted once');
select is((select count(*) from public.file_relations relation join public.files file on file.id=relation.file_id where file.public_id=(current_setting('test.file.complete')::jsonb->'file'->>'id')::uuid),1::bigint,'file relation commits atomically');
select ok(exists(select 1 from public.project_activities where action_type='file_uploaded' and project_id=(select id from public.projects where public_id='92020000-0000-4000-8000-000000000001')),'file completion records project activity');
select ok(exists(select 1 from public.audit_logs where action='file.upload_completed' and request_id='92040000-0000-4000-8000-000000000006'),'file completion is audited');

select set_config('request.jwt.claim.sub','92000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select set_config('test.file.download',public.authorize_current_project_file_download(
  (current_setting('test.file.complete')::jsonb->'file'->>'id')::uuid,
  '92040000-0000-4000-8000-000000000008'
)::text,true);
reset role;
select is(current_setting('test.file.download')::jsonb->>'outcome','success','authorized project member receives a download path');
select ok(exists(select 1 from public.audit_logs where action='file.download_authorized' and request_id='92040000-0000-4000-8000-000000000008'),'download authorization is audited');

select set_config('request.jwt.claim.sub','92000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select set_config('test.file.denied_download',public.authorize_current_project_file_download(
  (current_setting('test.file.complete')::jsonb->'file'->>'id')::uuid,
  '92040000-0000-4000-8000-000000000009'
)::text,true);
reset role;
select is(current_setting('test.file.denied_download')::jsonb->>'error','not_found','unrelated employee cannot discover a project file');

select set_config('request.jwt.claim.sub','92000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
set local role authenticated;
select set_config('test.file.cleanup_reserve',public.reserve_current_project_file_upload(
  '92020000-0000-4000-8000-000000000001','abandoned.pdf','application/pdf',8,
  repeat('b',64),'restricted','92030000-0000-4000-8000-000000000004',
  '92040000-0000-4000-8000-000000000010'
)::text,true);
reset role;
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select set_config('test.file.cleanup_signed',public.record_current_file_upload_signed(
  (current_setting('test.file.cleanup_reserve')::jsonb->>'uploadId')::uuid,
  '92040000-0000-4000-8000-000000000011'
)::text,true);
reset role;
update public.file_upload_reservations set expires_at=clock_timestamp()-interval '1 minute'
where public_id=(current_setting('test.file.cleanup_reserve')::jsonb->>'uploadId')::uuid;
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select set_config('test.file.cleanup_early_claim',coalesce((
  select row_to_json(claim)::text
  from public.claim_file_upload_cleanup(10,'92060000-0000-4000-8000-000000000002') claim
  where claim."uploadId"=(current_setting('test.file.cleanup_reserve')::jsonb->>'uploadId')::uuid
),'null'),true);
reset role;
select is(current_setting('test.file.cleanup_early_claim'),'null','cleanup cannot claim while an external upload token can still write');
update public.file_upload_reservations
set signed_upload_expires_at=clock_timestamp()-interval '1 minute'
where public_id=(current_setting('test.file.cleanup_reserve')::jsonb->>'uploadId')::uuid;
select set_config('request.jwt.claim.role','service_role',true);
set local role service_role;
select set_config('test.file.cleanup_claim',(select row_to_json(claim)::text from public.claim_file_upload_cleanup(10,'92060000-0000-4000-8000-000000000001') claim where claim."uploadId"=(current_setting('test.file.cleanup_reserve')::jsonb->>'uploadId')::uuid),true);
select set_config('test.file.cleanup_ack',public.complete_file_upload_cleanup(
  (current_setting('test.file.cleanup_reserve')::jsonb->>'uploadId')::uuid,
  '92060000-0000-4000-8000-000000000001',true,null
)::text,true);
reset role;
select is(current_setting('test.file.cleanup_claim')::jsonb->>'uploadId',current_setting('test.file.cleanup_reserve')::jsonb->>'uploadId','cleanup claims an expired pending object');
select is(current_setting('test.file.cleanup_ack')::boolean,true,'cleanup acknowledgement is accepted only for the claim token');
select ok(exists(select 1 from public.file_upload_reservations where public_id=(current_setting('test.file.cleanup_reserve')::jsonb->>'uploadId')::uuid and state='expired' and cleaned_at is not null),'expired reservation records successful removal');

select * from finish();
rollback;
