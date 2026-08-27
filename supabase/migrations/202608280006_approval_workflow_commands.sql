-- Versioned approval templates and the only authenticated approval-submission boundary.

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
  'customer.owner_transferred', 'customer.archived', 'customer.restored',
  'customer.contract_created', 'customer.source_linked',
  'customer.import_started', 'customer.imported', 'customer.import_completed',
  'customer.export_requested', 'customer.export_downloaded',
  'opportunity.created', 'opportunity.stage_changed', 'opportunity.converted',
  'customer.follow_up_created', 'approval.submitted', 'approval.command_failed',
  'payroll_policy.activated', 'payroll.calculated', 'payroll.confirmed',
  'ai.config.updated', 'organization.department_created',
  'organization.department_updated', 'organization.position_upserted',
  'organization.role_assigned', 'organization.command_failed',
  'organization.manager_assigned', 'directory.manager_mapped',
  'employee_skill.verified', 'employee_skill.verification_failed',
  'directory.sync_issue_resolved'
));

create or replace function public.is_valid_approval_template_definition(
  p_form_schema jsonb,
  p_step_definitions jsonb
)
returns boolean
language plpgsql
immutable
set search_path=''
as $$
declare
  v_field jsonb;
  v_step jsonb;
  v_rule jsonb;
  v_kind text;
