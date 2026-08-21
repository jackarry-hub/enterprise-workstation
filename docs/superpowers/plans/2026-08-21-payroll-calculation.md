# Payroll Calculation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add versioned enterprise payroll policies and server-authoritative calculation of employee social insurance, housing fund, cumulative withholding tax, gross pay, deductions, and net pay to the formal Feishu-authenticated workstation.

**Architecture:** Build a pure integer-cents calculation core that is shared by preview and save services. Persist versioned organization policy plus immutable policy/calculation snapshots in Supabase, expose permission-checked policy and preview APIs, and extend the existing fused HTML formal workstation without replacing its gateway or identity model.

**Tech Stack:** Next.js 15 route handlers, TypeScript 5, Vitest, Supabase/PostgreSQL migrations and RLS, vanilla JavaScript fused HTML, Node test runner/JSDOM.

**Spec:** `docs/superpowers/specs/2026-08-21-payroll-calculation-design.md`

## Global Constraints

- Do not add attendance or leave calculations.
- Do not calculate employer-borne social insurance or housing-fund cost.
- Do not add tax filing, bank payment, accounting voucher, non-resident tax, labor-remuneration tax, or annual-bonus special tax treatment.
- Enterprise rates and contribution-base limits are versioned by effective month; no regional rate is hard-coded.
- Resident salary tax uses the cumulative withholding method and the official seven-bracket table.
- Final money is calculated in integer cents; serialized API money values are two-decimal strings.
- Employees can read only their own payroll; policy and payroll mutation require `salary.manage`.
- Existing rows without `calculation_version` remain readable and are not recalculated.
- Confirmed or paid calculated payroll rows are immutable in V1.
- Preserve unrelated worktree changes. Stage only the files named by the current task.
- Keep `quantxy-ai-workbench-fused.html` and `public/quantxy-ai-workbench-fused.html` byte-identical after every HTML task.

---

## File Structure

- `src/features/payroll-calculation/types.ts`: public calculation input, policy, history, and result contracts.
- `src/features/payroll-calculation/money.ts`: strict decimal-string to integer-cents/percentage/fraction conversion and serialization.
- `src/features/payroll-calculation/tax.ts`: official cumulative withholding brackets and tax calculation.
- `src/features/payroll-calculation/calculator.ts`: social insurance, housing fund, gross, deductions, and net calculation.
- `src/features/payroll-calculation/*.test.ts`: pure unit and boundary tests.
- `supabase/migrations/202608210004_payroll_calculation.sql`: policy table, salary extensions, RLS, and atomic policy/payroll RPCs.
- `src/features/payroll-calculation/migration-contract.test.ts`: required SQL contract and security checks.
- `src/app/api/workstation/payroll/policy/{handler.ts,route.ts}`: policy read, draft save, and activation.
- `src/app/api/workstation/payroll/preview/{handler.ts,route.ts}`: server-authoritative calculation preview.
- `src/features/payroll-calculation/server-service.ts`: organization-scoped policy/history resolution shared by preview and save.
- `src/app/api/workstation/payroll/handler.ts`: save calculated draft/confirmed payroll through the atomic RPC.
- `src/app/api/workstation/payroll/*.test.ts`: permission, validation, spoofing, and persistence tests.
- `src/app/api/workstation/bootstrap/handler.ts`: load detailed calculated fields for the signed-in employee.
- `src/features/workstation/server-bootstrap.ts`: map database payroll details to fused HTML contracts.
- `public/workstation-server-adapter.js`: expose policy, preview, and save calls to the fused HTML.
- `quantxy-ai-workbench-fused.html` and `public/quantxy-ai-workbench-fused.html`: policy editor, payroll calculator, and employee breakdown.
- `tests/html-workstation-server-adapter.test.mjs`: gateway request/response behavior.
- `tests/html-personal-workbench-behavior.test.mjs`: manager calculation flow and employee self-only payslip behavior.
- `tests/e2e/payroll-calculation.spec.ts`: formal desktop/mobile flow.
- `.env.example`: no new secrets; document that payroll calculation uses existing Supabase server credentials.

---

### Task 1: Pure Money, Contribution, and Cumulative Tax Calculator

**Files:**
- Create: `src/features/payroll-calculation/types.ts`
- Create: `src/features/payroll-calculation/money.ts`
- Create: `src/features/payroll-calculation/tax.ts`
- Create: `src/features/payroll-calculation/calculator.ts`
- Test: `src/features/payroll-calculation/money.test.ts`
- Test: `src/features/payroll-calculation/tax.test.ts`
- Test: `src/features/payroll-calculation/calculator.test.ts`

**Interfaces:**
- Consumes: decimal strings from API/UI and one versioned `PayrollPolicyInput`.
- Produces: `parseMoney`, `formatMoney`, `parseRate`, `parseFractionRate`, `calculateCumulativeTax`, and `calculatePayroll`, used by all later server tasks.

- [ ] **Step 1: Define exact calculation contracts**

