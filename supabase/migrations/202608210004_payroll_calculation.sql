alter table public.audit_logs drop constraint if exists audit_logs_action_check;
alter table public.audit_logs add constraint audit_logs_action_check check (action in (
  'identity.provisioned', 'identity.claimed', 'identity.revoked',
  'member.status_changed', 'member.role_changed', 'profile.updated',
  'roster.imported', 'tenant.bootstrap_owner', 'enterprise.initialized',
  'directory.sync_started', 'directory.sync_completed', 'directory.sync_failed',
  'directory.role_mapped', 'project.created', 'task.created',
  'payroll_policy.activated', 'payroll.calculated', 'payroll.confirmed'
));

create or replace function public.has_organization_permission(
  target_organization_id bigint,
  target_permission_code text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members member
    join public.member_roles assignment
      on assignment.tenant_id = member.tenant_id
     and assignment.member_id = member.id
    join public.roles role
      on role.tenant_id = assignment.tenant_id
     and role.id = assignment.role_id
    join public.role_permissions role_permission
      on role_permission.tenant_id = role.tenant_id
     and role_permission.role_id = role.id
    join public.permissions permission
      on permission.id = role_permission.permission_id
    where member.tenant_id = (select public.current_tenant_id())
      and member.organization_id = target_organization_id
      and member.user_id = (select auth.uid())
      and member.status = 'active'
      and role.is_enabled
      and (role.organization_id is null or role.organization_id = target_organization_id)
      and permission.code = target_permission_code
  );
$$;

revoke all on function public.has_organization_permission(bigint,text) from public, anon;
grant execute on function public.has_organization_permission(bigint,text) to authenticated;

create table public.payroll_policies (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  organization_id bigint not null references public.organizations(id) on delete cascade,
  effective_month date not null check (extract(day from effective_month) = 1),
  pension_employee_rate numeric(9,6) not null
    check (pension_employee_rate between 0 and 1),
  medical_employee_rate numeric(9,6) not null
    check (medical_employee_rate between 0 and 1),
  medical_employee_fixed_amount numeric(14,2) not null default 0
    check (medical_employee_fixed_amount >= 0),
  unemployment_employee_rate numeric(9,6) not null
    check (unemployment_employee_rate between 0 and 1),
  housing_fund_employee_rate numeric(9,6) not null
    check (housing_fund_employee_rate between 0 and 1),
  social_base_min numeric(14,2) not null check (social_base_min >= 0),
  social_base_max numeric(14,2) not null check (social_base_max >= social_base_min),
  housing_base_min numeric(14,2) not null check (housing_base_min >= 0),
  housing_base_max numeric(14,2) not null check (housing_base_max >= housing_base_min),
  status text not null check (status in ('draft', 'active', 'retired')),
  example_confirmation_hash text
    check (example_confirmation_hash is null or example_confirmation_hash ~ '^[0-9a-f]{64}$'),
  created_by_member_id bigint not null,
  activated_by_member_id bigint,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, created_by_member_id)
    references public.organization_members(organization_id, id) on delete restrict,
  foreign key (organization_id, activated_by_member_id)
    references public.organization_members(organization_id, id) on delete restrict,
  check (
    (status = 'draft' and activated_by_member_id is null
      and activated_at is null and example_confirmation_hash is null)
    or (status in ('active', 'retired') and activated_by_member_id is not null
      and activated_at is not null and example_confirmation_hash is not null)
  )
);

create unique index payroll_policies_one_active_month_idx
  on public.payroll_policies(organization_id, effective_month)
  where status = 'active';

create index payroll_policies_organization_effective_idx
  on public.payroll_policies(organization_id, effective_month desc, created_at desc);

create or replace function public.touch_payroll_policy_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger payroll_policies_updated_at
before update on public.payroll_policies
for each row execute function public.touch_payroll_policy_updated_at();

alter table public.payroll_policies enable row level security;
alter table public.payroll_policies force row level security;

create policy payroll_policies_manager_select on public.payroll_policies
  for select to authenticated
  using ((select public.has_organization_permission(organization_id, 'salary.manage')));

grant select on public.payroll_policies to authenticated;
revoke insert, update, delete on public.payroll_policies from authenticated;
revoke all on function public.touch_payroll_policy_updated_at() from public, anon;

