-- Tenant-safe, idempotent expense reimbursement linked to verified files and approvals.

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
  'expense.draft_created', 'expense.draft_updated', 'expense.submitted',
  'expense.cancelled', 'expense.paid', 'expense.command_failed',
  'payroll_policy.activated', 'payroll.calculated', 'payroll.confirmed',
  'ai.config.updated', 'organization.department_created',
  'organization.department_updated', 'organization.position_upserted',
  'organization.role_assigned', 'organization.command_failed',
  'organization.manager_assigned', 'directory.manager_mapped',
  'employee_skill.verified', 'employee_skill.verification_failed',
  'directory.sync_issue_resolved'
));

insert into public.permissions(code,name,module,action)
values ('expense.submit','提交费用报销','expenses','submit')
on conflict(code) do update set name=excluded.name,module=excluded.module,action=excluded.action;

create or replace function public.is_expense_baseline_role(
  p_is_system boolean,p_is_enabled boolean,p_organization_id bigint,p_code text,p_permission text
)
returns boolean
language sql
immutable
set search_path=''
as $$
  select coalesce(p_is_system,false) and coalesce(p_is_enabled,false)
    and p_organization_id is null and (
      (p_permission='expense.submit' and p_code in (
        'owner','admin','department_head','supervisor','employee','finance','hr'
      ))
      or (p_permission='expense.manage' and p_code in ('owner','admin','finance'))
    );
$$;

create or replace function public.revoke_expense_permissions_before_role_update()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  delete from public.role_permissions assignment using public.permissions permission
  where assignment.tenant_id=old.tenant_id and assignment.role_id=old.id
    and assignment.permission_id=permission.id
    and permission.code in ('expense.submit','expense.manage')
    and public.is_expense_baseline_role(
      old.is_system,old.is_enabled,old.organization_id,old.code,permission.code
    );
  return new;
end;
$$;

create or replace function public.grant_expense_permissions_after_role_change()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  insert into public.role_permissions(tenant_id,role_id,permission_id)
  select new.tenant_id,new.id,permission.id from public.permissions permission
  where permission.code in ('expense.submit','expense.manage')
    and public.is_expense_baseline_role(
      new.is_system,new.is_enabled,new.organization_id,new.code,permission.code
    )
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists roles_expense_permissions_before_update on public.roles;
drop trigger if exists roles_expense_permissions_after_insert on public.roles;
drop trigger if exists roles_expense_permissions_after_update on public.roles;
create trigger roles_expense_permissions_before_update
before update of tenant_id,is_system,is_enabled,organization_id,code on public.roles
for each row execute function public.revoke_expense_permissions_before_role_update();
create trigger roles_expense_permissions_after_insert
after insert on public.roles
for each row execute function public.grant_expense_permissions_after_role_change();
create trigger roles_expense_permissions_after_update
after update of tenant_id,is_system,is_enabled,organization_id,code on public.roles
for each row execute function public.grant_expense_permissions_after_role_change();

insert into public.role_permissions(tenant_id,role_id,permission_id)
select role.tenant_id,role.id,permission.id
from public.roles role cross join public.permissions permission
where permission.code in ('expense.submit','expense.manage')
  and public.is_expense_baseline_role(
    role.is_system,role.is_enabled,role.organization_id,role.code,permission.code
  )
on conflict do nothing;

alter table public.employee_profiles
  add constraint employee_profiles_tenant_organization_id_key
  unique(tenant_id,organization_id,id);

alter table public.expense_reports
  add column version bigint not null default 1,
  add column paid_by_member_id bigint,
  add column payment_reference text,
  add column payment_evidence_status text,
  add column cancelled_at timestamptz,
  add column cancellation_reason text,
  add constraint expense_reports_tenant_organization_id_key unique(tenant_id,organization_id,id),
  add constraint expense_reports_version_check check(version>0),
  add constraint expense_reports_paid_by_fkey foreign key(tenant_id,organization_id,paid_by_member_id)
    references public.organization_members(tenant_id,organization_id,id) on delete restrict,
  add constraint expense_reports_payment_reference_check check(
    payment_reference is null or length(btrim(payment_reference)) between 1 and 120
  ),
  add constraint expense_reports_payment_evidence_status_check check(
    payment_evidence_status is null or payment_evidence_status in ('verified','legacy_unverified')
  ),
  add constraint expense_reports_cancellation_reason_check check(
    cancellation_reason is null or length(btrim(cancellation_reason)) between 1 and 500
  );

alter table public.expense_reports drop constraint if exists expense_reports_status_check;
alter table public.expense_reports add constraint expense_reports_status_check check(
  status in ('draft','submitted','approved','rejected','paid','cancelled')
);
alter table public.expense_reports drop constraint if exists expense_reports_check;
update public.expense_reports expense set payment_evidence_status='legacy_unverified'
where expense.status='paid';
alter table public.expense_reports add constraint expense_reports_terminal_state_check check(
  (status='paid' and cancelled_at is null and cancellation_reason is null and (
    (payment_evidence_status='verified' and paid_at is not null
      and paid_by_member_id is not null and payment_reference is not null)
    or (payment_evidence_status='legacy_unverified'
      and paid_by_member_id is null and payment_reference is null)
  ))
  or (status='cancelled' and paid_at is null and paid_by_member_id is null
    and payment_reference is null and payment_evidence_status is null
    and cancelled_at is not null and cancellation_reason is not null)
  or (status not in ('paid','cancelled') and paid_at is null and paid_by_member_id is null
    and payment_reference is null and payment_evidence_status is null
    and cancelled_at is null and cancellation_reason is null)
);

