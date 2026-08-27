-- Optimistic, idempotent and actor-safe approval decisions.

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
  'customer.follow_up_created', 'approval.submitted', 'approval.step_approved', 'approval.approved',
  'approval.rejected', 'approval.returned', 'approval.cancelled', 'approval.command_failed',
  'payroll_policy.activated', 'payroll.calculated', 'payroll.confirmed',
  'ai.config.updated', 'organization.department_created',
  'organization.department_updated', 'organization.position_upserted',
  'organization.role_assigned', 'organization.command_failed',
  'organization.manager_assigned', 'directory.manager_mapped',
  'employee_skill.verified', 'employee_skill.verification_failed',
  'directory.sync_issue_resolved'
));

alter table public.approvals drop constraint if exists approvals_status_check;
alter table public.approvals add constraint approvals_status_check check (
  status in ('draft','pending','approved','rejected','returned','cancelled')
);
alter table public.approval_steps drop constraint if exists approval_steps_status_check;
alter table public.approval_steps add constraint approval_steps_status_check check (
  status in ('pending','approved','rejected','returned','skipped')
);
alter table public.approval_actions drop constraint if exists approval_actions_action_type_check;
alter table public.approval_actions add constraint approval_actions_action_type_check check (
  action_type in ('submit','approve','reject','return','cancel','comment')
);

create table public.approval_action_idempotency (
  tenant_id bigint not null references public.tenants(id) on delete restrict,
  organization_id bigint not null,
  actor_member_id bigint not null,
  approval_public_id uuid not null,
  command text not null check (command in ('approve','reject','return','cancel')),
  expected_version bigint not null check (expected_version>0),
  payload_digest text not null check (payload_digest~'^[0-9a-f]{64}$'),
  request_id uuid not null,
  result jsonb,
  created_at timestamptz not null default clock_timestamp(),
  primary key(tenant_id,request_id),
  foreign key(tenant_id,organization_id)
    references public.organizations(tenant_id,id) on delete restrict,
  foreign key(tenant_id,organization_id,actor_member_id)
    references public.organization_members(tenant_id,organization_id,id) on delete restrict
);
alter table public.approval_action_idempotency enable row level security;
alter table public.approval_action_idempotency force row level security;

create or replace function public.current_approval_actor_identity()
returns table(
  tenant_id bigint,organization_id bigint,actor_member_id bigint,actor_auth_user_id uuid,
  actor_employee_id bigint,actor_employee_public_id uuid
)
language sql
volatile
security definer
set search_path=''
as $$
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
  where (select auth.uid()) is not null and external.auth_user_id=(select auth.uid())
    and external.status='active'
  limit 1
  for share of external,provider,tenant,organization,member,profile;
$$;