alter table public.salary
  add column if not exists policy_id bigint references public.payroll_policies(id) on delete restrict,
  add column if not exists policy_snapshot jsonb,
  add column if not exists calculation_snapshot jsonb,
  add column if not exists other_income numeric(14,2) check (other_income >= 0),
  add column if not exists gross_salary numeric(14,2) check (gross_salary >= 0),
  add column if not exists social_base numeric(14,2) check (social_base >= 0),
  add column if not exists housing_fund_base numeric(14,2) check (housing_fund_base >= 0),
  add column if not exists pension_employee numeric(14,2) check (pension_employee >= 0),
  add column if not exists medical_employee numeric(14,2) check (medical_employee >= 0),
  add column if not exists unemployment_employee numeric(14,2) check (unemployment_employee >= 0),
  add column if not exists housing_fund_employee numeric(14,2) check (housing_fund_employee >= 0),
  add column if not exists tax_exempt_income numeric(14,2) check (tax_exempt_income >= 0),
  add column if not exists special_additional_deduction numeric(14,2) check (special_additional_deduction >= 0),
  add column if not exists other_statutory_deduction numeric(14,2) check (other_statutory_deduction >= 0),
  add column if not exists tax_relief numeric(14,2) check (tax_relief >= 0),
  add column if not exists employment_months_ytd integer check (employment_months_ytd between 1 and 12),
  add column if not exists opening_cumulative_income numeric(16,2) check (opening_cumulative_income >= 0),
  add column if not exists opening_cumulative_tax_exempt_income numeric(16,2) check (opening_cumulative_tax_exempt_income >= 0),
  add column if not exists opening_cumulative_special_deduction numeric(16,2) check (opening_cumulative_special_deduction >= 0),
  add column if not exists opening_cumulative_special_additional_deduction numeric(16,2) check (opening_cumulative_special_additional_deduction >= 0),
  add column if not exists opening_cumulative_other_statutory_deduction numeric(16,2) check (opening_cumulative_other_statutory_deduction >= 0),
  add column if not exists opening_cumulative_tax_relief numeric(16,2) check (opening_cumulative_tax_relief >= 0),
  add column if not exists opening_cumulative_tax_withheld numeric(16,2) check (opening_cumulative_tax_withheld >= 0),
  add column if not exists cumulative_taxable_income numeric(16,2) check (cumulative_taxable_income >= 0),
  add column if not exists manual_adjustment_reason text,
  add column if not exists calculation_version text;

-- calculated salary requires complete snapshots while legacy manual rows remain readable.
alter table public.salary
  add constraint salary_calculated_snapshot_check check (
    calculation_version is null
    or (
      policy_id is not null
      and policy_snapshot is not null and jsonb_typeof(policy_snapshot) = 'object'
      and calculation_snapshot is not null and jsonb_typeof(calculation_snapshot) = 'object'
      and other_income is not null and gross_salary is not null
      and social_base is not null and housing_fund_base is not null
      and pension_employee is not null and medical_employee is not null
      and unemployment_employee is not null and housing_fund_employee is not null
      and tax_exempt_income is not null and special_additional_deduction is not null
      and other_statutory_deduction is not null and tax_relief is not null
      and employment_months_ytd is not null
      and opening_cumulative_income is not null
      and opening_cumulative_tax_exempt_income is not null
      and opening_cumulative_special_deduction is not null
      and opening_cumulative_special_additional_deduction is not null
      and opening_cumulative_other_statutory_deduction is not null
      and opening_cumulative_tax_relief is not null
      and opening_cumulative_tax_withheld is not null
      and cumulative_taxable_income is not null
    )
  ),
  add constraint salary_manual_adjustment_reason_check check (
    calculation_version is null
    or other_deduction = 0
    or nullif(btrim(manual_adjustment_reason), '') is not null
  );

revoke insert, update, delete on public.salary from authenticated;

