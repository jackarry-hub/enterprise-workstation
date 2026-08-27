-- Commercial CRM governance: immutable history/provenance, lifecycle controls,
-- per-row durable import and audited export snapshots.

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
    'create_current_customer_follow_up','convert_current_opportunity_to_project',
    'transfer_current_customer_owner','create_current_customer_contract',
    'create_current_crm_source_link','archive_current_customer','restore_current_customer',
    'begin_current_crm_import','import_current_customer_row','finalize_current_crm_import',
    'request_current_crm_export'
  ));

insert into public.permissions(code,name,module,action)
values
  ('customer.import','导入客户数据','customers','import'),
  ('customer.export','导出客户数据','customers','export'),
  ('customer.export_pii','导出客户联系人隐私字段','customers','export_pii')
on conflict (code) do update set name=excluded.name,module=excluded.module,action=excluded.action;

insert into public.role_permissions(tenant_id,role_id,permission_id)
select distinct existing.tenant_id,existing.role_id,exchange.id
from public.role_permissions existing
join public.permissions manager on manager.id=existing.permission_id and manager.code='customer.manage'
cross join public.permissions exchange
where exchange.code in ('customer.import','customer.export')
on conflict do nothing;

create table public.customer_ownership_history (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete restrict,
  organization_id bigint not null,
  customer_id bigint not null,
  previous_owner_member_id bigint,
  new_owner_member_id bigint not null,
  changed_by_member_id bigint,
  customer_version bigint not null check (customer_version>0),
  change_kind text not null check (change_kind in ('initial','migration_snapshot','transfer')),
  reason_digest text not null check (reason_digest ~ '^[0-9a-f]{64}$'),
  request_id uuid,
  idempotency_key uuid,
  changed_at timestamptz not null default clock_timestamp(),
  unique(tenant_id,organization_id,customer_id,customer_version),
  foreign key(tenant_id,organization_id,customer_id)
    references public.customers(tenant_id,organization_id,id) on delete restrict,
  foreign key(tenant_id,organization_id,previous_owner_member_id)
    references public.organization_members(tenant_id,organization_id,id) on delete restrict,
  foreign key(tenant_id,organization_id,new_owner_member_id)
    references public.organization_members(tenant_id,organization_id,id) on delete restrict,
  foreign key(tenant_id,organization_id,changed_by_member_id)
    references public.organization_members(tenant_id,organization_id,id) on delete restrict,
  check((change_kind='initial' and previous_owner_member_id is null and changed_by_member_id is not null
      and request_id is null and idempotency_key is null)
    or (change_kind='migration_snapshot' and previous_owner_member_id is null
      and changed_by_member_id is null and request_id is null and idempotency_key is null)
    or (change_kind='transfer' and previous_owner_member_id is not null
      and changed_by_member_id is not null and previous_owner_member_id<>new_owner_member_id
      and request_id is not null and idempotency_key is not null))
);

create table public.opportunity_stage_history (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete restrict,
  organization_id bigint not null,
  customer_id bigint not null,
  opportunity_id bigint not null,
  from_stage text check (from_stage is null or from_stage in ('lead','qualified','proposal','won','lost')),
  to_stage text not null check (to_stage in ('lead','qualified','proposal','won','lost')),
  changed_by_member_id bigint,
  opportunity_version bigint not null check (opportunity_version>0),
  change_kind text not null check (change_kind in ('initial','migration_snapshot','transition')),
  reason_digest text,
  request_id uuid,
  idempotency_key uuid,
  changed_at timestamptz not null default clock_timestamp(),
  unique(tenant_id,organization_id,opportunity_id,opportunity_version),
  foreign key(tenant_id,organization_id,customer_id,opportunity_id)
    references public.opportunities(tenant_id,organization_id,customer_id,id) on delete restrict,
  foreign key(tenant_id,organization_id,changed_by_member_id)
    references public.organization_members(tenant_id,organization_id,id) on delete restrict,
  check((change_kind in ('initial','migration_snapshot') and from_stage is null)
    or (change_kind='transition' and from_stage is not null and from_stage<>to_stage)),
  check((change_kind='initial' and changed_by_member_id is not null
      and reason_digest is null and request_id is null and idempotency_key is null)
    or (change_kind='migration_snapshot' and changed_by_member_id is null
      and reason_digest is null and request_id is null and idempotency_key is null)
    or (change_kind='transition' and reason_digest ~ '^[0-9a-f]{64}$'
      and changed_by_member_id is not null and request_id is not null and idempotency_key is not null))
);

alter table public.customer_project_links
  add constraint customer_project_links_contract_pair_uk
  unique(tenant_id,organization_id,customer_id,opportunity_id,project_id);

