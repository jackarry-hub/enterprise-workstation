-- Audited opportunity workflow and atomic won-opportunity conversion.

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
  'opportunity.created', 'opportunity.stage_changed', 'opportunity.converted',
  'customer.follow_up_created',
  'payroll_policy.activated', 'payroll.calculated', 'payroll.confirmed',
  'ai.config.updated', 'organization.department_created',
  'organization.department_updated', 'organization.position_upserted',
  'organization.role_assigned', 'organization.command_failed',
  'organization.manager_assigned', 'directory.manager_mapped',
  'employee_skill.verified', 'employee_skill.verification_failed',
  'directory.sync_issue_resolved'
));

alter table public.crm_command_idempotency
  drop constraint if exists crm_command_idempotency_operation_check;
alter table public.crm_command_idempotency
  add constraint crm_command_idempotency_operation_check check (operation in (
    'create_current_customer','update_current_customer','create_current_customer_contact',
    'create_current_opportunity','transition_current_opportunity_stage',
    'create_current_customer_follow_up','convert_current_opportunity_to_project'
  ));

create unique index customer_project_links_one_active_opportunity_uidx
  on public.customer_project_links(tenant_id,organization_id,opportunity_id)
  where opportunity_id is not null and archived_at is null;

-- Close the legacy project-create context before CRM conversion reuses it.
create or replace function public.current_project_command_context()
returns table (
  tenant_id bigint,
  organization_id bigint,
  actor_member_id bigint,
  actor_auth_user_id uuid,
  permission_scope text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Project command permission required' using errcode = '42501';
  end if;
  return query
  select tenant.id,organization.id,member.id,(select auth.uid()),
    case when exists (
      select 1
      from public.member_roles assignment
      join public.roles role on role.tenant_id=assignment.tenant_id
        and role.id=assignment.role_id and role.is_enabled
      join public.role_permissions role_grant on role_grant.tenant_id=assignment.tenant_id
        and role_grant.role_id=assignment.role_id
      join public.permissions permission on permission.id=role_grant.permission_id
      where assignment.tenant_id=member.tenant_id and assignment.member_id=member.id
        and (role.organization_id is null or role.organization_id=member.organization_id)
        and permission.code='project.manage'
    ) then 'project.manage' else 'organization.manage' end
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
        and permission.code in ('project.manage','organization.manage')
    )
  limit 1;
  if not found then
    raise exception 'Project command permission required' using errcode = '42501';
  end if;
end;
$$;

-- Follow-up reasons can repeat customer PII, so only their digest enters audit metadata.
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
  v_public_entity jsonb:=coalesce(p_entity,'{}'::jsonb)-'_resultVersion';
begin
  v_result := case when p_outcome='success' then jsonb_build_object(
    'outcome','success','resource',p_resource,'id',p_target_id,
    'version',coalesce((p_entity->>'_resultVersion')::bigint,(p_entity->>'version')::bigint,1),
    'entity',v_public_entity
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
      'businessReason',case when p_resource in ('customer_contact','customer_follow_up')
        then null else p_reason end,
      'businessReasonDigest',encode(
        public.digest(convert_to(p_reason,'UTF8'),'sha256'),'hex'
      ),
      'entityDigest',case when p_outcome='success' then encode(
        public.digest(convert_to(v_public_entity::text,'UTF8'),'sha256'),'hex'
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
      'businessReason',case when p_resource in ('customer_contact','customer_follow_up')
        then null else p_reason end,
      'businessReasonDigest',encode(
        public.digest(convert_to(p_reason,'UTF8'),'sha256'),'hex'
      ),'failure','scope_conflict'
    )
  );
  return jsonb_build_object('outcome','failure','error','scope_conflict');
end;
$$;