create or replace function public.is_valid_expense_approval_evidence(
  p_tenant bigint,p_organization bigint,p_approval bigint,p_statuses text[]
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists(
    select 1 from public.approvals approval
    left join public.approval_templates template on template.tenant_id=approval.tenant_id
      and template.organization_id=approval.organization_id and template.id=approval.template_id
    where approval.tenant_id=p_tenant and approval.organization_id=p_organization
      and approval.id=p_approval and approval.deleted_at is null
      and approval.status=any(coalesce(p_statuses,'{}'::text[]))
      and approval.approval_type='reimbursement'
      and (approval.template_id is null or template.template_key='expense_reimbursement')
  );
$$;

do $expense_workflow_backfill_preflight$
begin
  if exists(
    select 1 from public.expense_reports expense
    left join public.approvals approval on approval.organization_id=expense.organization_id
      and approval.id=expense.approval_id
    where expense.status in ('draft','submitted','approved','rejected') and (
      (expense.status='draft' and (
        expense.approval_id is not null or expense.owner_employee_id is not null
      ))
      or (expense.status='submitted' and (
        not public.is_valid_expense_approval_evidence(
          expense.tenant_id,expense.organization_id,expense.approval_id,array['pending']
        )
        or approval.applicant_employee_id<>expense.requester_employee_id
        or expense.owner_employee_id is distinct from approval.owner_employee_id
      ))
      or (expense.status='approved' and (
        not public.is_valid_expense_approval_evidence(
          expense.tenant_id,expense.organization_id,expense.approval_id,array['approved']
        )
        or approval.applicant_employee_id<>expense.requester_employee_id
        or expense.owner_employee_id is not null
      ))
      or (expense.status='rejected' and (
        not public.is_valid_expense_approval_evidence(
          expense.tenant_id,expense.organization_id,expense.approval_id,array['rejected','returned']
        )
        or approval.applicant_employee_id<>expense.requester_employee_id
        or expense.owner_employee_id is not null
      ))
    )
  ) then
    raise exception using
      message='Historical active expense workflow facts require reconciliation before upgrade',
      hint='Repair draft/submitted/approved/rejected approval links and owners, then re-run the migration';
  end if;
end;
$expense_workflow_backfill_preflight$;

alter table public.expense_reports
  add constraint expense_reports_exact_approval_fkey
    foreign key(tenant_id,organization_id,approval_id)
    references public.approvals(tenant_id,organization_id,id) on delete restrict,
  add constraint expense_reports_exact_requester_fkey
    foreign key(tenant_id,organization_id,requester_employee_id)
    references public.employee_profiles(tenant_id,organization_id,id) on delete restrict,
  add constraint expense_reports_exact_owner_fkey
    foreign key(tenant_id,organization_id,owner_employee_id)
    references public.employee_profiles(tenant_id,organization_id,id) on delete restrict,
  add constraint expense_reports_exact_project_fkey
    foreign key(tenant_id,organization_id,project_id)
    references public.projects(tenant_id,organization_id,id) on delete restrict;

create table public.expense_receipts(
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete restrict,
  organization_id bigint not null,
  expense_id bigint not null,
  file_id bigint not null,
  created_by_member_id bigint not null,
  created_at timestamptz not null default clock_timestamp(),
  unique(tenant_id,organization_id,id),
  unique(tenant_id,expense_id,file_id),
  foreign key(tenant_id,organization_id)
    references public.organizations(tenant_id,id) on delete restrict,
  constraint expense_receipts_exact_expense_fkey
    foreign key(tenant_id,organization_id,expense_id)
    references public.expense_reports(tenant_id,organization_id,id) on delete restrict,
  constraint expense_receipts_exact_file_fkey
    foreign key(tenant_id,organization_id,file_id)
    references public.files(tenant_id,organization_id,id) on delete restrict,
  foreign key(tenant_id,organization_id,created_by_member_id)
    references public.organization_members(tenant_id,organization_id,id) on delete restrict
);
create index expense_receipts_expense_idx
  on public.expense_receipts(tenant_id,organization_id,expense_id,created_at);
create index expense_receipts_file_idx
  on public.expense_receipts(tenant_id,organization_id,file_id);

insert into public.expense_receipts(
  tenant_id,organization_id,expense_id,file_id,created_by_member_id,created_at
)
select expense.tenant_id,expense.organization_id,expense.id,files.id,files.uploaded_by_member_id,
  expense.created_at
from public.expense_reports expense
cross join lateral unnest(expense.receipt_file_ids) receipt(raw_id)
join public.employee_profiles requester on requester.tenant_id=expense.tenant_id
  and requester.organization_id=expense.organization_id
  and requester.id=expense.requester_employee_id and requester.deleted_at is null
join public.files files on files.tenant_id=expense.tenant_id
  and files.organization_id=expense.organization_id
  and files.public_id::text=receipt.raw_id
  and expense.project_id is not null and files.project_id=expense.project_id
  and files.uploaded_by_member_id=requester.organization_member_id
  and files.verified_at is not null and files.deleted_at is null
  and (files.mime_type='application/pdf' or files.mime_type like 'image/%')
on conflict do nothing;

do $expense_receipt_backfill_preflight$
begin
  if exists(
    select 1 from public.expense_reports expense
    where cardinality(expense.receipt_file_ids)<>(
      select count(*) from public.expense_receipts receipt
      where receipt.tenant_id=expense.tenant_id and receipt.organization_id=expense.organization_id
        and receipt.expense_id=expense.id
    )
  ) then
    raise exception 'Historical expense receipts must be verified and project-scoped before upgrade';
  end if;
end;
$expense_receipt_backfill_preflight$;

create table public.expense_command_idempotency(
  tenant_id bigint not null references public.tenants(id) on delete restrict,
  organization_id bigint not null,
  actor_member_id bigint not null,
  operation text not null check(operation in (
    'create_current_expense','update_current_expense','submit_current_expense',
    'mark_current_expense_paid','cancel_current_expense'
  )),
  idempotency_key uuid not null,
  target_public_id uuid not null,
  payload_digest text not null check(payload_digest~'^[0-9a-f]{64}$'),
  request_id uuid not null,
  result jsonb,
  created_at timestamptz not null default clock_timestamp(),
  primary key(tenant_id,operation,idempotency_key),
  foreign key(tenant_id,organization_id)
    references public.organizations(tenant_id,id) on delete restrict,
  foreign key(tenant_id,organization_id,actor_member_id)
    references public.organization_members(tenant_id,organization_id,id) on delete restrict
);

alter table public.expense_receipts enable row level security;
alter table public.expense_receipts force row level security;
alter table public.expense_command_idempotency enable row level security;
alter table public.expense_command_idempotency force row level security;

create or replace function public.current_expense_command_identity(p_permission text)
returns table(
  tenant_id bigint,organization_id bigint,actor_member_id bigint,actor_auth_user_id uuid,
  actor_employee_id bigint,actor_employee_public_id uuid
)
language plpgsql
security definer
set search_path=''
as $$
begin
  if p_permission not in ('expense.submit','expense.manage') or (select auth.uid()) is null then
    raise exception 'Expense command permission required' using errcode='42501';
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
      join public.roles role on role.tenant_id=assignment.tenant_id
        and role.id=assignment.role_id and role.is_enabled
      join public.role_permissions role_grant on role_grant.tenant_id=assignment.tenant_id
        and role_grant.role_id=assignment.role_id
      join public.permissions permission on permission.id=role_grant.permission_id
      where assignment.tenant_id=member.tenant_id and assignment.member_id=member.id
        and (role.organization_id is null or role.organization_id=member.organization_id)
        and permission.code=p_permission)
  limit 1 for share of external,provider,tenant,organization,member,profile;
  if not found then
    raise exception 'Expense command permission required' using errcode='42501';
  end if;
end;
$$;

