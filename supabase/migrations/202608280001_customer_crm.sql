-- QuantXY authoritative CRM schema. Browser roles receive read access only;
-- every mutation is introduced later through audited SECURITY DEFINER commands.

create table public.customers (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete restrict,
  organization_id bigint not null,
  owner_member_id bigint not null,
  created_by_member_id bigint not null,
  updated_by_member_id bigint not null,
  name text not null check (length(btrim(name)) between 1 and 160),
  name_normalized text generated always as (lower(btrim(name))) stored,
  registration_code text check (
    registration_code is null or length(btrim(registration_code)) between 1 and 80
  ),
  registration_code_normalized text generated always as (
    case when registration_code is null then null else upper(btrim(registration_code)) end
  ) stored,
  industry text not null default 'other' check (length(btrim(industry)) between 1 and 80),
  source text not null default 'other'
    check (source in ('consulting','referral','event','outbound','other')),
  region text not null default '' check (length(region) <= 120),
  status text not null default 'lead'
    check (status in ('lead','following','proposal','negotiating','won','lost')),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  archived_at timestamptz,
  unique (tenant_id, organization_id, id),
  foreign key (tenant_id, organization_id)
    references public.organizations(tenant_id, id) on delete restrict,
  foreign key (tenant_id, organization_id, owner_member_id)
    references public.organization_members(tenant_id, organization_id, id) on delete restrict,
  foreign key (tenant_id, organization_id, created_by_member_id)
    references public.organization_members(tenant_id, organization_id, id) on delete restrict,
  foreign key (tenant_id, organization_id, updated_by_member_id)
    references public.organization_members(tenant_id, organization_id, id) on delete restrict
);

create unique index customers_active_normalized_name_uidx
  on public.customers(tenant_id, organization_id, name_normalized)
  where archived_at is null;
create unique index customers_active_registration_code_uidx
  on public.customers(tenant_id, organization_id, registration_code_normalized)
  where archived_at is null and registration_code_normalized is not null;
create index customers_scope_owner_status_idx
  on public.customers(tenant_id, organization_id, owner_member_id, status, updated_at desc)
  where archived_at is null;

create table public.customer_contacts (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete restrict,
  organization_id bigint not null,
  customer_id bigint not null,
  created_by_member_id bigint not null,
  updated_by_member_id bigint not null,
  name text not null check (length(btrim(name)) between 1 and 120),
  title text not null default '' check (length(title) <= 120),
  phone text check (phone is null or length(btrim(phone)) between 1 and 80),
  email text check (email is null or length(btrim(email)) between 3 and 320),
  visibility text not null default 'assigned'
    check (visibility in ('assigned','managers')),
  is_primary boolean not null default false,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  archived_at timestamptz,
  unique (tenant_id, organization_id, customer_id, id),
  foreign key (tenant_id, organization_id, customer_id)
    references public.customers(tenant_id, organization_id, id) on delete restrict,
  foreign key (tenant_id, organization_id, created_by_member_id)
    references public.organization_members(tenant_id, organization_id, id) on delete restrict,
  foreign key (tenant_id, organization_id, updated_by_member_id)
    references public.organization_members(tenant_id, organization_id, id) on delete restrict
);

create unique index customer_contacts_one_active_primary_uidx
  on public.customer_contacts(tenant_id, organization_id, customer_id)
  where is_primary and archived_at is null;
create index customer_contacts_scope_customer_idx
  on public.customer_contacts(tenant_id, organization_id, customer_id, updated_at desc)
  where archived_at is null;

create table public.opportunities (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete restrict,
  organization_id bigint not null,
  customer_id bigint not null,
  owner_member_id bigint not null,
  created_by_member_id bigint not null,
  updated_by_member_id bigint not null,
  name text not null check (length(btrim(name)) between 1 and 160),
  stage text not null default 'lead'
    check (stage in ('lead','qualified','proposal','won','lost')),
  amount numeric(18,2) not null default 0 check (
    amount >= 0 and amount < 10000000000000000::numeric and amount <> 'NaN'::numeric
  ),
  currency text not null default 'CNY' check (currency ~ '^[A-Z]{3}$'),
  expected_close_on date,
  loss_reason text check (loss_reason is null or length(btrim(loss_reason)) between 1 and 1000),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  archived_at timestamptz,
  unique (tenant_id, organization_id, customer_id, id),
  foreign key (tenant_id, organization_id, customer_id)
    references public.customers(tenant_id, organization_id, id) on delete restrict,
  foreign key (tenant_id, organization_id, owner_member_id)
    references public.organization_members(tenant_id, organization_id, id) on delete restrict,
  foreign key (tenant_id, organization_id, created_by_member_id)
    references public.organization_members(tenant_id, organization_id, id) on delete restrict,
  foreign key (tenant_id, organization_id, updated_by_member_id)
    references public.organization_members(tenant_id, organization_id, id) on delete restrict,
  check ((stage = 'lost' and loss_reason is not null) or (stage <> 'lost' and loss_reason is null))
);