create table public.customer_contracts (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete restrict,
  organization_id bigint not null,
  customer_id bigint not null,
  opportunity_id bigint,
  project_id bigint,
  created_by_member_id bigint not null,
  updated_by_member_id bigint not null,
  contract_number text not null check (length(btrim(contract_number)) between 1 and 80),
  contract_number_normalized text generated always as (upper(btrim(contract_number))) stored,
  title text not null check (length(btrim(title)) between 1 and 160),
  status text not null check (status in ('draft','active','completed','terminated')),
  amount numeric(18,2) not null check (
    amount>=0 and amount<10000000000000000::numeric and amount<>'NaN'::numeric
  ),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  signed_on date,
  starts_on date not null,
  ends_on date not null,
  version bigint not null default 1 check (version>0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  archived_at timestamptz,
  unique(tenant_id,organization_id,customer_id,id),
  foreign key(tenant_id,organization_id,customer_id)
    references public.customers(tenant_id,organization_id,id) on delete restrict,
  foreign key(tenant_id,organization_id,customer_id,opportunity_id)
    references public.opportunities(tenant_id,organization_id,customer_id,id) on delete restrict,
  foreign key(tenant_id,organization_id,project_id)
    references public.projects(tenant_id,organization_id,id) on delete restrict,
  foreign key(tenant_id,organization_id,customer_id,project_id)
    references public.customer_project_links(tenant_id,organization_id,customer_id,project_id) on delete restrict,
  foreign key(tenant_id,organization_id,customer_id,opportunity_id,project_id)
    references public.customer_project_links(
      tenant_id,organization_id,customer_id,opportunity_id,project_id
    ) on delete restrict,
  foreign key(tenant_id,organization_id,created_by_member_id)
    references public.organization_members(tenant_id,organization_id,id) on delete restrict,
  foreign key(tenant_id,organization_id,updated_by_member_id)
    references public.organization_members(tenant_id,organization_id,id) on delete restrict,
  check(opportunity_id is not null or project_id is not null),
  check(isfinite(starts_on) and isfinite(ends_on) and ends_on>=starts_on),
  check(signed_on is null or isfinite(signed_on))
);
create unique index customer_contracts_active_number_uidx
  on public.customer_contracts(tenant_id,organization_id,contract_number_normalized)
  where archived_at is null;
create index customer_contracts_customer_idx
  on public.customer_contracts(tenant_id,organization_id,customer_id,updated_at desc)
  where archived_at is null;

create table public.crm_source_links (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete restrict,
  organization_id bigint not null,
  customer_id bigint not null,
  contact_id bigint,
  opportunity_id bigint,
  project_id bigint,
  linked_by_member_id bigint not null,
  source_system text not null check (source_system in ('feishu','import','external_crm','n8n','other')),
  external_record_id text not null check (length(btrim(external_record_id)) between 1 and 255),
  source_url text check (source_url is null or (
    length(source_url)<=2048
    and source_url ~ '^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?([/?]|$)'
    and source_url !~* '^https://[^/?]*@'
    and position('#' in source_url)=0
    and source_url !~* '[?&](token|access_token|key|api_key|signature|sig|auth|password|secret)(=|&|$)'
    and source_url !~* '[?&][^=&#]*%[^=&#]*='
  )),
  created_at timestamptz not null default clock_timestamp(),
  unique(tenant_id,organization_id,id),
  foreign key(tenant_id,organization_id,customer_id)
    references public.customers(tenant_id,organization_id,id) on delete restrict,
  foreign key(tenant_id,organization_id,customer_id,contact_id)
    references public.customer_contacts(tenant_id,organization_id,customer_id,id) on delete restrict,
  foreign key(tenant_id,organization_id,customer_id,opportunity_id)
    references public.opportunities(tenant_id,organization_id,customer_id,id) on delete restrict,
  foreign key(tenant_id,organization_id,project_id)
    references public.projects(tenant_id,organization_id,id) on delete restrict,
  foreign key(tenant_id,organization_id,linked_by_member_id)
    references public.organization_members(tenant_id,organization_id,id) on delete restrict,
  target_kind text generated always as (
    case when contact_id is not null then 'contact'
      when opportunity_id is not null then 'opportunity'
      when project_id is not null then 'project' else 'customer' end
  ) stored,
  foreign key(tenant_id,organization_id,customer_id,project_id)
    references public.customer_project_links(tenant_id,organization_id,customer_id,project_id) on delete restrict,
  check(num_nonnulls(contact_id,opportunity_id,project_id)<=1)
);
create unique index crm_source_links_external_identity_uidx
  on public.crm_source_links(tenant_id,organization_id,source_system,external_record_id);
create index crm_source_links_customer_idx
  on public.crm_source_links(tenant_id,organization_id,customer_id,created_at desc);

create table public.crm_import_jobs (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete restrict,
  organization_id bigint not null,
  requested_by_member_id bigint not null,
  payload_digest text not null check (payload_digest ~ '^[0-9a-f]{64}$'),
  total_rows integer not null check (total_rows between 1 and 200),
  valid_rows integer not null check (valid_rows between 0 and total_rows),
  accepted_manifest jsonb not null default '[]'::jsonb
    check (jsonb_typeof(accepted_manifest)='array'),
  validation_rejections jsonb not null default '[]'::jsonb
    check (jsonb_typeof(validation_rejections)='array'),
  status text not null check (status in ('running','completed','completed_with_errors','failed')),
  succeeded_rows integer not null default 0 check (succeeded_rows>=0),
  failed_rows integer not null default 0 check (failed_rows>=0),
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  unique(tenant_id,organization_id,id),
  foreign key(tenant_id,organization_id,requested_by_member_id)
    references public.organization_members(tenant_id,organization_id,id) on delete restrict,
  check(succeeded_rows+failed_rows<=valid_rows)
);

create table public.crm_import_rows (
  id bigint generated always as identity primary key,
  tenant_id bigint not null references public.tenants(id) on delete restrict,
  organization_id bigint not null,
  import_job_id bigint not null,
  row_index integer not null check (row_index>=0),
  row_digest text not null check (row_digest ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('imported','rejected')),
  customer_id bigint,
  error_code text check (error_code is null or error_code in ('conflict','not_found','invalid_request','command_failed')),
  processed_at timestamptz not null default clock_timestamp(),
  unique(tenant_id,organization_id,import_job_id,row_index),
  foreign key(tenant_id,organization_id,import_job_id)
    references public.crm_import_jobs(tenant_id,organization_id,id) on delete restrict,
  foreign key(tenant_id,organization_id,customer_id)
    references public.customers(tenant_id,organization_id,id) on delete restrict,
  check((status='imported' and customer_id is not null and error_code is null)
    or (status='rejected' and customer_id is null and error_code is not null))
);

create table public.crm_export_jobs (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete restrict,
  organization_id bigint not null,
  requested_by_member_id bigint not null,
  customer_id bigint,
  include_contact_pii boolean not null,
  format text not null default 'json' check (format='json'),
  columns jsonb not null check (jsonb_typeof(columns)='array'),
  row_count integer not null check (row_count>=0),
  snapshot jsonb check (snapshot is null or jsonb_typeof(snapshot)='array'),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  watermark uuid not null unique,
  state text not null check (state in ('completed','expired')),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  download_count integer not null default 0 check (download_count>=0),
  last_downloaded_at timestamptz,
  purged_at timestamptz,
  unique(tenant_id,organization_id,id),
  foreign key(tenant_id,organization_id,requested_by_member_id)
    references public.organization_members(tenant_id,organization_id,id) on delete restrict,
  foreign key(tenant_id,organization_id,customer_id)
    references public.customers(tenant_id,organization_id,id) on delete restrict,
  check(expires_at>created_at),
  check((state='completed' and snapshot is not null and purged_at is null)
    or (state='expired' and snapshot is null and purged_at is not null))
);

create or replace function public.crm_import_digest_part(p_value text)
returns text
language sql
immutable
set search_path=''
as $$
  select case when p_value is null then '-1:'
    else octet_length(convert_to(p_value,'UTF8'))::text||':'||p_value end;
$$;

create or replace function public.compute_crm_import_row_digest(
  p_name text,p_registration_code text,p_owner_employee_public_id uuid,
  p_industry text,p_source text,p_region text,p_contact_name text,p_contact_title text,
  p_contact_phone text,p_contact_email text,p_contact_visibility text,p_contact_is_primary boolean
)
returns text
language sql
immutable
set search_path=''
as $$
  select encode(public.digest(convert_to(
    public.crm_import_digest_part(public.normalize_crm_name(p_name))||'|'||
    public.crm_import_digest_part(case when p_registration_code is null then null else btrim(p_registration_code) end)||'|'||
    public.crm_import_digest_part(lower(p_owner_employee_public_id::text))||'|'||
    public.crm_import_digest_part(case when p_industry is null then null else btrim(p_industry) end)||'|'||
    public.crm_import_digest_part(p_source)||'|'||
    public.crm_import_digest_part(case when p_region is null then null else btrim(p_region) end)||'|'||
    public.crm_import_digest_part(case when p_contact_name is null then null else btrim(p_contact_name) end)||'|'||
    public.crm_import_digest_part(case when p_contact_title is null then null else btrim(p_contact_title) end)||'|'||
    public.crm_import_digest_part(case when p_contact_phone is null then null else btrim(p_contact_phone) end)||'|'||
    public.crm_import_digest_part(case when p_contact_email is null then null else lower(btrim(p_contact_email)) end)||'|'||
    public.crm_import_digest_part(p_contact_visibility)||'|'||
    public.crm_import_digest_part(case when p_contact_is_primary is null then null else p_contact_is_primary::text end),
    'UTF8'),'sha256'),'hex');
$$;

create or replace function public.reject_immutable_crm_fact_mutation()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  raise exception 'Immutable CRM fact cannot be changed' using errcode='42501';
end;
$$;

create trigger customer_ownership_history_immutable
before update or delete on public.customer_ownership_history
for each row execute function public.reject_immutable_crm_fact_mutation();
create trigger opportunity_stage_history_immutable
before update or delete on public.opportunity_stage_history
for each row execute function public.reject_immutable_crm_fact_mutation();
create trigger crm_source_links_immutable
before update or delete on public.crm_source_links
for each row execute function public.reject_immutable_crm_fact_mutation();

create or replace function public.guard_customer_owner_transfer()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if new.owner_member_id<>old.owner_member_id
     and coalesce(current_setting('quantxy.crm_owner_transfer',true),'')<>'allowed' then
    raise exception 'Customer owner changes require transfer_current_customer_owner'
      using errcode='42501';
  end if;
  return new;
end;
$$;
create trigger customers_guard_owner_transfer
before update of owner_member_id on public.customers
for each row execute function public.guard_customer_owner_transfer();

create or replace function public.append_customer_ownership_baseline()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  insert into public.customer_ownership_history(
    tenant_id,organization_id,customer_id,previous_owner_member_id,new_owner_member_id,
    changed_by_member_id,customer_version,change_kind,reason_digest,changed_at
  ) values (
    new.tenant_id,new.organization_id,new.id,null,new.owner_member_id,
    new.created_by_member_id,new.version,'initial',
    encode(public.digest(convert_to('baseline','UTF8'),'sha256'),'hex'),new.created_at
  );
  return new;
end;
$$;
create trigger customers_append_ownership_baseline
after insert on public.customers
for each row execute function public.append_customer_ownership_baseline();

insert into public.customer_ownership_history(
  tenant_id,organization_id,customer_id,previous_owner_member_id,new_owner_member_id,
  changed_by_member_id,customer_version,change_kind,reason_digest,changed_at
)
select customer.tenant_id,customer.organization_id,customer.id,null,customer.owner_member_id,
  null,customer.version,'migration_snapshot',
  encode(public.digest(convert_to('baseline','UTF8'),'sha256'),'hex'),clock_timestamp()
from public.customers customer
on conflict do nothing;

create or replace function public.append_opportunity_stage_history()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if tg_op='INSERT' then
    insert into public.opportunity_stage_history(
      tenant_id,organization_id,customer_id,opportunity_id,from_stage,to_stage,
      changed_by_member_id,opportunity_version,change_kind,changed_at
    ) values (
      new.tenant_id,new.organization_id,new.customer_id,new.id,null,new.stage,
      new.created_by_member_id,new.version,'initial',new.created_at
    );
  elsif new.stage<>old.stage then
    insert into public.opportunity_stage_history(
      tenant_id,organization_id,customer_id,opportunity_id,from_stage,to_stage,
      changed_by_member_id,opportunity_version,change_kind,reason_digest,
      request_id,idempotency_key,changed_at
    ) values (
      new.tenant_id,new.organization_id,new.customer_id,new.id,old.stage,new.stage,
      new.updated_by_member_id,new.version,'transition',
      nullif(current_setting('quantxy.crm_stage_reason_digest',true),'')::text,
      nullif(current_setting('quantxy.crm_stage_request_id',true),'')::uuid,
      nullif(current_setting('quantxy.crm_stage_idempotency_key',true),'')::uuid,
      new.updated_at
    );
  end if;
  return new;
end;
$$;
create trigger opportunities_append_stage_history
after insert or update of stage on public.opportunities
for each row execute function public.append_opportunity_stage_history();

insert into public.opportunity_stage_history(
  tenant_id,organization_id,customer_id,opportunity_id,from_stage,to_stage,
  changed_by_member_id,opportunity_version,change_kind,changed_at
)
select opportunity.tenant_id,opportunity.organization_id,opportunity.customer_id,opportunity.id,
  null,opportunity.stage,null,opportunity.version,'migration_snapshot',clock_timestamp()
from public.opportunities opportunity
on conflict do nothing;

-- Archived customers and their child graph are invisible to ordinary REST reads.
drop policy if exists customers_current_scope_select on public.customers;
create policy customers_current_scope_select on public.customers
for select to authenticated
using (archived_at is null
  and public.can_read_current_customer(tenant_id,organization_id,owner_member_id));

drop policy if exists customer_contacts_current_scope_select on public.customer_contacts;
create policy customer_contacts_current_scope_select on public.customer_contacts
for select to authenticated
using (archived_at is null and exists (
  select 1 from public.customers customer
  where customer.tenant_id=customer_contacts.tenant_id
    and customer.organization_id=customer_contacts.organization_id
    and customer.id=customer_contacts.customer_id and customer.archived_at is null
    and (public.can_manage_current_crm(customer.tenant_id,customer.organization_id)
      or (customer_contacts.visibility='assigned' and public.can_read_current_customer(
        customer.tenant_id,customer.organization_id,customer.owner_member_id)))
));

drop policy if exists opportunities_current_scope_select on public.opportunities;
create policy opportunities_current_scope_select on public.opportunities
for select to authenticated
using (archived_at is null and exists (
  select 1 from public.customers customer
  where customer.tenant_id=opportunities.tenant_id
    and customer.organization_id=opportunities.organization_id
    and customer.id=opportunities.customer_id and customer.archived_at is null
    and public.can_read_current_customer(customer.tenant_id,customer.organization_id,customer.owner_member_id)
));

drop policy if exists customer_follow_ups_current_scope_select on public.customer_follow_ups;
create policy customer_follow_ups_current_scope_select on public.customer_follow_ups
for select to authenticated
using (archived_at is null and exists (
  select 1 from public.customers customer
  where customer.tenant_id=customer_follow_ups.tenant_id
    and customer.organization_id=customer_follow_ups.organization_id
    and customer.id=customer_follow_ups.customer_id and customer.archived_at is null
    and public.can_read_current_customer(customer.tenant_id,customer.organization_id,customer.owner_member_id)
));

drop policy if exists customer_project_links_current_scope_select on public.customer_project_links;
create policy customer_project_links_current_scope_select on public.customer_project_links
for select to authenticated
using (archived_at is null and exists (
  select 1 from public.customers customer
  where customer.tenant_id=customer_project_links.tenant_id
    and customer.organization_id=customer_project_links.organization_id
    and customer.id=customer_project_links.customer_id and customer.archived_at is null
    and public.can_read_current_customer(customer.tenant_id,customer.organization_id,customer.owner_member_id)
));

alter table public.customer_ownership_history enable row level security;
alter table public.customer_ownership_history force row level security;
alter table public.opportunity_stage_history enable row level security;
alter table public.opportunity_stage_history force row level security;
alter table public.customer_contracts enable row level security;
alter table public.customer_contracts force row level security;
alter table public.crm_source_links enable row level security;
alter table public.crm_source_links force row level security;
alter table public.crm_import_jobs enable row level security;
alter table public.crm_import_jobs force row level security;
alter table public.crm_import_rows enable row level security;
alter table public.crm_import_rows force row level security;
alter table public.crm_export_jobs enable row level security;
alter table public.crm_export_jobs force row level security;

create policy customer_ownership_history_current_scope_select on public.customer_ownership_history
for select to authenticated using (exists (
  select 1 from public.customers customer
  where customer.tenant_id=customer_ownership_history.tenant_id
    and customer.organization_id=customer_ownership_history.organization_id
    and customer.id=customer_ownership_history.customer_id and customer.archived_at is null
    and public.can_read_current_customer(customer.tenant_id,customer.organization_id,customer.owner_member_id)
));
create policy opportunity_stage_history_current_scope_select on public.opportunity_stage_history
for select to authenticated using (exists (
  select 1 from public.customers customer
  where customer.tenant_id=opportunity_stage_history.tenant_id
    and customer.organization_id=opportunity_stage_history.organization_id
    and customer.id=opportunity_stage_history.customer_id and customer.archived_at is null
    and public.can_read_current_customer(customer.tenant_id,customer.organization_id,customer.owner_member_id)
));
create policy customer_contracts_current_scope_select on public.customer_contracts
for select to authenticated using (archived_at is null and exists (
  select 1 from public.customers customer
  where customer.tenant_id=customer_contracts.tenant_id
    and customer.organization_id=customer_contracts.organization_id
    and customer.id=customer_contracts.customer_id and customer.archived_at is null
    and public.can_read_current_customer(customer.tenant_id,customer.organization_id,customer.owner_member_id)
));
create policy crm_source_links_current_scope_select on public.crm_source_links
for select to authenticated using (exists (
  select 1 from public.customers customer
  where customer.tenant_id=crm_source_links.tenant_id
    and customer.organization_id=crm_source_links.organization_id
    and customer.id=crm_source_links.customer_id and customer.archived_at is null
    and public.can_manage_current_crm(customer.tenant_id,customer.organization_id)
));

create or replace function public.current_crm_exchange_identity(p_permission text)
returns table(
  tenant_id bigint,organization_id bigint,actor_member_id bigint,
  actor_auth_user_id uuid,actor_employee_public_id uuid
)
language plpgsql
security definer
set search_path=''
as $$
begin
  if p_permission not in ('customer.import','customer.export','customer.export_pii')
     or (select auth.uid()) is null then
    raise exception 'CRM exchange permission required' using errcode='42501';
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
    and member.id=external.organization_member_id and member.user_id=(select auth.uid())
    and member.status='active'
  join public.employee_profiles profile on profile.tenant_id=member.tenant_id
    and profile.organization_id=member.organization_id
    and profile.organization_member_id=member.id and profile.deleted_at is null
    and profile.employment_status in ('probation','active','on_leave')
  where external.auth_user_id=(select auth.uid()) and external.status='active'
    and exists (
      select 1 from public.member_roles assignment
      join public.roles role on role.tenant_id=assignment.tenant_id
        and role.id=assignment.role_id and role.is_enabled
      join public.role_permissions role_grant on role_grant.tenant_id=assignment.tenant_id
        and role_grant.role_id=assignment.role_id
      join public.permissions permission on permission.id=role_grant.permission_id
      where assignment.tenant_id=member.tenant_id and assignment.member_id=member.id
        and (role.organization_id is null or role.organization_id=member.organization_id)
        and permission.code=p_permission
    )
  limit 1;
  if not found then
    raise exception 'CRM exchange permission required' using errcode='42501';
  end if;
end;
$$;

-- Contact PII is available only through this exact-identity projection.
create or replace function public.list_current_customer_contacts(
  p_customer_public_ids uuid[],p_primary_only boolean,p_per_customer_limit integer
)
returns table(
  record_id bigint,public_id uuid,customer_id bigint,name text,title text,phone text,email text,
  visibility text,is_primary boolean,version bigint,created_at timestamptz,updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path=''
as $$
begin
  if (select auth.uid()) is null or p_customer_public_ids is null
     or cardinality(p_customer_public_ids) not between 1 and 100
     or p_primary_only is null or p_per_customer_limit is null
     or p_per_customer_limit not between 1 and 101 then
    raise exception 'CRM contact projection is invalid' using errcode='22023';
  end if;
  return query
  select contact.id,contact.public_id,contact.customer_id,contact.name,contact.title,contact.phone,contact.email,
    contact.visibility,contact.is_primary,contact.version,contact.created_at,contact.updated_at
  from public.customers customer
  cross join lateral (
    select scoped.* from public.customer_contacts scoped
    where scoped.tenant_id=customer.tenant_id and scoped.organization_id=customer.organization_id
      and scoped.customer_id=customer.id and scoped.archived_at is null
      and (not p_primary_only or scoped.is_primary)
      and (public.can_manage_current_crm(customer.tenant_id,customer.organization_id)
        or (scoped.visibility='assigned' and public.can_read_current_customer(
          customer.tenant_id,customer.organization_id,customer.owner_member_id)))
    order by scoped.updated_at desc,scoped.id desc limit p_per_customer_limit
  ) contact
  where customer.public_id=any(p_customer_public_ids)
    and customer.archived_at is null
  order by contact.updated_at desc,contact.id desc;
end;
$$;

create or replace function public.list_current_archived_customers(p_limit integer default 50)
returns table(
  id uuid,name text,registration_code text,owner_employee_public_id uuid,
  version bigint,archived_at timestamptz
)
language plpgsql
stable
security definer
set search_path=''
as $$
declare v_tenant bigint; v_org bigint; v_actor bigint; v_user uuid; v_employee uuid;
begin
  select * into v_tenant,v_org,v_actor,v_user,v_employee from public.current_crm_command_identity();
  if p_limit not between 1 and 100 then
    raise exception 'Archived customer limit is invalid' using errcode='22023';
  end if;
  return query
  select customer.public_id,customer.name,customer.registration_code,profile.public_id,
    customer.version,customer.archived_at
  from public.customers customer
  join public.employee_profiles profile on profile.tenant_id=customer.tenant_id
    and profile.organization_id=customer.organization_id
    and profile.organization_member_id=customer.owner_member_id
  where customer.tenant_id=v_tenant and customer.organization_id=v_org
    and customer.archived_at is not null
  order by customer.archived_at desc,customer.id desc limit p_limit;
end;
$$;

-- CRM reasons may contain personal or commercial data; audit keeps only digests.
create or replace function public.complete_crm_command(
  p_tenant_id bigint,p_organization_id bigint,p_actor_auth_user_id uuid,
  p_actor_member_id bigint,p_operation text,p_resource text,p_action text,
  p_target_id text,p_request_id uuid,p_idempotency_key uuid,p_reason text,
  p_outcome text,p_error text,p_entity jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare v_result jsonb; v_public_entity jsonb:=coalesce(p_entity,'{}'::jsonb)-'_resultVersion';
begin
  v_result:=case when p_outcome='success' then jsonb_build_object(
    'outcome','success','resource',p_resource,'id',p_target_id,
    'version',coalesce((p_entity->>'_resultVersion')::bigint,(p_entity->>'version')::bigint,1),
    'entity',v_public_entity
  ) else jsonb_build_object('outcome','failure','error',p_error) end;
  update public.crm_command_idempotency ledger set result=v_result
  where ledger.tenant_id=p_tenant_id and ledger.organization_id=p_organization_id
    and ledger.actor_member_id=p_actor_member_id and ledger.operation=p_operation
    and ledger.idempotency_key=p_idempotency_key;
  if not found then raise exception 'CRM command ledger completion failed' using errcode='P0001'; end if;
  perform public.append_audit_log(
    p_tenant_id,p_organization_id,p_actor_auth_user_id,p_actor_member_id,
    case when p_outcome='success' then p_action else 'customer.command_failed' end,
    p_resource,p_target_id,p_request_id,null,jsonb_build_object(
      'outcome',p_outcome,'operation',p_operation,'resource',p_resource,
      'requestId',p_request_id,'idempotencyKey',p_idempotency_key,
      'businessReason',null,
      'businessReasonDigest',encode(public.digest(convert_to(p_reason,'UTF8'),'sha256'),'hex'),
      'entityDigest',case when p_outcome='success' then encode(
        public.digest(convert_to(v_public_entity::text,'UTF8'),'sha256'),'hex') else null end,
      'failure',case when p_outcome='failure' then p_error else null end
    )
  );
  return v_result;
end;
$$;

create or replace function public.audit_crm_scope_conflict(
  p_tenant_id bigint,p_organization_id bigint,p_actor_auth_user_id uuid,
  p_actor_member_id bigint,p_operation text,p_resource text,p_target_id text,
  p_request_id uuid,p_idempotency_key uuid,p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
begin
  perform public.append_audit_log(
    p_tenant_id,p_organization_id,p_actor_auth_user_id,p_actor_member_id,
    'customer.command_failed',p_resource,p_target_id,p_request_id,null,jsonb_build_object(
      'outcome','failure','operation',p_operation,'resource',p_resource,
      'requestId',p_request_id,'idempotencyKey',p_idempotency_key,'businessReason',null,
      'businessReasonDigest',encode(public.digest(convert_to(p_reason,'UTF8'),'sha256'),'hex'),
      'failure','scope_conflict'
    )
  );
  return jsonb_build_object('outcome','failure','error','scope_conflict');
end;
$$;

-- The legacy update signature remains compatible, but ownership changes must use
-- the dedicated transfer command so an immutable history event is unavoidable.
create or replace function public.update_current_customer(
  p_customer_public_id uuid,p_name text,p_registration_code text,
  p_owner_employee_public_id uuid,p_industry text,p_source text,p_region text,
  p_status text,p_expected_version bigint,p_reason text,request_id uuid,idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
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
      'expectedVersion',p_expected_version,'reason',btrim(p_reason)),idempotency_key,request_id);
  if v_claim->>'state'='scope_conflict' then
    return public.audit_crm_scope_conflict(v_tenant,v_org,v_user,v_actor,
      'update_current_customer','customer',p_customer_public_id::text,request_id,idempotency_key,btrim(p_reason));
  end if;
  if v_claim->>'state'='replay' then return v_claim->'result'; end if;
  select * into v_customer from public.customers customer
  where customer.tenant_id=v_tenant and customer.organization_id=v_org
    and customer.public_id=p_customer_public_id and customer.archived_at is null for update;
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
    and profile.employment_status in ('probation','active','on_leave') for share of profile,member;
  if not found then
    return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,'update_current_customer',
      'customer','customer.updated',p_customer_public_id::text,request_id,idempotency_key,
      btrim(p_reason),'failure','not_found',null);
  end if;
  if v_owner<>v_customer.owner_member_id then
    return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,'update_current_customer',
      'customer','customer.updated',p_customer_public_id::text,request_id,idempotency_key,
      btrim(p_reason),'failure','ownership_transfer_required',null);
  end if;
  begin
    update public.customers customer set name=v_name,registration_code=v_registration,
      industry=btrim(p_industry),source=p_source,region=btrim(p_region),status=p_status,
      updated_by_member_id=v_actor,version=customer.version+1,updated_at=clock_timestamp()
    where customer.tenant_id=v_tenant and customer.organization_id=v_org and customer.id=v_customer.id
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
    'updatedAt',v_customer.updated_at,'archivedAt',v_customer.archived_at);
  return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,'update_current_customer',
    'customer','customer.updated',v_customer.public_id::text,request_id,idempotency_key,
    btrim(p_reason),'success',null,v_entity);