create or replace function public.claim_approval_action(
  p_tenant bigint,p_organization bigint,p_actor bigint,p_approval uuid,p_command text,
  p_expected_version bigint,p_comment text,p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_digest text:=encode(public.digest(convert_to(jsonb_build_object(
    'approvalId',p_approval,'command',p_command,'expectedVersion',p_expected_version,
    'comment',p_comment
  )::text,'UTF8'),'sha256'),'hex');
  v_organization bigint; v_actor bigint; v_approval uuid; v_command text;
  v_expected_version bigint; v_stored_digest text; v_result jsonb;
begin
  insert into public.approval_action_idempotency(
    tenant_id,organization_id,actor_member_id,approval_public_id,command,
    expected_version,payload_digest,request_id
  ) values(
    p_tenant,p_organization,p_actor,p_approval,p_command,p_expected_version,v_digest,p_request_id
  ) on conflict(tenant_id,request_id) do nothing;
  select ledger.organization_id,ledger.actor_member_id,ledger.approval_public_id,
    ledger.command,ledger.expected_version,ledger.payload_digest,ledger.result
  into strict v_organization,v_actor,v_approval,v_command,v_expected_version,v_stored_digest,v_result
  from public.approval_action_idempotency ledger
  where ledger.tenant_id=p_tenant and ledger.request_id=p_request_id
  for update;
  if v_organization<>p_organization or v_actor<>p_actor or v_approval<>p_approval
     or v_command<>p_command or v_expected_version<>p_expected_version
     or v_stored_digest<>v_digest then
    return jsonb_build_object('state','scope_conflict');
  end if;
  if v_result is not null then return jsonb_build_object('state','replay','result',v_result); end if;
  return jsonb_build_object('state','claimed');
end;
$$;

create or replace function public.complete_approval_action(
  p_tenant bigint,p_organization bigint,p_user uuid,p_actor bigint,p_approval uuid,
  p_request_id uuid,p_command text,p_outcome text,p_error text,p_entity jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare v_result jsonb;
begin
  v_result:=case when p_outcome='success' then jsonb_build_object(
    'outcome','success','resource','approval','id',p_approval,
    'version',(p_entity->>'version')::bigint,'entity',p_entity
  ) else jsonb_build_object('outcome','failure','error',p_error) end;
  update public.approval_action_idempotency ledger set result=v_result
  where ledger.tenant_id=p_tenant and ledger.organization_id=p_organization
    and ledger.actor_member_id=p_actor and ledger.approval_public_id=p_approval
    and ledger.command=p_command and ledger.request_id=p_request_id;
  if not found then raise exception 'Approval action ledger completion failed' using errcode='P0001'; end if;
  perform public.append_audit_log(
    p_tenant,p_organization,p_user,p_actor,
    case when p_outcome='failure' then 'approval.command_failed'
      when p_command='approve' and p_entity->>'status'='pending' then 'approval.step_approved'
      else 'approval.'||case p_command when 'approve' then 'approved'
        when 'reject' then 'rejected' when 'return' then 'returned' else 'cancelled' end end,
    'approval',p_approval::text,p_request_id,null,jsonb_build_object(
      'outcome',p_outcome,'operation','act_on_current_approval','command',p_command,
      'resource','approval','requestId',p_request_id,
      'resultingStatus',case when p_outcome='success' then p_entity->>'status' else null end,
      'resultingVersion',case when p_outcome='success' then (p_entity->>'version')::bigint else null end,
      'currentStepOrder',case when p_outcome='success' then p_entity->'currentStepOrder' else null end,
      'entityDigest',case when p_outcome='success' then encode(
        public.digest(convert_to(p_entity::text,'UTF8'),'sha256'),'hex') else null end,
      'failure',case when p_outcome='failure' then p_error else null end
    )
  );
  return v_result;
end;
$$;

create or replace function public.normalize_approval_comment(p_comment text)
returns text
language sql
immutable
strict
set search_path=''
as $$
  select btrim(
    p_comment,
    E' \t\n\r\f'||chr(11)||U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'
  );
$$;

create or replace function public.act_on_current_approval(
  approval_public_id uuid,command text,expected_version integer,comment text,request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_tenant bigint; v_org bigint; v_actor_member bigint; v_user uuid;
  v_actor_employee bigint; v_actor_public uuid; v_claim jsonb;
  v_approval public.approvals%rowtype; v_current_step public.approval_steps%rowtype;
  v_next_step public.approval_steps%rowtype; v_action public.approval_actions%rowtype;
  v_participant boolean; v_has_later_step boolean; v_next_owner_public uuid;
  v_now timestamptz:=clock_timestamp(); v_failure text; v_entity jsonb; v_comment text;
begin
  if approval_public_id is null or command is null
     or command not in ('approve','reject','return','cancel')
     or expected_version is null or expected_version<1 or request_id is null
     or comment is not null and (
       length(public.normalize_approval_comment(comment))<1
       or length(public.normalize_approval_comment(comment))>500
     )
     or command in ('reject','return','cancel') and comment is null then
    raise exception 'Approval action is invalid' using errcode='22023';
  end if;
  v_comment:=case when comment is null then null else public.normalize_approval_comment(comment) end;
  select * into strict v_tenant,v_org,v_actor_member,v_user,v_actor_employee,v_actor_public
  from public.current_approval_actor_identity();
  v_claim:=public.claim_approval_action(
    v_tenant,v_org,v_actor_member,approval_public_id,command,expected_version,v_comment,request_id
  );
  if v_claim->>'state'='scope_conflict' then
    perform public.append_audit_log(
      v_tenant,v_org,v_user,v_actor_member,'approval.command_failed','approval',
      approval_public_id::text,request_id,null,jsonb_build_object(
        'outcome','failure','operation','act_on_current_approval','command',command,
        'resource','approval','requestId',request_id,'failure','scope_conflict'
      )
    );
    return jsonb_build_object('outcome','failure','error','scope_conflict');
  end if;
  if v_claim->>'state'='replay' then return v_claim->'result'; end if;

  select approval.* into v_approval from public.approvals approval
  where approval.tenant_id=v_tenant and approval.organization_id=v_org
    and approval.public_id=approval_public_id and approval.deleted_at is null
  for update;
  if not found then v_failure:='forbidden';
  else
    select step.* into v_current_step from public.approval_steps step
    where step.tenant_id=v_tenant and step.organization_id=v_org
      and step.approval_id=v_approval.id and step.step_order=v_approval.current_step_order
      and step.status='pending'
    for update;
    select v_approval.applicant_employee_id=v_actor_employee or exists(
      select 1 from public.approval_steps participant_step
      where participant_step.tenant_id=v_tenant and participant_step.organization_id=v_org
        and participant_step.approval_id=v_approval.id
        and participant_step.approver_employee_id=v_actor_employee
    ) into v_participant;
    if not v_participant then v_failure:='forbidden';
    elsif v_approval.version<>expected_version then v_failure:='conflict';
    elsif v_approval.status<>'pending' or v_current_step.id is null then v_failure:='invalid_state';
    elsif command='cancel' and v_approval.applicant_employee_id<>v_actor_employee then v_failure:='forbidden';
    elsif command<>'cancel' and (
      v_approval.applicant_employee_id=v_actor_employee
      or v_current_step.approver_employee_id<>v_actor_employee
    ) then v_failure:='forbidden';
    end if;
  end if;
  if v_failure is not null then
    return public.complete_approval_action(
      v_tenant,v_org,v_user,v_actor_member,approval_public_id,request_id,
      command,'failure',v_failure,null
    );
  end if;

  if command='approve' then
    select exists(select 1 from public.approval_steps step
      where step.tenant_id=v_tenant and step.organization_id=v_org
        and step.approval_id=v_approval.id and step.step_order>v_current_step.step_order
        and step.status='pending') into v_has_later_step;
    if v_has_later_step then
      select step.* into v_next_step from public.approval_steps step
      where step.tenant_id=v_tenant and step.organization_id=v_org
        and step.approval_id=v_approval.id and step.step_order>v_current_step.step_order
        and step.status='pending' order by step.step_order limit 1 for update;
      select profile.public_id into v_next_owner_public
      from public.employee_profiles profile
      join public.organization_members member on member.tenant_id=profile.tenant_id
        and member.organization_id=profile.organization_id
        and member.id=profile.organization_member_id and member.status='active'
      where profile.tenant_id=v_tenant and profile.organization_id=v_org
        and profile.id=v_next_step.approver_employee_id and profile.deleted_at is null
        and profile.employment_status in ('probation','active','on_leave')
      for share of profile,member;
      if not found then v_failure:='approver_unavailable'; end if;
    end if;
  end if;
  if v_failure is not null then
    return public.complete_approval_action(
      v_tenant,v_org,v_user,v_actor_member,approval_public_id,request_id,
      command,'failure',v_failure,null
    );
  end if;

  begin
    if command='approve' then
      update public.approval_steps step set status='approved',acted_at=v_now,comment=v_comment
      where step.tenant_id=v_tenant and step.organization_id=v_org and step.id=v_current_step.id;
      if v_has_later_step then
        update public.approvals approval set owner_employee_id=v_next_step.approver_employee_id,
          current_step=v_next_step.name,current_step_order=v_next_step.step_order,
          version=approval.version+1,updated_at=v_now
        where approval.tenant_id=v_tenant and approval.organization_id=v_org
          and approval.id=v_approval.id returning approval.* into v_approval;
      else
        update public.approvals approval set status='approved',owner_employee_id=null,
          current_step=null,current_step_order=null,completed_at=v_now,
          version=approval.version+1,updated_at=v_now
        where approval.tenant_id=v_tenant and approval.organization_id=v_org
          and approval.id=v_approval.id returning approval.* into v_approval;
      end if;
    elsif command='reject' then
      update public.approval_steps step set status='rejected',acted_at=v_now,comment=v_comment
      where step.tenant_id=v_tenant and step.organization_id=v_org and step.id=v_current_step.id;
      update public.approval_steps step set status='skipped'
      where step.tenant_id=v_tenant and step.organization_id=v_org
        and step.approval_id=v_approval.id and step.step_order>v_current_step.step_order
        and step.status='pending';
      update public.approvals approval set status='rejected',owner_employee_id=null,
        current_step=null,current_step_order=null,completed_at=v_now,
        version=approval.version+1,updated_at=v_now
      where approval.tenant_id=v_tenant and approval.organization_id=v_org
        and approval.id=v_approval.id returning approval.* into v_approval;
    elsif command='return' then
      update public.approval_steps step set status='returned',acted_at=v_now,comment=v_comment
      where step.tenant_id=v_tenant and step.organization_id=v_org and step.id=v_current_step.id;
      update public.approval_steps step set status='skipped'
      where step.tenant_id=v_tenant and step.organization_id=v_org
        and step.approval_id=v_approval.id and step.step_order>v_current_step.step_order
        and step.status='pending';
      update public.approvals approval set status='returned',owner_employee_id=null,
        current_step=null,current_step_order=null,completed_at=v_now,
        version=approval.version+1,updated_at=v_now
      where approval.tenant_id=v_tenant and approval.organization_id=v_org
        and approval.id=v_approval.id returning approval.* into v_approval;
    else
      update public.approval_steps step set status='skipped'
      where step.tenant_id=v_tenant and step.organization_id=v_org
        and step.approval_id=v_approval.id and step.status='pending';
      update public.approvals approval set status='cancelled',owner_employee_id=null,
        current_step=null,current_step_order=null,completed_at=v_now,
        version=approval.version+1,updated_at=v_now
      where approval.tenant_id=v_tenant and approval.organization_id=v_org
        and approval.id=v_approval.id returning approval.* into v_approval;
    end if;
    insert into public.approval_actions(
      tenant_id,organization_id,approval_id,actor_employee_id,action_type,content,created_at
    ) values(
      v_tenant,v_org,v_approval.id,v_actor_employee,command,v_comment,v_now
    ) returning * into v_action;
  exception when others then
    v_failure:='command_failed';
  end;
  if v_failure is not null then
    return public.complete_approval_action(
      v_tenant,v_org,v_user,v_actor_member,approval_public_id,request_id,
      command,'failure',v_failure,null
    );
  end if;
  if v_approval.owner_employee_id is not null then
    select profile.public_id into strict v_next_owner_public
    from public.employee_profiles profile where profile.tenant_id=v_tenant
      and profile.organization_id=v_org and profile.id=v_approval.owner_employee_id;
  else v_next_owner_public:=null;
  end if;
  v_entity:=jsonb_build_object(
    'id',v_approval.public_id,'version',v_approval.version,'status',v_approval.status,
    'currentStep',v_approval.current_step,'currentStepOrder',v_approval.current_step_order,
    'ownerEmployeeId',v_next_owner_public,'completedAt',v_approval.completed_at,
    'lastAction',jsonb_build_object(
      'type',v_action.action_type,'comment',v_action.content,'actedAt',v_action.created_at
    )
  );
  return public.complete_approval_action(
    v_tenant,v_org,v_user,v_actor_member,approval_public_id,request_id,
    command,'success',null,v_entity
  );
exception when no_data_found then
  raise exception 'Approval action identity unavailable' using errcode='42501';
end;
$$;

create or replace function public.reject_approval_action_mutation()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  raise exception 'Approval actions are append-only' using errcode='42501';
end;
$$;
create trigger approval_actions_reject_mutation
before update or delete on public.approval_actions
for each row execute function public.reject_approval_action_mutation();
create trigger approval_actions_reject_truncate
before truncate on public.approval_actions
for each statement execute function public.reject_approval_action_mutation();

revoke all on table public.approval_action_idempotency from public,anon,authenticated,service_role;
revoke all on function public.current_approval_actor_identity() from public,anon,authenticated,service_role;
revoke all on function public.claim_approval_action(bigint,bigint,bigint,uuid,text,bigint,text,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.complete_approval_action(bigint,bigint,uuid,bigint,uuid,uuid,text,text,text,jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.reject_approval_action_mutation()
  from public,anon,authenticated,service_role;
revoke all on function public.normalize_approval_comment(text)
  from public,anon,authenticated,service_role;
revoke all on function public.act_on_current_approval(uuid,text,integer,text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.act_on_current_approval(uuid,text,integer,text,uuid)
  to authenticated;