create index opportunities_scope_customer_stage_idx
  on public.opportunities(tenant_id, organization_id, customer_id, stage, expected_close_on)
  where archived_at is null;
create index opportunities_scope_owner_stage_idx
  on public.opportunities(tenant_id, organization_id, owner_member_id, stage, updated_at desc)
  where archived_at is null;

create table public.customer_follow_ups (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete restrict,
  organization_id bigint not null,
  customer_id bigint not null,
  opportunity_id bigint,
  actor_member_id bigint not null,
  kind text not null check (kind in ('call','meeting','email','message','visit','note')),
  content text not null check (length(btrim(content)) between 1 and 8000),
  occurred_at timestamptz not null default clock_timestamp(),
  next_follow_up_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  archived_at timestamptz,
  unique (tenant_id, organization_id, customer_id, id),
  foreign key (tenant_id, organization_id, customer_id)
    references public.customers(tenant_id, organization_id, id) on delete restrict,
  foreign key (tenant_id, organization_id, customer_id, opportunity_id)
    references public.opportunities(tenant_id, organization_id, customer_id, id) on delete restrict,
  foreign key (tenant_id, organization_id, actor_member_id)
    references public.organization_members(tenant_id, organization_id, id) on delete restrict,
  check (next_follow_up_at is null or next_follow_up_at >= occurred_at)
);

create index customer_follow_ups_scope_customer_time_idx
  on public.customer_follow_ups(tenant_id, organization_id, customer_id, occurred_at desc)
  where archived_at is null;
create index customer_follow_ups_next_action_idx
  on public.customer_follow_ups(tenant_id, organization_id, next_follow_up_at)
  where next_follow_up_at is not null and archived_at is null;

create table public.customer_project_links (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  tenant_id bigint not null references public.tenants(id) on delete restrict,
  organization_id bigint not null,
  customer_id bigint not null,
  opportunity_id bigint,
  project_id bigint not null,
  linked_by_member_id bigint not null,
  link_type text not null default 'delivery'
    check (link_type in ('delivery','support','renewal')),
  created_at timestamptz not null default clock_timestamp(),
  archived_at timestamptz,
  unique (tenant_id, organization_id, customer_id, project_id),
  foreign key (tenant_id, organization_id, customer_id)
    references public.customers(tenant_id, organization_id, id) on delete restrict,
  foreign key (tenant_id, organization_id, customer_id, opportunity_id)
    references public.opportunities(tenant_id, organization_id, customer_id, id) on delete restrict,
  foreign key (tenant_id, organization_id, project_id)
    references public.projects(tenant_id, organization_id, id) on delete restrict,
  foreign key (tenant_id, organization_id, linked_by_member_id)
    references public.organization_members(tenant_id, organization_id, id) on delete restrict
);

create index customer_project_links_scope_customer_idx
  on public.customer_project_links(tenant_id, organization_id, customer_id, created_at desc)
  where archived_at is null;
create index customer_project_links_scope_project_idx
  on public.customer_project_links(tenant_id, organization_id, project_id)
  where archived_at is null;

create or replace function public.can_manage_current_crm(
  p_tenant_id bigint,
  p_organization_id bigint
)
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select exists (
    select 1
    from public.external_identities external
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
    where external.auth_user_id=(select auth.uid()) and external.status='active'
      and external.tenant_id=p_tenant_id and external.organization_id=p_organization_id
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
  );
$$;

create or replace function public.can_read_current_customer(
  p_tenant_id bigint,
  p_organization_id bigint,
  p_owner_member_id bigint
)
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select exists (
    select 1
    from public.external_identities external
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
    where external.auth_user_id=(select auth.uid()) and external.status='active'
      and external.tenant_id=p_tenant_id and external.organization_id=p_organization_id
      and (
        member.id=p_owner_member_id
        or public.can_manage_current_crm(p_tenant_id,p_organization_id)
      )
  );