create or replace function public.save_payroll_policy_v1(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id bigint := (select public.current_tenant_id());
  v_organization_id bigint;
  v_actor_member_id bigint;
  v_action text := p_payload->>'action';
  v_effective_month date;
  v_status text;
  v_confirmation_hash text := nullif(lower(btrim(coalesce(p_payload->>'exampleConfirmationHash', ''))), '');
  v_policy_public_id uuid := gen_random_uuid();
begin
  if v_tenant_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_payload) <> 'object' or v_action not in ('saveDraft', 'activate') then
    raise exception 'Payroll policy input is invalid' using errcode = '22023';
  end if;

  select member.organization_id, member.id
  into strict v_organization_id, v_actor_member_id
  from public.organization_members member
  where member.tenant_id = v_tenant_id
    and member.user_id = (select auth.uid())
    and member.status = 'active'
  order by member.id
  limit 1;

  if not public.has_organization_permission(v_organization_id, 'salary.manage') then
    raise exception 'Payroll policy access is not allowed' using errcode = '42501';
  end if;

  v_effective_month := to_date(p_payload->>'effectiveMonth' || '-01', 'YYYY-MM-DD');
  if to_char(v_effective_month, 'YYYY-MM') <> p_payload->>'effectiveMonth' then
    raise exception 'Payroll policy month is invalid' using errcode = '22023';
  end if;
  v_status := case when v_action = 'activate' then 'active' else 'draft' end;
  if v_status = 'active' and (v_confirmation_hash is null or v_confirmation_hash !~ '^[0-9a-f]{64}$') then
    raise exception 'Payroll policy example confirmation is required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('payroll-policy:' || v_organization_id::text || ':' || v_effective_month::text, 0)
  );

  if v_status = 'active' then
    update public.payroll_policies
    set status = 'retired', updated_at = now()
    where organization_id = v_organization_id
      and effective_month = v_effective_month
      and status = 'active';
  end if;

  insert into public.payroll_policies (
    public_id, organization_id, effective_month,
    pension_employee_rate, medical_employee_rate, medical_employee_fixed_amount,
    unemployment_employee_rate, housing_fund_employee_rate,
    social_base_min, social_base_max, housing_base_min, housing_base_max,
    status, example_confirmation_hash, created_by_member_id,
    activated_by_member_id, activated_at
  ) values (
    v_policy_public_id, v_organization_id, v_effective_month,
    (p_payload->>'pensionEmployeeRate')::numeric,
    (p_payload->>'medicalEmployeeRate')::numeric,
    (p_payload->>'medicalEmployeeFixedAmount')::numeric,
    (p_payload->>'unemploymentEmployeeRate')::numeric,
    (p_payload->>'housingFundEmployeeRate')::numeric,
    (p_payload->>'socialBaseMin')::numeric,
    (p_payload->>'socialBaseMax')::numeric,
    (p_payload->>'housingBaseMin')::numeric,
    (p_payload->>'housingBaseMax')::numeric,
    v_status, v_confirmation_hash, v_actor_member_id,
    case when v_status = 'active' then v_actor_member_id else null end,
    case when v_status = 'active' then now() else null end
  );

  if v_status = 'active' then
    perform public.append_audit_log(
      v_tenant_id, v_organization_id, (select auth.uid()), v_actor_member_id,
      'payroll_policy.activated', 'payroll_policy', v_policy_public_id::text,
      null, null,
      jsonb_build_object('effectiveMonth', to_char(v_effective_month, 'YYYY-MM'))
    );
  end if;

  return v_policy_public_id;
end;
$$;

revoke all on function public.save_payroll_policy_v1(jsonb) from public, anon;
grant execute on function public.save_payroll_policy_v1(jsonb) to authenticated;