end;
$$;

create or replace function public.transfer_current_customer_owner(
  p_customer_public_id uuid,p_new_owner_employee_public_id uuid,p_expected_version bigint,
  p_reason text,request_id uuid,idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_tenant bigint; v_org bigint; v_actor bigint; v_user uuid; v_actor_employee uuid;
  v_customer public.customers%rowtype; v_new_owner bigint; v_previous_owner bigint; v_previous_employee uuid;
  v_claim jsonb; v_entity jsonb; v_failure text;
begin
  select * into v_tenant,v_org,v_actor,v_user,v_actor_employee from public.current_crm_command_identity();
  if p_customer_public_id is null or p_new_owner_employee_public_id is null
     or p_expected_version is null or p_expected_version<1
     or p_reason is null or length(btrim(p_reason)) not between 1 and 500
     or request_id is null or idempotency_key is null or request_id=idempotency_key then
    raise exception 'CRM transfer command is invalid' using errcode='22023';
  end if;
  v_claim:=public.claim_crm_command(v_tenant,v_org,v_actor,'transfer_current_customer_owner',
    p_customer_public_id,jsonb_build_object('customerId',p_customer_public_id,
      'newOwnerEmployeePublicId',p_new_owner_employee_public_id,'expectedVersion',p_expected_version,
      'reason',btrim(p_reason)),idempotency_key,request_id);
  if v_claim->>'state'='scope_conflict' then
    return public.audit_crm_scope_conflict(v_tenant,v_org,v_user,v_actor,
      'transfer_current_customer_owner','customer_transfer',p_customer_public_id::text,
      request_id,idempotency_key,btrim(p_reason));
  end if;
  if v_claim->>'state'='replay' then return v_claim->'result'; end if;
  select * into v_customer from public.customers customer
  where customer.tenant_id=v_tenant and customer.organization_id=v_org
    and customer.public_id=p_customer_public_id and customer.archived_at is null for update;
  if not found then
    return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,'transfer_current_customer_owner',
      'customer_transfer','customer.owner_transferred',p_customer_public_id::text,
      request_id,idempotency_key,btrim(p_reason),'failure','not_found',null);
  end if;
  if v_customer.version<>p_expected_version then
    return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,'transfer_current_customer_owner',
      'customer_transfer','customer.owner_transferred',p_customer_public_id::text,
      request_id,idempotency_key,btrim(p_reason),'failure','stale_version',null);
  end if;
  select profile.organization_member_id into v_new_owner
  from public.employee_profiles profile
  join public.organization_members member on member.tenant_id=profile.tenant_id
    and member.organization_id=profile.organization_id
    and member.id=profile.organization_member_id and member.status='active'
  where profile.tenant_id=v_tenant and profile.organization_id=v_org
    and profile.public_id=p_new_owner_employee_public_id and profile.deleted_at is null
    and profile.employment_status in ('probation','active','on_leave') for share of profile,member;
  if not found then
    return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,'transfer_current_customer_owner',
      'customer_transfer','customer.owner_transferred',p_customer_public_id::text,
      request_id,idempotency_key,btrim(p_reason),'failure','owner_unavailable',null);
  end if;
  if v_new_owner=v_customer.owner_member_id then
    return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,'transfer_current_customer_owner',
      'customer_transfer','customer.owner_transferred',p_customer_public_id::text,
      request_id,idempotency_key,btrim(p_reason),'failure','conflict',null);
  end if;
  v_previous_owner:=v_customer.owner_member_id;
  select profile.public_id into v_previous_employee from public.employee_profiles profile
  where profile.tenant_id=v_tenant and profile.organization_id=v_org
    and profile.organization_member_id=v_customer.owner_member_id
  order by (profile.deleted_at is null) desc,profile.updated_at desc,profile.id desc limit 1;
  if v_previous_employee is null then
    return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,'transfer_current_customer_owner',
      'customer_transfer','customer.owner_transferred',p_customer_public_id::text,
      request_id,idempotency_key,btrim(p_reason),'failure','not_found',null);
  end if;
  begin
    perform set_config('quantxy.crm_owner_transfer','allowed',true);
    update public.customers customer set owner_member_id=v_new_owner,updated_by_member_id=v_actor,
      version=customer.version+1,updated_at=clock_timestamp()
    where customer.tenant_id=v_tenant and customer.organization_id=v_org and customer.id=v_customer.id
    returning * into v_customer;
    perform set_config('quantxy.crm_owner_transfer','',true);
    insert into public.customer_ownership_history(
      tenant_id,organization_id,customer_id,previous_owner_member_id,new_owner_member_id,
      changed_by_member_id,customer_version,change_kind,reason_digest,request_id,idempotency_key,changed_at
    ) values (
      v_tenant,v_org,v_customer.id,v_previous_owner,v_new_owner,v_actor,v_customer.version,
      'transfer',encode(public.digest(convert_to(btrim(p_reason),'UTF8'),'sha256'),'hex'),
      request_id,idempotency_key,v_customer.updated_at
    );
  exception when others then
    perform set_config('quantxy.crm_owner_transfer','',true);
    v_failure:='command_failed';
  end;
  if v_failure is not null then
    return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,'transfer_current_customer_owner',
      'customer_transfer','customer.owner_transferred',p_customer_public_id::text,
      request_id,idempotency_key,btrim(p_reason),'failure',v_failure,null);
  end if;
  v_entity:=jsonb_build_object('id',v_customer.public_id,'version',v_customer.version,
    'ownerEmployeePublicId',p_new_owner_employee_public_id,
    'previousOwnerEmployeePublicId',v_previous_employee,'updatedAt',v_customer.updated_at);
  return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,'transfer_current_customer_owner',
    'customer_transfer','customer.owner_transferred',v_customer.public_id::text,
    request_id,idempotency_key,btrim(p_reason),'success',null,v_entity);