create or replace function public.create_current_opportunity(
  p_customer_public_id uuid,
  p_name text,
  p_owner_employee_public_id uuid,
  p_amount numeric,
  p_currency text,
  p_expected_close_on date,
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
  v_customer public.customers%rowtype; v_owner bigint; v_opportunity public.opportunities%rowtype;
  v_claim jsonb; v_failure text; v_entity jsonb;
begin
  select * into v_tenant,v_org,v_actor,v_user,v_actor_employee
  from public.current_crm_command_identity();
  if p_customer_public_id is null or p_name is null or length(btrim(p_name)) not between 1 and 160
     or p_owner_employee_public_id is null or p_amount is null or p_amount='NaN'::numeric
     or p_amount<0 or p_amount>9999999999999999.99 or p_amount<>trunc(p_amount,2)
     or p_currency is null or p_currency !~ '^[A-Z]{3}$'
     or (p_expected_close_on is not null
       and (not isfinite(p_expected_close_on) or p_expected_close_on<current_date))
     or p_version is distinct from 0 or p_reason is null
     or length(btrim(p_reason)) not between 1 and 500
     or request_id is null or idempotency_key is null or request_id=idempotency_key then
    raise exception 'CRM command is invalid' using errcode='22023';
  end if;
  v_claim:=public.claim_crm_command(v_tenant,v_org,v_actor,'create_current_opportunity',null,
    jsonb_build_object('customerId',p_customer_public_id,'name',btrim(p_name),
      'ownerEmployeePublicId',p_owner_employee_public_id,'amount',p_amount::text,
      'currency',p_currency,'expectedCloseOn',p_expected_close_on,'version',p_version,
      'reason',btrim(p_reason)),idempotency_key,request_id);
  if v_claim->>'state'='scope_conflict' then
    return public.audit_crm_scope_conflict(v_tenant,v_org,v_user,v_actor,
      'create_current_opportunity','opportunity',null,request_id,idempotency_key,btrim(p_reason));
  end if;
  if v_claim->>'state'='replay' then return v_claim->'result'; end if;

  select * into v_customer from public.customers customer
  where customer.tenant_id=v_tenant and customer.organization_id=v_org
    and customer.public_id=p_customer_public_id and customer.archived_at is null
  for share;
  if not found then
    return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,'create_current_opportunity',
      'opportunity','opportunity.created',null,request_id,idempotency_key,btrim(p_reason),
      'failure','not_found',null);
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
    return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,'create_current_opportunity',
      'opportunity','opportunity.created',null,request_id,idempotency_key,btrim(p_reason),
      'failure','not_found',null);
  end if;
  begin
    insert into public.opportunities(
      public_id,tenant_id,organization_id,customer_id,owner_member_id,
      created_by_member_id,updated_by_member_id,name,stage,amount,currency,expected_close_on,version
    ) values (
      (v_claim->>'targetPublicId')::uuid,v_tenant,v_org,v_customer.id,v_owner,
      v_actor,v_actor,btrim(p_name),'lead',p_amount,p_currency,p_expected_close_on,1
    ) returning * into v_opportunity;
  exception when unique_violation then v_failure:='conflict';
  when others then v_failure:='command_failed';
  end;
  if v_failure is not null then
    return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,'create_current_opportunity',
      'opportunity','opportunity.created',null,request_id,idempotency_key,btrim(p_reason),
      'failure',v_failure,null);
  end if;
  v_entity:=jsonb_build_object(
    'id',v_opportunity.public_id,'customerId',v_customer.public_id,
    'ownerEmployeePublicId',p_owner_employee_public_id,'name',v_opportunity.name,
    'stage',v_opportunity.stage,'amount',v_opportunity.amount::text,
    'currency',v_opportunity.currency,'expectedCloseOn',v_opportunity.expected_close_on,
    'lossReason',v_opportunity.loss_reason,'version',v_opportunity.version,
    'createdAt',v_opportunity.created_at,'updatedAt',v_opportunity.updated_at,
    'archivedAt',v_opportunity.archived_at
  );
  return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,'create_current_opportunity',
    'opportunity','opportunity.created',v_opportunity.public_id::text,request_id,idempotency_key,
    btrim(p_reason),'success',null,v_entity);
end;
$$;