create or replace function public.can_read_current_expense(
  p_tenant bigint,p_organization bigint,p_expense bigint
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists(
    select 1 from public.expense_reports expense
    join public.external_identities external on external.tenant_id=expense.tenant_id
      and external.organization_id=expense.organization_id
      and external.auth_user_id=(select auth.uid()) and external.status='active'
    join public.identity_providers provider on provider.tenant_id=external.tenant_id
      and provider.id=external.identity_provider_id and provider.status='active'
    join public.tenants tenant on tenant.id=external.tenant_id and tenant.status='active'
    join public.organization_members member on member.tenant_id=external.tenant_id
      and member.organization_id=external.organization_id
      and member.id=external.organization_member_id
      and member.user_id=(select auth.uid()) and member.status='active'
    join public.employee_profiles profile on profile.tenant_id=member.tenant_id
      and profile.organization_id=member.organization_id
      and profile.organization_member_id=member.id and profile.deleted_at is null
      and profile.employment_status in ('probation','active','on_leave')
    where expense.tenant_id=p_tenant and expense.organization_id=p_organization
      and expense.id=p_expense and expense.deleted_at is null
      and (
        profile.id in (expense.requester_employee_id,expense.owner_employee_id)
        or exists(select 1 from public.approval_steps step
          where step.tenant_id=expense.tenant_id and step.organization_id=expense.organization_id
            and step.approval_id=expense.approval_id and step.approver_employee_id=profile.id)
        or exists(select 1 from public.member_roles assignment
          join public.roles role on role.tenant_id=assignment.tenant_id
            and role.id=assignment.role_id and role.is_enabled
          join public.role_permissions role_grant on role_grant.tenant_id=assignment.tenant_id
            and role_grant.role_id=assignment.role_id
          join public.permissions permission on permission.id=role_grant.permission_id
          where assignment.tenant_id=member.tenant_id and assignment.member_id=member.id
            and (role.organization_id is null or role.organization_id=member.organization_id)
            and permission.code='expense.manage')
      )
  );
$$;

drop policy if exists expense_reports_member_select on public.expense_reports;
drop policy if exists expense_reports_self_insert on public.expense_reports;
drop policy if exists expense_reports_owner_update on public.expense_reports;
create policy expense_reports_exact_participant_select on public.expense_reports
for select to authenticated using(
  (select public.can_read_current_expense(tenant_id,organization_id,id))
);
create policy expense_receipts_exact_participant_select on public.expense_receipts
for select to authenticated using(
  (select public.can_read_current_expense(tenant_id,organization_id,expense_id))
);

create or replace function public.claim_expense_command(
  p_tenant bigint,p_organization bigint,p_actor bigint,p_operation text,p_target uuid,
  p_payload jsonb,p_idempotency_key uuid,p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_target uuid:=coalesce(p_target,gen_random_uuid());
  v_digest text:=encode(public.digest(convert_to(p_payload::text,'UTF8'),'sha256'),'hex');
  v_org bigint; v_actor bigint; v_stored_target uuid; v_stored_digest text; v_result jsonb;
begin
  insert into public.expense_command_idempotency(
    tenant_id,organization_id,actor_member_id,operation,idempotency_key,target_public_id,
    payload_digest,request_id
  ) values(
    p_tenant,p_organization,p_actor,p_operation,p_idempotency_key,v_target,v_digest,p_request_id
  ) on conflict(tenant_id,operation,idempotency_key) do nothing;
  select ledger.organization_id,ledger.actor_member_id,ledger.target_public_id,
    ledger.payload_digest,ledger.result
  into strict v_org,v_actor,v_stored_target,v_stored_digest,v_result
  from public.expense_command_idempotency ledger
  where ledger.tenant_id=p_tenant and ledger.operation=p_operation
    and ledger.idempotency_key=p_idempotency_key for update;
  if v_org<>p_organization or v_actor<>p_actor
     or (p_target is not null and v_stored_target<>p_target)
     or v_stored_digest<>v_digest then
    return jsonb_build_object('state','scope_conflict');
  end if;
  if v_result is not null then return jsonb_build_object('state','replay','result',v_result); end if;
  return jsonb_build_object('state','claimed','targetPublicId',v_stored_target);
end;
$$;

create or replace function public.expense_command_entity(
  p_tenant bigint,p_organization bigint,p_expense bigint
)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  select jsonb_build_object(
    'id',expense.public_id,'version',expense.version,'expenseCode',expense.expense_code,
    'status',expense.status,'projectId',project.public_id,'expenseType',expense.expense_type,
    'amount',expense.amount::text,'currency',expense.currency,'expenseDate',expense.expense_date,
    'description',expense.description,'receiptFileIds',coalesce((
      select jsonb_agg(files.public_id order by receipt.id)
      from public.expense_receipts receipt join public.files files
        on files.tenant_id=receipt.tenant_id and files.organization_id=receipt.organization_id
        and files.id=receipt.file_id
      where receipt.tenant_id=expense.tenant_id and receipt.organization_id=expense.organization_id
        and receipt.expense_id=expense.id
    ),'[]'::jsonb),'approvalId',approval.public_id,'ownerEmployeeId',owner.public_id,
    'paidAt',expense.paid_at,'paymentReference',expense.payment_reference,
    'updatedAt',expense.updated_at
  )
  from public.expense_reports expense
  left join public.projects project on project.tenant_id=expense.tenant_id
    and project.organization_id=expense.organization_id and project.id=expense.project_id
  left join public.approvals approval on approval.tenant_id=expense.tenant_id
    and approval.organization_id=expense.organization_id and approval.id=expense.approval_id
  left join public.employee_profiles owner on owner.tenant_id=expense.tenant_id
    and owner.organization_id=expense.organization_id and owner.id=expense.owner_employee_id
  where expense.tenant_id=p_tenant and expense.organization_id=p_organization
    and expense.id=p_expense;
$$;

create or replace function public.complete_expense_command(
  p_tenant bigint,p_organization bigint,p_user uuid,p_actor bigint,p_operation text,
  p_target uuid,p_request_id uuid,p_idempotency_key uuid,p_outcome text,p_error text,
  p_entity jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare v_result jsonb; v_action text;
begin
  v_result:=case when p_outcome='success' then jsonb_build_object(
    'outcome','success','resource','expense','id',p_target,
    'version',(p_entity->>'version')::bigint,'entity',p_entity
  ) else jsonb_build_object('outcome','failure','error',p_error) end;
  update public.expense_command_idempotency ledger set result=v_result
  where ledger.tenant_id=p_tenant and ledger.organization_id=p_organization
    and ledger.actor_member_id=p_actor and ledger.operation=p_operation
    and ledger.idempotency_key=p_idempotency_key;
  if not found then raise exception 'Expense command ledger completion failed' using errcode='P0001'; end if;
  v_action:=case when p_outcome='failure' then 'expense.command_failed'
    when p_operation='create_current_expense' then 'expense.draft_created'
    when p_operation='update_current_expense' then 'expense.draft_updated'
    when p_operation='submit_current_expense' then 'expense.submitted'
    when p_operation='mark_current_expense_paid' then 'expense.paid'
    else 'expense.cancelled' end;
  perform public.append_audit_log(
    p_tenant,p_organization,p_user,p_actor,v_action,'expense',p_target::text,p_request_id,null,
    jsonb_build_object(
      'outcome',p_outcome,'operation',p_operation,'resource','expense','requestId',p_request_id,
      'resultingStatus',case when p_outcome='success' then p_entity->>'status' else null end,
      'resultingVersion',case when p_outcome='success' then (p_entity->>'version')::bigint else null end,
      'entityDigest',case when p_outcome='success' then encode(
        public.digest(convert_to(p_entity::text,'UTF8'),'sha256'),'hex') else null end,
      'failure',case when p_outcome='failure' then p_error else null end
    )
  );
  return v_result;
end;
$$;

create or replace function public.valid_expense_receipts(
  p_tenant bigint,p_organization bigint,p_actor bigint,p_project bigint,p_file_ids uuid[]
)
returns boolean
language plpgsql
volatile
security definer
set search_path=''
as $$
declare v_count integer;
begin
  select count(*)::integer into v_count from (
      select files.id from public.files files
      where files.tenant_id=p_tenant and files.organization_id=p_organization
        and files.public_id=any(coalesce(p_file_ids,'{}'::uuid[]))
        and files.project_id=p_project and p_project is not null
        and files.uploaded_by_member_id=p_actor and files.verified_at is not null
        and files.deleted_at is null and files.size_bytes>0
        and (files.mime_type='application/pdf' or files.mime_type like 'image/%')
      for share of files
  ) locked_files;
  return coalesce(cardinality(p_file_ids),0)<=20
    and coalesce(cardinality(p_file_ids),0)=coalesce(v_count,0);
end;
$$;

create or replace function public.replace_expense_receipts(
  p_tenant bigint,p_organization bigint,p_actor bigint,p_expense bigint,p_file_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  perform set_config('quantxy.expense_command','on',true);
  delete from public.expense_receipts receipt
  where receipt.tenant_id=p_tenant and receipt.organization_id=p_organization
    and receipt.expense_id=p_expense;
  insert into public.expense_receipts(
    tenant_id,organization_id,expense_id,file_id,created_by_member_id
  )
  select p_tenant,p_organization,p_expense,files.id,p_actor
  from unnest(coalesce(p_file_ids,'{}'::uuid[])) requested(public_id)
  join public.files files on files.tenant_id=p_tenant and files.organization_id=p_organization
    and files.public_id=requested.public_id
  order by array_position(p_file_ids,files.public_id);
end;
$$;

create or replace function public.normalize_expense_text(p_value text)
returns text
language sql
immutable
strict
set search_path=''
as $$
  select btrim(
    p_value,
    E' \t\n\r\f'||chr(11)||U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'
  );
$$;

create or replace function public.is_valid_expense_input(
  p_type text,p_amount text,p_date date,p_description text,p_file_ids uuid[]
)
returns boolean
language sql
immutable
set search_path=''
as $$
  select case when p_type in ('travel','meal','transport','office','other')
    and p_amount is not null
    and p_amount~'^(0\.(0[1-9]|[1-9][0-9]?)|[1-9][0-9]{0,11}(\.[0-9]{1,2})?)$'
    and p_date is not null and isfinite(p_date) and p_description is not null
    and length(public.normalize_expense_text(p_description)) between 1 and 500
    and coalesce(cardinality(p_file_ids),0)<=20
    and coalesce(cardinality(p_file_ids),0)=coalesce((
      select count(distinct value) from unnest(coalesce(p_file_ids,'{}'::uuid[])) value
    ),0)
  then p_amount::numeric>0 and p_amount::numeric<1000000000000::numeric
  else false end;
$$;

create or replace function public.expense_child_uuid(p_key uuid,p_domain text)
returns uuid
language sql
immutable
strict
set search_path=''
as $$ select md5(p_domain||':'||p_key::text)::uuid $$;

create or replace function public.enforce_expense_command_mutation()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if current_setting('quantxy.expense_command',true) is distinct from 'on' then
    raise exception 'Expense reports are command-owned' using errcode='42501';
  end if;
  if tg_op='DELETE' then
    raise exception 'Expense reports cannot be deleted' using errcode='42501';
  end if;
  if old.status in ('paid','cancelled') then
    raise exception 'Completed expense reports are immutable' using errcode='42501';
  end if;
  if new.tenant_id<>old.tenant_id or new.organization_id<>old.organization_id
     or new.requester_employee_id<>old.requester_employee_id
     or new.project_id is distinct from old.project_id
     or new.expense_code<>old.expense_code or new.currency<>old.currency
     or new.created_at<>old.created_at then
    raise exception 'Expense ownership fields are immutable' using errcode='42501';
  end if;
  return new;
end;
$$;

-- Reuse the approval transaction without requiring an expense-only caller to
-- also receive the broader approval.submit permission. This helper is owner-
-- only and accepts an identity that an outer command already resolved.
create or replace function public.submit_approval_for_command_identity(
  p_tenant bigint,p_organization bigint,p_actor_member bigint,p_actor_user uuid,
  p_applicant_employee bigint,template_public_id uuid,form_data jsonb,
  idempotency_key uuid,request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_claim jsonb; v_template public.approval_templates%rowtype;
  v_applicant public.employee_profiles%rowtype; v_step record; v_rule jsonb;
  v_approver bigint; v_steps jsonb:='[]'::jsonb; v_first_approver bigint;
  v_approval public.approvals%rowtype; v_target uuid;
  v_now timestamptz:=clock_timestamp(); v_failure text; v_entity jsonb;
begin
  if (select auth.uid()) is distinct from p_actor_user or not exists(
    select 1 from public.tenants tenant
    join public.organizations organization on organization.tenant_id=tenant.id
      and organization.id=p_organization
    join public.organization_members member on member.tenant_id=tenant.id
      and member.organization_id=organization.id and member.id=p_actor_member
      and member.user_id=p_actor_user and member.status='active'
    join public.employee_profiles profile on profile.tenant_id=tenant.id
      and profile.organization_id=organization.id and profile.id=p_applicant_employee
      and profile.organization_member_id=member.id and profile.deleted_at is null
      and profile.employment_status in ('probation','active','on_leave')
    join public.external_identities external on external.tenant_id=tenant.id
      and external.organization_id=organization.id and external.organization_member_id=member.id
      and external.auth_user_id=p_actor_user and external.status='active'
    join public.identity_providers provider on provider.tenant_id=external.tenant_id
      and provider.id=external.identity_provider_id and provider.status='active'
    where tenant.id=p_tenant and tenant.status='active'
  ) then
    raise exception 'Approval command identity unavailable' using errcode='42501';
  end if;
  if template_public_id is null or form_data is null
     or jsonb_typeof(form_data) is distinct from 'object'
     or idempotency_key is null or request_id is null or idempotency_key=request_id then
    raise exception 'Approval submission is invalid' using errcode='22023';
  end if;
  v_claim:=public.claim_approval_command(
    p_tenant,p_organization,p_actor_member,'submit_current_approval',
    jsonb_build_object('templateId',template_public_id,'formData',form_data),
    idempotency_key,request_id
  );
  if v_claim->>'state'='scope_conflict' then
    perform public.append_audit_log(
      p_tenant,p_organization,p_actor_user,p_actor_member,
      'approval.command_failed','approval',null,request_id,null,
      jsonb_build_object(
        'outcome','failure','failure','scope_conflict','requestId',request_id
      )
    );
    return jsonb_build_object('outcome','failure','error','scope_conflict');
  end if;
  if v_claim->>'state'='replay' then return v_claim->'result'; end if;
  v_target:=(v_claim->>'targetPublicId')::uuid;
  select * into v_template from public.approval_templates template
  where template.tenant_id=p_tenant and template.organization_id=p_organization
    and template.public_id=template_public_id and template.is_active for share;
  if not found then v_failure:='template_not_found';
  elsif not public.is_valid_approval_form(v_template.form_schema,form_data) then
    v_failure:='invalid_form';
  end if;
  if v_failure is not null then
    return public.complete_approval_submission(
      p_tenant,p_organization,p_actor_user,p_actor_member,v_target,request_id,
      idempotency_key,'failure',v_failure,null
    );
  end if;
  select profile.* into strict v_applicant from public.employee_profiles profile
  join public.organization_members applicant_member
    on applicant_member.tenant_id=profile.tenant_id
    and applicant_member.organization_id=profile.organization_id
    and applicant_member.id=profile.organization_member_id
    and applicant_member.status='active'
  where profile.tenant_id=p_tenant and profile.organization_id=p_organization
    and profile.id=p_applicant_employee and profile.deleted_at is null
    and profile.employment_status in ('probation','active','on_leave')
  for share of profile,applicant_member;
  for v_step in
    select value,ordinality
    from jsonb_array_elements(v_template.step_definitions) with ordinality
  loop
    v_rule:=v_step.value->'approverRule'; v_approver:=null;
    if v_rule->>'kind'='applicant_manager' then
      select manager.id into v_approver from public.employee_profiles manager
      join public.organization_members manager_member
        on manager_member.tenant_id=manager.tenant_id
        and manager_member.organization_id=manager.organization_id
        and manager_member.id=manager.organization_member_id
        and manager_member.status='active'
      where manager.tenant_id=p_tenant and manager.organization_id=p_organization
        and manager.id=v_applicant.manager_employee_id and manager.deleted_at is null
        and manager.employment_status in ('probation','active','on_leave')
      for share of manager,manager_member;
    elsif v_rule->>'kind'='employee' then
      select employee.id into v_approver from public.employee_profiles employee
      join public.organization_members employee_member
        on employee_member.tenant_id=employee.tenant_id
        and employee_member.organization_id=employee.organization_id
        and employee_member.id=employee.organization_member_id
        and employee_member.status='active'
      where employee.tenant_id=p_tenant and employee.organization_id=p_organization
        and employee.public_id=(v_rule->>'employeePublicId')::uuid
        and employee.deleted_at is null
        and employee.employment_status in ('probation','active','on_leave')
      for share of employee,employee_member;
    elsif v_rule->>'kind'='role' then
      select employee.id into v_approver from public.roles role
      join public.member_roles assignment on assignment.tenant_id=role.tenant_id
        and assignment.role_id=role.id
      join public.organization_members member on member.tenant_id=assignment.tenant_id
        and member.id=assignment.member_id and member.organization_id=p_organization
        and member.status='active'
      join public.employee_profiles employee on employee.tenant_id=member.tenant_id
        and employee.organization_id=member.organization_id
        and employee.organization_member_id=member.id and employee.deleted_at is null
        and employee.employment_status in ('probation','active','on_leave')
      where role.tenant_id=p_tenant
        and (role.organization_id is null or role.organization_id=p_organization)
        and role.code=v_rule->>'roleCode' and role.is_enabled
        and employee.id<>p_applicant_employee
      order by employee.id limit 1 for share of role,assignment,member,employee;
    end if;
    if v_approver is null or v_approver=p_applicant_employee then
      v_failure:='approver_unavailable'; exit;
    end if;
    if v_step.ordinality=1 then v_first_approver:=v_approver; end if;
    v_steps:=v_steps||jsonb_build_array(jsonb_build_object(
      'order',v_step.ordinality,'name',v_step.value->>'name','approverId',v_approver
    ));
  end loop;
  if v_failure is not null then
    return public.complete_approval_submission(
      p_tenant,p_organization,p_actor_user,p_actor_member,v_target,request_id,
      idempotency_key,'failure',v_failure,null
    );
  end if;
  begin
    insert into public.approvals(
      public_id,tenant_id,organization_id,applicant_employee_id,owner_employee_id,
      approval_code,approval_type,title,summary,form_data,current_step,current_step_order,
      status,submitted_at,template_id,template_version,version,created_at,updated_at
    ) values(
      v_target,p_tenant,p_organization,p_applicant_employee,v_first_approver,
      'AP-'||upper(substr(replace(v_target::text,'-',''),1,20)),
      v_template.approval_type,v_template.title,v_template.description,form_data,
      v_steps->0->>'name',1,'pending',v_now,v_template.id,v_template.version,1,v_now,v_now
    ) returning * into v_approval;
    insert into public.approval_steps(
      tenant_id,organization_id,approval_id,step_order,name,
      approver_employee_id,status,created_at
    ) select p_tenant,p_organization,v_approval.id,(step->>'order')::integer,
      step->>'name',(step->>'approverId')::bigint,'pending',v_now
    from jsonb_array_elements(v_steps) step;
    insert into public.approval_actions(
      tenant_id,organization_id,approval_id,actor_employee_id,action_type,content,created_at
    ) values(
      p_tenant,p_organization,v_approval.id,p_applicant_employee,'submit',null,v_now
    );
  exception when others then
    v_failure:='command_failed';
  end;
  if v_failure is not null then
    return public.complete_approval_submission(
      p_tenant,p_organization,p_actor_user,p_actor_member,v_target,request_id,
      idempotency_key,'failure',v_failure,null
    );
  end if;
  v_entity:=jsonb_build_object(
    'id',v_approval.public_id,'version',v_approval.version,
    'approvalCode',v_approval.approval_code,'approvalType',v_approval.approval_type,
    'title',v_approval.title,'status',v_approval.status,
    'currentStep',v_approval.current_step,'templateId',v_template.public_id,
    'templateVersion',v_template.version,'submittedAt',v_approval.submitted_at
  );
  return public.complete_approval_submission(
    p_tenant,p_organization,p_actor_user,p_actor_member,v_target,request_id,
    idempotency_key,'success',null,v_entity
  );
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
  v_tenant bigint; v_organization bigint; v_actor bigint; v_user uuid;
  v_employee bigint; v_employee_public uuid;
begin
  select * into v_tenant,v_organization,v_actor,v_user,v_employee,v_employee_public
  from public.current_approval_command_identity('approval.submit');
  return public.submit_approval_for_command_identity(
    v_tenant,v_organization,v_actor,v_user,v_employee,
    template_public_id,form_data,idempotency_key,request_id
  );
end;
$$;

revoke all on function public.submit_approval_for_command_identity(
  bigint,bigint,bigint,uuid,bigint,uuid,jsonb,uuid,uuid
) from public,anon,authenticated,service_role;

create or replace function public.submit_current_expense(
  expense_public_id uuid,expected_version integer,idempotency_key uuid,request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_tenant bigint; v_org bigint; v_actor bigint; v_user uuid; v_employee bigint; v_employee_public uuid;
  v_claim jsonb; v_expense public.expense_reports%rowtype; v_template public.approval_templates%rowtype;
  v_approval public.approvals%rowtype; v_approval_result jsonb; v_failure text; v_entity jsonb;
  v_now timestamptz:=clock_timestamp(); v_form jsonb;
begin
  if expense_public_id is null or expected_version is null or expected_version<1
     or idempotency_key is null or request_id is null or idempotency_key=request_id then
    raise exception 'Expense submission is invalid' using errcode='22023';
  end if;
  select * into strict v_tenant,v_org,v_actor,v_user,v_employee,v_employee_public
  from public.current_expense_command_identity('expense.submit');
  v_claim:=public.claim_expense_command(
    v_tenant,v_org,v_actor,'submit_current_expense',expense_public_id,
    jsonb_build_object('expenseId',expense_public_id,'expectedVersion',expected_version),
    idempotency_key,request_id
  );
  if v_claim->>'state'='scope_conflict' then
    perform public.append_audit_log(v_tenant,v_org,v_user,v_actor,'expense.command_failed','expense',
      expense_public_id::text,request_id,null,jsonb_build_object(
        'outcome','failure','operation','submit_current_expense','resource','expense',
        'requestId',request_id,'failure','scope_conflict'));
    return jsonb_build_object('outcome','failure','error','scope_conflict');
  end if;
  if v_claim->>'state'='replay' then return v_claim->'result'; end if;
  -- Approval decisions lock approval then synchronize expense. Probe first and
  -- take the same approval -> expense lock order to avoid a cancellation cycle.
  select expense.* into v_expense from public.expense_reports expense
  where expense.tenant_id=v_tenant and expense.organization_id=v_org
    and expense.public_id=expense_public_id and expense.deleted_at is null;
  if found and v_expense.approval_id is not null then
    select approval.* into v_approval from public.approvals approval
    where approval.tenant_id=v_tenant and approval.organization_id=v_org
      and approval.id=v_expense.approval_id for update;
  end if;
  select expense.* into v_expense from public.expense_reports expense
  where expense.tenant_id=v_tenant and expense.organization_id=v_org
    and expense.public_id=expense_public_id and expense.deleted_at is null for update;
  if not found then v_failure:='expense_not_found';
  elsif v_expense.requester_employee_id<>v_employee then v_failure:='forbidden';
  elsif v_expense.version<>expected_version then v_failure:='conflict';
  elsif v_expense.status not in ('draft','rejected') then v_failure:='invalid_state';
  elsif not public.valid_expense_receipts(v_tenant,v_org,v_actor,v_expense.project_id,
    coalesce(v_expense.receipt_file_ids::uuid[],'{}'::uuid[])) then v_failure:='invalid_receipt';
  end if;
  if v_failure is null then
    select template.* into v_template from public.approval_templates template
    where template.tenant_id=v_tenant and template.organization_id=v_org
      and template.template_key='expense_reimbursement' and template.is_active
    for share;
    if not found then v_failure:='approval_unavailable'; end if;
  end if;
  if v_failure is not null then
    return public.complete_expense_command(
      v_tenant,v_org,v_user,v_actor,'submit_current_expense',expense_public_id,request_id,
      idempotency_key,'failure',v_failure,null
    );
  end if;
  select jsonb_strip_nulls(jsonb_build_object(
    'amount',v_expense.amount::text,'purpose',v_expense.description,
    'expenseDate',v_expense.expense_date,'projectId',project.public_id,
    'costType',v_expense.expense_type
  )) into v_form from (select 1) singleton
  left join public.projects project on project.tenant_id=v_expense.tenant_id
    and project.organization_id=v_expense.organization_id and project.id=v_expense.project_id;
  begin
    v_approval_result:=public.submit_approval_for_command_identity(
      v_tenant,v_org,v_actor,v_user,v_employee,v_template.public_id,v_form,
      public.expense_child_uuid(idempotency_key,'expense-approval-idempotency'),
      public.expense_child_uuid(request_id,'expense-approval-request')
    );
    if v_approval_result->>'outcome'<>'success' then
      v_failure:='approval_unavailable';
    else
      select approval.* into v_approval from public.approvals approval
      where approval.tenant_id=v_tenant and approval.organization_id=v_org
        and approval.public_id=(v_approval_result->>'id')::uuid
        and approval.applicant_employee_id=v_employee and approval.status='pending'
      for update;
      if not found then v_failure:='approval_unavailable';
      else
        perform set_config('quantxy.expense_command','on',true);
        update public.expense_reports expense set approval_id=v_approval.id,
          owner_employee_id=v_approval.owner_employee_id,status='submitted',
          version=expense.version+1,updated_at=v_now
        where expense.tenant_id=v_tenant and expense.organization_id=v_org and expense.id=v_expense.id
        returning expense.* into v_expense;
      end if;
    end if;
  exception when others then
    v_failure:='command_failed';
  end;
  if v_failure is not null then
    return public.complete_expense_command(
      v_tenant,v_org,v_user,v_actor,'submit_current_expense',expense_public_id,request_id,
      idempotency_key,'failure',v_failure,null
    );
  end if;
  v_entity:=public.expense_command_entity(v_tenant,v_org,v_expense.id);
  return public.complete_expense_command(
    v_tenant,v_org,v_user,v_actor,'submit_current_expense',expense_public_id,request_id,
    idempotency_key,'success',null,v_entity
  );
exception when no_data_found then
  raise exception 'Expense command identity unavailable' using errcode='42501';
end;
$$;

create or replace function public.sync_expense_from_approval()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.version=old.version then return new; end if;
  perform set_config('quantxy.expense_command','on',true);
  update public.expense_reports expense set
    status=case new.status
      when 'approved' then 'approved'
      when 'rejected' then 'rejected'
      when 'returned' then 'rejected'
      when 'cancelled' then 'cancelled'
      else 'submitted' end,
    owner_employee_id=case when new.status='pending' then new.owner_employee_id else null end,
    cancelled_at=case when new.status='cancelled' then coalesce(expense.cancelled_at,new.completed_at,clock_timestamp()) else null end,
    cancellation_reason=case when new.status='cancelled' then coalesce(expense.cancellation_reason,'审批已取消') else null end,
    version=expense.version+1,updated_at=clock_timestamp()
  where expense.tenant_id=new.tenant_id and expense.organization_id=new.organization_id
    and expense.approval_id=new.id and expense.status='submitted';
  return new;
end;
$$;
create trigger approvals_sync_linked_expense
after update of status,owner_employee_id,version on public.approvals
for each row execute function public.sync_expense_from_approval();

create or replace function public.mark_current_expense_paid(
  expense_public_id uuid,expected_version integer,payment_reference text,
  idempotency_key uuid,request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_tenant bigint; v_org bigint; v_actor bigint; v_user uuid; v_employee bigint; v_employee_public uuid;
  v_claim jsonb; v_expense public.expense_reports%rowtype; v_failure text; v_entity jsonb;
  v_now timestamptz:=clock_timestamp(); v_reference text;
begin
  if expense_public_id is null or expected_version is null or expected_version<1
     or payment_reference is null
     or length(public.normalize_expense_text(payment_reference)) not between 1 and 120
     or idempotency_key is null or request_id is null or idempotency_key=request_id then
    raise exception 'Expense payment is invalid' using errcode='22023';
  end if;
  v_reference:=public.normalize_expense_text(payment_reference);
  select * into strict v_tenant,v_org,v_actor,v_user,v_employee,v_employee_public
  from public.current_expense_command_identity('expense.manage');
  v_claim:=public.claim_expense_command(
    v_tenant,v_org,v_actor,'mark_current_expense_paid',expense_public_id,
    jsonb_build_object('expenseId',expense_public_id,'expectedVersion',expected_version,
      'paymentReference',v_reference),idempotency_key,request_id
  );
  if v_claim->>'state'='scope_conflict' then
    perform public.append_audit_log(v_tenant,v_org,v_user,v_actor,'expense.command_failed','expense',
      expense_public_id::text,request_id,null,jsonb_build_object(
        'outcome','failure','operation','mark_current_expense_paid','resource','expense',
        'requestId',request_id,'failure','scope_conflict'));
    return jsonb_build_object('outcome','failure','error','scope_conflict');
  end if;
  if v_claim->>'state'='replay' then return v_claim->'result'; end if;
  select expense.* into v_expense from public.expense_reports expense
  where expense.tenant_id=v_tenant and expense.organization_id=v_org
    and expense.public_id=expense_public_id and expense.deleted_at is null for update;
  if not found then v_failure:='expense_not_found';
  elsif v_expense.version<>expected_version then v_failure:='conflict';
  elsif v_expense.status<>'approved' or v_expense.approval_id is null then v_failure:='invalid_state';
  elsif not public.is_valid_expense_approval_evidence(
    v_tenant,v_org,v_expense.approval_id,array['approved']
  ) then v_failure:='invalid_state';
  end if;
  if v_failure is not null then
    return public.complete_expense_command(
      v_tenant,v_org,v_user,v_actor,'mark_current_expense_paid',expense_public_id,request_id,
      idempotency_key,'failure',v_failure,null
    );
  end if;
  begin
    perform set_config('quantxy.expense_command','on',true);
    update public.expense_reports expense set status='paid',owner_employee_id=null,
      paid_at=v_now,paid_by_member_id=v_actor,payment_reference=v_reference,
      payment_evidence_status='verified',
      version=expense.version+1,updated_at=v_now
    where expense.tenant_id=v_tenant and expense.organization_id=v_org and expense.id=v_expense.id
    returning expense.* into v_expense;
  exception when others then
    v_failure:='command_failed';
  end;
  if v_failure is not null then
    return public.complete_expense_command(
      v_tenant,v_org,v_user,v_actor,'mark_current_expense_paid',expense_public_id,request_id,
      idempotency_key,'failure',v_failure,null
    );
  end if;
  v_entity:=public.expense_command_entity(v_tenant,v_org,v_expense.id);
  return public.complete_expense_command(
    v_tenant,v_org,v_user,v_actor,'mark_current_expense_paid',expense_public_id,request_id,
    idempotency_key,'success',null,v_entity
  );
exception when no_data_found then
  raise exception 'Expense command identity unavailable' using errcode='42501';
end;
$$;

create or replace function public.cancel_current_expense(
  expense_public_id uuid,expected_version integer,reason text,
  idempotency_key uuid,request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_tenant bigint; v_org bigint; v_actor bigint; v_user uuid; v_employee bigint; v_employee_public uuid;
  v_claim jsonb; v_expense public.expense_reports%rowtype; v_approval public.approvals%rowtype;
  v_action_result jsonb; v_failure text; v_entity jsonb;
  v_now timestamptz:=clock_timestamp(); v_reason text;
begin
  if expense_public_id is null or expected_version is null or expected_version<1 or reason is null
     or length(public.normalize_expense_text(reason)) not between 1 and 500
     or idempotency_key is null or request_id is null or idempotency_key=request_id then
    raise exception 'Expense cancellation is invalid' using errcode='22023';
  end if;
  v_reason:=public.normalize_expense_text(reason);
  select * into strict v_tenant,v_org,v_actor,v_user,v_employee,v_employee_public
  from public.current_expense_command_identity('expense.submit');
  v_claim:=public.claim_expense_command(
    v_tenant,v_org,v_actor,'cancel_current_expense',expense_public_id,
    jsonb_build_object('expenseId',expense_public_id,'expectedVersion',expected_version,'reason',v_reason),
    idempotency_key,request_id
  );
  if v_claim->>'state'='scope_conflict' then
    perform public.append_audit_log(v_tenant,v_org,v_user,v_actor,'expense.command_failed','expense',
      expense_public_id::text,request_id,null,jsonb_build_object(
        'outcome','failure','operation','cancel_current_expense','resource','expense',
        'requestId',request_id,'failure','scope_conflict'));
    return jsonb_build_object('outcome','failure','error','scope_conflict');
  end if;
  if v_claim->>'state'='replay' then return v_claim->'result'; end if;
  -- Approval actions lock approval before their synchronization trigger locks
  -- the linked expense. Cancellation follows that same global lock order.
  select expense.* into v_expense from public.expense_reports expense
  where expense.tenant_id=v_tenant and expense.organization_id=v_org
    and expense.public_id=expense_public_id and expense.deleted_at is null;
  if found and v_expense.approval_id is not null then
    select approval.* into v_approval from public.approvals approval
    where approval.tenant_id=v_tenant and approval.organization_id=v_org
      and approval.id=v_expense.approval_id for update;
  end if;
  select expense.* into v_expense from public.expense_reports expense
  where expense.tenant_id=v_tenant and expense.organization_id=v_org
    and expense.public_id=expense_public_id and expense.deleted_at is null for update;
  if not found then v_failure:='expense_not_found';
  elsif v_expense.requester_employee_id<>v_employee then v_failure:='forbidden';
  elsif v_expense.version<>expected_version then v_failure:='conflict';
  elsif v_expense.status not in ('draft','rejected','submitted') then v_failure:='invalid_state';
  end if;
  if v_failure is not null then
    return public.complete_expense_command(
      v_tenant,v_org,v_user,v_actor,'cancel_current_expense',expense_public_id,request_id,
      idempotency_key,'failure',v_failure,null
    );
  end if;
  begin
    if v_expense.status='submitted' then
      if v_approval.id is null or v_approval.id<>v_expense.approval_id
         or not public.is_valid_expense_approval_evidence(
           v_tenant,v_org,v_expense.approval_id,array['pending']
         ) then
        v_failure:='invalid_state';
      else
        v_action_result:=public.act_on_current_approval(
          v_approval.public_id,'cancel',v_approval.version::integer,v_reason,
          public.expense_child_uuid(request_id,'expense-cancel-approval-action')
        );
        if v_action_result->>'outcome'<>'success' then v_failure:='approval_unavailable'; end if;
        select expense.* into v_expense from public.expense_reports expense
        where expense.tenant_id=v_tenant and expense.organization_id=v_org
          and expense.public_id=expense_public_id for update;
        if v_failure is null and (
          v_expense.status<>'cancelled' or v_expense.version<>expected_version+1
        ) then
          raise exception 'Expense cancellation synchronization failed' using errcode='P0001';
        end if;
      end if;
    else
      perform set_config('quantxy.expense_command','on',true);
      update public.expense_reports expense set status='cancelled',owner_employee_id=null,
        cancelled_at=v_now,cancellation_reason=v_reason,version=expense.version+1,updated_at=v_now
      where expense.tenant_id=v_tenant and expense.organization_id=v_org and expense.id=v_expense.id
      returning expense.* into v_expense;
    end if;
  exception when others then
    v_failure:='command_failed';
  end;
  if v_failure is not null then
    return public.complete_expense_command(
      v_tenant,v_org,v_user,v_actor,'cancel_current_expense',expense_public_id,request_id,
      idempotency_key,'failure',v_failure,null
    );
  end if;
  v_entity:=public.expense_command_entity(v_tenant,v_org,v_expense.id);
  return public.complete_expense_command(
    v_tenant,v_org,v_user,v_actor,'cancel_current_expense',expense_public_id,request_id,
    idempotency_key,'success',null,v_entity
  );
exception when no_data_found then
  raise exception 'Expense command identity unavailable' using errcode='42501';
end;
$$;

create trigger expense_reports_reject_completed_mutation
before update or delete on public.expense_reports
for each row execute function public.enforce_expense_command_mutation();

create or replace function public.enforce_expense_receipt_command_mutation()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if current_setting('quantxy.expense_command',true) is distinct from 'on' then
    raise exception 'Expense receipts are command-owned' using errcode='42501';
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;
create trigger expense_receipts_reject_mutation
before insert or update or delete on public.expense_receipts
for each row execute function public.enforce_expense_receipt_command_mutation();
create trigger expense_receipts_reject_truncate
before truncate on public.expense_receipts
for each statement execute function public.enforce_expense_receipt_command_mutation();

create or replace function public.create_current_expense(
  project_public_id uuid,expense_type text,amount text,expense_date date,description text,
  receipt_file_ids uuid[],idempotency_key uuid,request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_tenant bigint; v_org bigint; v_actor bigint; v_user uuid; v_employee bigint; v_employee_public uuid;
  v_project bigint; v_claim jsonb; v_target uuid; v_expense public.expense_reports%rowtype;
  v_failure text; v_entity jsonb; v_now timestamptz:=clock_timestamp(); v_description text;
begin
  if public.is_valid_expense_input(
       expense_type,amount,expense_date,description,receipt_file_ids
     ) is distinct from true
     or idempotency_key is null or request_id is null or idempotency_key=request_id
     or project_public_id is null and coalesce(cardinality(receipt_file_ids),0)>0 then
    raise exception 'Expense draft is invalid' using errcode='22023';
  end if;
  v_description:=public.normalize_expense_text(description);
  select * into strict v_tenant,v_org,v_actor,v_user,v_employee,v_employee_public
  from public.current_expense_command_identity('expense.submit');
  v_claim:=public.claim_expense_command(
    v_tenant,v_org,v_actor,'create_current_expense',null,
    jsonb_build_object(
      'projectId',project_public_id,'expenseType',expense_type,'amount',amount,
      'expenseDate',expense_date,'description',v_description,
      'receiptFileIds',coalesce(to_jsonb(receipt_file_ids),'[]'::jsonb)
    ),idempotency_key,request_id
  );
  if v_claim->>'state'='scope_conflict' then
    perform public.append_audit_log(v_tenant,v_org,v_user,v_actor,'expense.command_failed','expense',null,
      request_id,null,jsonb_build_object('outcome','failure','operation','create_current_expense',
        'resource','expense','requestId',request_id,'failure','scope_conflict'));
    return jsonb_build_object('outcome','failure','error','scope_conflict');
  end if;
  if v_claim->>'state'='replay' then return v_claim->'result'; end if;
  v_target:=(v_claim->>'targetPublicId')::uuid;
  if project_public_id is not null then
    select project.id into v_project from public.projects project
    where project.tenant_id=v_tenant and project.organization_id=v_org
      and project.public_id=project_public_id and project.deleted_at is null
      and project.archived_at is null
      and (project.owner_member_id=v_actor or exists(
        select 1 from public.project_members membership
        where membership.tenant_id=v_tenant and membership.organization_id=v_org
          and membership.project_id=project.id and membership.member_id=v_actor
          and membership.left_at is null
      )) for share of project;
    if not found then v_failure:='forbidden'; end if;
  end if;
  if v_failure is null and not public.valid_expense_receipts(
    v_tenant,v_org,v_actor,v_project,receipt_file_ids
  ) then v_failure:='invalid_receipt'; end if;
  if v_failure is not null then
    return public.complete_expense_command(
      v_tenant,v_org,v_user,v_actor,'create_current_expense',v_target,request_id,
      idempotency_key,'failure',v_failure,null
    );
  end if;
  begin
    perform set_config('quantxy.expense_command','on',true);
    insert into public.expense_reports(
      public_id,tenant_id,organization_id,requester_employee_id,project_id,expense_code,
      expense_type,amount,currency,expense_date,description,receipt_file_ids,status,version,
      created_at,updated_at
    ) values(
      v_target,v_tenant,v_org,v_employee,v_project,
      'EXP-'||upper(substr(replace(v_target::text,'-',''),1,20)),expense_type,amount::numeric,
      'CNY',expense_date,v_description,coalesce(receipt_file_ids::text[],'{}'::text[]),
      'draft',1,v_now,v_now
    ) returning * into v_expense;
    perform public.replace_expense_receipts(
      v_tenant,v_org,v_actor,v_expense.id,receipt_file_ids
    );
  exception when others then
    v_failure:='command_failed';
  end;
  if v_failure is not null then
    return public.complete_expense_command(
      v_tenant,v_org,v_user,v_actor,'create_current_expense',v_target,request_id,
      idempotency_key,'failure',v_failure,null
    );
  end if;
  v_entity:=public.expense_command_entity(v_tenant,v_org,v_expense.id);
  return public.complete_expense_command(
    v_tenant,v_org,v_user,v_actor,'create_current_expense',v_target,request_id,
    idempotency_key,'success',null,v_entity
  );
exception when no_data_found then
  raise exception 'Expense command identity unavailable' using errcode='42501';
end;
$$;

revoke all on table public.expense_reports from public,anon,authenticated,service_role;
revoke all on table public.expense_receipts from public,anon,authenticated,service_role;
revoke all on table public.expense_command_idempotency from public,anon,authenticated,service_role;
revoke all on sequence public.expense_reports_id_seq from public,anon,authenticated,service_role;
revoke all on sequence public.expense_receipts_id_seq from public,anon,authenticated,service_role;
grant select on table public.expense_reports,public.expense_receipts to authenticated;

revoke all on function public.is_expense_baseline_role(boolean,boolean,bigint,text,text)
  from public,anon,authenticated,service_role;
revoke all on function public.revoke_expense_permissions_before_role_update()
  from public,anon,authenticated,service_role;
revoke all on function public.grant_expense_permissions_after_role_change()
  from public,anon,authenticated,service_role;
revoke all on function public.current_expense_command_identity(text)
  from public,anon,authenticated,service_role;
revoke all on function public.claim_expense_command(bigint,bigint,bigint,text,uuid,jsonb,uuid,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.expense_command_entity(bigint,bigint,bigint)
  from public,anon,authenticated,service_role;
revoke all on function public.complete_expense_command(bigint,bigint,uuid,bigint,text,uuid,uuid,uuid,text,text,jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.valid_expense_receipts(bigint,bigint,bigint,bigint,uuid[])
  from public,anon,authenticated,service_role;
revoke all on function public.replace_expense_receipts(bigint,bigint,bigint,bigint,uuid[])
  from public,anon,authenticated,service_role;
revoke all on function public.normalize_expense_text(text)
  from public,anon,authenticated,service_role;
revoke all on function public.is_valid_expense_input(text,text,date,text,uuid[])
  from public,anon,authenticated,service_role;
revoke all on function public.expense_child_uuid(uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function public.enforce_expense_command_mutation()
  from public,anon,authenticated,service_role;
revoke all on function public.enforce_expense_receipt_command_mutation()
  from public,anon,authenticated,service_role;
revoke all on function public.sync_expense_from_approval()
  from public,anon,authenticated,service_role;
revoke all on function public.is_valid_expense_approval_evidence(bigint,bigint,bigint,text[])
  from public,anon,authenticated,service_role;

revoke all on function public.can_read_current_expense(bigint,bigint,bigint)
  from public,anon,authenticated,service_role;
grant execute on function public.can_read_current_expense(bigint,bigint,bigint) to authenticated;

revoke all on function public.create_current_expense(uuid,text,text,date,text,uuid[],uuid,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.submit_current_expense(uuid,integer,uuid,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.mark_current_expense_paid(uuid,integer,text,uuid,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.cancel_current_expense(uuid,integer,text,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.create_current_expense(uuid,text,text,date,text,uuid[],uuid,uuid)
  to authenticated;
grant execute on function public.submit_current_expense(uuid,integer,uuid,uuid)
  to authenticated;
grant execute on function public.mark_current_expense_paid(uuid,integer,text,uuid,uuid)
  to authenticated;
grant execute on function public.cancel_current_expense(uuid,integer,text,uuid,uuid)
  to authenticated;

create or replace function public.update_current_expense(
  expense_public_id uuid,expected_version integer,expense_type text,amount text,
  expense_date date,description text,receipt_file_ids uuid[],idempotency_key uuid,request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_tenant bigint; v_org bigint; v_actor bigint; v_user uuid; v_employee bigint; v_employee_public uuid;
  v_claim jsonb; v_expense public.expense_reports%rowtype; v_failure text; v_entity jsonb;
  v_now timestamptz:=clock_timestamp(); v_description text;
begin
  if expense_public_id is null or expected_version is null or expected_version<1
     or public.is_valid_expense_input(
       expense_type,amount,expense_date,description,receipt_file_ids
     ) is distinct from true
     or idempotency_key is null or request_id is null or idempotency_key=request_id then
    raise exception 'Expense update is invalid' using errcode='22023';
  end if;
  v_description:=public.normalize_expense_text(description);
  select * into strict v_tenant,v_org,v_actor,v_user,v_employee,v_employee_public
  from public.current_expense_command_identity('expense.submit');
  v_claim:=public.claim_expense_command(
    v_tenant,v_org,v_actor,'update_current_expense',expense_public_id,
    jsonb_build_object(
      'expenseId',expense_public_id,'expectedVersion',expected_version,
      'expenseType',expense_type,'amount',amount,'expenseDate',expense_date,
      'description',v_description,'receiptFileIds',coalesce(to_jsonb(receipt_file_ids),'[]'::jsonb)
    ),idempotency_key,request_id
  );
  if v_claim->>'state'='scope_conflict' then
    perform public.append_audit_log(v_tenant,v_org,v_user,v_actor,'expense.command_failed','expense',
      expense_public_id::text,request_id,null,jsonb_build_object(
        'outcome','failure','operation','update_current_expense','resource','expense',
        'requestId',request_id,'failure','scope_conflict'));
    return jsonb_build_object('outcome','failure','error','scope_conflict');
  end if;
  if v_claim->>'state'='replay' then return v_claim->'result'; end if;
  select expense.* into v_expense from public.expense_reports expense
  where expense.tenant_id=v_tenant and expense.organization_id=v_org
    and expense.public_id=expense_public_id and expense.deleted_at is null for update;
  if not found then v_failure:='expense_not_found';
  elsif v_expense.requester_employee_id<>v_employee then v_failure:='forbidden';
  elsif v_expense.version<>expected_version then v_failure:='conflict';
  elsif v_expense.status not in ('draft','rejected') then v_failure:='invalid_state';
  elsif not public.valid_expense_receipts(
    v_tenant,v_org,v_actor,v_expense.project_id,receipt_file_ids
  ) then v_failure:='invalid_receipt';
  end if;
  if v_failure is not null then
    return public.complete_expense_command(
      v_tenant,v_org,v_user,v_actor,'update_current_expense',expense_public_id,request_id,
      idempotency_key,'failure',v_failure,null
    );
  end if;
  begin
    perform set_config('quantxy.expense_command','on',true);
    update public.expense_reports expense set expense_type=update_current_expense.expense_type,
      amount=update_current_expense.amount::numeric,expense_date=update_current_expense.expense_date,
      description=v_description,receipt_file_ids=coalesce(update_current_expense.receipt_file_ids::text[],'{}'::text[]),
      version=expense.version+1,updated_at=v_now
    where expense.tenant_id=v_tenant and expense.organization_id=v_org and expense.id=v_expense.id
    returning expense.* into v_expense;
    perform public.replace_expense_receipts(
      v_tenant,v_org,v_actor,v_expense.id,receipt_file_ids
    );
  exception when others then
    v_failure:='command_failed';
  end;
  if v_failure is not null then
    return public.complete_expense_command(
      v_tenant,v_org,v_user,v_actor,'update_current_expense',expense_public_id,request_id,
      idempotency_key,'failure',v_failure,null
    );
  end if;
  v_entity:=public.expense_command_entity(v_tenant,v_org,v_expense.id);
  return public.complete_expense_command(
    v_tenant,v_org,v_user,v_actor,'update_current_expense',expense_public_id,request_id,
    idempotency_key,'success',null,v_entity
  );
exception when no_data_found then
  raise exception 'Expense command identity unavailable' using errcode='42501';
end;
$$;

revoke all on function public.update_current_expense(uuid,integer,text,text,date,text,uuid[],uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.update_current_expense(uuid,integer,text,text,date,text,uuid[],uuid,uuid)
  to authenticated;