```ts
export type PayrollPolicyInput = {
  id: string;
  effectiveMonth: string;
  pensionEmployeeRate: string;
  medicalEmployeeRate: string;
  medicalEmployeeFixedAmount: string;
  unemploymentEmployeeRate: string;
  housingFundEmployeeRate: string;
  socialBaseMin: string;
  socialBaseMax: string;
  housingBaseMin: string;
  housingBaseMax: string;
};

export type PayrollCalculationInput = {
  month: string;
  // Server-derived from employee_profiles.hire_date; never trusted from the client.
  employmentMonthsYtd: number;
  baseSalary: string;
  performanceBonus: string;
  projectBonus: string;
  otherBonus: string;
  otherIncome: string;
  socialBase: string;
  housingFundBase: string;
  taxExemptIncome: string;
  specialAdditionalDeduction: string;
  otherStatutoryDeduction: string;
  taxRelief: string;
  otherDeduction: string;
  manualAdjustmentReason: string;
  openingCumulativeIncome: string;
  openingCumulativeTaxExemptIncome: string;
  openingCumulativeSpecialDeduction: string;
  openingCumulativeSpecialAdditionalDeduction: string;
  openingCumulativeOtherStatutoryDeduction: string;
  openingCumulativeTaxRelief: string;
  openingCumulativeTaxWithheld: string;
};

export type PriorPayrollTotals = {
  cumulativeIncome: bigint;
  cumulativeTaxExemptIncome: bigint;
  cumulativeSpecialDeduction: bigint;
  cumulativeSpecialAdditionalDeduction: bigint;
  cumulativeOtherStatutoryDeduction: bigint;
  cumulativeTaxRelief: bigint;
  cumulativeTaxWithheld: bigint;
};

export type PayrollCalculationResult = {
  grossSalary: string;
  bonus: string;
  pensionEmployee: string;
  medicalEmployee: string;
  unemploymentEmployee: string;
  housingFundEmployee: string;
  socialSecurity: string;
  cumulativeTaxableIncome: string;
  individualIncomeTax: string;
  deductions: string;
  netSalary: string;
  taxBracket: { rate: string; quickDeduction: string };
  cumulative: {
    income: string;
    taxExemptIncome: string;
    specialDeduction: string;
    specialAdditionalDeduction: string;
    otherStatutoryDeduction: string;
    taxRelief: string;
    taxWithheld: string;
  };
};
```

- [ ] **Step 2: Write failing money parsing tests**

```ts
import { describe, expect, it } from "vitest";
import { formatMoney, parseFractionRate, parseMoney, parseRate } from "./money";

describe("payroll decimal arithmetic", () => {
  it("parses and formats RMB without binary-float arithmetic", () => {
    expect(parseMoney("1234.56")).toBe(123456n);
    expect(formatMoney(123456n)).toBe("1234.56");
    expect(parseRate("10.5")).toBe(105000n);
    expect(parseFractionRate("0.105000")).toBe(105000n);
  });

  it.each(["", "-1", "1.001", "NaN", "100000001"])("rejects %s", (value) => {
    expect(() => parseMoney(value)).toThrow("invalid_money");
  });
});
```

- [ ] **Step 3: Run money tests and confirm RED**

Run: `npm run test:unit -- src/features/payroll-calculation/money.test.ts`

Expected: FAIL because `./money` does not exist.

- [ ] **Step 4: Implement strict cents and rate conversion**

```ts
const MONEY = /^(0|[1-9]\d{0,8})(?:\.(\d{1,2}))?$/;
const RATE = /^(0|[1-9]\d?)(?:\.(\d{1,4}))?$|^100(?:\.0{1,4})?$/;

export function parseMoney(value: string) {
  const match = MONEY.exec(value.trim());
  if (!match) throw new Error("invalid_money");
  return BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
}

export function formatMoney(cents: bigint) {
  if (cents < 0n) return `-${formatMoney(-cents)}`;
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}

export function parseRate(value: string) {
  const match = RATE.exec(value.trim());
  if (!match) throw new Error("invalid_rate");
  return BigInt(match[1]) * 10_000n + BigInt((match[2] ?? "").padEnd(4, "0"));
}

export function parseFractionRate(value: string) {
  const match = /^(0(?:\.\d{1,6})?|1(?:\.0{1,6})?)$/.exec(value.trim());
  if (!match) throw new Error("invalid_fraction_rate");
  const [whole, fraction = ""] = value.trim().split(".");
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}

export function multiplyRate(cents: bigint, partsPerMillion: bigint) {
  return (cents * partsPerMillion + 500_000n) / 1_000_000n;
}
```

- [ ] **Step 5: Write failing tax and payroll boundary tests**

```ts
it.each([
  ["36000.00", "3", "0.00"],
  ["36000.01", "10", "2520.00"],
  ["144000.01", "20", "16920.00"],
  ["300000.01", "25", "31920.00"],
  ["420000.01", "30", "52920.00"],
  ["660000.01", "35", "85920.00"],
  ["960000.01", "45", "181920.00"],
])("selects the official bracket at %s", (taxable, rate, quickDeduction) => {
  expect(taxBracket(parseMoney(taxable))).toMatchObject({ rate, quickDeduction });
});

it("clamps bases, calculates this-month tax, and returns net pay", () => {
  const result = calculatePayroll(policyFixture, inputFixture, priorFixture);
  expect(result.grossSalary).toBe("25000.00");
  expect(result.pensionEmployee).toBe("1600.00");
  expect(result.medicalEmployee).toBe("402.00");
  expect(result.unemploymentEmployee).toBe("100.00");
  expect(result.housingFundEmployee).toBe("1400.00");
  expect(result.netSalary).toBe("20878.00");
});
```

- [ ] **Step 6: Run calculator tests and confirm RED**

Run: `npm run test:unit -- src/features/payroll-calculation/tax.test.ts src/features/payroll-calculation/calculator.test.ts`

Expected: FAIL because bracket and calculator exports do not exist.

- [ ] **Step 7: Implement the official bracket table and calculation pipeline**

