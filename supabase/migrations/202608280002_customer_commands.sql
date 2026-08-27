-- Audited, idempotent customer and contact mutation boundary.

alter table public.audit_logs drop constraint if exists audit_logs_action_check;
alter table public.audit_logs add constraint audit_logs_action_check check (action in (
  'identity.provisioned', 'identity.claimed', 'identity.revoked', 'member.status_changed',
  'member.role_changed', 'profile.updated', 'roster.imported', 'tenant.bootstrap_owner',
  'enterprise.initialized', 'directory.sync_started', 'directory.sync_completed',
  'directory.sync_failed', 'directory.role_mapped', 'project.created', 'project.updated',
  'project.archived', 'project.restored', 'project.member_added',
  'project.member_role_changed', 'project.member_removed', 'project.command_failed',
  'project.milestone_created', 'project.risk_created', 'project.activity_recorded',
  'project.report_submitted', 'project.execution_failed', 'task.created',
  'task.batch_created', 'task.claimed', 'task.progress_updated', 'task.submitted',
  'task.reviewed', 'task.reopened', 'task.acceptance_recorded',
  'task.command_failed', 'task.comment_created', 'task.dependency_created',
  'notification.read', 'notification.retried',
  'file.upload_reserved', 'file.upload_completed', 'file.upload_failed',
  'file.upload_expired', 'file.download_authorized',
  'customer.created', 'customer.updated', 'customer.contact_created', 'customer.command_failed',
  'payroll_policy.activated', 'payroll.calculated', 'payroll.confirmed',
  'ai.config.updated', 'organization.department_created',
  'organization.department_updated', 'organization.position_upserted',
  'organization.role_assigned', 'organization.command_failed',
  'organization.manager_assigned', 'directory.manager_mapped',
  'employee_skill.verified', 'employee_skill.verification_failed',
  'directory.sync_issue_resolved'
));

create table public.crm_command_idempotency (
  tenant_id bigint not null references public.tenants(id) on delete restrict,
  organization_id bigint not null,
  actor_member_id bigint not null,
  operation text not null check (operation in (
    'create_current_customer','update_current_customer','create_current_customer_contact'
  )),
  idempotency_key uuid not null,
  target_public_id uuid not null,
  payload_digest text not null check (payload_digest ~ '^[0-9a-f]{64}$'),
  request_id uuid not null,
  result jsonb,
  created_at timestamptz not null default clock_timestamp(),
  primary key (tenant_id, operation, idempotency_key),
  foreign key (tenant_id, organization_id)
    references public.organizations(tenant_id, id) on delete restrict,
  foreign key (tenant_id, organization_id, actor_member_id)
    references public.organization_members(tenant_id, organization_id, id) on delete restrict
);

alter table public.crm_command_idempotency enable row level security;
alter table public.crm_command_idempotency force row level security;