create or replace function public.transition_current_opportunity_stage(
  p_opportunity_public_id uuid,
  p_stage text,
  p_loss_reason text,
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
  v_opportunity public.opportunities%rowtype; v_customer_public_id uuid;
  v_owner_employee_public_id uuid; v_claim jsonb; v_entity jsonb;
begin
  select * into v_tenant,v_org,v_actor,v_user,v_actor_employee
  from public.current_crm_command_identity();
  if p_opportunity_public_id is null or p_stage is null
     or p_stage not in ('qualified','proposal','won','lost')
     or (p_stage='lost' and (p_loss_reason is null or length(btrim(p_loss_reason)) not between 1 and 1000))
     or (p_stage<>'lost' and p_loss_reason is not null)
     or p_expected_version is null or p_expected_version<1
     or p_reason is null or length(btrim(p_reason)) not between 1 and 500
     or request_id is null or idempotency_key is null or request_id=idempotency_key then
    raise exception 'CRM command is invalid' using errcode='22023';
  end if;
  v_claim:=public.claim_crm_command(v_tenant,v_org,v_actor,'transition_current_opportunity_stage',
    p_opportunity_public_id,jsonb_build_object('opportunityId',p_opportunity_public_id,
      'stage',p_stage,'lossReason',case when p_loss_reason is null then null else btrim(p_loss_reason) end,
      'expectedVersion',p_expected_version,'reason',btrim(p_reason)),idempotency_key,request_id);
  if v_claim->>'state'='scope_conflict' then
    return public.audit_crm_scope_conflict(v_tenant,v_org,v_user,v_actor,
      'transition_current_opportunity_stage','opportunity',p_opportunity_public_id::text,
      request_id,idempotency_key,btrim(p_reason));
  end if;
  if v_claim->>'state'='replay' then return v_claim->'result'; end if;

  select * into v_opportunity from public.opportunities opportunity
  where opportunity.tenant_id=v_tenant and opportunity.organization_id=v_org
    and opportunity.public_id=p_opportunity_public_id and opportunity.archived_at is null
  for update;
  if not found then
    return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,
      'transition_current_opportunity_stage','opportunity','opportunity.stage_changed',
      p_opportunity_public_id::text,request_id,idempotency_key,btrim(p_reason),
      'failure','not_found',null);
  end if;
  if v_opportunity.version<>p_expected_version then
    return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,
      'transition_current_opportunity_stage','opportunity','opportunity.stage_changed',
      p_opportunity_public_id::text,request_id,idempotency_key,btrim(p_reason),
      'failure','stale_version',null);
  end if;
  if not ((v_opportunity.stage='lead' and p_stage='qualified')
    or (v_opportunity.stage='qualified' and p_stage='proposal')
    or (v_opportunity.stage='proposal' and p_stage in ('won','lost'))) then
    return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,
      'transition_current_opportunity_stage','opportunity','opportunity.stage_changed',
      p_opportunity_public_id::text,request_id,idempotency_key,btrim(p_reason),
      'failure','invalid_stage',null);
  end if;
  select profile.public_id into v_owner_employee_public_id
  from public.employee_profiles profile
  where profile.tenant_id=v_tenant and profile.organization_id=v_org
    and profile.organization_member_id=v_opportunity.owner_member_id
  order by (profile.deleted_at is null) desc,profile.updated_at desc,profile.id desc
  limit 1;
  if not found then
    return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,
      'transition_current_opportunity_stage','opportunity','opportunity.stage_changed',
      p_opportunity_public_id::text,request_id,idempotency_key,btrim(p_reason),
      'failure','not_found',null);
  end if;
  update public.opportunities opportunity set
    stage=p_stage,loss_reason=case when p_stage='lost' then btrim(p_loss_reason) else null end,
    updated_by_member_id=v_actor,version=opportunity.version+1,updated_at=clock_timestamp()
  where opportunity.tenant_id=v_tenant and opportunity.organization_id=v_org
    and opportunity.id=v_opportunity.id
  returning * into v_opportunity;
  select customer.public_id into strict v_customer_public_id from public.customers customer
  where customer.tenant_id=v_tenant and customer.organization_id=v_org
    and customer.id=v_opportunity.customer_id;
  v_entity:=jsonb_build_object(
    'id',v_opportunity.public_id,'customerId',v_customer_public_id,
    'ownerEmployeePublicId',v_owner_employee_public_id,'name',v_opportunity.name,
    'stage',v_opportunity.stage,'amount',v_opportunity.amount::text,
    'currency',v_opportunity.currency,'expectedCloseOn',v_opportunity.expected_close_on,
    'lossReason',v_opportunity.loss_reason,'version',v_opportunity.version,
    'createdAt',v_opportunity.created_at,'updatedAt',v_opportunity.updated_at,
    'archivedAt',v_opportunity.archived_at
  );
  return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,
    'transition_current_opportunity_stage','opportunity','opportunity.stage_changed',
    v_opportunity.public_id::text,request_id,idempotency_key,btrim(p_reason),
    'success',null,v_entity);