```ts
const BRACKETS = [
  { max: 3_600_000n, ratePpm: 30_000n, rate: "3", quick: 0n },
  { max: 14_400_000n, ratePpm: 100_000n, rate: "10", quick: 252_000n },
  { max: 30_000_000n, ratePpm: 200_000n, rate: "20", quick: 1_692_000n },
  { max: 42_000_000n, ratePpm: 250_000n, rate: "25", quick: 3_192_000n },
  { max: 66_000_000n, ratePpm: 300_000n, rate: "30", quick: 5_292_000n },
  { max: 96_000_000n, ratePpm: 350_000n, rate: "35", quick: 8_592_000n },
  { max: null, ratePpm: 450_000n, rate: "45", quick: 18_192_000n },
] as const;

export function taxBracket(taxableCents: bigint) {
  const row = BRACKETS.find(({ max }) => max === null || taxableCents <= max)!;
  return { ...row, quickDeduction: formatMoney(row.quick) };
}

export function calculateCumulativeTax(input: CumulativeTaxInput) {
  const taxable = max(0n, input.income - input.taxExemptIncome
    - 500_000n * BigInt(input.employmentMonthsYtd)
    - input.specialDeduction - input.specialAdditionalDeduction
    - input.otherStatutoryDeduction);
  const bracket = taxBracket(taxable);
  const cumulativeTax = max(0n,
    multiplyRate(taxable, bracket.ratePpm) - bracket.quick - input.taxRelief,
  );
  return {
    taxable,
    currentTax: max(0n, cumulativeTax - input.previouslyWithheld),
    bracket,
  };
}
```

Implement `calculatePayroll` by clamping bases, calculating four employee contributions, building cumulative inputs from opening values plus stored prior payroll, calculating current tax, then formatting all public amounts. Treat `manualAdjustmentReason` as required whenever `otherDeduction` is greater than zero. Throw `missing_history`, `missing_adjustment_reason`, `negative_net_salary`, or `invalid_employment_months` for invalid contexts.

- [ ] **Step 8: Run calculator suite and commit**

Run: `npm run test:unit -- src/features/payroll-calculation/money.test.ts src/features/payroll-calculation/tax.test.ts src/features/payroll-calculation/calculator.test.ts`

Expected: PASS with all bracket, clamp, year-to-date, rounding, and negative-net cases green.

```bash
git add src/features/payroll-calculation
git commit -m "feat: add payroll calculation engine"
```

---

### Task 2: Payroll Policy Schema, Salary Snapshots, and Atomic Persistence

**Files:**
- Create: `supabase/migrations/202608210004_payroll_calculation.sql`
- Create: `src/features/payroll-calculation/migration-contract.test.ts`

**Interfaces:**
- Consumes: existing `organizations`, `organization_members`, `employee_profiles`, `salary`, `has_organization_role`, and `append_audit_log` database contracts.
- Produces: `payroll_policies` table, extended `salary` columns, `save_payroll_policy_v1(jsonb)`, and `save_salary_calculation_v1(jsonb)` RPCs.

- [ ] **Step 1: Write a failing migration contract test**

```ts
const sql = await readFile(
  path.join(process.cwd(), "supabase/migrations/202608210004_payroll_calculation.sql"),
  "utf8",
);

expect(sql).toContain("create table public.payroll_policies");
expect(sql).toContain("effective_month date not null");
expect(sql).toContain("policy_snapshot jsonb");
expect(sql).toContain("calculation_snapshot jsonb");
expect(sql).toContain("create or replace function public.save_payroll_policy_v1");
expect(sql).toContain("create or replace function public.save_salary_calculation_v1");
expect(sql).toContain("pg_advisory_xact_lock");
expect(sql).toContain("salary.manage");
expect(sql).toMatch(/enable row level security/);
expect(sql).not.toMatch(/grant all/);
```

- [ ] **Step 2: Run the contract test and confirm RED**

Run: `npm run test:unit -- src/features/payroll-calculation/migration-contract.test.ts`

Expected: FAIL because the migration does not exist.

- [ ] **Step 3: Add policy schema and constraints**

Create `payroll_policies` with organization foreign key, `effective_month` day-one check, rates `numeric(9,6)` constrained between 0 and 1, non-negative base bounds, `min <= max`, status check, audit timestamps, and a partial unique index for one non-retired policy per organization/effective month.

```sql
create table public.payroll_policies (
  id bigint generated always as identity primary key,
  public_id uuid not null default gen_random_uuid() unique,
  organization_id bigint not null references public.organizations(id) on delete cascade,
  effective_month date not null check (extract(day from effective_month) = 1),
  pension_employee_rate numeric(9,6) not null check (pension_employee_rate between 0 and 1),
  medical_employee_rate numeric(9,6) not null check (medical_employee_rate between 0 and 1),
  medical_employee_fixed_amount numeric(14,2) not null default 0 check (medical_employee_fixed_amount >= 0),
  unemployment_employee_rate numeric(9,6) not null check (unemployment_employee_rate between 0 and 1),
  housing_fund_employee_rate numeric(9,6) not null check (housing_fund_employee_rate between 0 and 1),
  social_base_min numeric(14,2) not null check (social_base_min >= 0),
  social_base_max numeric(14,2) not null check (social_base_max >= social_base_min),
  housing_base_min numeric(14,2) not null check (housing_base_min >= 0),
  housing_base_max numeric(14,2) not null check (housing_base_max >= housing_base_min),
  status text not null check (status in ('draft','active','retired')),
  created_by_member_id bigint not null,
  activated_by_member_id bigint,
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, created_by_member_id)
    references public.organization_members(organization_id, id),
  foreign key (organization_id, activated_by_member_id)
    references public.organization_members(organization_id, id)
);
```