end;
$$;

create or replace function public.transition_current_opportunity_stage(
  p_opportunity_public_id uuid,p_stage text,p_loss_reason text,p_expected_version bigint,
  p_reason text,request_id uuid,idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_tenant bigint; v_org bigint; v_actor bigint; v_user uuid; v_actor_employee uuid;
  v_customer public.customers%rowtype; v_opportunity public.opportunities%rowtype;
  v_customer_id bigint; v_customer_public_id uuid; v_owner_employee_public_id uuid;
  v_claim jsonb; v_entity jsonb; v_failure text;
begin
  select * into v_tenant,v_org,v_actor,v_user,v_actor_employee from public.current_crm_command_identity();
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

  select opportunity.customer_id into v_customer_id from public.opportunities opportunity
  where opportunity.tenant_id=v_tenant and opportunity.organization_id=v_org
    and opportunity.public_id=p_opportunity_public_id;
  if not found then
    return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,
      'transition_current_opportunity_stage','opportunity','opportunity.stage_changed',
      p_opportunity_public_id::text,request_id,idempotency_key,btrim(p_reason),'failure','not_found',null);
  end if;
  select * into v_customer from public.customers customer
  where customer.tenant_id=v_tenant and customer.organization_id=v_org
    and customer.id=v_customer_id and customer.archived_at is null for update;
  if not found then
    return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,
      'transition_current_opportunity_stage','opportunity','opportunity.stage_changed',
      p_opportunity_public_id::text,request_id,idempotency_key,btrim(p_reason),'failure','not_found',null);
  end if;
  select * into v_opportunity from public.opportunities opportunity
  where opportunity.tenant_id=v_tenant and opportunity.organization_id=v_org
    and opportunity.public_id=p_opportunity_public_id and opportunity.customer_id=v_customer.id
    and opportunity.archived_at is null for update;
  if not found then
    return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,
      'transition_current_opportunity_stage','opportunity','opportunity.stage_changed',
      p_opportunity_public_id::text,request_id,idempotency_key,btrim(p_reason),'failure','not_found',null);
  end if;
  if v_opportunity.version<>p_expected_version then
    return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,
      'transition_current_opportunity_stage','opportunity','opportunity.stage_changed',
      p_opportunity_public_id::text,request_id,idempotency_key,btrim(p_reason),'failure','stale_version',null);
  end if;
  if not ((v_opportunity.stage='lead' and p_stage='qualified')
    or (v_opportunity.stage='qualified' and p_stage='proposal')
    or (v_opportunity.stage='proposal' and p_stage in ('won','lost'))) then
    return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,
      'transition_current_opportunity_stage','opportunity','opportunity.stage_changed',
      p_opportunity_public_id::text,request_id,idempotency_key,btrim(p_reason),'failure','invalid_stage',null);
  end if;
  select profile.public_id into v_owner_employee_public_id from public.employee_profiles profile
  where profile.tenant_id=v_tenant and profile.organization_id=v_org
    and profile.organization_member_id=v_opportunity.owner_member_id
  order by (profile.deleted_at is null) desc,profile.updated_at desc,profile.id desc limit 1;
  if not found then
    return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,
      'transition_current_opportunity_stage','opportunity','opportunity.stage_changed',
      p_opportunity_public_id::text,request_id,idempotency_key,btrim(p_reason),'failure','not_found',null);
  end if;
  perform set_config('quantxy.crm_stage_reason_digest',
    encode(public.digest(convert_to(btrim(p_reason),'UTF8'),'sha256'),'hex'),true);
  perform set_config('quantxy.crm_stage_request_id',request_id::text,true);
  perform set_config('quantxy.crm_stage_idempotency_key',idempotency_key::text,true);
  begin
    update public.opportunities opportunity set stage=p_stage,
      loss_reason=case when p_stage='lost' then btrim(p_loss_reason) else null end,
      updated_by_member_id=v_actor,version=opportunity.version+1,updated_at=clock_timestamp()
    where opportunity.tenant_id=v_tenant and opportunity.organization_id=v_org
      and opportunity.id=v_opportunity.id returning * into v_opportunity;
  exception when others then v_failure:='command_failed';
  end;
  if v_failure is not null then
    return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,
      'transition_current_opportunity_stage','opportunity','opportunity.stage_changed',
      p_opportunity_public_id::text,request_id,idempotency_key,btrim(p_reason),'failure',v_failure,null);
  end if;
  v_entity:=jsonb_build_object(
    'id',v_opportunity.public_id,'customerId',v_customer.public_id,
    'ownerEmployeePublicId',v_owner_employee_public_id,'name',v_opportunity.name,
    'stage',v_opportunity.stage,'amount',v_opportunity.amount::text,
    'currency',v_opportunity.currency,'expectedCloseOn',v_opportunity.expected_close_on,
    'lossReason',v_opportunity.loss_reason,'version',v_opportunity.version,
    'createdAt',v_opportunity.created_at,'updatedAt',v_opportunity.updated_at,
    'archivedAt',v_opportunity.archived_at);
  return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,
    'transition_current_opportunity_stage','opportunity','opportunity.stage_changed',
    v_opportunity.public_id::text,request_id,idempotency_key,btrim(p_reason),'success',null,v_entity);
end;
$$;

create or replace function public.convert_current_opportunity_to_project(
  p_opportunity_public_id uuid,p_project_name text,p_description text,p_category text,
  p_status text,p_priority text,p_starts_on date,p_due_on date,p_expected_version bigint,
  p_reason text,request_id uuid,idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_tenant bigint; v_org bigint; v_actor bigint; v_user uuid; v_actor_employee uuid;
  v_customer public.customers%rowtype; v_customer_id bigint;
  v_opportunity public.opportunities%rowtype; v_owner_employee_public_id uuid;
  v_claim jsonb; v_project_result jsonb; v_project public.projects%rowtype;
  v_link public.customer_project_links%rowtype; v_entity jsonb; v_failure text;
begin
  select * into v_tenant,v_org,v_actor,v_user,v_actor_employee from public.current_crm_command_identity();
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
  ) then raise exception 'Project command permission required' using errcode='42501';
  end if;
  if p_opportunity_public_id is null or p_project_name is null
     or length(btrim(p_project_name)) not between 1 and 160
     or p_description is null or length(p_description)>4000
     or p_category is null or length(btrim(p_category)) not between 1 and 80
     or p_status is null or p_status not in ('planning','active')
     or p_priority is null or p_priority not in ('low','medium','high','critical')
     or p_starts_on is null or p_due_on is null or not isfinite(p_starts_on)
     or not isfinite(p_due_on) or p_due_on<p_starts_on
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
      'convert_current_opportunity_to_project','opportunity_conversion',p_opportunity_public_id::text,
      request_id,idempotency_key,btrim(p_reason));
  end if;
  if v_claim->>'state'='replay' then return v_claim->'result'; end if;
  select opportunity.customer_id into v_customer_id from public.opportunities opportunity
  where opportunity.tenant_id=v_tenant and opportunity.organization_id=v_org
    and opportunity.public_id=p_opportunity_public_id;
  if not found then
    return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,
      'convert_current_opportunity_to_project','opportunity_conversion','opportunity.converted',
      p_opportunity_public_id::text,request_id,idempotency_key,btrim(p_reason),'failure','not_found',null);
  end if;
  select * into v_customer from public.customers customer
  where customer.tenant_id=v_tenant and customer.organization_id=v_org
    and customer.id=v_customer_id and customer.archived_at is null for update;
  if not found then
    return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,
      'convert_current_opportunity_to_project','opportunity_conversion','opportunity.converted',
      p_opportunity_public_id::text,request_id,idempotency_key,btrim(p_reason),'failure','not_found',null);
  end if;
  select * into v_opportunity from public.opportunities opportunity
  where opportunity.tenant_id=v_tenant and opportunity.organization_id=v_org
    and opportunity.customer_id=v_customer.id and opportunity.public_id=p_opportunity_public_id
    and opportunity.archived_at is null for update;
  if not found then
    return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,
      'convert_current_opportunity_to_project','opportunity_conversion','opportunity.converted',
      p_opportunity_public_id::text,request_id,idempotency_key,btrim(p_reason),'failure','not_found',null);
  end if;
  if v_opportunity.version<>p_expected_version then
    return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,
      'convert_current_opportunity_to_project','opportunity_conversion','opportunity.converted',
      p_opportunity_public_id::text,request_id,idempotency_key,btrim(p_reason),'failure','stale_version',null);
  end if;
  if v_opportunity.stage<>'won' then
    return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,
      'convert_current_opportunity_to_project','opportunity_conversion','opportunity.converted',
      p_opportunity_public_id::text,request_id,idempotency_key,btrim(p_reason),'failure','invalid_stage',null);
  end if;
  if exists (select 1 from public.customer_project_links link
    where link.tenant_id=v_tenant and link.organization_id=v_org
      and link.customer_id=v_customer.id and link.opportunity_id=v_opportunity.id
      and link.archived_at is null) then
    return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,
      'convert_current_opportunity_to_project','opportunity_conversion','opportunity.converted',
      p_opportunity_public_id::text,request_id,idempotency_key,btrim(p_reason),'failure','already_converted',null);
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
      p_opportunity_public_id::text,request_id,idempotency_key,btrim(p_reason),'failure','not_found',null);
  end if;
  begin
    v_project_result:=public.create_current_project_v2(
      btrim(p_project_name),btrim(p_description),btrim(p_category),v_owner_employee_public_id,
      v_opportunity.amount,p_status,p_priority,p_starts_on,p_due_on,0,btrim(p_reason),
      request_id,gen_random_uuid());
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
    ) values (v_tenant,v_org,v_customer.id,v_opportunity.id,v_project.id,v_actor,'delivery')
    returning * into v_link;
    update public.opportunities opportunity set updated_by_member_id=v_actor,
      version=opportunity.version+1,updated_at=clock_timestamp()
    where opportunity.tenant_id=v_tenant and opportunity.organization_id=v_org
      and opportunity.id=v_opportunity.id returning * into v_opportunity;
  exception when unique_violation then v_failure:='already_converted';
  when others then v_failure:=coalesce(v_failure,'command_failed');
  end;
  if v_failure is not null then
    return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,
      'convert_current_opportunity_to_project','opportunity_conversion','opportunity.converted',
      p_opportunity_public_id::text,request_id,idempotency_key,btrim(p_reason),'failure',v_failure,null);
  end if;
  v_entity:=jsonb_build_object(
    'opportunityId',v_opportunity.public_id,'opportunityVersion',v_opportunity.version,
    'projectId',v_project.public_id,'projectVersion',v_project.version,
    'customerProjectLinkId',v_link.public_id,'_resultVersion',v_opportunity.version);
  return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,
    'convert_current_opportunity_to_project','opportunity_conversion','opportunity.converted',
    v_opportunity.public_id::text,request_id,idempotency_key,btrim(p_reason),'success',null,v_entity);
end;
$$;