create or replace function public.current_crm_command_identity()
returns table(
  tenant_id bigint,
  organization_id bigint,
  actor_member_id bigint,
  actor_auth_user_id uuid,
  actor_employee_public_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'CRM command permission required' using errcode='42501';
  end if;
  return query
  select tenant.id,organization.id,member.id,(select auth.uid()),profile.public_id
  from public.external_identities external
  join public.identity_providers provider on provider.tenant_id=external.tenant_id
    and provider.id=external.identity_provider_id and provider.status='active'
  join public.tenants tenant on tenant.id=external.tenant_id and tenant.status='active'
  join public.organizations organization on organization.tenant_id=external.tenant_id
    and organization.id=external.organization_id
  join public.organization_members member on member.tenant_id=external.tenant_id
    and member.organization_id=external.organization_id
    and member.id=external.organization_member_id
    and member.user_id=(select auth.uid()) and member.status='active'
  join public.employee_profiles profile on profile.tenant_id=member.tenant_id
    and profile.organization_id=member.organization_id
    and profile.organization_member_id=member.id and profile.deleted_at is null
    and profile.employment_status in ('probation','active','on_leave')
  where external.auth_user_id=(select auth.uid()) and external.status='active'
    and exists (
      select 1
      from public.member_roles assignment
      join public.roles role on role.tenant_id=assignment.tenant_id
        and role.id=assignment.role_id and role.is_enabled
      join public.role_permissions role_grant on role_grant.tenant_id=assignment.tenant_id
        and role_grant.role_id=assignment.role_id
      join public.permissions permission on permission.id=role_grant.permission_id
      where assignment.tenant_id=member.tenant_id and assignment.member_id=member.id
        and (role.organization_id is null or role.organization_id=member.organization_id)
        and permission.code='customer.manage'
    )
  limit 1;
  if not found then
    raise exception 'CRM command permission required' using errcode='42501';
  end if;
end;
$$;

create or replace function public.claim_crm_command(
  p_tenant_id bigint,
  p_organization_id bigint,
  p_actor_member_id bigint,
  p_operation text,
  p_target_public_id uuid,
  p_payload jsonb,
  p_idempotency_key uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target uuid := coalesce(p_target_public_id,gen_random_uuid());
  v_expected_digest text := encode(
    public.digest(convert_to(coalesce(p_payload,'{}'::jsonb)::text,'UTF8'),'sha256'),'hex'
  );
  v_organization bigint;
  v_actor bigint;
  v_stored_target uuid;
  v_digest text;
  v_result jsonb;
begin
  insert into public.crm_command_idempotency(
    tenant_id,organization_id,actor_member_id,operation,idempotency_key,
    target_public_id,payload_digest,request_id
  ) values (
    p_tenant_id,p_organization_id,p_actor_member_id,p_operation,p_idempotency_key,
    v_target,v_expected_digest,p_request_id
  ) on conflict (tenant_id,operation,idempotency_key) do nothing;

  select ledger.organization_id,ledger.actor_member_id,ledger.target_public_id,
         ledger.payload_digest,ledger.result
  into strict v_organization,v_actor,v_stored_target,v_digest,v_result
  from public.crm_command_idempotency ledger
  where ledger.tenant_id=p_tenant_id and ledger.operation=p_operation
    and ledger.idempotency_key=p_idempotency_key
  for update;

  if v_organization<>p_organization_id or v_actor<>p_actor_member_id
     or (p_target_public_id is not null and v_stored_target<>p_target_public_id)
     or v_digest<>v_expected_digest then
    return jsonb_build_object('state','scope_conflict');
  end if;
  if v_result is not null then
    return jsonb_build_object('state','replay','result',v_result,'targetPublicId',v_stored_target);
  end if;
  return jsonb_build_object('state','claimed','targetPublicId',v_stored_target);
end;
$$;

create or replace function public.complete_crm_command(
  p_tenant_id bigint,
  p_organization_id bigint,
  p_actor_auth_user_id uuid,
  p_actor_member_id bigint,
  p_operation text,
  p_resource text,
  p_action text,
  p_target_id text,
  p_request_id uuid,
  p_idempotency_key uuid,
  p_reason text,
  p_outcome text,
  p_error text,
  p_entity jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  v_result := case when p_outcome='success' then jsonb_build_object(
    'outcome','success','resource',p_resource,'id',p_target_id,
    'version',coalesce((p_entity->>'version')::bigint,1),
    'entity',coalesce(p_entity,'{}'::jsonb)
  ) else jsonb_build_object('outcome','failure','error',p_error) end;

  update public.crm_command_idempotency ledger set result=v_result
  where ledger.tenant_id=p_tenant_id and ledger.organization_id=p_organization_id
    and ledger.actor_member_id=p_actor_member_id and ledger.operation=p_operation
    and ledger.idempotency_key=p_idempotency_key;
  if not found then
    raise exception 'CRM command ledger completion failed' using errcode='P0001';
  end if;

  perform public.append_audit_log(
    p_tenant_id,p_organization_id,p_actor_auth_user_id,p_actor_member_id,
    case when p_outcome='success' then p_action else 'customer.command_failed' end,
    p_resource,p_target_id,p_request_id,null,
    jsonb_build_object(
      'outcome',p_outcome,'operation',p_operation,'resource',p_resource,
      'requestId',p_request_id,'idempotencyKey',p_idempotency_key,
      'businessReason',case when p_resource='customer_contact' then null else p_reason end,
      'businessReasonDigest',encode(
        public.digest(convert_to(p_reason,'UTF8'),'sha256'),'hex'
      ),
      'entityDigest',case when p_outcome='success' then encode(
        public.digest(convert_to(coalesce(p_entity,'{}'::jsonb)::text,'UTF8'),'sha256'),'hex'
      ) else null end,
      'failure',case when p_outcome='failure' then p_error else null end
    )
  );
  return v_result;
end;
$$;

create or replace function public.audit_crm_scope_conflict(
  p_tenant_id bigint,
  p_organization_id bigint,
  p_actor_auth_user_id uuid,
  p_actor_member_id bigint,
  p_operation text,
  p_resource text,
  p_target_id text,
  p_request_id uuid,
  p_idempotency_key uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.append_audit_log(
    p_tenant_id,p_organization_id,p_actor_auth_user_id,p_actor_member_id,
    'customer.command_failed',p_resource,p_target_id,p_request_id,null,
    jsonb_build_object(
      'outcome','failure','operation',p_operation,'resource',p_resource,
      'requestId',p_request_id,'idempotencyKey',p_idempotency_key,
      'businessReason',case when p_resource='customer_contact' then null else p_reason end,
      'businessReasonDigest',encode(
        public.digest(convert_to(p_reason,'UTF8'),'sha256'),'hex'
      ),'failure','scope_conflict'
    )
  );
  return jsonb_build_object('outcome','failure','error','scope_conflict');
end;
$$;

create or replace function public.normalize_crm_name(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(btrim(p_value),'[[:space:]]+',' ','g');
$$;

create or replace function public.create_current_customer(
  p_name text,
  p_registration_code text,
  p_owner_employee_public_id uuid,
  p_industry text,
  p_source text,
  p_region text,
  p_status text,
  p_version bigint,
  p_reason text,
  request_id uuid,
  idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant bigint; v_org bigint; v_actor bigint; v_user uuid; v_actor_employee uuid;
  v_owner bigint; v_customer public.customers%rowtype; v_claim jsonb; v_failure text;
  v_name text; v_registration text; v_entity jsonb;
begin
  select * into v_tenant,v_org,v_actor,v_user,v_actor_employee
  from public.current_crm_command_identity();
  v_name:=public.normalize_crm_name(p_name);
  v_registration:=case when p_registration_code is null then null else btrim(p_registration_code) end;
  if request_id is null or idempotency_key is null or request_id=idempotency_key
     or p_version is distinct from 0 or nullif(v_name,'') is null or length(v_name)>160
     or (v_registration is not null and length(v_registration) not between 1 and 80)
     or p_owner_employee_public_id is null or p_industry is null
     or length(btrim(p_industry)) not between 1 and 80
     or p_source is null or p_source not in ('consulting','referral','event','outbound','other')
     or p_region is null or length(btrim(p_region))>120
     or p_status is null or p_status not in ('lead','following','proposal','negotiating','won','lost')
     or p_reason is null or length(btrim(p_reason)) not between 1 and 500 then
    raise exception 'CRM command is invalid' using errcode='22023';
  end if;
  v_claim:=public.claim_crm_command(v_tenant,v_org,v_actor,'create_current_customer',null,
    jsonb_build_object('name',v_name,'registrationCode',v_registration,
      'ownerEmployeePublicId',p_owner_employee_public_id,'industry',btrim(p_industry),
      'source',p_source,'region',btrim(p_region),'status',p_status,'version',p_version,'reason',btrim(p_reason)),
    idempotency_key,request_id);
  if v_claim->>'state'='scope_conflict' then
    return public.audit_crm_scope_conflict(v_tenant,v_org,v_user,v_actor,
      'create_current_customer','customer',null,request_id,idempotency_key,btrim(p_reason));
  end if;
  if v_claim->>'state'='replay' then return v_claim->'result'; end if;

  select profile.organization_member_id into v_owner
  from public.employee_profiles profile
  join public.organization_members member on member.tenant_id=profile.tenant_id
    and member.organization_id=profile.organization_id
    and member.id=profile.organization_member_id and member.status='active'
  where profile.tenant_id=v_tenant and profile.organization_id=v_org
    and profile.public_id=p_owner_employee_public_id and profile.deleted_at is null
    and profile.employment_status in ('probation','active','on_leave')
  for share of profile,member;
  if not found then
    return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,'create_current_customer',
      'customer','customer.created',null,request_id,idempotency_key,btrim(p_reason),
      'failure','not_found',null);
  end if;
  begin
    insert into public.customers(
      public_id,tenant_id,organization_id,owner_member_id,created_by_member_id,updated_by_member_id,
      name,registration_code,industry,source,region,status,version
    ) values (
      (v_claim->>'targetPublicId')::uuid,v_tenant,v_org,v_owner,v_actor,v_actor,
      v_name,v_registration,btrim(p_industry),p_source,btrim(p_region),p_status,1
    ) returning * into v_customer;
  exception when unique_violation then v_failure:='conflict';
  when others then v_failure:='command_failed';
  end;
  if v_failure is not null then
    return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,'create_current_customer',
      'customer','customer.created',null,request_id,idempotency_key,btrim(p_reason),
      'failure',v_failure,null);
  end if;
  v_entity:=jsonb_build_object(
    'id',v_customer.public_id,'version',v_customer.version,
    'ownerEmployeePublicId',p_owner_employee_public_id,'name',v_customer.name,
    'registrationCode',v_customer.registration_code,'industry',v_customer.industry,
    'source',v_customer.source,'region',v_customer.region,'status',v_customer.status,
    'updatedAt',v_customer.updated_at,'archivedAt',v_customer.archived_at
  );
  return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,'create_current_customer',
    'customer','customer.created',v_customer.public_id::text,request_id,idempotency_key,
    btrim(p_reason),'success',null,v_entity);
end;
$$;

create or replace function public.update_current_customer(
  p_customer_public_id uuid,
  p_name text,
  p_registration_code text,
  p_owner_employee_public_id uuid,
  p_industry text,
  p_source text,
  p_region text,
  p_status text,
  p_expected_version bigint,
  p_reason text,
  request_id uuid,
  idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant bigint; v_org bigint; v_actor bigint; v_user uuid; v_actor_employee uuid;
  v_owner bigint; v_customer public.customers%rowtype; v_claim jsonb; v_failure text;
  v_name text; v_registration text; v_entity jsonb;
begin
  select * into v_tenant,v_org,v_actor,v_user,v_actor_employee
  from public.current_crm_command_identity();
  v_name:=public.normalize_crm_name(p_name);
  v_registration:=case when p_registration_code is null then null else btrim(p_registration_code) end;
  if p_customer_public_id is null or request_id is null or idempotency_key is null
     or request_id=idempotency_key or p_expected_version is null or p_expected_version<1
     or nullif(v_name,'') is null or length(v_name)>160
     or (v_registration is not null and length(v_registration) not between 1 and 80)
     or p_owner_employee_public_id is null or p_industry is null
     or length(btrim(p_industry)) not between 1 and 80
     or p_source is null or p_source not in ('consulting','referral','event','outbound','other')
     or p_region is null or length(btrim(p_region))>120
     or p_status is null or p_status not in ('lead','following','proposal','negotiating','won','lost')
     or p_reason is null or length(btrim(p_reason)) not between 1 and 500 then
    raise exception 'CRM command is invalid' using errcode='22023';
  end if;
  v_claim:=public.claim_crm_command(v_tenant,v_org,v_actor,'update_current_customer',p_customer_public_id,
    jsonb_build_object('customerId',p_customer_public_id,'name',v_name,'registrationCode',v_registration,
      'ownerEmployeePublicId',p_owner_employee_public_id,'industry',btrim(p_industry),
      'source',p_source,'region',btrim(p_region),'status',p_status,
      'expectedVersion',p_expected_version,'reason',btrim(p_reason)),
    idempotency_key,request_id);
  if v_claim->>'state'='scope_conflict' then
    return public.audit_crm_scope_conflict(v_tenant,v_org,v_user,v_actor,
      'update_current_customer','customer',p_customer_public_id::text,
      request_id,idempotency_key,btrim(p_reason));
  end if;
  if v_claim->>'state'='replay' then return v_claim->'result'; end if;

  select * into v_customer from public.customers customer
  where customer.tenant_id=v_tenant and customer.organization_id=v_org
    and customer.public_id=p_customer_public_id and customer.archived_at is null
  for update;
  if not found then
    return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,'update_current_customer',
      'customer','customer.updated',p_customer_public_id::text,request_id,idempotency_key,
      btrim(p_reason),'failure','not_found',null);
  end if;
  if v_customer.version<>p_expected_version then
    return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,'update_current_customer',
      'customer','customer.updated',p_customer_public_id::text,request_id,idempotency_key,
      btrim(p_reason),'failure','stale_version',null);
  end if;
  select profile.organization_member_id into v_owner
  from public.employee_profiles profile
  join public.organization_members member on member.tenant_id=profile.tenant_id
    and member.organization_id=profile.organization_id
    and member.id=profile.organization_member_id and member.status='active'
  where profile.tenant_id=v_tenant and profile.organization_id=v_org
    and profile.public_id=p_owner_employee_public_id and profile.deleted_at is null
    and profile.employment_status in ('probation','active','on_leave')
  for share of profile,member;
  if not found then
    return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,'update_current_customer',
      'customer','customer.updated',p_customer_public_id::text,request_id,idempotency_key,
      btrim(p_reason),'failure','not_found',null);
  end if;
  begin
    update public.customers customer set
      owner_member_id=v_owner,name=v_name,registration_code=v_registration,
      industry=btrim(p_industry),source=p_source,region=btrim(p_region),status=p_status,
      updated_by_member_id=v_actor,version=customer.version+1,updated_at=clock_timestamp()
    where customer.tenant_id=v_tenant and customer.organization_id=v_org
      and customer.id=v_customer.id
    returning * into v_customer;
  exception when unique_violation then v_failure:='conflict';
  when others then v_failure:='command_failed';
  end;
  if v_failure is not null then
    return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,'update_current_customer',
      'customer','customer.updated',p_customer_public_id::text,request_id,idempotency_key,
      btrim(p_reason),'failure',v_failure,null);
  end if;
  v_entity:=jsonb_build_object(
    'id',v_customer.public_id,'version',v_customer.version,
    'ownerEmployeePublicId',p_owner_employee_public_id,'name',v_customer.name,
    'registrationCode',v_customer.registration_code,'industry',v_customer.industry,
    'source',v_customer.source,'region',v_customer.region,'status',v_customer.status,
    'updatedAt',v_customer.updated_at,'archivedAt',v_customer.archived_at
  );
  return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,'update_current_customer',
    'customer','customer.updated',v_customer.public_id::text,request_id,idempotency_key,
    btrim(p_reason),'success',null,v_entity);