- [ ] **Step 4: Extend salary with detailed and snapshot fields**

Add every field from spec section 4.2. Keep new fields nullable for old manual rows. Add `calculation_version text`, `policy_snapshot jsonb`, `calculation_snapshot jsonb`, and checks requiring all calculated fields when `calculation_version is not null`.

Set compatibility aggregates on calculated rows:

```text
bonus = performance_bonus + project_bonus + other_bonus
social_security = pension_employee + medical_employee
  + unemployment_employee + housing_fund_employee
deductions = social_security + individual_income_tax + other_deduction
net_salary = gross_salary - deductions
```

- [ ] **Step 5: Add least-privilege RLS and atomic policy/payroll RPCs**

Policies allow `salary.manage` users to select/insert/update policy rows and retain current salary self-or-manager reads. `save_payroll_policy_v1(payload jsonb)` must serialize policy drafts/activation per organization and effective month, retire the previous active version atomically, require and audit the server-verified example-calculation confirmation hash for activation, and append `payroll_policy.activated` to the audit log. Revoke public/anon execution and grant only `authenticated`.

`save_salary_calculation_v1(payload jsonb)` must:

```sql
perform pg_advisory_xact_lock(
  hashtextextended(v_organization_id::text || ':' || v_employee_profile_id::text || ':' || v_payroll_month::text, 0)
);

if exists (
  select 1 from public.salary
  where organization_id = v_organization_id
    and employee_profile_id = v_employee_profile_id
    and payroll_month = v_payroll_month
    and deleted_at is null
    and status in ('processing','paid')
) then
  raise exception 'Confirmed payroll is immutable' using errcode = '23505';
end if;
```

Then upsert only a draft or insert a new calculated row, append `payroll.calculated` or `payroll.confirmed` to the audit log, and return the row public ID. Revoke public/anon execution and grant only `authenticated`.

- [ ] **Step 6: Run migration contract and local database tests**

Run:

```bash
npm run test:unit -- src/features/payroll-calculation/migration-contract.test.ts
npm run db:reset
npm run db:test
```

Expected: migration contract PASS, reset applies `202608210004`, and all database tests PASS.

- [ ] **Step 7: Commit schema task**

```bash
git add supabase/migrations/202608210004_payroll_calculation.sql src/features/payroll-calculation/migration-contract.test.ts
git commit -m "feat: add payroll calculation schema"
```

---

### Task 3: Payroll Policy API

**Files:**
- Create: `src/app/api/workstation/payroll/policy/handler.ts`
- Create: `src/app/api/workstation/payroll/policy/handler.test.ts`
- Create: `src/app/api/workstation/payroll/policy/route.ts`

**Interfaces:**
- Consumes: `getWorkspaceSession`, Supabase server client, `salary.manage`, and Task 2 policy schema.
- Produces: `GET /api/workstation/payroll/policy` and `PUT /api/workstation/payroll/policy`.

- [ ] **Step 1: Write failing permission and versioning tests**

```ts
it("requires salary.manage for reading and writing policy", async () => {
  const handler = createPayrollPolicyHandler({
    loadSession: async () => ({ member: { id: 7 }, permissionCodes: ["payroll.read.self"] }),
    loadPolicies: vi.fn(),
    savePolicy: vi.fn(),
  });
  expect((await handler.GET()).status).toBe(403);
  expect((await handler.PUT(policyRequest(validPolicy))).status).toBe(403);
});

it("stores decimal rates as fractions and activates only after example confirmation", async () => {
  const savePolicy = vi.fn().mockResolvedValue({ status: "active", publicId: "policy-1" });
  const handler = authorizedPolicyHandler({
    buildActivationExample: vi.fn().mockResolvedValue({ confirmationHash: "example-hash" }),
    savePolicy,
  });
  const response = await handler.PUT(policyRequest({
    action: "activate",
    exampleConfirmationHash: "example-hash",
    effectiveMonth: "2026-08",
    pensionEmployeeRate: "8",
    medicalEmployeeRate: "2",
    medicalEmployeeFixedAmount: "2.00",
    unemploymentEmployeeRate: "0.5",
    housingFundEmployeeRate: "7",
    socialBaseMin: "4000.00",
    socialBaseMax: "22000.00",
    housingBaseMin: "4000.00",
    housingBaseMax: "22000.00",
  }));
  expect(response.status).toBe(200);
  expect(savePolicy).toHaveBeenCalledWith(expect.objectContaining({
    actorMemberId: 7,
    pensionEmployeeRate: "0.080000",
    status: "active",
  }));
});
```

- [ ] **Step 2: Run tests and confirm RED**

Run: `npm run test:unit -- src/app/api/workstation/payroll/policy/handler.test.ts`

Expected: FAIL because handler and route do not exist.

- [ ] **Step 3: Implement strict request parsing and dependencies**

`GET` returns active policy, version history, and a server-generated example calculation for each draft. The example uses a canonical one-month resident salary input with contribution bases clamped to that policy and returns a SHA-256 confirmation hash over canonical policy inputs plus results.

`PUT` accepts only `saveDraft` or `activate`. Convert percentage text through `parseRate`, serialize the database fraction with six decimals, validate `min <= max`, and never accept organization/member IDs from the client. Activation requires the matching `exampleConfirmationHash`; recompute it on the server before calling the atomic policy RPC so a changed draft cannot reuse an older confirmation.

```ts
export type PayrollPolicyDependencies = {
  loadSession: () => Promise<PayrollSession | null>;
  loadPolicies: (actorMemberId: number) => Promise<unknown>;
  buildActivationExample: (policy: PayrollPolicyPersistenceInput) => Promise<PayrollActivationExample>;
  savePolicy: (input: PayrollPolicyPersistenceInput) => Promise<unknown>;
};
```