create or replace function public.create_current_customer_contract(
  p_customer_public_id uuid,p_opportunity_public_id uuid,p_project_public_id uuid,
  p_contract_number text,p_title text,p_status text,p_amount numeric,p_currency text,
  p_signed_on date,p_starts_on date,p_ends_on date,p_version bigint,p_reason text,
  request_id uuid,idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_tenant bigint; v_org bigint; v_actor bigint; v_user uuid; v_actor_employee uuid;
  v_customer public.customers%rowtype; v_opportunity bigint; v_project bigint;
  v_contract public.customer_contracts%rowtype; v_claim jsonb; v_failure text; v_entity jsonb;
begin
  select * into v_tenant,v_org,v_actor,v_user,v_actor_employee from public.current_crm_command_identity();
  if p_customer_public_id is null or (p_opportunity_public_id is null and p_project_public_id is null)
     or p_contract_number is null or length(btrim(p_contract_number)) not between 1 and 80
     or p_title is null or length(btrim(p_title)) not between 1 and 160
     or p_status is null or p_status not in ('draft','active','completed','terminated')
     or p_amount is null or p_amount<0 or p_amount>=10000000000000000::numeric or p_amount='NaN'::numeric
     or p_currency is null or p_currency!~'^[A-Z]{3}$'
     or p_starts_on is null or p_ends_on is null or not isfinite(p_starts_on)
     or not isfinite(p_ends_on) or p_ends_on<p_starts_on
     or (p_signed_on is not null and not isfinite(p_signed_on))
     or p_version is null or p_version<>0
     or p_reason is null or length(btrim(p_reason)) not between 1 and 500
     or request_id is null or idempotency_key is null or request_id=idempotency_key then
    raise exception 'CRM contract command is invalid' using errcode='22023';
  end if;
  v_claim:=public.claim_crm_command(v_tenant,v_org,v_actor,'create_current_customer_contract',null,
    jsonb_build_object('customerId',p_customer_public_id,'opportunityId',p_opportunity_public_id,
      'projectId',p_project_public_id,'contractNumber',btrim(p_contract_number),'title',btrim(p_title),
      'status',p_status,'amount',p_amount::text,'currency',p_currency,'signedOn',p_signed_on,
      'startsOn',p_starts_on,'endsOn',p_ends_on,'version',p_version,'reason',btrim(p_reason)),
    idempotency_key,request_id);
  if v_claim->>'state'='scope_conflict' then
    return public.audit_crm_scope_conflict(v_tenant,v_org,v_user,v_actor,
      'create_current_customer_contract','customer_contract',null,request_id,idempotency_key,btrim(p_reason));
  end if;
  if v_claim->>'state'='replay' then return v_claim->'result'; end if;
  select * into v_customer from public.customers customer
  where customer.tenant_id=v_tenant and customer.organization_id=v_org
    and customer.public_id=p_customer_public_id and customer.archived_at is null for update;
  if not found then
    return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,'create_current_customer_contract',
      'customer_contract','customer.contract_created',v_claim->>'targetPublicId',request_id,idempotency_key,
      btrim(p_reason),'failure','not_found',null);
  end if;
  if p_opportunity_public_id is not null then
    select opportunity.id into v_opportunity from public.opportunities opportunity
    where opportunity.tenant_id=v_tenant and opportunity.organization_id=v_org
      and opportunity.customer_id=v_customer.id and opportunity.public_id=p_opportunity_public_id
      and opportunity.archived_at is null for share;
    if not found then
      return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,'create_current_customer_contract',
        'customer_contract','customer.contract_created',v_claim->>'targetPublicId',request_id,idempotency_key,
        btrim(p_reason),'failure','not_found',null);
    end if;
  end if;
  if p_project_public_id is not null then
    select project.id into v_project from public.customer_project_links link
    join public.projects project on project.tenant_id=link.tenant_id
      and project.organization_id=link.organization_id and project.id=link.project_id
      and project.public_id=p_project_public_id and project.deleted_at is null
    where link.tenant_id=v_tenant and link.organization_id=v_org
      and link.customer_id=v_customer.id and link.archived_at is null
      and (v_opportunity is null or link.opportunity_id=v_opportunity) for share of link,project;
    if not found then
      return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,'create_current_customer_contract',
        'customer_contract','customer.contract_created',v_claim->>'targetPublicId',request_id,idempotency_key,
        btrim(p_reason),'failure','not_found',null);
    end if;
  end if;
  begin
    insert into public.customer_contracts(
      public_id,tenant_id,organization_id,customer_id,opportunity_id,project_id,
      created_by_member_id,updated_by_member_id,contract_number,title,status,amount,currency,
      signed_on,starts_on,ends_on
    ) values (
      (v_claim->>'targetPublicId')::uuid,v_tenant,v_org,v_customer.id,v_opportunity,v_project,
      v_actor,v_actor,btrim(p_contract_number),btrim(p_title),p_status,p_amount,p_currency,
      p_signed_on,p_starts_on,p_ends_on
    ) returning * into v_contract;
  exception when unique_violation then v_failure:='conflict';
  when foreign_key_violation then v_failure:='not_found';
  when others then v_failure:='command_failed';
  end;
  if v_failure is not null then
    return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,'create_current_customer_contract',
      'customer_contract','customer.contract_created',v_claim->>'targetPublicId',request_id,idempotency_key,
      btrim(p_reason),'failure',v_failure,null);
  end if;
  v_entity:=jsonb_build_object('id',v_contract.public_id,'customerId',v_customer.public_id,
    'opportunityId',p_opportunity_public_id,'projectId',p_project_public_id,
    'contractNumber',v_contract.contract_number,'title',v_contract.title,'status',v_contract.status,
    'amount',v_contract.amount::text,'currency',v_contract.currency,'signedOn',v_contract.signed_on,
    'startsOn',v_contract.starts_on,'endsOn',v_contract.ends_on,'version',v_contract.version,
    'createdAt',v_contract.created_at,'updatedAt',v_contract.updated_at);
  return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,'create_current_customer_contract',
    'customer_contract','customer.contract_created',v_contract.public_id::text,request_id,idempotency_key,
    btrim(p_reason),'success',null,v_entity);
end;
$$;

create or replace function public.create_current_crm_source_link(
  p_customer_public_id uuid,p_contact_public_id uuid,p_opportunity_public_id uuid,
  p_project_public_id uuid,p_source_system text,p_external_record_id text,p_source_url text,
  p_version bigint,p_reason text,request_id uuid,idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_tenant bigint; v_org bigint; v_actor bigint; v_user uuid; v_actor_employee uuid;
  v_customer public.customers%rowtype; v_contact bigint; v_opportunity bigint; v_project bigint;
  v_link public.crm_source_links%rowtype; v_claim jsonb; v_failure text; v_entity jsonb;
begin
  select * into v_tenant,v_org,v_actor,v_user,v_actor_employee from public.current_crm_command_identity();
  if p_customer_public_id is null or num_nonnulls(p_contact_public_id,p_opportunity_public_id,p_project_public_id)<>1
     or p_source_system is null or p_source_system not in ('feishu','import','external_crm','n8n','other')
     or p_external_record_id is null or length(btrim(p_external_record_id)) not between 1 and 255
     or (p_source_url is not null and (length(p_source_url)>2048
       or p_source_url!~'^https://[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?([/?]|$)'
       or p_source_url~*'^https://[^/?]*@'
       or position('#' in p_source_url)>0
       or p_source_url~*'[?&](token|access_token|key|api_key|signature|sig|auth|password|secret)(=|&|$)'
       or p_source_url~*'[?&][^=&#]*%[^=&#]*='))
     or p_version is null or p_version<>0
     or p_reason is null or length(btrim(p_reason)) not between 1 and 500
     or request_id is null or idempotency_key is null or request_id=idempotency_key then
    raise exception 'CRM source command is invalid' using errcode='22023';
  end if;
  v_claim:=public.claim_crm_command(v_tenant,v_org,v_actor,'create_current_crm_source_link',null,
    jsonb_build_object('customerId',p_customer_public_id,'contactId',p_contact_public_id,
      'opportunityId',p_opportunity_public_id,'projectId',p_project_public_id,
      'sourceSystem',p_source_system,
      'externalRecordDigest',encode(public.digest(convert_to(btrim(p_external_record_id),'UTF8'),'sha256'),'hex'),
      'sourceUrlDigest',case when p_source_url is null then null else encode(
        public.digest(convert_to(p_source_url,'UTF8'),'sha256'),'hex') end,
      'version',p_version,'reason',btrim(p_reason)),idempotency_key,request_id);
  if v_claim->>'state'='scope_conflict' then
    return public.audit_crm_scope_conflict(v_tenant,v_org,v_user,v_actor,
      'create_current_crm_source_link','crm_source_link',null,request_id,idempotency_key,btrim(p_reason));
  end if;
  if v_claim->>'state'='replay' then return v_claim->'result'; end if;
  select * into v_customer from public.customers customer
  where customer.tenant_id=v_tenant and customer.organization_id=v_org
    and customer.public_id=p_customer_public_id and customer.archived_at is null for update;
  if not found then v_failure:='not_found'; end if;
  if v_failure is null and p_contact_public_id is not null then
    select contact.id into v_contact from public.customer_contacts contact
    where contact.tenant_id=v_tenant and contact.organization_id=v_org
      and contact.customer_id=v_customer.id and contact.public_id=p_contact_public_id
      and contact.archived_at is null for share;
    if not found then v_failure:='not_found'; end if;
  elsif v_failure is null and p_opportunity_public_id is not null then
    select opportunity.id into v_opportunity from public.opportunities opportunity
    where opportunity.tenant_id=v_tenant and opportunity.organization_id=v_org
      and opportunity.customer_id=v_customer.id and opportunity.public_id=p_opportunity_public_id
      and opportunity.archived_at is null for share;
    if not found then v_failure:='not_found'; end if;
  elsif v_failure is null and p_project_public_id is not null then
    select project.id into v_project from public.customer_project_links link
    join public.projects project on project.tenant_id=link.tenant_id
      and project.organization_id=link.organization_id and project.id=link.project_id
      and project.public_id=p_project_public_id and project.deleted_at is null
    where link.tenant_id=v_tenant and link.organization_id=v_org
      and link.customer_id=v_customer.id and link.archived_at is null for share of link,project;
    if not found then v_failure:='not_found'; end if;
  end if;
  if v_failure is null then
    begin
      insert into public.crm_source_links(
        public_id,tenant_id,organization_id,customer_id,contact_id,opportunity_id,project_id,
        linked_by_member_id,source_system,external_record_id,source_url
      ) values (
        (v_claim->>'targetPublicId')::uuid,v_tenant,v_org,v_customer.id,v_contact,v_opportunity,v_project,
        v_actor,p_source_system,btrim(p_external_record_id),p_source_url
      ) returning * into v_link;
    exception when unique_violation then v_failure:='conflict';
    when foreign_key_violation then v_failure:='not_found';
    when others then v_failure:='command_failed';
    end;
  end if;
  if v_failure is not null then
    return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,'create_current_crm_source_link',
      'crm_source_link','customer.source_linked',v_claim->>'targetPublicId',request_id,idempotency_key,
      btrim(p_reason),'failure',v_failure,null);
  end if;
  v_entity:=jsonb_build_object('id',v_link.public_id,'customerId',v_customer.public_id,
    'contactId',p_contact_public_id,'opportunityId',p_opportunity_public_id,'projectId',p_project_public_id,
    'sourceSystem',v_link.source_system,'externalRecordId',v_link.external_record_id,
    'sourceUrl',v_link.source_url,'createdAt',v_link.created_at);
  return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,'create_current_crm_source_link',
    'crm_source_link','customer.source_linked',v_link.public_id::text,request_id,idempotency_key,
    btrim(p_reason),'success',null,v_entity);
end;
$$;