end;
$$;

create or replace function public.create_current_customer_contact(
  p_customer_public_id uuid,
  p_name text,
  p_title text,
  p_phone text,
  p_email text,
  p_visibility text,
  p_is_primary boolean,
  p_version bigint,
  p_reason text,
  request_id uuid,
  idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant bigint; v_org bigint; v_actor bigint; v_user uuid; v_actor_employee uuid;
  v_customer public.customers%rowtype; v_contact public.customer_contacts%rowtype;
  v_claim jsonb; v_failure text; v_entity jsonb; v_phone text; v_email text;
begin
  select * into v_tenant,v_org,v_actor,v_user,v_actor_employee
  from public.current_crm_command_identity();
  v_phone:=case when p_phone is null then null else btrim(p_phone) end;
  v_email:=case when p_email is null then null else lower(btrim(p_email)) end;
  if p_customer_public_id is null or request_id is null or idempotency_key is null
     or request_id=idempotency_key or p_version is distinct from 0
     or p_name is null or length(btrim(p_name)) not between 1 and 120
     or p_title is null or length(btrim(p_title))>120
     or (v_phone is not null and length(v_phone) not between 1 and 80)
     or (v_email is not null and (length(v_email) not between 3 and 320 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'))
     or (v_phone is null and v_email is null)
     or p_visibility is null or p_visibility not in ('assigned','managers')
     or p_is_primary is null or p_reason is null
     or length(btrim(p_reason)) not between 1 and 500 then
    raise exception 'CRM command is invalid' using errcode='22023';
  end if;
  v_claim:=public.claim_crm_command(v_tenant,v_org,v_actor,'create_current_customer_contact',
    p_customer_public_id,jsonb_build_object('customerId',p_customer_public_id,
      'name',btrim(p_name),'title',btrim(p_title),'phone',v_phone,'email',v_email,
      'visibility',p_visibility,'isPrimary',p_is_primary,'version',p_version,'reason',btrim(p_reason)),
    idempotency_key,request_id);
  if v_claim->>'state'='scope_conflict' then
    return public.audit_crm_scope_conflict(v_tenant,v_org,v_user,v_actor,
      'create_current_customer_contact','customer_contact',p_customer_public_id::text,
      request_id,idempotency_key,btrim(p_reason));
  end if;
  if v_claim->>'state'='replay' then return v_claim->'result'; end if;

  select * into v_customer from public.customers customer
  where customer.tenant_id=v_tenant and customer.organization_id=v_org
    and customer.public_id=p_customer_public_id and customer.archived_at is null
  for update;
  if not found then
    return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,
      'create_current_customer_contact','customer_contact','customer.contact_created',
      null,request_id,idempotency_key,btrim(p_reason),'failure','not_found',null);
  end if;
  begin
    if p_is_primary then
      update public.customer_contacts contact set
        is_primary=false,updated_by_member_id=v_actor,version=contact.version+1,
        updated_at=clock_timestamp()
      where contact.tenant_id=v_tenant and contact.organization_id=v_org
        and contact.customer_id=v_customer.id and contact.is_primary
        and contact.archived_at is null;
    end if;
    insert into public.customer_contacts(
      tenant_id,organization_id,customer_id,created_by_member_id,updated_by_member_id,
      name,title,phone,email,visibility,is_primary,version
    ) values (
      v_tenant,v_org,v_customer.id,v_actor,v_actor,btrim(p_name),btrim(p_title),
      v_phone,v_email,p_visibility,p_is_primary,1
    ) returning * into v_contact;
  exception when unique_violation then v_failure:='conflict';
  when others then v_failure:='command_failed';
  end;
  if v_failure is not null then
    return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,
      'create_current_customer_contact','customer_contact','customer.contact_created',
      null,request_id,idempotency_key,btrim(p_reason),'failure',v_failure,null);
  end if;
  v_entity:=jsonb_build_object(
    'id',v_contact.public_id,'customerId',v_customer.public_id,'version',v_contact.version,
    'name',v_contact.name,'title',v_contact.title,'phone',v_contact.phone,'email',v_contact.email,
    'visibility',v_contact.visibility,'isPrimary',v_contact.is_primary,
    'createdAt',v_contact.created_at,'updatedAt',v_contact.updated_at
  );
  return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,
    'create_current_customer_contact','customer_contact','customer.contact_created',
    v_contact.public_id::text,request_id,idempotency_key,btrim(p_reason),'success',null,v_entity);