The default dependency resolves organization from the session member, validates the example confirmation, and calls `save_payroll_policy_v1`; the RPC retires an older active policy only inside the same organization/effective month and appends `payroll_policy.activated` to the audit log.

- [ ] **Step 4: Wire route and run tests**

```ts
export const dynamic = "force-dynamic";
const handler = createPayrollPolicyHandler(defaultPayrollPolicyDependencies);
export const GET = handler.GET;
export const PUT = handler.PUT;
```

Run: `npm run test:unit -- src/app/api/workstation/payroll/policy/handler.test.ts`

Expected: PASS for unauthorized, forbidden, invalid rate, invalid base range, draft, activation-example mismatch, activation, and organization isolation cases.

- [ ] **Step 5: Commit policy API**

```bash
git add src/app/api/workstation/payroll/policy
git commit -m "feat: add payroll policy API"
```

---

### Task 4: Shared Server Calculation Service, Preview API, and Authoritative Save

**Files:**
- Create: `src/features/payroll-calculation/server-service.ts`
- Create: `src/features/payroll-calculation/server-service.test.ts`
- Create: `src/app/api/workstation/payroll/preview/handler.ts`
- Create: `src/app/api/workstation/payroll/preview/handler.test.ts`
- Create: `src/app/api/workstation/payroll/preview/route.ts`
- Modify: `src/app/api/workstation/payroll/handler.ts`
- Modify: `src/app/api/workstation/payroll/handler.test.ts`

**Interfaces:**
- Consumes: Task 1 `calculatePayroll`, Task 2 `save_salary_calculation_v1`, Task 3 policy persistence.
- Produces: `calculatePayrollForActor(input, dependencies)` shared by preview/save and expanded authoritative payroll POST.

- [ ] **Step 1: Write failing service tests for policy/history resolution**

```ts
it("uses the latest active policy not later than payroll month", async () => {
  const result = await calculatePayrollForActor(input, dependencies({
    policies: [policy("2026-01"), policy("2026-07"), policy("2026-09")],
  }));
  expect(result.policy.effectiveMonth).toBe("2026-07");
});

it("requires opening cumulative values when hire date predates the first in-system payroll month", async () => {
  await expect(calculatePayrollForActor({
    ...input,
    month: "2026-08",
    openingCumulativeIncome: "",
  }, dependencies({
    employee: { hireDate: "2026-01-15" },
    history: [],
  }))).rejects.toThrow("missing_opening_cumulative");
});

it("uses zero opening totals when the employee is hired in the selected month", async () => {
  const result = await calculatePayrollForActor({
    ...input,
    month: "2026-08",
    openingCumulativeIncome: "",
  }, dependencies({
    employee: { hireDate: "2026-08-01" },
    history: [],
  }));
  expect(result.calculation.cumulative.income).toBe(result.calculation.grossSalary);
});
```

- [ ] **Step 2: Run service tests and confirm RED**

Run: `npm run test:unit -- src/features/payroll-calculation/server-service.test.ts`

Expected: FAIL because service does not exist.

- [ ] **Step 3: Implement organization-scoped context resolution**

The service must derive actor organization and target employee profile from the session organization, query active policy by `effective_month <= requested month`, load earlier calculated rows from January through the prior month, derive `employmentMonthsYtd` from the employee `hire_date` and requested payroll month, and call `calculatePayroll`. Require opening cumulative values only when the employee was already employed before the first in-system payroll month in the same tax year. If the employee was hired in the selected month or in January, use zero opening totals. Once a calculated row exists, reuse its immutable opening snapshot, reject client attempts to change it, and fail on gaps between stored calculated months. The public `PayrollSaveRequest` omits `employmentMonthsYtd`; if a client sends it anyway, strict parsing discards it. A missing or future `hire_date` blocks calculation with `employee_hire_date_missing`.

```ts
export async function calculatePayrollForActor(
  actor: { memberId: number; organizationId: number },
  input: PayrollSaveRequest,
  dependencies: PayrollCalculationDependencies,
) {
  const employee = await dependencies.loadEmployee(actor.organizationId, input.memberId);
  if (!employee) throw new PayrollError("employee_not_found");
  const policy = await dependencies.loadPolicy(actor.organizationId, input.month);
  if (!policy) throw new PayrollError("payroll_policy_missing");
  const employmentMonthsYtd = employmentMonthsInYear(employee.hireDate, input.month);
  const history = await dependencies.loadYearHistory(
    actor.organizationId,
    employee.profileId,
    input.month.slice(0, 4),
  );
  return {
    employee,
    policy,
    calculation: calculatePayroll(
      policy,
      { ...input, employmentMonthsYtd },
      toPriorTotals(history, input),
    ),
  };
}
```

- [ ] **Step 4: Write failing preview and spoofed-save tests**

```ts
it("returns a calculation without persistence", async () => {
  const preview = vi.fn().mockResolvedValue(calculatedFixture);
  const response = await createPayrollPreviewHandler({ loadSession, preview })(request(validInput));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(calculatedFixture);
});

it("ignores client gross, tax, deductions, and net fields", async () => {
  const saveCalculatedPayroll = vi.fn().mockResolvedValue({ status: "saved" });
  const response = await saveHandler(request({
    ...validInput,
    grossSalary: "1.00",
    individualIncomeTax: "1.00",
    deductions: "1.00",
    netSalary: "999999.00",
    employmentMonthsYtd: 12,
  }));
  expect(response.status).toBe(200);
  expect(saveCalculatedPayroll).toHaveBeenCalledWith(expect.objectContaining({
    calculation: calculatedFixture.calculation,
  }));
});
```