create or replace function public.change_current_customer_archive_state(
  p_customer_public_id uuid,p_expected_version bigint,p_reason text,
  request_id uuid,idempotency_key uuid,p_archive boolean
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_tenant bigint; v_org bigint; v_actor bigint; v_user uuid; v_actor_employee uuid;
  v_operation text:=case when p_archive then 'archive_current_customer' else 'restore_current_customer' end;
  v_action text:=case when p_archive then 'customer.archived' else 'customer.restored' end;
  v_customer public.customers%rowtype; v_claim jsonb; v_failure text; v_entity jsonb;
begin
  select * into v_tenant,v_org,v_actor,v_user,v_actor_employee from public.current_crm_command_identity();
  if p_customer_public_id is null or p_expected_version is null or p_expected_version<1
     or p_reason is null or length(btrim(p_reason)) not between 1 and 500
     or request_id is null or idempotency_key is null or request_id=idempotency_key then
    raise exception 'CRM lifecycle command is invalid' using errcode='22023';
  end if;
  v_claim:=public.claim_crm_command(v_tenant,v_org,v_actor,v_operation,p_customer_public_id,
    jsonb_build_object('customerId',p_customer_public_id,'expectedVersion',p_expected_version,
      'archive',p_archive,'reason',btrim(p_reason)),idempotency_key,request_id);
  if v_claim->>'state'='scope_conflict' then
    return public.audit_crm_scope_conflict(v_tenant,v_org,v_user,v_actor,v_operation,
      'customer_lifecycle',p_customer_public_id::text,request_id,idempotency_key,btrim(p_reason));
  end if;
  if v_claim->>'state'='replay' then return v_claim->'result'; end if;
  select * into v_customer from public.customers customer
  where customer.tenant_id=v_tenant and customer.organization_id=v_org
    and customer.public_id=p_customer_public_id for update;
  if not found then v_failure:='not_found';
  elsif v_customer.version<>p_expected_version then v_failure:='stale_version';
  elsif p_archive and v_customer.archived_at is not null then v_failure:='already_archived';
  elsif not p_archive and v_customer.archived_at is null then v_failure:='not_archived';
  end if;
  if v_failure is null and not p_archive and not exists (
    select 1 from public.organization_members member
    join public.employee_profiles profile on profile.tenant_id=member.tenant_id
      and profile.organization_id=member.organization_id
      and profile.organization_member_id=member.id and profile.deleted_at is null
      and profile.employment_status in ('probation','active','on_leave')
    where member.tenant_id=v_tenant and member.organization_id=v_org
      and member.id=v_customer.owner_member_id and member.status='active'
  ) then v_failure:='owner_unavailable';
  end if;
  if v_failure is null then
    begin
      update public.customers customer set archived_at=case when p_archive then clock_timestamp() else null end,
        updated_by_member_id=v_actor,version=customer.version+1,updated_at=clock_timestamp()
      where customer.tenant_id=v_tenant and customer.organization_id=v_org and customer.id=v_customer.id
      returning * into v_customer;
    exception when unique_violation then v_failure:='conflict';
    when others then v_failure:='command_failed';
    end;
  end if;
  if v_failure is not null then
    return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,v_operation,
      'customer_lifecycle',v_action,p_customer_public_id::text,request_id,idempotency_key,
      btrim(p_reason),'failure',v_failure,null);
  end if;
  v_entity:=jsonb_build_object('id',v_customer.public_id,'version',v_customer.version,
    'archived',p_archive,'archivedAt',v_customer.archived_at);
  return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,v_operation,
    'customer_lifecycle',v_action,v_customer.public_id::text,request_id,idempotency_key,
    btrim(p_reason),'success',null,v_entity);
end;
$$;

create or replace function public.archive_current_customer(
  p_customer_public_id uuid,p_expected_version bigint,p_reason text,
  request_id uuid,idempotency_key uuid
)
returns jsonb language sql security definer set search_path=''
as $$
  select public.change_current_customer_archive_state(
    p_customer_public_id,p_expected_version,p_reason,request_id,idempotency_key,true);
$$;

create or replace function public.restore_current_customer(
  p_customer_public_id uuid,p_expected_version bigint,p_reason text,
  request_id uuid,idempotency_key uuid
)
returns jsonb language sql security definer set search_path=''
as $$
  select public.change_current_customer_archive_state(
    p_customer_public_id,p_expected_version,p_reason,request_id,idempotency_key,false);
$$;

create or replace function public.begin_current_crm_import(
  p_payload_digest text,p_total_rows integer,p_valid_rows integer,
  p_accepted_manifest jsonb,p_validation_rejections jsonb,
  p_reason text,request_id uuid,idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_tenant bigint; v_org bigint; v_actor bigint; v_user uuid; v_actor_employee uuid;
  v_claim jsonb; v_job public.crm_import_jobs%rowtype; v_entity jsonb;
begin
  select * into v_tenant,v_org,v_actor,v_user,v_actor_employee
  from public.current_crm_exchange_identity('customer.import');
  if p_total_rows is null or p_total_rows not between 1 and 200
     or p_valid_rows is null or p_valid_rows not between 0 and p_total_rows
     or p_accepted_manifest is null or jsonb_typeof(p_accepted_manifest)<>'array'
     or p_validation_rejections is null or jsonb_typeof(p_validation_rejections)<>'array' then
    raise exception 'CRM import job is invalid' using errcode='22023';
  end if;
  if p_payload_digest is null or p_payload_digest!~'^[0-9a-f]{64}$'
     or jsonb_array_length(p_accepted_manifest)<>p_valid_rows
     or length(p_accepted_manifest::text)>65536
     or exists (
       select 1 from jsonb_array_elements(p_accepted_manifest) accepted
       where case when jsonb_typeof(accepted)<>'object' then true else
         not (accepted ? 'index' and accepted ? 'rowDigest')
         or exists (select 1 from jsonb_object_keys(accepted) key where key not in ('index','rowDigest'))
         or coalesce((accepted->>'index')~'^[0-9]+$',false)=false
         or case when coalesce((accepted->>'index')~'^[0-9]+$',false)
           then (accepted->>'index')::numeric not between 0 and p_total_rows-1 else true end
         or coalesce((accepted->>'rowDigest')~'^[0-9a-f]{64}$',false)=false end
     )
     or (select count(distinct case when coalesce((accepted->>'index')~'^[0-9]+$',false)
          then accepted->>'index' end) from jsonb_array_elements(p_accepted_manifest) accepted)<>p_valid_rows
     or jsonb_array_length(p_validation_rejections)<>p_total_rows-p_valid_rows
     or length(p_validation_rejections::text)>65536
     or exists (
       select 1 from jsonb_array_elements(p_validation_rejections) rejection
       where case when jsonb_typeof(rejection)<>'object' then true else
         not (rejection ? 'index' and rejection ? 'errors')
         or exists (select 1 from jsonb_object_keys(rejection) key where key not in ('index','errors'))
         or case when jsonb_typeof(rejection->'errors')<>'array' then true else
           jsonb_array_length(rejection->'errors') not between 1 and 16
           or exists (
             select 1 from jsonb_array_elements(rejection->'errors') error_code
             where jsonb_typeof(error_code)<>'string' or error_code#>>'{}' not in (
               'rows_required','invalid_row_count','invalid_row','untrusted_scope_field','unknown_field',
               'invalid_name','invalid_registration_code','invalid_owner','invalid_industry','invalid_source',
               'invalid_region','invalid_contact_shape','invalid_contact_name','invalid_contact_title',
               'invalid_contact_phone','invalid_contact_email','contact_channel_required',
               'invalid_contact_visibility','invalid_contact_primary_flag','duplicate_name_in_batch',
               'duplicate_registration_in_batch'
             )
           ) end
         or coalesce((rejection->>'index')~'^[0-9]+$',false)=false
         or case when coalesce((rejection->>'index')~'^[0-9]+$',false)
           then (rejection->>'index')::numeric not between 0 and p_total_rows-1 else true end end
     )
     or (select count(distinct case when coalesce((rejection->>'index')~'^[0-9]+$',false)
          then rejection->>'index' end) from jsonb_array_elements(p_validation_rejections) rejection)
        <>p_total_rows-p_valid_rows
     or exists (
       select 1 from generate_series(0,p_total_rows-1) row_index
       where not exists (select 1 from jsonb_array_elements(p_accepted_manifest) accepted
          where accepted->>'index'=row_index::text)
         and not exists (select 1 from jsonb_array_elements(p_validation_rejections) rejection
          where rejection->>'index'=row_index::text)
     )
     or exists (
       select 1 from jsonb_array_elements(p_accepted_manifest) accepted
       join jsonb_array_elements(p_validation_rejections) rejection
         on rejection->>'index'=accepted->>'index'
     )
     or p_reason is null or length(btrim(p_reason)) not between 1 and 500
     or request_id is null or idempotency_key is null or request_id=idempotency_key then
    raise exception 'CRM import job is invalid' using errcode='22023';
  end if;
  v_claim:=public.claim_crm_command(v_tenant,v_org,v_actor,'begin_current_crm_import',null,
    jsonb_build_object('payloadDigest',p_payload_digest,'totalRows',p_total_rows,
      'validRows',p_valid_rows,'acceptedManifest',p_accepted_manifest,
      'validationRejections',p_validation_rejections,
      'reason',btrim(p_reason)),idempotency_key,request_id);
  if v_claim->>'state'='scope_conflict' then
    return public.audit_crm_scope_conflict(v_tenant,v_org,v_user,v_actor,
      'begin_current_crm_import','crm_import_job',null,request_id,idempotency_key,btrim(p_reason));
  end if;
  if v_claim->>'state'='replay' then return v_claim->'result'; end if;
  insert into public.crm_import_jobs(
    public_id,tenant_id,organization_id,requested_by_member_id,payload_digest,total_rows,
    valid_rows,accepted_manifest,validation_rejections,status
  ) values (
    (v_claim->>'targetPublicId')::uuid,v_tenant,v_org,v_actor,p_payload_digest,p_total_rows,
    p_valid_rows,p_accepted_manifest,p_validation_rejections,'running'
  ) returning * into v_job;
  v_entity:=jsonb_build_object('id',v_job.public_id,'version',1,'status',v_job.status,
    'totalRows',v_job.total_rows,'validRows',v_job.valid_rows,
    'validationRejectedRows',jsonb_array_length(v_job.validation_rejections));
  return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,'begin_current_crm_import',
    'crm_import_job','customer.import_started',v_job.public_id::text,request_id,idempotency_key,
    btrim(p_reason),'success',null,v_entity);
end;
$$;