begin
  if jsonb_typeof(p_form_schema) is distinct from 'object'
     or (select array_agg(key order by key) from jsonb_object_keys(p_form_schema) key)
       is distinct from array['fields']::text[]
     or jsonb_typeof(p_form_schema->'fields') is distinct from 'array'
     or jsonb_array_length(p_form_schema->'fields') not between 1 and 30
     or jsonb_typeof(p_step_definitions) is distinct from 'array'
     or jsonb_array_length(p_step_definitions) not between 1 and 12 then
    return false;
  end if;
  if (select count(*)<>count(distinct field->>'key')
      from jsonb_array_elements(p_form_schema->'fields') field) then return false; end if;
  for v_field in select value from jsonb_array_elements(p_form_schema->'fields') loop
    if jsonb_typeof(v_field) is distinct from 'object'
       or exists(select 1 from jsonb_object_keys(v_field) key
         where key not in ('key','label','type','required','maxLength','options'))
       or jsonb_typeof(v_field->'key') is distinct from 'string'
       or coalesce(v_field->>'key','')!~'^[A-Za-z][A-Za-z0-9_]{0,63}$'
       or jsonb_typeof(v_field->'label') is distinct from 'string'
       or length(btrim(coalesce(v_field->>'label',''))) not between 1 and 80
       or jsonb_typeof(v_field->'type') is distinct from 'string'
       or coalesce(v_field->>'type','') not in ('text','money','date','uuid','boolean','integer','enum')
       or jsonb_typeof(v_field->'required') is distinct from 'boolean' then return false;
    end if;
    if v_field->>'type'='text' then
      if not (jsonb_typeof(v_field->'maxLength') is not distinct from 'number'
        and (v_field->>'maxLength')~'^[1-9][0-9]{0,3}$'
        and (v_field->>'maxLength')::integer between 1 and 2000) then return false; end if;
    elsif v_field ? 'maxLength' then return false;
    end if;
    if v_field->>'type'='enum' then
      if jsonb_typeof(v_field->'options') is distinct from 'array'
         or jsonb_array_length(v_field->'options') not between 1 and 50
         or exists(select 1 from jsonb_array_elements(v_field->'options') option
           where jsonb_typeof(option) is distinct from 'string'
             or length(btrim(option#>>'{}')) not between 1 and 80)
         or (select count(*)<>count(distinct option#>>'{}')
           from jsonb_array_elements(v_field->'options') option) then return false; end if;
    elsif v_field ? 'options' then return false;
    end if;
  end loop;
  for v_step in select value from jsonb_array_elements(p_step_definitions) loop
    if jsonb_typeof(v_step) is distinct from 'object'
       or (select array_agg(key order by key) from jsonb_object_keys(v_step) key)
         is distinct from array['approverRule','name']::text[]
       or jsonb_typeof(v_step->'name') is distinct from 'string'
       or length(btrim(coalesce(v_step->>'name',''))) not between 1 and 120
       or jsonb_typeof(v_step->'approverRule') is distinct from 'object' then return false; end if;
    v_rule:=v_step->'approverRule'; v_kind:=v_rule->>'kind';
    if v_kind='applicant_manager' then
      if (select array_agg(key order by key) from jsonb_object_keys(v_rule) key)
        is distinct from array['kind']::text[]
        or jsonb_typeof(v_rule->'kind') is distinct from 'string' then return false; end if;
    elsif v_kind='role' then
      if (select array_agg(key order by key) from jsonb_object_keys(v_rule) key)
           is distinct from array['kind','roleCode']::text[]
         or jsonb_typeof(v_rule->'kind') is distinct from 'string'
         or jsonb_typeof(v_rule->'roleCode') is distinct from 'string'
         or coalesce(v_rule->>'roleCode','')!~'^[a-z][a-z0-9_.-]{0,63}$' then return false; end if;
    elsif v_kind='employee' then
      if (select array_agg(key order by key) from jsonb_object_keys(v_rule) key)
           is distinct from array['employeePublicId','kind']::text[]
         or jsonb_typeof(v_rule->'kind') is distinct from 'string'
         or jsonb_typeof(v_rule->'employeePublicId') is distinct from 'string' then return false; end if;
      perform (v_rule->>'employeePublicId')::uuid;
    else return false;
    end if;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;

create or replace function public.is_valid_approval_form(p_schema jsonb,p_form jsonb)
returns boolean
language plpgsql
immutable
set search_path=''
as $$
declare
  v_field jsonb;
  v_key text;
  v_value jsonb;
  v_text text;
begin
  if jsonb_typeof(p_form) is distinct from 'object' or pg_column_size(p_form)>32768
     or (select count(*) from jsonb_object_keys(p_form))>30 then return false; end if;
  if exists(select 1 from jsonb_object_keys(p_form) submitted(key)
    where not exists(select 1 from jsonb_array_elements(p_schema->'fields') field
      where field->>'key'=submitted.key)) then return false; end if;
  for v_field in select value from jsonb_array_elements(p_schema->'fields') loop
    v_key:=v_field->>'key';
    if (v_field->>'required')::boolean and not (p_form ? v_key) then return false; end if;
    if not (p_form ? v_key) then continue; end if;
    v_value:=p_form->v_key;
    if v_value='null'::jsonb then
      if (v_field->>'required')::boolean then return false; else continue; end if;
    end if;
    v_text:=v_value#>>'{}';
    case v_field->>'type'
      when 'text' then
        if jsonb_typeof(v_value)<>'string' or length(btrim(v_text))<1
           or length(v_text)>(v_field->>'maxLength')::integer then return false; end if;
      when 'money' then
        if jsonb_typeof(v_value)<>'string' or v_text!~'^(0|[1-9][0-9]{0,15})(\.[0-9]{1,2})?$'
           or v_text::numeric>=10000000000000000::numeric then return false; end if;
      when 'date' then
        if jsonb_typeof(v_value)<>'string' or v_text!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
           or not isfinite(v_text::date) then return false; end if;
      when 'uuid' then
        if jsonb_typeof(v_value)<>'string' then return false; end if; perform v_text::uuid;
      when 'boolean' then
        if jsonb_typeof(v_value)<>'boolean' then return false; end if;
      when 'integer' then
        if jsonb_typeof(v_value)<>'number' or v_text!~'^(-?[1-9][0-9]{0,14}|0)$' then return false; end if;
      when 'enum' then
        if jsonb_typeof(v_value)<>'string' or not exists(
          select 1 from jsonb_array_elements_text(v_field->'options') option where option=v_text
        ) then return false; end if;
      else return false;
    end case;
  end loop;
  return true;
exception when others then
  return false;
end;
$$;

create table public.approval_templates (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete restrict,
  organization_id bigint not null,
  template_key text not null check (template_key~'^[a-z][a-z0-9_.-]{0,63}$'),
  version integer not null check (version>0),
  approval_type text not null check (approval_type in ('reimbursement','purchase','contract')),
  title text not null check (length(btrim(title)) between 1 and 160),
  description text check (description is null or length(btrim(description)) between 1 and 500),
  form_schema jsonb not null,
  step_definitions jsonb not null,
  is_active boolean not null default true,
  created_by_member_id bigint,
  created_at timestamptz not null default clock_timestamp(),
  unique(tenant_id,organization_id,id),
  unique(tenant_id,organization_id,id,version),
  unique(tenant_id,organization_id,template_key,version),
  foreign key(tenant_id,organization_id)
    references public.organizations(tenant_id,id) on delete restrict,
  foreign key(tenant_id,organization_id,created_by_member_id)
    references public.organization_members(tenant_id,organization_id,id) on delete restrict,
  check(public.is_valid_approval_template_definition(form_schema,step_definitions))
);
create unique index approval_templates_one_active_version_idx
  on public.approval_templates(tenant_id,organization_id,template_key) where is_active;

alter table public.approvals add column tenant_id bigint;
alter table public.approvals add column template_id bigint;
alter table public.approvals add column template_version integer;
alter table public.approvals add column version bigint not null default 1 check (version>0);
alter table public.approvals add column current_step_order integer check (current_step_order is null or current_step_order>0);
update public.approvals approval set tenant_id=organization.tenant_id
from public.organizations organization where organization.id=approval.organization_id;
alter table public.approvals alter column tenant_id set not null;
alter table public.approvals add constraint approvals_tenant_organization_fk
  foreign key(tenant_id,organization_id) references public.organizations(tenant_id,id) on delete restrict;
alter table public.approvals add constraint approvals_tenant_organization_id_uidx
  unique(tenant_id,organization_id,id);
alter table public.approvals add constraint approvals_template_version_fk
  foreign key(tenant_id,organization_id,template_id,template_version)
  references public.approval_templates(tenant_id,organization_id,id,version) on delete restrict;
alter table public.approvals add constraint approvals_template_pair_check
  check((template_id is null and template_version is null) or (template_id is not null and template_version is not null));

alter table public.approval_steps add column tenant_id bigint;
update public.approval_steps step set tenant_id=organization.tenant_id
from public.organizations organization where organization.id=step.organization_id;
alter table public.approval_steps alter column tenant_id set not null;
alter table public.approval_steps add constraint approval_steps_tenant_approval_fk
  foreign key(tenant_id,organization_id,approval_id)
  references public.approvals(tenant_id,organization_id,id) on delete restrict;

alter table public.approval_actions add column tenant_id bigint;
update public.approval_actions action set tenant_id=organization.tenant_id
from public.organizations organization where organization.id=action.organization_id;
alter table public.approval_actions alter column tenant_id set not null;
alter table public.approval_actions add constraint approval_actions_tenant_approval_fk
  foreign key(tenant_id,organization_id,approval_id)
  references public.approvals(tenant_id,organization_id,id) on delete restrict;

create table public.approval_command_idempotency (
  tenant_id bigint not null references public.tenants(id) on delete restrict,
  organization_id bigint not null,
  actor_member_id bigint not null,
  operation text not null check (operation='submit_current_approval'),
  idempotency_key uuid not null,
  target_public_id uuid not null,
  payload_digest text not null check (payload_digest~'^[0-9a-f]{64}$'),
  request_id uuid not null,
  result jsonb,
  created_at timestamptz not null default clock_timestamp(),
  primary key(tenant_id,operation,idempotency_key),
  foreign key(tenant_id,organization_id)
    references public.organizations(tenant_id,id) on delete restrict,
  foreign key(tenant_id,organization_id,actor_member_id)
    references public.organization_members(tenant_id,organization_id,id) on delete restrict
);

alter table public.approval_templates enable row level security;
alter table public.approval_templates force row level security;
alter table public.approval_command_idempotency enable row level security;
alter table public.approval_command_idempotency force row level security;

create or replace function public.can_read_current_approval_template(
  p_tenant_id bigint,p_organization_id bigint
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists(
    select 1
    from public.external_identities external
    join public.identity_providers provider on provider.tenant_id=external.tenant_id
      and provider.id=external.identity_provider_id and provider.status='active'
    join public.tenants tenant on tenant.id=external.tenant_id and tenant.status='active'
    join public.organizations organization on organization.tenant_id=external.tenant_id
      and organization.id=external.organization_id
    join public.organization_members member on member.tenant_id=external.tenant_id
      and member.organization_id=external.organization_id and member.id=external.organization_member_id
      and member.user_id=(select auth.uid()) and member.status='active'
    join public.employee_profiles profile on profile.tenant_id=member.tenant_id
      and profile.organization_id=member.organization_id and profile.organization_member_id=member.id
      and profile.deleted_at is null and profile.employment_status in ('probation','active','on_leave')
    where external.auth_user_id=(select auth.uid()) and external.status='active'
      and external.tenant_id=p_tenant_id and external.organization_id=p_organization_id
      and exists(select 1 from public.member_roles assignment
        join public.roles role on role.tenant_id=assignment.tenant_id
          and role.id=assignment.role_id and role.is_enabled
        join public.role_permissions role_grant on role_grant.tenant_id=assignment.tenant_id
          and role_grant.role_id=assignment.role_id
        join public.permissions permission on permission.id=role_grant.permission_id
        where assignment.tenant_id=member.tenant_id and assignment.member_id=member.id
          and (role.organization_id is null or role.organization_id=member.organization_id)
          and permission.code='approval.submit')
  );
$$;
create policy approval_templates_member_select on public.approval_templates
  for select to authenticated using (
    is_active and (select public.can_read_current_approval_template(tenant_id,organization_id))
  );

create or replace function public.reject_approval_template_mutation()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if tg_op='UPDATE' and current_setting('quantxy.approval_template_admin',true)='on'
     and (to_jsonb(new)-'is_active')=(to_jsonb(old)-'is_active')
     and new.is_active is distinct from old.is_active then
    return new;
  end if;
  raise exception 'Approval template versions are immutable' using errcode='42501';
end;
$$;
create trigger approval_templates_reject_update_delete
before update or delete on public.approval_templates
for each row execute function public.reject_approval_template_mutation();
create trigger approval_templates_reject_truncate
before truncate on public.approval_templates
for each statement execute function public.reject_approval_template_mutation();

create or replace function public.current_approval_command_identity(p_permission text)
returns table(
  tenant_id bigint,organization_id bigint,actor_member_id bigint,actor_auth_user_id uuid,
  actor_employee_id bigint,actor_employee_public_id uuid
)
language plpgsql
security definer
set search_path=''
as $$
begin
  if p_permission not in ('approval.submit','approval.act') or (select auth.uid()) is null then
    raise exception 'Approval command permission required' using errcode='42501';
  end if;
  return query
  select tenant.id,organization.id,member.id,(select auth.uid()),profile.id,profile.public_id
  from public.external_identities external
  join public.identity_providers provider on provider.tenant_id=external.tenant_id
    and provider.id=external.identity_provider_id and provider.status='active'
  join public.tenants tenant on tenant.id=external.tenant_id and tenant.status='active'
  join public.organizations organization on organization.tenant_id=external.tenant_id
    and organization.id=external.organization_id
  join public.organization_members member on member.tenant_id=external.tenant_id
    and member.organization_id=external.organization_id and member.id=external.organization_member_id
    and member.user_id=(select auth.uid()) and member.status='active'
  join public.employee_profiles profile on profile.tenant_id=member.tenant_id
    and profile.organization_id=member.organization_id and profile.organization_member_id=member.id
    and profile.deleted_at is null and profile.employment_status in ('probation','active','on_leave')
  where external.auth_user_id=(select auth.uid()) and external.status='active'
    and exists(select 1 from public.member_roles assignment
      join public.roles role on role.tenant_id=assignment.tenant_id and role.id=assignment.role_id and role.is_enabled
      join public.role_permissions role_grant on role_grant.tenant_id=assignment.tenant_id
        and role_grant.role_id=assignment.role_id
      join public.permissions permission on permission.id=role_grant.permission_id
      where assignment.tenant_id=member.tenant_id and assignment.member_id=member.id
        and (role.organization_id is null or role.organization_id=member.organization_id)
        and permission.code=p_permission)
  limit 1;
  if not found then raise exception 'Approval command permission required' using errcode='42501'; end if;
end;
$$;

create or replace function public.claim_approval_command(
  p_tenant bigint,p_organization bigint,p_actor bigint,p_operation text,p_payload jsonb,
  p_idempotency_key uuid,p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_target uuid:=gen_random_uuid();
  v_digest text:=encode(public.digest(convert_to(p_payload::text,'UTF8'),'sha256'),'hex');
  v_organization bigint; v_actor bigint; v_stored_target uuid; v_stored_digest text; v_result jsonb;
begin
  insert into public.approval_command_idempotency(
    tenant_id,organization_id,actor_member_id,operation,idempotency_key,target_public_id,payload_digest,request_id
  ) values(p_tenant,p_organization,p_actor,p_operation,p_idempotency_key,v_target,v_digest,p_request_id)
  on conflict(tenant_id,operation,idempotency_key) do nothing;
  select ledger.organization_id,ledger.actor_member_id,ledger.target_public_id,ledger.payload_digest,ledger.result
  into strict v_organization,v_actor,v_stored_target,v_stored_digest,v_result
  from public.approval_command_idempotency ledger
  where ledger.tenant_id=p_tenant and ledger.operation=p_operation and ledger.idempotency_key=p_idempotency_key
  for update;
  if v_organization<>p_organization or v_actor<>p_actor or v_stored_digest<>v_digest then
    return jsonb_build_object('state','scope_conflict');
  end if;
  if v_result is not null then return jsonb_build_object('state','replay','result',v_result); end if;
  return jsonb_build_object('state','claimed','targetPublicId',v_stored_target);
end;
$$;

create or replace function public.complete_approval_submission(
  p_tenant bigint,p_organization bigint,p_user uuid,p_actor bigint,p_target uuid,
  p_request_id uuid,p_idempotency_key uuid,p_outcome text,p_error text,p_entity jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare v_result jsonb;
begin
  v_result:=case when p_outcome='success' then jsonb_build_object(
    'outcome','success','resource','approval','id',p_target,'version',1,'entity',p_entity
  ) else jsonb_build_object('outcome','failure','error',p_error) end;
  update public.approval_command_idempotency ledger set result=v_result
  where ledger.tenant_id=p_tenant and ledger.organization_id=p_organization
    and ledger.actor_member_id=p_actor and ledger.operation='submit_current_approval'
    and ledger.idempotency_key=p_idempotency_key;
  if not found then raise exception 'Approval command ledger completion failed' using errcode='P0001'; end if;
  perform public.append_audit_log(p_tenant,p_organization,p_user,p_actor,
    case when p_outcome='success' then 'approval.submitted' else 'approval.command_failed' end,
    'approval',p_target::text,p_request_id,null,jsonb_build_object(
      'outcome',p_outcome,'operation','submit_current_approval','resource','approval',
      'requestId',p_request_id,'idempotencyKey',p_idempotency_key,
      'entityDigest',case when p_outcome='success' then encode(
        public.digest(convert_to(p_entity::text,'UTF8'),'sha256'),'hex') else null end,
      'failure',case when p_outcome='failure' then p_error else null end));
  return v_result;
end;
$$;

create or replace function public.submit_current_approval(
  template_public_id uuid,form_data jsonb,idempotency_key uuid,request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_tenant bigint; v_org bigint; v_actor bigint; v_user uuid; v_applicant_id bigint; v_employee_public_id uuid;
  v_claim jsonb; v_template public.approval_templates%rowtype; v_applicant public.employee_profiles%rowtype;
  v_step record; v_rule jsonb; v_approver bigint; v_steps jsonb:='[]'::jsonb; v_first_approver bigint;
  v_approval public.approvals%rowtype; v_target uuid; v_now timestamptz:=clock_timestamp(); v_failure text;
  v_entity jsonb;
begin
  select * into v_tenant,v_org,v_actor,v_user,v_applicant_id,v_employee_public_id
  from public.current_approval_command_identity('approval.submit');
  if template_public_id is null or form_data is null or jsonb_typeof(form_data) is distinct from 'object'
     or idempotency_key is null or request_id is null or idempotency_key=request_id then
    raise exception 'Approval submission is invalid' using errcode='22023';
  end if;
  v_claim:=public.claim_approval_command(v_tenant,v_org,v_actor,'submit_current_approval',
    jsonb_build_object('templateId',template_public_id,'formData',form_data),idempotency_key,request_id);
  if v_claim->>'state'='scope_conflict' then
    perform public.append_audit_log(v_tenant,v_org,v_user,v_actor,'approval.command_failed','approval',null,
      request_id,null,jsonb_build_object('outcome','failure','failure','scope_conflict','requestId',request_id));
    return jsonb_build_object('outcome','failure','error','scope_conflict');
  end if;
  if v_claim->>'state'='replay' then return v_claim->'result'; end if;
  v_target:=(v_claim->>'targetPublicId')::uuid;
  select * into v_template from public.approval_templates template
  where template.tenant_id=v_tenant and template.organization_id=v_org
    and template.public_id=template_public_id and template.is_active for share;
  if not found then v_failure:='template_not_found';
  elsif not public.is_valid_approval_form(v_template.form_schema,form_data) then v_failure:='invalid_form';
  end if;
  if v_failure is not null then
    return public.complete_approval_submission(v_tenant,v_org,v_user,v_actor,v_target,request_id,
      idempotency_key,'failure',v_failure,null);
  end if;
  select profile.* into strict v_applicant from public.employee_profiles profile
  join public.organization_members applicant_member on applicant_member.tenant_id=profile.tenant_id
    and applicant_member.organization_id=profile.organization_id
    and applicant_member.id=profile.organization_member_id and applicant_member.status='active'
  where profile.tenant_id=v_tenant and profile.organization_id=v_org and profile.id=v_applicant_id
    and profile.deleted_at is null and profile.employment_status in ('probation','active','on_leave')
  for share of profile,applicant_member;
  for v_step in select value,ordinality from jsonb_array_elements(v_template.step_definitions) with ordinality loop
    v_rule:=v_step.value->'approverRule'; v_approver:=null;
    if v_rule->>'kind'='applicant_manager' then
      select manager.id into v_approver from public.employee_profiles manager
      join public.organization_members manager_member on manager_member.tenant_id=manager.tenant_id
        and manager_member.organization_id=manager.organization_id
        and manager_member.id=manager.organization_member_id and manager_member.status='active'
      where manager.tenant_id=v_tenant and manager.organization_id=v_org
        and manager.id=v_applicant.manager_employee_id and manager.deleted_at is null
        and manager.employment_status in ('probation','active','on_leave')
      for share of manager,manager_member;
    elsif v_rule->>'kind'='employee' then
      select employee.id into v_approver from public.employee_profiles employee
      join public.organization_members employee_member on employee_member.tenant_id=employee.tenant_id
        and employee_member.organization_id=employee.organization_id
        and employee_member.id=employee.organization_member_id and employee_member.status='active'
      where employee.tenant_id=v_tenant and employee.organization_id=v_org
        and employee.public_id=(v_rule->>'employeePublicId')::uuid and employee.deleted_at is null
        and employee.employment_status in ('probation','active','on_leave')
      for share of employee,employee_member;
    elsif v_rule->>'kind'='role' then
      select employee.id into v_approver
      from public.roles role
      join public.member_roles assignment on assignment.tenant_id=role.tenant_id and assignment.role_id=role.id
      join public.organization_members member on member.tenant_id=assignment.tenant_id
        and member.id=assignment.member_id and member.organization_id=v_org and member.status='active'
      join public.employee_profiles employee on employee.tenant_id=member.tenant_id
        and employee.organization_id=member.organization_id and employee.organization_member_id=member.id
        and employee.deleted_at is null and employee.employment_status in ('probation','active','on_leave')
      where role.tenant_id=v_tenant and (role.organization_id is null or role.organization_id=v_org)
        and role.code=v_rule->>'roleCode' and role.is_enabled and employee.id<>v_applicant_id
      order by employee.id limit 1 for share of role,assignment,member,employee;
    end if;
    if v_approver is null or v_approver=v_applicant_id then v_failure:='approver_unavailable'; exit; end if;
    if v_step.ordinality=1 then v_first_approver:=v_approver; end if;
    v_steps:=v_steps||jsonb_build_array(jsonb_build_object(
      'order',v_step.ordinality,'name',v_step.value->>'name','approverId',v_approver));
  end loop;
  if v_failure is not null then
    return public.complete_approval_submission(v_tenant,v_org,v_user,v_actor,v_target,request_id,
      idempotency_key,'failure',v_failure,null);
  end if;
  begin
    insert into public.approvals(
      public_id,tenant_id,organization_id,applicant_employee_id,owner_employee_id,
      approval_code,approval_type,title,summary,form_data,current_step,current_step_order,
      status,submitted_at,template_id,template_version,version,created_at,updated_at
    ) values(
      v_target,v_tenant,v_org,v_applicant_id,v_first_approver,
      'AP-'||upper(substr(replace(v_target::text,'-',''),1,20)),v_template.approval_type,v_template.title,
      v_template.description,form_data,v_steps->0->>'name',1,'pending',v_now,
      v_template.id,v_template.version,1,v_now,v_now
    ) returning * into v_approval;
    insert into public.approval_steps(
      tenant_id,organization_id,approval_id,step_order,name,approver_employee_id,status,created_at
    ) select v_tenant,v_org,v_approval.id,(step->>'order')::integer,step->>'name',
      (step->>'approverId')::bigint,'pending',v_now from jsonb_array_elements(v_steps) step;
    insert into public.approval_actions(
      tenant_id,organization_id,approval_id,actor_employee_id,action_type,content,created_at
    ) values(v_tenant,v_org,v_approval.id,v_applicant_id,'submit',null,v_now);
  exception when others then
    v_failure:='command_failed';
  end;
  if v_failure is not null then
    return public.complete_approval_submission(v_tenant,v_org,v_user,v_actor,v_target,request_id,
      idempotency_key,'failure',v_failure,null);
  end if;
  v_entity:=jsonb_build_object(
    'id',v_approval.public_id,'version',v_approval.version,'approvalCode',v_approval.approval_code,
    'approvalType',v_approval.approval_type,'title',v_approval.title,'status',v_approval.status,
    'currentStep',v_approval.current_step,'templateId',v_template.public_id,
    'templateVersion',v_template.version,'submittedAt',v_approval.submitted_at);
  return public.complete_approval_submission(v_tenant,v_org,v_user,v_actor,v_target,request_id,
    idempotency_key,'success',null,v_entity);
end;
$$;

create or replace function public.is_approval_submit_baseline_role(
  p_is_system boolean,p_is_enabled boolean,p_organization_id bigint,p_code text
)
returns boolean
language sql
immutable
set search_path=''
as $$
  select coalesce(p_is_system,false) and coalesce(p_is_enabled,false)
    and p_organization_id is null
    and p_code in ('owner','admin','department_head','supervisor','employee','finance','hr');
$$;

create or replace function public.revoke_approval_submit_before_role_update()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if public.is_approval_submit_baseline_role(old.is_system,old.is_enabled,old.organization_id,old.code) then
    delete from public.role_permissions assignment using public.permissions permission
    where assignment.tenant_id=old.tenant_id and assignment.role_id=old.id
      and assignment.permission_id=permission.id and permission.code='approval.submit';
  end if;
  return new;
end;
$$;

create or replace function public.grant_approval_submit_after_role_change()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if public.is_approval_submit_baseline_role(new.is_system,new.is_enabled,new.organization_id,new.code) then
    insert into public.role_permissions(tenant_id,role_id,permission_id)
    select new.tenant_id,new.id,permission.id from public.permissions permission
    where permission.code='approval.submit' on conflict do nothing;
  end if;
  return new;
end;
$$;

create trigger roles_approval_submit_before_update
before update of tenant_id,is_system,is_enabled,organization_id,code on public.roles
for each row execute function public.revoke_approval_submit_before_role_update();
create trigger roles_approval_submit_after_insert
after insert on public.roles
for each row execute function public.grant_approval_submit_after_role_change();
create trigger roles_approval_submit_after_update
after update of tenant_id,is_system,is_enabled,organization_id,code on public.roles
for each row execute function public.grant_approval_submit_after_role_change();

insert into public.role_permissions(tenant_id,role_id,permission_id)
select role.tenant_id,role.id,permission.id
from public.roles role join public.permissions permission on permission.code='approval.submit'
where public.is_approval_submit_baseline_role(
  role.is_system,role.is_enabled,role.organization_id,role.code
) on conflict do nothing;

create or replace function public.default_approval_template_catalog()
returns table(
  template_key text,approval_type text,title text,description text,
  form_schema jsonb,step_definitions jsonb
)
language sql
immutable
set search_path=''
as $$
  values
    ('expense_reimbursement','reimbursement','费用报销审批','用于真实费用报销及财务复核',
      '{"fields":[{"key":"amount","label":"报销金额","type":"money","required":true},{"key":"purpose","label":"费用说明","type":"text","required":true,"maxLength":500},{"key":"expenseDate","label":"发生日期","type":"date","required":true},{"key":"projectId","label":"关联项目","type":"uuid","required":false},{"key":"costType","label":"费用类型","type":"enum","required":true,"options":["travel","meal","transport","office","other"]}]}'::jsonb,
      '[{"name":"直属主管审批","approverRule":{"kind":"applicant_manager"}},{"name":"财务复核","approverRule":{"kind":"role","roleCode":"finance"}}]'::jsonb),
    ('purchase_request','purchase','采购申请审批','用于采购预算和供应商申请',
      '{"fields":[{"key":"item","label":"采购事项","type":"text","required":true,"maxLength":300},{"key":"amount","label":"采购金额","type":"money","required":true},{"key":"supplier","label":"拟定供应商","type":"text","required":false,"maxLength":200},{"key":"reason","label":"采购原因","type":"text","required":true,"maxLength":500}]}'::jsonb,
      '[{"name":"直属主管审批","approverRule":{"kind":"applicant_manager"}},{"name":"财务复核","approverRule":{"kind":"role","roleCode":"finance"}}]'::jsonb),
    ('contract_review','contract','合同审批','用于合同签署前业务与管理审核',
      '{"fields":[{"key":"contractName","label":"合同名称","type":"text","required":true,"maxLength":200},{"key":"counterparty","label":"合同相对方","type":"text","required":true,"maxLength":200},{"key":"amount","label":"合同金额","type":"money","required":true},{"key":"effectiveDate","label":"生效日期","type":"date","required":true}]}'::jsonb,
      '[{"name":"直属主管审批","approverRule":{"kind":"applicant_manager"}},{"name":"管理员复核","approverRule":{"kind":"role","roleCode":"admin"}}]'::jsonb);
$$;

create or replace function public.seed_default_approval_templates_for_organization()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  insert into public.approval_templates(
    tenant_id,organization_id,template_key,version,approval_type,title,description,form_schema,step_definitions
  ) select new.tenant_id,new.id,seed.template_key,1,seed.approval_type,seed.title,seed.description,
    seed.form_schema,seed.step_definitions from public.default_approval_template_catalog() seed
  on conflict(tenant_id,organization_id,template_key,version) do nothing;
  return new;
end;
$$;
create trigger organizations_seed_default_approval_templates
after insert on public.organizations
for each row execute function public.seed_default_approval_templates_for_organization();

insert into public.approval_templates(
  tenant_id,organization_id,template_key,version,approval_type,title,description,form_schema,step_definitions
)
select organization.tenant_id,organization.id,seed.template_key,1,seed.approval_type,seed.title,seed.description,
  seed.form_schema,seed.step_definitions
from public.organizations organization
cross join public.default_approval_template_catalog() seed
on conflict(tenant_id,organization_id,template_key,version) do nothing;

revoke all on table public.approval_templates from public,anon,authenticated,service_role;
grant select on table public.approval_templates to authenticated;
revoke all on table public.approval_command_idempotency from public,anon,authenticated,service_role;
revoke all on sequence public.approval_templates_id_seq from public,anon,authenticated,service_role;
revoke all on function public.is_valid_approval_template_definition(jsonb,jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.is_valid_approval_form(jsonb,jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.can_read_current_approval_template(bigint,bigint)
  from public,anon,authenticated,service_role;
grant execute on function public.can_read_current_approval_template(bigint,bigint) to authenticated;
revoke all on function public.reject_approval_template_mutation()
  from public,anon,authenticated,service_role;
revoke all on function public.is_approval_submit_baseline_role(boolean,boolean,bigint,text)
  from public,anon,authenticated,service_role;
revoke all on function public.revoke_approval_submit_before_role_update()
  from public,anon,authenticated,service_role;
revoke all on function public.grant_approval_submit_after_role_change()
  from public,anon,authenticated,service_role;
revoke all on function public.default_approval_template_catalog()
  from public,anon,authenticated,service_role;
revoke all on function public.seed_default_approval_templates_for_organization()
  from public,anon,authenticated,service_role;
revoke all on function public.current_approval_command_identity(text)
  from public,anon,authenticated,service_role;
revoke all on function public.claim_approval_command(bigint,bigint,bigint,text,jsonb,uuid,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.complete_approval_submission(
  bigint,bigint,uuid,bigint,uuid,uuid,uuid,text,text,jsonb
) from public,anon,authenticated,service_role;
revoke all on function public.submit_current_approval(uuid,jsonb,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.submit_current_approval(uuid,jsonb,uuid,uuid) to authenticated;