end;
$$;

revoke all on table public.crm_command_idempotency from public,anon,authenticated,service_role;
revoke all on function public.current_crm_command_identity() from public,anon,authenticated,service_role;
revoke all on function public.claim_crm_command(bigint,bigint,bigint,text,uuid,jsonb,uuid,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.complete_crm_command(bigint,bigint,uuid,bigint,text,text,text,text,uuid,uuid,text,text,text,jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.audit_crm_scope_conflict(bigint,bigint,uuid,bigint,text,text,text,uuid,uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function public.normalize_crm_name(text) from public,anon,authenticated,service_role;
revoke all on function public.create_current_customer(text,text,uuid,text,text,text,text,bigint,text,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.create_current_customer(text,text,uuid,text,text,text,text,bigint,text,uuid,uuid)
  to authenticated;
revoke all on function public.update_current_customer(uuid,text,text,uuid,text,text,text,text,bigint,text,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.update_current_customer(uuid,text,text,uuid,text,text,text,text,bigint,text,uuid,uuid)
  to authenticated;
revoke all on function public.create_current_customer_contact(uuid,text,text,text,text,text,boolean,bigint,text,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.create_current_customer_contact(uuid,text,text,text,text,text,boolean,bigint,text,uuid,uuid)
  to authenticated;