$$;

alter table public.customers enable row level security;
alter table public.customers force row level security;
alter table public.customer_contacts enable row level security;
alter table public.customer_contacts force row level security;
alter table public.opportunities enable row level security;
alter table public.opportunities force row level security;
alter table public.customer_follow_ups enable row level security;
alter table public.customer_follow_ups force row level security;
alter table public.customer_project_links enable row level security;
alter table public.customer_project_links force row level security;

create policy customers_current_scope_select on public.customers
for select to authenticated
using (public.can_read_current_customer(tenant_id,organization_id,owner_member_id));

create policy customer_contacts_current_scope_select on public.customer_contacts
for select to authenticated
using (exists (
  select 1 from public.customers customer
  where customer.tenant_id=customer_contacts.tenant_id
    and customer.organization_id=customer_contacts.organization_id
    and customer.id=customer_contacts.customer_id
    and (
      public.can_manage_current_crm(customer.tenant_id,customer.organization_id)
      or (
        customer_contacts.visibility='assigned'
        and public.can_read_current_customer(
          customer.tenant_id,customer.organization_id,customer.owner_member_id
        )
      )
    )
));

create policy opportunities_current_scope_select on public.opportunities
for select to authenticated
using (exists (
  select 1 from public.customers customer
  where customer.tenant_id=opportunities.tenant_id
    and customer.organization_id=opportunities.organization_id
    and customer.id=opportunities.customer_id
    and public.can_read_current_customer(
      customer.tenant_id,customer.organization_id,customer.owner_member_id
    )
));

create policy customer_follow_ups_current_scope_select on public.customer_follow_ups
for select to authenticated
using (exists (
  select 1 from public.customers customer
  where customer.tenant_id=customer_follow_ups.tenant_id
    and customer.organization_id=customer_follow_ups.organization_id
    and customer.id=customer_follow_ups.customer_id
    and public.can_read_current_customer(
      customer.tenant_id,customer.organization_id,customer.owner_member_id
    )
));

create policy customer_project_links_current_scope_select on public.customer_project_links
for select to authenticated
using (exists (
  select 1 from public.customers customer
  where customer.tenant_id=customer_project_links.tenant_id
    and customer.organization_id=customer_project_links.organization_id
    and customer.id=customer_project_links.customer_id
    and public.can_read_current_customer(
      customer.tenant_id,customer.organization_id,customer.owner_member_id
    )
));

create or replace function public.touch_crm_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create trigger customers_touch_updated_at before update on public.customers
for each row execute function public.touch_crm_updated_at();
create trigger customer_contacts_touch_updated_at before update on public.customer_contacts
for each row execute function public.touch_crm_updated_at();
create trigger opportunities_touch_updated_at before update on public.opportunities
for each row execute function public.touch_crm_updated_at();

revoke all on table public.customers from public,anon,authenticated,service_role;
revoke all on table public.customer_contacts from public,anon,authenticated,service_role;
revoke all on table public.opportunities from public,anon,authenticated,service_role;
revoke all on table public.customer_follow_ups from public,anon,authenticated,service_role;
revoke all on table public.customer_project_links from public,anon,authenticated,service_role;
grant select on table public.customers to authenticated;
grant select on table public.customer_contacts to authenticated;
grant select on table public.opportunities to authenticated;
grant select on table public.customer_follow_ups to authenticated;
grant select on table public.customer_project_links to authenticated;

revoke all on function public.can_manage_current_crm(bigint,bigint)
  from public,anon,authenticated,service_role;
grant execute on function public.can_manage_current_crm(bigint,bigint) to authenticated;
revoke all on function public.can_read_current_customer(bigint,bigint,bigint)
  from public,anon,authenticated,service_role;
grant execute on function public.can_read_current_customer(bigint,bigint,bigint) to authenticated;
revoke all on function public.touch_crm_updated_at()
  from public,anon,authenticated,service_role;

revoke all on sequence public.customers_id_seq from public,anon,authenticated,service_role;
revoke all on sequence public.customer_contacts_id_seq from public,anon,authenticated,service_role;
revoke all on sequence public.opportunities_id_seq from public,anon,authenticated,service_role;
revoke all on sequence public.customer_follow_ups_id_seq from public,anon,authenticated,service_role;
revoke all on sequence public.customer_project_links_id_seq from public,anon,authenticated,service_role;