- [ ] **Step 5: Implement preview and refactor save to shared service**

`POST /preview` requires `salary.manage`, calls the shared service, and returns the policy summary plus calculation. `POST /payroll` parses the same input, calls the same service again, builds immutable snapshots, then calls the RPC. Map errors exactly:

```ts
const statusByCode = {
  unauthorized: 401,
  forbidden: 403,
  invalid_request: 400,
  employee_not_found: 404,
  employee_hire_date_missing: 409,
  payroll_policy_missing: 409,
  missing_opening_cumulative: 409,
  confirmed_payroll_immutable: 409,
  payroll_update_failed: 409,
} as const;
```

- [ ] **Step 6: Run service/API tests**

Run:

```bash
npm run test:unit -- src/features/payroll-calculation/server-service.test.ts
npm run test:unit -- src/app/api/workstation/payroll/preview/handler.test.ts src/app/api/workstation/payroll/handler.test.ts
```

Expected: PASS, including preview/save equality and spoofed aggregate rejection.

- [ ] **Step 7: Commit service and API task**

```bash
git add src/features/payroll-calculation/server-service.ts src/features/payroll-calculation/server-service.test.ts src/app/api/workstation/payroll
git commit -m "feat: calculate payroll on the server"
```

---

### Task 5: Bootstrap Mapping and Formal HTML Gateway

**Files:**
- Modify: `src/app/api/workstation/bootstrap/handler.ts`
- Modify: `src/app/api/workstation/bootstrap/handler.test.ts`
- Modify: `src/features/workstation/server-bootstrap.ts`
- Modify: `src/features/workstation/server-bootstrap.test.ts`
- Modify: `public/workstation-server-adapter.js`
- Modify: `tests/html-workstation-server-adapter.test.mjs`

**Interfaces:**
- Consumes: detailed salary columns and policy/preview/save endpoints.
- Produces: self-only detailed payroll rows and formal gateway methods `loadPayrollPolicy`, `previewPayroll`, and `savePayroll`.

- [ ] **Step 1: Write failing bootstrap mapping test**

```ts
expect(bootstrap.payroll.m7[0]).toMatchObject({
  month: "2026-08",
  grossSalary: 25000,
  pensionEmployee: 1600,
  medicalEmployee: 402,
  unemploymentEmployee: 100,
  housingFundEmployee: 1400,
  social: 3502,
  cumulativeTaxableIncome: 120000,
  tax: 620,
  net: 20878,
  calculationVersion: "cn-resident-cumulative-v1",
});
```

- [ ] **Step 2: Run bootstrap tests and confirm RED**

Run: `npm run test:unit -- src/app/api/workstation/bootstrap/handler.test.ts src/features/workstation/server-bootstrap.test.ts`

Expected: FAIL because detailed fields are not selected/mapped.

- [ ] **Step 3: Select and map detailed self-only payroll fields**

Extend the salary select and `buildServerBootstrap` input. Preserve old rows by falling back to existing aggregate values when `calculation_version` is null. Do not load another employee's payroll into the signed-in bootstrap.

- [ ] **Step 4: Write failing adapter request tests**

```js
await adapter.loadPayrollPolicy();
await adapter.previewPayroll(validPayrollInput);
await adapter.savePayroll(validPayrollInput);

assert.equal(requests.find(({ url }) => url === "/api/workstation/payroll/policy").init.method, "GET");
assert.equal(requests.find(({ url }) => url === "/api/workstation/payroll/preview").init.method, "POST");
assert.equal(requests.filter(({ url }) => url === "/api/workstation/payroll").length, 1);
```

- [ ] **Step 5: Implement gateway methods and refresh saved self payroll**

```js
loadPayrollPolicy: function () {
  return request("/api/workstation/payroll/policy", { method: "GET" });
},
previewPayroll: function (input) {
  return request("/api/workstation/payroll/preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input || {}),
  });
},
savePayroll: function (input) {
  return request("/api/workstation/payroll", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input || {}),
  }).then(function (result) {
    if (result.payroll && result.memberId === requireBootstrap().session.memberId) {
      requireBootstrap().payroll[result.memberId] = [result.payroll]
        .concat(requireBootstrap().payroll[result.memberId] || [])
        .filter(function (row, index, rows) {
          return rows.findIndex(function (candidate) { return candidate.month === row.month; }) === index;
        });
    }
    return clone(result);
  });
},
```

- [ ] **Step 6: Run bootstrap and adapter tests, then commit**

Run:

```bash
npm run test:unit -- src/app/api/workstation/bootstrap/handler.test.ts src/features/workstation/server-bootstrap.test.ts
node --test tests/html-workstation-server-adapter.test.mjs
```

Expected: PASS and no secret or cross-employee payroll data in bootstrap fixtures.

```bash
git add src/app/api/workstation/bootstrap src/features/workstation/server-bootstrap.ts src/features/workstation/server-bootstrap.test.ts public/workstation-server-adapter.js tests/html-workstation-server-adapter.test.mjs
git commit -m "feat: expose calculated payroll to workstation"
```

---

### Task 6: System-Settings Policy and Payroll Calculation Management UI

**Files:**
- Modify: `quantxy-ai-workbench-fused.html`
- Modify: `public/quantxy-ai-workbench-fused.html`
- Modify: `tests/html-fusion-contract.test.mjs`
- Modify: `tests/html-personal-workbench-behavior.test.mjs`