end;
$$;

create or replace function public.create_current_customer_follow_up(
  p_customer_public_id uuid,
  p_opportunity_public_id uuid,
  p_kind text,
  p_content text,
  p_next_follow_up_at timestamptz,
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
  v_customer public.customers%rowtype; v_opportunity_id bigint;
  v_follow_up public.customer_follow_ups%rowtype; v_claim jsonb; v_entity jsonb;
  v_now timestamptz:=clock_timestamp();
begin
  select * into v_tenant,v_org,v_actor,v_user,v_actor_employee
  from public.current_crm_command_identity();
  if p_customer_public_id is null or p_kind is null
     or p_kind not in ('call','meeting','email','message','visit','note')
     or p_content is null or length(btrim(p_content)) not between 1 and 8000
     or (p_next_follow_up_at is not null
       and (not isfinite(p_next_follow_up_at) or p_next_follow_up_at<v_now))
     or p_version is distinct from 0 or p_reason is null
     or length(btrim(p_reason)) not between 1 and 500
     or request_id is null or idempotency_key is null or request_id=idempotency_key then
    raise exception 'CRM command is invalid' using errcode='22023';
  end if;
  v_claim:=public.claim_crm_command(v_tenant,v_org,v_actor,'create_current_customer_follow_up',null,
    jsonb_build_object('customerId',p_customer_public_id,'opportunityId',p_opportunity_public_id,
      'kind',p_kind,'content',btrim(p_content),'nextFollowUpAt',p_next_follow_up_at,
      'version',p_version,'reason',btrim(p_reason)),idempotency_key,request_id);
  if v_claim->>'state'='scope_conflict' then
    return public.audit_crm_scope_conflict(v_tenant,v_org,v_user,v_actor,
      'create_current_customer_follow_up','customer_follow_up',null,
      request_id,idempotency_key,btrim(p_reason));
  end if;
  if v_claim->>'state'='replay' then return v_claim->'result'; end if;

  select * into v_customer from public.customers customer
  where customer.tenant_id=v_tenant and customer.organization_id=v_org
    and customer.public_id=p_customer_public_id and customer.archived_at is null
  for share;
  if not found then
    return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,
      'create_current_customer_follow_up','customer_follow_up','customer.follow_up_created',
      null,request_id,idempotency_key,btrim(p_reason),'failure','not_found',null);
  end if;
  if p_opportunity_public_id is not null then
    select opportunity.id into v_opportunity_id from public.opportunities opportunity
    where opportunity.tenant_id=v_tenant and opportunity.organization_id=v_org
      and opportunity.customer_id=v_customer.id
      and opportunity.public_id=p_opportunity_public_id and opportunity.archived_at is null
    for share;
    if not found then
      return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,
        'create_current_customer_follow_up','customer_follow_up','customer.follow_up_created',
        null,request_id,idempotency_key,btrim(p_reason),'failure','not_found',null);
    end if;
  end if;
  insert into public.customer_follow_ups(
    public_id,tenant_id,organization_id,customer_id,opportunity_id,actor_member_id,
    kind,content,occurred_at,next_follow_up_at
  ) values (
    (v_claim->>'targetPublicId')::uuid,v_tenant,v_org,v_customer.id,v_opportunity_id,v_actor,
    p_kind,btrim(p_content),v_now,p_next_follow_up_at
  ) returning * into v_follow_up;
  v_entity:=jsonb_build_object(
    'id',v_follow_up.public_id,'customerId',v_customer.public_id,
    'opportunityId',p_opportunity_public_id,'actorEmployeePublicId',v_actor_employee,
    'kind',v_follow_up.kind,'content',v_follow_up.content,
    'occurredAt',v_follow_up.occurred_at,'nextFollowUpAt',v_follow_up.next_follow_up_at
  );
  return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,
    'create_current_customer_follow_up','customer_follow_up','customer.follow_up_created',
    v_follow_up.public_id::text,request_id,idempotency_key,btrim(p_reason),
    'success',null,v_entity);
end;
$$;