create or replace function public.import_current_customer_row(
  p_import_job_public_id uuid,p_row_index integer,p_row_digest text,
  p_name text,p_registration_code text,p_owner_employee_public_id uuid,
  p_industry text,p_source text,p_region text,p_contact_name text,p_contact_title text,
  p_contact_phone text,p_contact_email text,p_contact_visibility text,p_contact_is_primary boolean,
  p_version bigint,p_reason text,request_id uuid,idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_tenant bigint; v_org bigint; v_actor bigint; v_user uuid; v_actor_employee uuid;
  v_claim jsonb; v_job public.crm_import_jobs%rowtype; v_owner bigint;
  v_customer public.customers%rowtype; v_contact public.customer_contacts%rowtype;
  v_failure text; v_entity jsonb; v_name text; v_registration text; v_has_contact boolean;
  v_computed_digest text; v_manifest_digest text; v_manifest_accepted boolean:=false;
begin
  select * into v_tenant,v_org,v_actor,v_user,v_actor_employee
  from public.current_crm_exchange_identity('customer.import');
  v_name:=public.normalize_crm_name(p_name);
  v_registration:=case when p_registration_code is null then null else btrim(p_registration_code) end;
  v_has_contact:=p_contact_name is not null;
  if p_import_job_public_id is null or p_row_index is null or p_row_index<0
     or p_row_digest is null or p_row_digest!~'^[0-9a-f]{64}$'
     or nullif(v_name,'') is null or length(v_name)>160
     or (v_registration is not null and length(v_registration) not between 1 and 80)
     or p_owner_employee_public_id is null or p_industry is null
     or length(btrim(p_industry)) not between 1 and 80
     or p_source is null or p_source not in ('consulting','referral','event','outbound','other')
     or p_region is null or length(btrim(p_region))>120
     or (v_has_contact and (length(btrim(p_contact_name)) not between 1 and 120
       or p_contact_title is null or length(p_contact_title)>120
       or (p_contact_phone is null and p_contact_email is null)
       or (p_contact_phone is not null and length(btrim(p_contact_phone)) not between 1 and 80)
       or (p_contact_email is not null and (length(btrim(p_contact_email)) not between 3 and 320
         or btrim(p_contact_email)!~*'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'))
       or p_contact_visibility is null or p_contact_visibility not in ('assigned','managers')
       or p_contact_is_primary is null))
     or (not v_has_contact and num_nonnulls(p_contact_title,p_contact_phone,p_contact_email,
       p_contact_visibility,p_contact_is_primary)>0)
     or p_version is null or p_version<>0
     or p_reason is null or length(btrim(p_reason)) not between 1 and 500
     or request_id is null or idempotency_key is null or request_id=idempotency_key then
    raise exception 'CRM import row is invalid' using errcode='22023';
  end if;
  v_claim:=public.claim_crm_command(v_tenant,v_org,v_actor,'import_current_customer_row',null,
    jsonb_build_object('importJobId',p_import_job_public_id,'rowIndex',p_row_index,
      'rowDigest',p_row_digest,'reason',btrim(p_reason)),idempotency_key,request_id);
  if v_claim->>'state'='scope_conflict' then
    return public.audit_crm_scope_conflict(v_tenant,v_org,v_user,v_actor,
      'import_current_customer_row','customer_import',null,request_id,idempotency_key,btrim(p_reason));
  end if;
  if v_claim->>'state'='replay' then return v_claim->'result'; end if;
  select * into v_job from public.crm_import_jobs job
  where job.tenant_id=v_tenant and job.organization_id=v_org
    and job.public_id=p_import_job_public_id and job.requested_by_member_id=v_actor for update;
  if not found or v_job.status<>'running' or p_row_index>=v_job.total_rows then v_failure:='not_found';
  elsif exists (
    select 1 from public.crm_import_rows row_result
    where row_result.tenant_id=v_tenant and row_result.organization_id=v_org
      and row_result.import_job_id=v_job.id and row_result.row_index=p_row_index
  ) then v_failure:='conflict';
  end if;
  if v_failure is null then
    select accepted->>'rowDigest' into v_manifest_digest
    from jsonb_array_elements(v_job.accepted_manifest) accepted
    where accepted->>'index'=p_row_index::text;
    v_computed_digest:=public.compute_crm_import_row_digest(
      v_name,v_registration,p_owner_employee_public_id,btrim(p_industry),p_source,btrim(p_region),
      case when p_contact_name is null then null else btrim(p_contact_name) end,
      case when p_contact_title is null then null else btrim(p_contact_title) end,
      case when p_contact_phone is null then null else btrim(p_contact_phone) end,
      case when p_contact_email is null then null else lower(btrim(p_contact_email)) end,
      p_contact_visibility,p_contact_is_primary);
    if v_manifest_digest is null or v_manifest_digest<>p_row_digest
       or v_computed_digest<>p_row_digest then
      v_failure:='invalid_request';
    else
      v_manifest_accepted:=true;
    end if;
  end if;
  if v_failure is null then
    select profile.organization_member_id into v_owner
    from public.employee_profiles profile
    join public.organization_members member on member.tenant_id=profile.tenant_id
      and member.organization_id=profile.organization_id
      and member.id=profile.organization_member_id and member.status='active'
    where profile.tenant_id=v_tenant and profile.organization_id=v_org
      and profile.public_id=p_owner_employee_public_id and profile.deleted_at is null
      and profile.employment_status in ('probation','active','on_leave') for share of profile,member;
    if not found then v_failure:='not_found'; end if;
  end if;
  if v_failure is null then
    begin
      insert into public.customers(
        public_id,tenant_id,organization_id,owner_member_id,created_by_member_id,updated_by_member_id,
        name,registration_code,industry,source,region,status
      ) values (
        (v_claim->>'targetPublicId')::uuid,v_tenant,v_org,v_owner,v_actor,v_actor,
        v_name,v_registration,btrim(p_industry),p_source,btrim(p_region),'lead'
      ) returning * into v_customer;
      if v_has_contact then
        insert into public.customer_contacts(
          tenant_id,organization_id,customer_id,created_by_member_id,updated_by_member_id,
          name,title,phone,email,visibility,is_primary
        ) values (
          v_tenant,v_org,v_customer.id,v_actor,v_actor,btrim(p_contact_name),btrim(p_contact_title),
          case when p_contact_phone is null then null else btrim(p_contact_phone) end,
          case when p_contact_email is null then null else lower(btrim(p_contact_email)) end,
          p_contact_visibility,p_contact_is_primary
        ) returning * into v_contact;
      end if;
      insert into public.crm_source_links(
        tenant_id,organization_id,customer_id,contact_id,linked_by_member_id,
        source_system,external_record_id
      ) values (
        v_tenant,v_org,v_customer.id,case when v_has_contact then v_contact.id else null end,v_actor,
        'import',v_job.public_id::text||':'||p_row_index::text
      );
      insert into public.crm_import_rows(
        tenant_id,organization_id,import_job_id,row_index,row_digest,status,customer_id
      ) values (v_tenant,v_org,v_job.id,p_row_index,v_computed_digest,'imported',v_customer.id);
    exception when unique_violation then v_failure:='conflict';
    when foreign_key_violation then v_failure:='not_found';
    when others then v_failure:='command_failed';
    end;
  end if;
  if v_failure is not null then
    if v_manifest_accepted and v_job.id is not null and not exists (
      select 1 from public.crm_import_rows row_result
      where row_result.tenant_id=v_tenant and row_result.organization_id=v_org
        and row_result.import_job_id=v_job.id and row_result.row_index=p_row_index
    ) then
      insert into public.crm_import_rows(
        tenant_id,organization_id,import_job_id,row_index,row_digest,status,error_code
      ) values (v_tenant,v_org,v_job.id,p_row_index,v_computed_digest,'rejected',
        case when v_failure in ('conflict','not_found','invalid_request') then v_failure else 'command_failed' end);
    end if;
    return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,'import_current_customer_row',
      'customer_import','customer.imported',v_claim->>'targetPublicId',request_id,idempotency_key,
      btrim(p_reason),'failure',v_failure,null);
  end if;
  v_entity:=jsonb_build_object('id',v_customer.public_id,'version',v_customer.version,
    'contactId',case when v_has_contact then v_contact.public_id else null end,
    'name',v_customer.name,'registrationCode',v_customer.registration_code);
  return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,'import_current_customer_row',
    'customer_import','customer.imported',v_customer.public_id::text,request_id,idempotency_key,
    btrim(p_reason),'success',null,v_entity);
end;
$$;

create or replace function public.finalize_current_crm_import(
  p_import_job_public_id uuid,p_reason text,request_id uuid,idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_tenant bigint; v_org bigint; v_actor bigint; v_user uuid; v_actor_employee uuid;
  v_claim jsonb; v_job public.crm_import_jobs%rowtype; v_succeeded integer; v_failed integer;
  v_validation_failed integer; v_status text; v_entity jsonb;
begin
  select * into v_tenant,v_org,v_actor,v_user,v_actor_employee
  from public.current_crm_exchange_identity('customer.import');
  if p_import_job_public_id is null or p_reason is null or length(btrim(p_reason)) not between 1 and 500
     or request_id is null or idempotency_key is null or request_id=idempotency_key then
    raise exception 'CRM import completion is invalid' using errcode='22023';
  end if;
  v_claim:=public.claim_crm_command(v_tenant,v_org,v_actor,'finalize_current_crm_import',
    p_import_job_public_id,jsonb_build_object('importJobId',p_import_job_public_id,
      'reason',btrim(p_reason)),idempotency_key,request_id);
  if v_claim->>'state'='scope_conflict' then
    return public.audit_crm_scope_conflict(v_tenant,v_org,v_user,v_actor,
      'finalize_current_crm_import','crm_import_job',p_import_job_public_id::text,
      request_id,idempotency_key,btrim(p_reason));
  end if;
  if v_claim->>'state'='replay' then return v_claim->'result'; end if;
  select * into v_job from public.crm_import_jobs job
  where job.tenant_id=v_tenant and job.organization_id=v_org
    and job.public_id=p_import_job_public_id and job.requested_by_member_id=v_actor for update;
  if not found or v_job.status<>'running' then
    return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,'finalize_current_crm_import',
      'crm_import_job','customer.import_completed',p_import_job_public_id::text,
      request_id,idempotency_key,btrim(p_reason),'failure','not_found',null);
  end if;
  select count(*) filter(where row_result.status='imported')::integer,
    count(*) filter(where row_result.status='rejected')::integer
  into v_succeeded,v_failed from public.crm_import_rows row_result
  where row_result.tenant_id=v_tenant and row_result.organization_id=v_org
    and row_result.import_job_id=v_job.id;
  if v_succeeded+v_failed<>v_job.valid_rows then
    return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,'finalize_current_crm_import',
      'crm_import_job','customer.import_completed',p_import_job_public_id::text,
      request_id,idempotency_key,btrim(p_reason),'failure','conflict',null);
  end if;
  v_validation_failed:=jsonb_array_length(v_job.validation_rejections);
  v_status:=case when v_failed+v_validation_failed=0 then 'completed' else 'completed_with_errors' end;
  update public.crm_import_jobs job set status=v_status,succeeded_rows=v_succeeded,
    failed_rows=v_failed,completed_at=clock_timestamp()
  where job.tenant_id=v_tenant and job.organization_id=v_org and job.id=v_job.id returning * into v_job;
  v_entity:=jsonb_build_object('id',v_job.public_id,'version',1,'status',v_job.status,
    'totalRows',v_job.total_rows,'acceptedRows',v_job.succeeded_rows,
    'rejectedRows',v_job.failed_rows+v_validation_failed);
  return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,'finalize_current_crm_import',
    'crm_import_job','customer.import_completed',v_job.public_id::text,request_id,idempotency_key,
    btrim(p_reason),'success',null,v_entity);
end;
$$;

create or replace function public.request_current_crm_export(
  p_customer_public_id uuid,p_include_contact_pii boolean,p_reason text,
  request_id uuid,idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_tenant bigint; v_org bigint; v_actor bigint; v_user uuid; v_actor_employee uuid;
  v_claim jsonb; v_job public.crm_export_jobs%rowtype; v_snapshot jsonb; v_columns jsonb;
  v_row_count integer; v_exported_at timestamptz:=clock_timestamp();
  v_entity jsonb; v_failure text;
begin
  select * into v_tenant,v_org,v_actor,v_user,v_actor_employee
  from public.current_crm_exchange_identity('customer.export');
  if p_include_contact_pii is null or p_reason is null or length(btrim(p_reason)) not between 1 and 500
     or request_id is null or idempotency_key is null or request_id=idempotency_key then
    raise exception 'CRM export request is invalid' using errcode='22023';
  end if;
  if p_include_contact_pii then
    perform 1 from public.current_crm_exchange_identity('customer.export_pii');
  end if;
  v_claim:=public.claim_crm_command(v_tenant,v_org,v_actor,'request_current_crm_export',null,
    jsonb_build_object('customerId',p_customer_public_id,'includeContactPii',p_include_contact_pii,
      'reason',btrim(p_reason)),idempotency_key,request_id);
  if v_claim->>'state'='scope_conflict' then
    return public.audit_crm_scope_conflict(v_tenant,v_org,v_user,v_actor,
      'request_current_crm_export','crm_export',null,request_id,idempotency_key,btrim(p_reason));
  end if;
  if v_claim->>'state'='replay' then return v_claim->'result'; end if;
  if p_customer_public_id is not null and not exists (
    select 1 from public.customers customer
    where customer.tenant_id=v_tenant and customer.organization_id=v_org
      and customer.public_id=p_customer_public_id and customer.archived_at is null
      and public.can_read_current_customer(customer.tenant_id,customer.organization_id,customer.owner_member_id)
  ) then
    return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,'request_current_crm_export',
      'crm_export','customer.export_requested',v_claim->>'targetPublicId',request_id,idempotency_key,
      btrim(p_reason),'failure','not_found',null);
  end if;
  begin
    update public.crm_export_jobs job set snapshot=null,state='expired',purged_at=clock_timestamp()
    where job.id in (
      select expired.id from public.crm_export_jobs expired
      where expired.tenant_id=v_tenant and expired.organization_id=v_org
        and expired.state='completed' and expired.expires_at<=clock_timestamp()
      order by expired.expires_at,expired.id limit 100 for update skip locked
    );
    select coalesce(jsonb_agg(export_row.payload order by export_row.updated_at desc,export_row.id desc),'[]'::jsonb)
    into v_snapshot
    from (
      select customer.id,customer.updated_at,
        jsonb_build_object(
          'id',customer.public_id,'name',customer.name,'registrationCode',customer.registration_code,
          'industry',customer.industry,'source',customer.source,'region',customer.region,
          'status',customer.status,'ownerEmployeePublicId',owner.public_id
        ) || case when p_include_contact_pii then jsonb_build_object('primaryContact',(
          select jsonb_build_object('id',contact.public_id,'name',contact.name,'title',contact.title,
            'phone',contact.phone,'email',contact.email)
          from public.customer_contacts contact
          where contact.tenant_id=customer.tenant_id and contact.organization_id=customer.organization_id
            and contact.customer_id=customer.id and contact.archived_at is null and contact.is_primary
            and (public.can_manage_current_crm(customer.tenant_id,customer.organization_id)
              or (contact.visibility='assigned' and public.can_read_current_customer(
                customer.tenant_id,customer.organization_id,customer.owner_member_id)))
          order by contact.updated_at desc,contact.id desc limit 1
        )) else '{}'::jsonb end as payload
      from public.customers customer
      left join lateral (
        select profile.public_id
        from public.employee_profiles profile
        where profile.tenant_id=customer.tenant_id and profile.organization_id=customer.organization_id
          and profile.organization_member_id=customer.owner_member_id
        order by (profile.deleted_at is null) desc,profile.updated_at desc,profile.id desc limit 1
      ) owner on true
      where customer.tenant_id=v_tenant and customer.organization_id=v_org
        and customer.archived_at is null
        and (p_customer_public_id is null or customer.public_id=p_customer_public_id)
        and public.can_read_current_customer(customer.tenant_id,customer.organization_id,customer.owner_member_id)
      order by customer.updated_at desc,customer.id desc limit 5001
    ) export_row;
    v_row_count:=jsonb_array_length(v_snapshot);
    if v_row_count>5000 then
      v_failure:='export_too_large';
    elsif exists (select 1 from jsonb_array_elements(v_snapshot) export_item
      where export_item->>'ownerEmployeePublicId' is null) then
      v_failure:='command_failed';
    end if;
    v_columns:=case when p_include_contact_pii then
      '["id","name","registrationCode","industry","source","region","status","ownerEmployeePublicId","primaryContact"]'::jsonb
    else '["id","name","registrationCode","industry","source","region","status","ownerEmployeePublicId"]'::jsonb end;
    if v_failure is null then
      insert into public.crm_export_jobs(
        public_id,tenant_id,organization_id,requested_by_member_id,customer_id,include_contact_pii,
        columns,row_count,snapshot,sha256,watermark,state,created_at,expires_at
      ) values (
        (v_claim->>'targetPublicId')::uuid,v_tenant,v_org,v_actor,
        (select customer.id from public.customers customer
          where customer.tenant_id=v_tenant and customer.organization_id=v_org
            and customer.public_id=p_customer_public_id),
        p_include_contact_pii,v_columns,v_row_count,v_snapshot,
        encode(public.digest(convert_to(v_snapshot::text,'UTF8'),'sha256'),'hex'),
        gen_random_uuid(),'completed',v_exported_at,v_exported_at+interval '15 minutes'
      ) returning * into v_job;
    end if;
  exception when others then
    v_failure:='command_failed';
  end;
  if v_failure is not null then
    return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,'request_current_crm_export',
      'crm_export','customer.export_requested',v_claim->>'targetPublicId',request_id,idempotency_key,
      btrim(p_reason),'failure',v_failure,null);
  end if;
  v_entity:=jsonb_build_object('id',v_job.public_id,'version',1,'watermark',v_job.watermark,
    'scope',case when p_customer_public_id is null then 'all' else 'customer' end,
    'customerId',p_customer_public_id,'includeContactPii',v_job.include_contact_pii,
    'rowCount',v_job.row_count,'exportedAt',v_job.created_at,'expiresAt',v_job.expires_at,
    'sha256',v_job.sha256,
    'downloadUrl','/api/workstation/customers/export/'||v_job.public_id::text);
  return public.complete_crm_command(v_tenant,v_org,v_user,v_actor,'request_current_crm_export',
    'crm_export','customer.export_requested',v_job.public_id::text,request_id,idempotency_key,
    btrim(p_reason),'success',null,v_entity);