create or replace function public.save_salary_calculation_v1(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id bigint := (select public.current_tenant_id());
  v_organization_id bigint;
  v_actor_member_id bigint;
  v_employee_profile_id bigint;
  v_employee_public_id uuid;
  v_policy_id bigint;
  v_payroll_month date;
  v_requested_status text := p_payload->>'status';
  v_existing_id bigint;
  v_existing_status text;
  v_salary_public_id uuid;
  v_bonus numeric(14,2);
  v_gross_salary numeric(14,2);
  v_social_security numeric(14,2);
  v_deductions numeric(14,2);
  v_net_salary numeric(14,2);
  v_action text;
begin
  if v_tenant_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_payload) <> 'object' or v_requested_status not in ('draft', 'processing') then
    raise exception 'Payroll input is invalid' using errcode = '22023';
  end if;

  select member.organization_id, member.id
  into strict v_organization_id, v_actor_member_id
  from public.organization_members member
  where member.tenant_id = v_tenant_id
    and member.user_id = (select auth.uid())
    and member.status = 'active'
  order by member.id
  limit 1;

  if not public.has_organization_permission(v_organization_id, 'salary.manage') then
    raise exception 'Payroll access is not allowed' using errcode = '42501';
  end if;

  v_payroll_month := to_date(p_payload->>'month' || '-01', 'YYYY-MM-DD');
  if to_char(v_payroll_month, 'YYYY-MM') <> p_payload->>'month' then
    raise exception 'Payroll month is invalid' using errcode = '22023';
  end if;

  select profile.id, profile.public_id
  into strict v_employee_profile_id, v_employee_public_id
  from public.employee_profiles profile
  where profile.organization_id = v_organization_id
    and profile.organization_member_id = (p_payload->>'memberId')::bigint
    and profile.deleted_at is null;

  select policy.id into strict v_policy_id
  from public.payroll_policies policy
  where policy.organization_id = v_organization_id
    and policy.public_id = (p_payload->>'policyId')::uuid
    and policy.status = 'active'
    and policy.effective_month <= v_payroll_month;

  if jsonb_typeof(p_payload->'policySnapshot') <> 'object'
     or jsonb_typeof(p_payload->'calculationSnapshot') <> 'object'
     or nullif(btrim(coalesce(p_payload->>'calculationVersion', '')), '') is null then
    raise exception 'Payroll snapshots are required' using errcode = '22023';
  end if;

  v_bonus := (p_payload->>'performanceBonus')::numeric
    + (p_payload->>'projectBonus')::numeric
    + (p_payload->>'otherBonus')::numeric;
  v_gross_salary := (p_payload->>'baseSalary')::numeric
    + v_bonus
    + (p_payload->>'otherIncome')::numeric;
  v_social_security := (p_payload->>'pensionEmployee')::numeric
    + (p_payload->>'medicalEmployee')::numeric
    + (p_payload->>'unemploymentEmployee')::numeric
    + (p_payload->>'housingFundEmployee')::numeric;
  v_deductions := v_social_security
    + (p_payload->>'individualIncomeTax')::numeric
    + (p_payload->>'otherDeduction')::numeric;
  v_net_salary := v_gross_salary - v_deductions;

  if v_net_salary < 0 then
    raise exception 'Net salary cannot be negative' using errcode = '22023';
  end if;
  if (p_payload->>'otherDeduction')::numeric > 0
     and nullif(btrim(coalesce(p_payload->>'manualAdjustmentReason', '')), '') is null then
    raise exception 'Manual adjustment reason is required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      v_organization_id::text || ':' || v_employee_profile_id::text || ':' || v_payroll_month::text,
      0
    )
  );

  select salary.id, salary.status, salary.public_id
  into v_existing_id, v_existing_status, v_salary_public_id
  from public.salary salary
  where salary.organization_id = v_organization_id
    and salary.employee_profile_id = v_employee_profile_id
    and salary.payroll_month = v_payroll_month
    and salary.deleted_at is null
  for update;

  if v_existing_status in ('processing', 'paid') then
    raise exception 'Confirmed payroll is immutable' using errcode = '23505';
  end if;

  if v_existing_id is null then
    v_salary_public_id := gen_random_uuid();
    insert into public.salary (
      public_id, organization_id, employee_profile_id, payroll_month,
      base_salary, performance_bonus, project_bonus, other_bonus, bonus, other_income,
      gross_salary, social_base, housing_fund_base,
      pension_employee, medical_employee, unemployment_employee, housing_fund_employee,
      social_security, tax_exempt_income, special_additional_deduction,
      other_statutory_deduction, tax_relief, employment_months_ytd,
      opening_cumulative_income, opening_cumulative_tax_exempt_income,
      opening_cumulative_special_deduction,
      opening_cumulative_special_additional_deduction,
      opening_cumulative_other_statutory_deduction,
      opening_cumulative_tax_relief, opening_cumulative_tax_withheld,
      cumulative_taxable_income, individual_income_tax, other_deduction,
      manual_adjustment_reason, deductions, net_salary, status,
      policy_id, policy_snapshot, calculation_snapshot, calculation_version, note
    ) values (
      v_salary_public_id, v_organization_id, v_employee_profile_id, v_payroll_month,
      (p_payload->>'baseSalary')::numeric,
      (p_payload->>'performanceBonus')::numeric,
      (p_payload->>'projectBonus')::numeric,
      (p_payload->>'otherBonus')::numeric,
      v_bonus, (p_payload->>'otherIncome')::numeric,
      v_gross_salary, (p_payload->>'socialBase')::numeric,
      (p_payload->>'housingFundBase')::numeric,
      (p_payload->>'pensionEmployee')::numeric,
      (p_payload->>'medicalEmployee')::numeric,
      (p_payload->>'unemploymentEmployee')::numeric,
      (p_payload->>'housingFundEmployee')::numeric,
      v_social_security, (p_payload->>'taxExemptIncome')::numeric,
      (p_payload->>'specialAdditionalDeduction')::numeric,
      (p_payload->>'otherStatutoryDeduction')::numeric,
      (p_payload->>'taxRelief')::numeric,
      (p_payload->>'employmentMonthsYtd')::integer,
      (p_payload->>'openingCumulativeIncome')::numeric,
      (p_payload->>'openingCumulativeTaxExemptIncome')::numeric,
      (p_payload->>'openingCumulativeSpecialDeduction')::numeric,
      (p_payload->>'openingCumulativeSpecialAdditionalDeduction')::numeric,
      (p_payload->>'openingCumulativeOtherStatutoryDeduction')::numeric,
      (p_payload->>'openingCumulativeTaxRelief')::numeric,
      (p_payload->>'openingCumulativeTaxWithheld')::numeric,
      (p_payload->>'cumulativeTaxableIncome')::numeric,
      (p_payload->>'individualIncomeTax')::numeric,
      (p_payload->>'otherDeduction')::numeric,
      nullif(btrim(coalesce(p_payload->>'manualAdjustmentReason', '')), ''),
      v_deductions, v_net_salary, v_requested_status,
      v_policy_id, p_payload->'policySnapshot', p_payload->'calculationSnapshot',
      btrim(p_payload->>'calculationVersion'),
      nullif(btrim(coalesce(p_payload->>'note', '')), '')
    );
  else
    update public.salary set
      base_salary = (p_payload->>'baseSalary')::numeric,
      performance_bonus = (p_payload->>'performanceBonus')::numeric,
      project_bonus = (p_payload->>'projectBonus')::numeric,
      other_bonus = (p_payload->>'otherBonus')::numeric,
      bonus = v_bonus,
      other_income = (p_payload->>'otherIncome')::numeric,
      gross_salary = v_gross_salary,
      social_base = (p_payload->>'socialBase')::numeric,
      housing_fund_base = (p_payload->>'housingFundBase')::numeric,
      pension_employee = (p_payload->>'pensionEmployee')::numeric,
      medical_employee = (p_payload->>'medicalEmployee')::numeric,
      unemployment_employee = (p_payload->>'unemploymentEmployee')::numeric,
      housing_fund_employee = (p_payload->>'housingFundEmployee')::numeric,
      social_security = v_social_security,
      tax_exempt_income = (p_payload->>'taxExemptIncome')::numeric,
      special_additional_deduction = (p_payload->>'specialAdditionalDeduction')::numeric,
      other_statutory_deduction = (p_payload->>'otherStatutoryDeduction')::numeric,
      tax_relief = (p_payload->>'taxRelief')::numeric,
      employment_months_ytd = (p_payload->>'employmentMonthsYtd')::integer,
      opening_cumulative_income = (p_payload->>'openingCumulativeIncome')::numeric,
      opening_cumulative_tax_exempt_income = (p_payload->>'openingCumulativeTaxExemptIncome')::numeric,
      opening_cumulative_special_deduction = (p_payload->>'openingCumulativeSpecialDeduction')::numeric,
      opening_cumulative_special_additional_deduction = (p_payload->>'openingCumulativeSpecialAdditionalDeduction')::numeric,
      opening_cumulative_other_statutory_deduction = (p_payload->>'openingCumulativeOtherStatutoryDeduction')::numeric,
      opening_cumulative_tax_relief = (p_payload->>'openingCumulativeTaxRelief')::numeric,
      opening_cumulative_tax_withheld = (p_payload->>'openingCumulativeTaxWithheld')::numeric,
      cumulative_taxable_income = (p_payload->>'cumulativeTaxableIncome')::numeric,
      individual_income_tax = (p_payload->>'individualIncomeTax')::numeric,
      other_deduction = (p_payload->>'otherDeduction')::numeric,
      manual_adjustment_reason = nullif(btrim(coalesce(p_payload->>'manualAdjustmentReason', '')), ''),
      deductions = v_deductions,
      net_salary = v_net_salary,
      status = v_requested_status,
      policy_id = v_policy_id,
      policy_snapshot = p_payload->'policySnapshot',
      calculation_snapshot = p_payload->'calculationSnapshot',
      calculation_version = btrim(p_payload->>'calculationVersion'),
      note = nullif(btrim(coalesce(p_payload->>'note', '')), ''),
      updated_at = now()
    where id = v_existing_id;
  end if;

  v_action := case when v_requested_status = 'processing'
    then 'payroll.confirmed' else 'payroll.calculated' end;
  perform public.append_audit_log(
    v_tenant_id, v_organization_id, (select auth.uid()), v_actor_member_id,
    v_action, 'salary', v_salary_public_id::text, null, null,
    jsonb_build_object(
      'employeeProfileId', v_employee_public_id,
      'payrollMonth', to_char(v_payroll_month, 'YYYY-MM'),
      'status', v_requested_status
    )
  );

  return v_salary_public_id;
end;
$$;

revoke all on function public.save_salary_calculation_v1(jsonb) from public, anon;
grant execute on function public.save_salary_calculation_v1(jsonb) to authenticated;