create or replace function public.convert_current_opportunity_to_project(
  p_opportunity_public_id uuid,
  p_project_name text,
  p_description text,
  p_category text,
  p_status text,
  p_priority text,
  p_starts_on date,
  p_due_on date,
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
  v_opportunity public.opportunities%rowtype; v_owner_employee_public_id uuid;
  v_claim jsonb; v_project_result jsonb; v_project public.projects%rowtype;
  v_link public.customer_project_links%rowtype; v_entity jsonb; v_failure text;
begin
  select * into v_tenant,v_org,v_actor,v_user,v_actor_employee
  from public.current_crm_command_identity();
  if not exists (
    select 1 from public.member_roles assignment
    join public.roles role on role.tenant_id=assignment.tenant_id
      and role.id=assignment.role_id and role.is_enabled
    join public.role_permissions role_grant on role_grant.tenant_id=assignment.tenant_id
      and role_grant.role_id=assignment.role_id
    join public.permissions permission on permission.id=role_grant.permission_id
    where assignment.tenant_id=v_tenant and assignment.member_id=v_actor
      and (role.organization_id is null or role.organization_id=v_org)
      and permission.code in ('project.manage','organization.manage')
  ) then
    raise exception 'Project command permission required' using errcode='42501';
  end if;
  if p_opportunity_public_id is null or p_project_name is null
     or length(btrim(p_project_name)) not between 1 and 160
     or p_description is null or length(p_description)>4000
     or p_category is null or length(btrim(p_category)) not between 1 and 80
     or p_status is null or p_status not in ('planning','active')
     or p_priority is null or p_priority not in ('low','medium','high','critical')
     or p_starts_on is null or p_due_on is null
     or not isfinite(p_starts_on) or not isfinite(p_due_on) or p_due_on<p_starts_on
     or p_expected_version is null or p_expected_version<1
     or p_reason is null or length(btrim(p_reason)) not between 1 and 500
     or request_id is null or idempotency_key is null or request_id=idempotency_key then
    raise exception 'CRM command is invalid' using errcode='22023';
  end if;
  v_claim:=public.claim_crm_command(v_tenant,v_org,v_actor,'convert_current_opportunity_to_project',
    p_opportunity_public_id,jsonb_build_object('opportunityId',p_opportunity_public_id,
      'projectName',btrim(p_project_name),'description',btrim(p_description),
      'category',btrim(p_category),'status',p_status,'priority',p_priority,
      'startsOn',p_starts_on,'dueOn',p_due_on,'expectedVersion',p_expected_version,
      'reason',btrim(p_reason)),idempotency_key,request_id);
  if v_claim->>'state'='scope_conflict' then
    return public.audit_crm_scope_conflict(v_tenant,v_org,v_user,v_actor,
      'convert_current_opportunity_to_project','opportunity_conversion',
      p_opportunity_public_id::text,request_id,idempotency_key,btrim(p_reason));
  end if;
  if v_claim->>'state'='replay' then return v_claim->'result'; end if;

  select * into v_opportunity from public.opportunities opportunity
  where opportunity.tenant_id=v_tenant and opportunity.organization_id=v_org
    and opportunity.public_id=p_opportunity_public_id and opportunity.archived_at is null
  for update;
  if not found then
    return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,
      'convert_current_opportunity_to_project','opportunity_conversion','opportunity.converted',
      p_opportunity_public_id::text,request_id,idempotency_key,btrim(p_reason),
      'failure','not_found',null);
  end if;
  if v_opportunity.version<>p_expected_version then
    return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,
      'convert_current_opportunity_to_project','opportunity_conversion','opportunity.converted',
      p_opportunity_public_id::text,request_id,idempotency_key,btrim(p_reason),
      'failure','stale_version',null);
  end if;
  if v_opportunity.stage<>'won' then
    return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,
      'convert_current_opportunity_to_project','opportunity_conversion','opportunity.converted',
      p_opportunity_public_id::text,request_id,idempotency_key,btrim(p_reason),
      'failure','invalid_stage',null);
  end if;
  if exists (
    select 1 from public.customer_project_links link
    where link.tenant_id=v_tenant and link.organization_id=v_org
      and link.opportunity_id=v_opportunity.id and link.archived_at is null
  ) then
    return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,
      'convert_current_opportunity_to_project','opportunity_conversion','opportunity.converted',
      p_opportunity_public_id::text,request_id,idempotency_key,btrim(p_reason),
      'failure','already_converted',null);
  end if;
  select profile.public_id into v_owner_employee_public_id
  from public.employee_profiles profile
  join public.organization_members member on member.tenant_id=profile.tenant_id
    and member.organization_id=profile.organization_id
    and member.id=profile.organization_member_id and member.status='active'
  where profile.tenant_id=v_tenant and profile.organization_id=v_org
    and profile.organization_member_id=v_opportunity.owner_member_id
    and profile.deleted_at is null and profile.employment_status in ('probation','active','on_leave')
  for share of profile,member;
  if not found then
    return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,
      'convert_current_opportunity_to_project','opportunity_conversion','opportunity.converted',
      p_opportunity_public_id::text,request_id,idempotency_key,btrim(p_reason),
      'failure','not_found',null);
  end if;
  begin
    v_project_result:=public.create_current_project_v2(
      btrim(p_project_name),btrim(p_description),btrim(p_category),v_owner_employee_public_id,
      v_opportunity.amount,p_status,p_priority,p_starts_on,p_due_on,0,btrim(p_reason),
      request_id,gen_random_uuid()
    );
    if v_project_result->>'outcome'<>'success' then
      v_failure:=case when v_project_result->>'error' in ('conflict','not_found')
        then v_project_result->>'error' else 'project_unavailable' end;
      raise exception 'Nested project command failed';
    end if;
    select * into strict v_project from public.projects project
    where project.tenant_id=v_tenant and project.organization_id=v_org
      and project.public_id=(v_project_result->>'id')::uuid and project.archived_at is null;
    insert into public.customer_project_links(
      tenant_id,organization_id,customer_id,opportunity_id,project_id,linked_by_member_id,link_type
    ) values (
      v_tenant,v_org,v_opportunity.customer_id,v_opportunity.id,v_project.id,v_actor,'delivery'
    ) returning * into v_link;
    update public.opportunities opportunity set
      updated_by_member_id=v_actor,version=opportunity.version+1,updated_at=clock_timestamp()
    where opportunity.tenant_id=v_tenant and opportunity.organization_id=v_org
      and opportunity.id=v_opportunity.id
    returning * into v_opportunity;
  exception when unique_violation then v_failure:='already_converted';
  when others then v_failure:=coalesce(v_failure,'command_failed');
  end;
  if v_failure is not null then
    return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,
      'convert_current_opportunity_to_project','opportunity_conversion','opportunity.converted',
      p_opportunity_public_id::text,request_id,idempotency_key,btrim(p_reason),
      'failure',v_failure,null);
  end if;
  v_entity:=jsonb_build_object(
    'opportunityId',v_opportunity.public_id,'opportunityVersion',v_opportunity.version,
    'projectId',v_project.public_id,'projectVersion',v_project.version,
    'customerProjectLinkId',v_link.public_id,'_resultVersion',v_opportunity.version
  );
  return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,
    'convert_current_opportunity_to_project','opportunity_conversion','opportunity.converted',
    v_opportunity.public_id::text,request_id,idempotency_key,btrim(p_reason),
    'success',null,v_entity);
end;
$$;

revoke all on function public.current_project_command_context()
  from public,anon,authenticated,service_role;
revoke all on function public.complete_crm_command(bigint,bigint,uuid,bigint,text,text,text,text,uuid,uuid,text,text,text,jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.audit_crm_scope_conflict(bigint,bigint,uuid,bigint,text,text,text,uuid,uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function public.create_current_opportunity(uuid,text,uuid,numeric,text,date,bigint,text,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.create_current_opportunity(uuid,text,uuid,numeric,text,date,bigint,text,uuid,uuid)
  to authenticated;
revoke all on function public.transition_current_opportunity_stage(uuid,text,text,bigint,text,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.transition_current_opportunity_stage(uuid,text,text,bigint,text,uuid,uuid)
  to authenticated;
revoke all on function public.create_current_customer_follow_up(uuid,uuid,text,text,timestamptz,bigint,text,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.create_current_customer_follow_up(uuid,uuid,text,text,timestamptz,bigint,text,uuid,uuid)
  to authenticated;
revoke all on function public.convert_current_opportunity_to_project(uuid,text,text,text,text,text,date,date,bigint,text,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.convert_current_opportunity_to_project(uuid,text,text,text,text,text,date,date,bigint,text,uuid,uuid)
  to authenticated;