end;
$$;

create or replace function public.download_current_crm_export(
  p_export_public_id uuid,request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_tenant bigint; v_org bigint; v_actor bigint; v_user uuid; v_actor_employee uuid;
  v_job public.crm_export_jobs%rowtype; v_digest text;
begin
  select * into v_tenant,v_org,v_actor,v_user,v_actor_employee
  from public.current_crm_exchange_identity('customer.export');
  if p_export_public_id is null or request_id is null then
    raise exception 'CRM export download is invalid' using errcode='22023';
  end if;
  select * into v_job from public.crm_export_jobs job
  where job.tenant_id=v_tenant and job.organization_id=v_org
    and job.public_id=p_export_public_id and job.requested_by_member_id=v_actor for update;
  if not found then return jsonb_build_object('outcome','failure','error','not_found'); end if;
  if v_job.state='expired' or v_job.expires_at<=clock_timestamp() then
    if v_job.state='completed' then
      update public.crm_export_jobs job set snapshot=null,state='expired',purged_at=clock_timestamp()
      where job.tenant_id=v_tenant and job.organization_id=v_org and job.id=v_job.id;
    end if;
    return jsonb_build_object('outcome','failure','error','export_expired');
  end if;
  if v_job.include_contact_pii then
    perform 1 from public.current_crm_exchange_identity('customer.export_pii');
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_job.snapshot) export_row
    left join public.customers customer on customer.tenant_id=v_tenant
      and customer.organization_id=v_org and customer.public_id::text=export_row->>'id'
    where customer.id is null or customer.archived_at is not null
      or not public.can_read_current_customer(
        customer.tenant_id,customer.organization_id,customer.owner_member_id)
  ) then
    update public.crm_export_jobs job set snapshot=null,state='expired',purged_at=clock_timestamp()
    where job.tenant_id=v_tenant and job.organization_id=v_org and job.id=v_job.id;
    perform public.append_audit_log(v_tenant,v_org,v_user,v_actor,'customer.command_failed',
      'crm_export',v_job.public_id::text,request_id,null,jsonb_build_object(
        'outcome','failure','resource','crm_export','requestId',request_id,
        'watermark',v_job.watermark,'failure','scope_revoked'));
    return jsonb_build_object('outcome','failure','error','scope_revoked');
  end if;
  v_digest:=encode(public.digest(convert_to(v_job.snapshot::text,'UTF8'),'sha256'),'hex');
  if v_digest<>v_job.sha256 then
    raise exception 'CRM export snapshot integrity failure' using errcode='P0001';
  end if;
  update public.crm_export_jobs job set download_count=job.download_count+1,
    last_downloaded_at=clock_timestamp()
  where job.tenant_id=v_tenant and job.organization_id=v_org and job.id=v_job.id;
  perform public.append_audit_log(v_tenant,v_org,v_user,v_actor,'customer.export_downloaded',
    'crm_export',v_job.public_id::text,request_id,null,jsonb_build_object(
      'outcome','success','resource','crm_export','requestId',request_id,
      'watermark',v_job.watermark,'rowCount',v_job.row_count,
      'includeContactPii',v_job.include_contact_pii,'sha256',v_job.sha256));
  return jsonb_build_object('id',v_job.public_id,'watermark',v_job.watermark,
    'includeContactPii',v_job.include_contact_pii,'rowCount',v_job.row_count,
    'sha256',v_job.sha256,'exportedAt',v_job.created_at,'rows',v_job.snapshot);
end;
$$;

create or replace function public.purge_expired_crm_exports(p_limit integer default 500)
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare
  v_purged integer;
begin
  if p_limit is null or p_limit not between 1 and 5000 then
    raise exception 'CRM export purge limit is invalid' using errcode='22023';
  end if;
  with expired as (
    select job.id from public.crm_export_jobs job
    where job.state='completed' and job.expires_at<=clock_timestamp()
    order by job.expires_at,job.id limit p_limit for update skip locked
  ), purged as (
    update public.crm_export_jobs job set snapshot=null,state='expired',purged_at=clock_timestamp()
    from expired where job.id=expired.id returning job.id
  )
  select count(*)::integer into v_purged from purged;
  return v_purged;
end;
$$;

create trigger customer_ownership_history_reject_truncate
before truncate on public.customer_ownership_history
for each statement execute function public.reject_immutable_crm_fact_mutation();
create trigger opportunity_stage_history_reject_truncate
before truncate on public.opportunity_stage_history
for each statement execute function public.reject_immutable_crm_fact_mutation();
create trigger crm_source_links_reject_truncate
before truncate on public.crm_source_links
for each statement execute function public.reject_immutable_crm_fact_mutation();

revoke all on table public.customer_ownership_history from public,anon,authenticated,service_role;
revoke all on table public.opportunity_stage_history from public,anon,authenticated,service_role;
revoke all on table public.customer_contracts from public,anon,authenticated,service_role;
revoke all on table public.crm_source_links from public,anon,authenticated,service_role;
revoke all on table public.crm_import_jobs from public,anon,authenticated,service_role;
revoke all on table public.crm_import_rows from public,anon,authenticated,service_role;
revoke all on table public.crm_export_jobs from public,anon,authenticated,service_role;
revoke all on table public.customer_contacts from authenticated;

grant select on table public.customer_ownership_history to authenticated;
grant select on table public.opportunity_stage_history to authenticated;
grant select on table public.customer_contracts to authenticated;
grant select on table public.crm_source_links to authenticated;

revoke all on sequence public.customer_ownership_history_id_seq from public,anon,authenticated,service_role;
revoke all on sequence public.opportunity_stage_history_id_seq from public,anon,authenticated,service_role;
revoke all on sequence public.customer_contracts_id_seq from public,anon,authenticated,service_role;
revoke all on sequence public.crm_source_links_id_seq from public,anon,authenticated,service_role;
revoke all on sequence public.crm_import_jobs_id_seq from public,anon,authenticated,service_role;
revoke all on sequence public.crm_import_rows_id_seq from public,anon,authenticated,service_role;
revoke all on sequence public.crm_export_jobs_id_seq from public,anon,authenticated,service_role;

revoke all on function public.current_crm_exchange_identity(text) from public,anon,authenticated,service_role;
revoke all on function public.reject_immutable_crm_fact_mutation() from public,anon,authenticated,service_role;
revoke all on function public.guard_customer_owner_transfer() from public,anon,authenticated,service_role;
revoke all on function public.append_customer_ownership_baseline() from public,anon,authenticated,service_role;
revoke all on function public.append_opportunity_stage_history() from public,anon,authenticated,service_role;
revoke all on function public.crm_import_digest_part(text) from public,anon,authenticated,service_role;
revoke all on function public.compute_crm_import_row_digest(
  text,text,uuid,text,text,text,text,text,text,text,text,boolean
) from public,anon,authenticated,service_role;
revoke all on function public.list_current_customer_contacts(uuid[],boolean,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.list_current_customer_contacts(uuid[],boolean,integer) to authenticated;
revoke all on function public.list_current_archived_customers(integer) from public,anon,authenticated,service_role;
grant execute on function public.list_current_archived_customers(integer) to authenticated;
revoke all on function public.change_current_customer_archive_state(uuid,bigint,text,uuid,uuid,boolean)
  from public,anon,authenticated,service_role;

revoke all on function public.transfer_current_customer_owner(uuid,uuid,bigint,text,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.transfer_current_customer_owner(uuid,uuid,bigint,text,uuid,uuid)
  to authenticated;
revoke all on function public.create_current_customer_contract(
  uuid,uuid,uuid,text,text,text,numeric,text,date,date,date,bigint,text,uuid,uuid
) from public,anon,authenticated,service_role;
grant execute on function public.create_current_customer_contract(
  uuid,uuid,uuid,text,text,text,numeric,text,date,date,date,bigint,text,uuid,uuid
) to authenticated;
revoke all on function public.create_current_crm_source_link(
  uuid,uuid,uuid,uuid,text,text,text,bigint,text,uuid,uuid
) from public,anon,authenticated,service_role;
grant execute on function public.create_current_crm_source_link(
  uuid,uuid,uuid,uuid,text,text,text,bigint,text,uuid,uuid
) to authenticated;
revoke all on function public.archive_current_customer(uuid,bigint,text,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.archive_current_customer(uuid,bigint,text,uuid,uuid) to authenticated;
revoke all on function public.restore_current_customer(uuid,bigint,text,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.restore_current_customer(uuid,bigint,text,uuid,uuid) to authenticated;
revoke all on function public.begin_current_crm_import(text,integer,integer,jsonb,jsonb,text,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.begin_current_crm_import(text,integer,integer,jsonb,jsonb,text,uuid,uuid)
  to authenticated;
revoke all on function public.import_current_customer_row(
  uuid,integer,text,text,text,uuid,text,text,text,text,text,text,text,text,boolean,bigint,text,uuid,uuid
) from public,anon,authenticated,service_role;
grant execute on function public.import_current_customer_row(
  uuid,integer,text,text,text,uuid,text,text,text,text,text,text,text,text,boolean,bigint,text,uuid,uuid
) to authenticated;
revoke all on function public.finalize_current_crm_import(uuid,text,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.finalize_current_crm_import(uuid,text,uuid,uuid) to authenticated;
revoke all on function public.request_current_crm_export(uuid,boolean,text,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.request_current_crm_export(uuid,boolean,text,uuid,uuid) to authenticated;
revoke all on function public.download_current_crm_export(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.download_current_crm_export(uuid,uuid) to authenticated;
revoke all on function public.purge_expired_crm_exports(integer)
  from public,anon,authenticated,service_role;
grant execute on function public.purge_expired_crm_exports(integer) to service_role;