**Interfaces:**
- Consumes: Task 5 formal gateway methods and existing `salary.manage` permission.
- Produces: a policy editor under existing `set` (系统设置), plus payroll inputs, preview summary, draft save, and confirm actions on existing `pay-admin` (薪资录入).

- [ ] **Step 1: Write failing HTML contract tests**

```js
for (const label of [
  "薪资核算参数", "生效月份", "养老个人比例", "医疗个人比例",
  "失业个人比例", "公积金个人比例", "社保基数下限", "社保基数上限",
  "保存草稿", "启用参数", "专项附加扣除", "累计已缴个税",
  "预览核算", "确认工资单",
]) assert.match(source, new RegExp(label));

assert.match(source, /data-act="payroll-policy-save"/);
assert.match(source, /data-act="payroll-policy-activate"/);
assert.match(source, /data-act="payroll-preview"/);
assert.match(source, /data-act="payroll-confirm"/);
```

- [ ] **Step 2: Write failing behavioral test for preview and confirm**

```js
gateway.loadPayrollPolicy = async () => ({ active: policyFixture, history: [] });
gateway.previewPayroll = async () => previewFixture;
gateway.savePayroll = async () => ({ status: "saved", payroll: payrollFixture });

S.page = "pay-admin";
render();
fillPayrollInputs(dom.window.document, validInput);
dom.window.document.querySelector('[data-act="payroll-preview"]').click();
await flushPromises();
assert.match(dom.window.document.querySelector("#view").textContent, /应发工资.*25000\.00/s);
assert.match(dom.window.document.querySelector("#view").textContent, /实发工资.*20878\.00/s);

dom.window.document.querySelector('[data-act="payroll-confirm"]').click();
await flushPromises();
assert.equal(gateway.savePayroll.mock.calls.length, 1);
```

- [ ] **Step 3: Run targeted HTML tests and confirm RED**

Run: `node --test --test-name-pattern="payroll policy|previews calculated payroll|confirms calculated payroll" tests/html-fusion-contract.test.mjs tests/html-personal-workbench-behavior.test.mjs`

Expected: FAIL because controls/actions are absent.

- [ ] **Step 4: Extend state and render policy only in system settings**

Add `S.payrollPolicy`, `S.payrollPolicyBusy`, `S.payrollPolicyExample`, `S.payrollDraft`, `S.payrollPreview`, and `S.payrollError`. Load policy after entering `set` or `pay-admin` with `salary.manage`. Render “薪资核算参数” only inside `viewSet`; do not duplicate it in `viewPayrollAdmin`. Policy fields submit strings, not numbers. Hide policy controls and employee payroll management entirely without permission.

After saving a draft, show the server-generated example calculation with policy version, sample gross, four personal contributions, tax, deductions, and net. Keep “启用参数” disabled until the authorized user checks “我已核对示例结果”; activation sends the returned `exampleConfirmationHash`, and any policy input change clears that confirmation.

- [ ] **Step 5: Replace manual tax/social inputs with calculation inputs**

The form order must be: employee/month, income, contribution bases, tax deductions, other deduction plus required reason, opening cumulative values, then preview. Do not render an editable `employmentMonthsYtd`; display the server-derived hire date/任职月份 in the preview instead. Show opening fields only when the API reports that the employee was hired before the first in-system payroll month in the same year; otherwise keep them absent rather than inviting unnecessary manual input.

Preview output renders one concise summary row plus expandable details:

```text
应发工资 | 社保公积金 | 本期个税 | 其他扣款 | 实发工资
```

Disable confirm until the latest preview hash matches the current input hash. Any input change invalidates the preview.

- [ ] **Step 6: Implement policy, preview, draft, and confirm actions**

Use `data-act` handlers:

```js
if (a === "payroll-policy-save") savePayrollPolicy("saveDraft");
else if (a === "payroll-policy-activate") savePayrollPolicy("activate");
else if (a === "payroll-preview") previewPayrollCalculation();
else if (a === "payroll-save-draft") saveCalculatedPayroll("draft");
else if (a === "payroll-confirm") saveCalculatedPayroll("processing");
```

Map errors to clear Chinese messages: missing policy, incomplete opening cumulative values, immutable confirmed row, invalid amount, and service unavailable. Never print raw response bodies.

- [ ] **Step 7: Synchronize the two HTML copies and run tests**

Run:

```powershell
Copy-Item -LiteralPath quantxy-ai-workbench-fused.html -Destination public/quantxy-ai-workbench-fused.html
node --test tests/html-fusion-contract.test.mjs tests/html-personal-workbench-behavior.test.mjs
```

Expected: PASS and `Get-FileHash` SHA256 values for both files are equal.

- [ ] **Step 8: Commit payroll management UI**

```bash
git add quantxy-ai-workbench-fused.html public/quantxy-ai-workbench-fused.html tests/html-fusion-contract.test.mjs tests/html-personal-workbench-behavior.test.mjs
git commit -m "feat: add payroll calculation workspace"
```

---

### Task 7: Employee Self-Only Payslip Breakdown and Mobile Flow

**Files:**
- Modify: `quantxy-ai-workbench-fused.html`
- Modify: `public/quantxy-ai-workbench-fused.html`
- Modify: `tests/html-personal-workbench-behavior.test.mjs`
- Create: `tests/e2e/payroll-calculation.spec.ts`

**Interfaces:**
- Consumes: detailed self-only bootstrap payroll rows from Task 5.
- Produces: desktop and mobile employee payslip with gross, contribution, tax, deduction, and net detail.

- [ ] **Step 1: Write failing employee privacy and detail tests**

```js
S.me = "m7";
S.payroll = {
  m7: [calculatedPayroll("m7")],
  m8: [calculatedPayroll("m8", { net: 999999 })],
};
S.page = "fin";
render();

const text = dom.window.document.querySelector("#view").textContent;
for (const label of [
  "应发工资", "养老保险", "医疗保险", "失业保险", "住房公积金",
  "累计应纳税所得额", "本期个人所得税", "扣款合计", "实发工资",
]) assert.match(text, new RegExp(label));
assert.doesNotMatch(text, /999999/);
```

- [ ] **Step 2: Write failing mobile disclosure test**

```js
dom.window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
render();
const details = dom.window.document.querySelector('[data-act="payroll-details-toggle"]');
assert.ok(details);
assert.equal(details.getAttribute("aria-expanded"), "false");
details.click();
assert.equal(dom.window.document.querySelector('[data-payroll-details]').hidden, false);
```

- [ ] **Step 3: Run targeted tests and confirm RED**

Run: `node --test --test-name-pattern="calculated payroll|mobile payroll details" tests/html-personal-workbench-behavior.test.mjs`

Expected: FAIL because detailed rows and toggle are absent.

- [ ] **Step 4: Render calculated and legacy payslips safely**

Calculated rows show four personal contributions separately, tax cumulative basis and bracket explanation, other deduction plus reason, and gross/deductions/net summary. Legacy rows keep the existing “社保公积金” aggregate and display “历史手工记录” without invented detail.

All values come from `payrollRow(S.me, month)` only. Do not accept a member ID in click actions or URL state.

- [ ] **Step 5: Add mobile progressive disclosure**

At widths below 680px, keep gross/deductions/net visible. Collapse calculation details behind a native button with at least 44px height and `aria-expanded`. Preserve the existing bottom “薪酬” navigation and whole-card personal-income click target.

- [ ] **Step 6: Add formal e2e coverage**

```ts
test("employee sees only own calculated payslip on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/quantxy-ai-workbench-fused.html?formal=1");
  await page.getByRole("button", { name: "薪酬" }).click();
  await expect(page.getByText("实发工资")).toBeVisible();
  await expect(page.getByText("住房公积金")).not.toBeVisible();
  await page.getByRole("button", { name: "查看详细计算" }).click();
  await expect(page.getByText("住房公积金")).toBeVisible();
});
```

Use the existing authenticated e2e fixture/binding. Do not seed another employee's salary into the client for this test.

- [ ] **Step 7: Synchronize HTML, run HTML/e2e tests, and commit**

Run:

```powershell
Copy-Item -LiteralPath quantxy-ai-workbench-fused.html -Destination public/quantxy-ai-workbench-fused.html
node --test tests/html-personal-workbench-behavior.test.mjs
npx playwright test tests/e2e/payroll-calculation.spec.ts
```

Expected: employee detail and 390px flow PASS, both HTML files have equal SHA256 hashes.

```bash
git add quantxy-ai-workbench-fused.html public/quantxy-ai-workbench-fused.html tests/html-personal-workbench-behavior.test.mjs tests/e2e/payroll-calculation.spec.ts
git commit -m "feat: show calculated employee payslips"
```

---

### Task 8: Documentation, Full Verification, and Deployment Readiness

**Files:**
- Modify: `.env.example`
- Modify: `src/features/salary/README.md`
- Create: `docs/deployment/payroll-calculation-rollout.md`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: operator instructions, no-secret environment documentation, and complete verification evidence.

- [ ] **Step 1: Document policy activation and safe rollout**

`docs/deployment/payroll-calculation-rollout.md` must state:

1. Apply migration before deploying the application image.
2. Do not activate automatic calculation until an authorized payroll manager enters and verifies policy values.
3. Test one designated employee and non-production payroll month.
4. Compare policy inputs, gross, four personal contributions, cumulative tax, deductions, and net against the company's payroll professional.
5. Confirm the employee can see only their own payslip.
6. Only then activate the first real payroll month.
7. Existing historical rows are not recalculated.

- [ ] **Step 2: Document environment behavior**

Add comments to `.env.example` explaining that no new payroll secret is introduced and formal calculation uses existing server-only Supabase credentials. Do not add a `NEXT_PUBLIC_*` payroll secret.

- [ ] **Step 3: Run focused and full verification**

Run:

```bash
npm run test:unit
npm run test:html
npm run typecheck
npm run lint
npm run build
```

If local Supabase is available, also run:

```bash
npm run db:reset
npm run db:test
```

Expected: every command exits 0; do not report database verification as passed if local Supabase is unavailable.

- [ ] **Step 4: Verify repository and artifact boundaries**

Run:

```powershell
$a=(Get-FileHash quantxy-ai-workbench-fused.html -Algorithm SHA256).Hash
$b=(Get-FileHash public/quantxy-ai-workbench-fused.html -Algorithm SHA256).Hash
if($a -ne $b){ throw 'HTML copies differ' }
git diff --check
git status --short
```

Confirm `.env`, `.env.production`, real employee tax inputs, and payroll values are not staged. Confirm unrelated pre-existing worktree changes were preserved.

- [ ] **Step 5: Commit documentation**

```bash
git add .env.example src/features/salary/README.md docs/deployment/payroll-calculation-rollout.md
git commit -m "docs: add payroll calculation rollout guide"
```

- [ ] **Step 6: Stop before production migration or deployment**

Report the final commit hash, migration filename, test/build evidence, and any local database verification limitation. Do not push the database migration, rebuild the server container, or activate a real payroll policy without a separate explicit deployment authorization.
