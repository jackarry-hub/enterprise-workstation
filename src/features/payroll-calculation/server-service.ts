import { calculatePayroll } from "./calculator";
import {
  formatMoney,
  formatRatePercent,
  parseFractionRate,
  parseMoney,
} from "./money";
import type {
  PayrollCalculationInput,
  PayrollPolicyInput,
  PriorPayrollTotals,
} from "./types";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const PAYROLL_CALCULATION_VERSION = "cn-cumulative-withholding-v1";

export type PayrollSaveRequest = Omit<
  PayrollCalculationInput,
  "employmentMonthsYtd"
> & {
  memberId: number;
  status: "draft" | "processing";
  note: string;
};

export type PayrollEmployee = {
  profileId: number;
  memberId: number;
  hireDate: string | null;
};

export type PayrollPolicyRecord = {
  publicId: string;
  status: "draft" | "active" | "retired";
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

export type PayrollHistoryRow = {
  month: string;
  status: "draft" | "processing" | "paid";
  calculationVersion: string | null;
  grossSalary: string;
  taxExemptIncome: string;
  socialSecurity: string;
  specialAdditionalDeduction: string;
  otherStatutoryDeduction: string;
  taxRelief: string;
  individualIncomeTax: string;
  openingCumulativeIncome: string;
  openingCumulativeTaxExemptIncome: string;
  openingCumulativeSpecialDeduction: string;
  openingCumulativeSpecialAdditionalDeduction: string;
  openingCumulativeOtherStatutoryDeduction: string;
  openingCumulativeTaxRelief: string;
  openingCumulativeTaxWithheld: string;
};

export type PayrollCalculationDependencies = {
  loadEmployee: (
    organizationId: number,
    memberId: number,
  ) => Promise<PayrollEmployee | null>;
  loadPolicies: (organizationId: number) => Promise<PayrollPolicyRecord[]>;
  loadYearHistory: (
    organizationId: number,
    employeeProfileId: number,
    year: string,
  ) => Promise<PayrollHistoryRow[]>;
};

export class PayrollError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "PayrollError";
  }
}

const requestMoneyKeys = [
  "baseSalary",
  "performanceBonus",
  "projectBonus",
  "otherBonus",
  "otherIncome",
  "socialBase",
  "housingFundBase",
  "taxExemptIncome",
  "specialAdditionalDeduction",
  "otherStatutoryDeduction",
  "taxRelief",
  "otherDeduction",
] as const;

const openingKeys = [
  "openingCumulativeIncome",
  "openingCumulativeTaxExemptIncome",
  "openingCumulativeSpecialDeduction",
  "openingCumulativeSpecialAdditionalDeduction",
  "openingCumulativeOtherStatutoryDeduction",
  "openingCumulativeTaxRelief",
  "openingCumulativeTaxWithheld",
] as const;

export function parsePayrollSaveRequest(value: unknown): PayrollSaveRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const memberMatch = typeof body.memberId === "string"
    ? /^m([1-9]\d*)$/.exec(body.memberId)
    : null;
  const memberId = memberMatch ? Number(memberMatch[1]) : null;
  if (!memberId || !Number.isSafeInteger(memberId)) return null;
  if (typeof body.month !== "string"
    || !/^\d{4}-(0[1-9]|1[0-2])$/.test(body.month)) return null;
  if (body.status !== "draft" && body.status !== "processing") return null;
  if (typeof body.manualAdjustmentReason !== "string"
    || body.manualAdjustmentReason.length > 500) return null;
  if (typeof body.note !== "string" || body.note.length > 2_000) return null;

  const amounts = {} as Record<(typeof requestMoneyKeys)[number], string>;
  const opening = {} as Record<(typeof openingKeys)[number], string>;
  try {
    for (const key of requestMoneyKeys) {
      if (typeof body[key] !== "string") return null;
      amounts[key] = formatMoney(parseMoney(body[key]));
    }
    for (const key of openingKeys) {
      if (typeof body[key] !== "string") return null;
      opening[key] = body[key].trim()
        ? formatMoney(parseMoney(body[key]))
        : "";
    }
  } catch {
    return null;
  }

  return {
    memberId,
    month: body.month,
    ...amounts,
    ...opening,
    manualAdjustmentReason: body.manualAdjustmentReason.trim(),
    status: body.status,
    note: body.note.trim(),
  };
}

type OpeningValues = Pick<PayrollSaveRequest, (typeof openingKeys)[number]>;

const zeroOpening: OpeningValues = {
  openingCumulativeIncome: "0.00",
  openingCumulativeTaxExemptIncome: "0.00",
  openingCumulativeSpecialDeduction: "0.00",
  openingCumulativeSpecialAdditionalDeduction: "0.00",
  openingCumulativeOtherStatutoryDeduction: "0.00",
  openingCumulativeTaxRelief: "0.00",
  openingCumulativeTaxWithheld: "0.00",
};

const zeroPrior: PriorPayrollTotals = {
  cumulativeIncome: BigInt(0),
  cumulativeTaxExemptIncome: BigInt(0),
  cumulativeSpecialDeduction: BigInt(0),
  cumulativeSpecialAdditionalDeduction: BigInt(0),
  cumulativeOtherStatutoryDeduction: BigInt(0),
  cumulativeTaxRelief: BigInt(0),
  cumulativeTaxWithheld: BigInt(0),
};

function monthIndex(month: string) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match) throw new PayrollError("invalid_request");
  return Number(match[1]) * 12 + Number(match[2]) - 1;
}

function validHireDate(value: string | null) {
  if (!value || !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)) {
    return null;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value
    ? null
    : value;
}

export function employmentMonthsInYear(hireDate: string, month: string) {
  const selected = monthIndex(month);
  const hireMonth = monthIndex(hireDate.slice(0, 7));
  if (hireMonth > selected) throw new PayrollError("employee_hire_date_missing");
  const selectedYear = Number(month.slice(0, 4));
  const hireYear = Number(hireDate.slice(0, 4));
  const firstMonth = hireYear < selectedYear ? selectedYear * 12 : hireMonth;
  return selected - firstMonth + 1;
}

function policyForCalculator(policy: PayrollPolicyRecord): PayrollPolicyInput {
  return {
    id: policy.publicId,
    effectiveMonth: policy.effectiveMonth,
    pensionEmployeeRate: formatRatePercent(
      parseFractionRate(policy.pensionEmployeeRate),
    ),
    medicalEmployeeRate: formatRatePercent(
      parseFractionRate(policy.medicalEmployeeRate),
    ),
    medicalEmployeeFixedAmount: policy.medicalEmployeeFixedAmount,
    unemploymentEmployeeRate: formatRatePercent(
      parseFractionRate(policy.unemploymentEmployeeRate),
    ),
    housingFundEmployeeRate: formatRatePercent(
      parseFractionRate(policy.housingFundEmployeeRate),
    ),
    socialBaseMin: policy.socialBaseMin,
    socialBaseMax: policy.socialBaseMax,
    housingBaseMin: policy.housingBaseMin,
    housingBaseMax: policy.housingBaseMax,
  };
}

function openingFromHistory(row: PayrollHistoryRow): OpeningValues {
  return {
    openingCumulativeIncome: row.openingCumulativeIncome,
    openingCumulativeTaxExemptIncome: row.openingCumulativeTaxExemptIncome,
    openingCumulativeSpecialDeduction: row.openingCumulativeSpecialDeduction,
    openingCumulativeSpecialAdditionalDeduction:
      row.openingCumulativeSpecialAdditionalDeduction,
    openingCumulativeOtherStatutoryDeduction:
      row.openingCumulativeOtherStatutoryDeduction,
    openingCumulativeTaxRelief: row.openingCumulativeTaxRelief,
    openingCumulativeTaxWithheld: row.openingCumulativeTaxWithheld,
  };
}

function normalizedOpening(input: PayrollSaveRequest): OpeningValues {
  return Object.fromEntries(openingKeys.map((key) => [
    key,
    formatMoney(parseMoney(input[key])),
  ])) as OpeningValues;
}

function assertOpeningMatches(
  requested: PayrollSaveRequest,
  immutable: OpeningValues,
) {
  for (const key of openingKeys) {
    if (!requested[key].trim()) continue;
    let normalized: string;
    try {
      normalized = formatMoney(parseMoney(requested[key]));
    } catch {
      throw new PayrollError("opening_cumulative_mismatch");
    }
    if (normalized !== formatMoney(parseMoney(immutable[key]))) {
      throw new PayrollError("opening_cumulative_mismatch");
    }
  }
}

function addMoney(total: bigint, value: string) {
  return total + parseMoney(value);
}

function priorTotals(history: PayrollHistoryRow[]): PriorPayrollTotals {
  return history.reduce<PriorPayrollTotals>((total, row) => ({
    cumulativeIncome: addMoney(total.cumulativeIncome, row.grossSalary),
    cumulativeTaxExemptIncome: addMoney(
      total.cumulativeTaxExemptIncome,
      row.taxExemptIncome,
    ),
    cumulativeSpecialDeduction: addMoney(
      total.cumulativeSpecialDeduction,
      row.socialSecurity,
    ),
    cumulativeSpecialAdditionalDeduction: addMoney(
      total.cumulativeSpecialAdditionalDeduction,
      row.specialAdditionalDeduction,
    ),
    cumulativeOtherStatutoryDeduction: addMoney(
      total.cumulativeOtherStatutoryDeduction,
      row.otherStatutoryDeduction,
    ),
    cumulativeTaxRelief: addMoney(total.cumulativeTaxRelief, row.taxRelief),
    cumulativeTaxWithheld: addMoney(
      total.cumulativeTaxWithheld,
      row.individualIncomeTax,
    ),
  }), { ...zeroPrior });
}

function confirmedHistoryForMonth(
  history: PayrollHistoryRow[],
  selectedMonth: string,
) {
  const year = selectedMonth.slice(0, 4);
  const selectedIndex = monthIndex(selectedMonth);
  const rows = history
    .filter((row) => row.month.slice(0, 4) === year)
    .filter((row) => monthIndex(row.month) < selectedIndex)
    .filter((row) => row.calculationVersion !== null)
    .filter((row) => row.status === "processing" || row.status === "paid")
    .sort((left, right) => left.month.localeCompare(right.month));
  if (new Set(rows.map(({ month }) => month)).size !== rows.length) {
    throw new PayrollError("missing_history");
  }
  if (rows.length > 0) {
    const first = monthIndex(rows[0].month);
    for (let expected = first; expected < selectedIndex; expected += 1) {
      if (!rows.some(({ month }) => monthIndex(month) === expected)) {
        throw new PayrollError("missing_history");
      }
    }
  }
  return rows;
}

export async function calculatePayrollForActor(
  actor: { memberId: number; organizationId: number },
  input: PayrollSaveRequest,
  dependencies: PayrollCalculationDependencies,
) {
  monthIndex(input.month);
  const employee = await dependencies.loadEmployee(
    actor.organizationId,
    input.memberId,
  );
  if (!employee) throw new PayrollError("employee_not_found");

  const hireDate = validHireDate(employee.hireDate);
  if (!hireDate || hireDate.slice(0, 7) > input.month) {
    throw new PayrollError("employee_hire_date_missing");
  }
  const employmentMonthsYtd = employmentMonthsInYear(hireDate, input.month);

  const policy = (await dependencies.loadPolicies(actor.organizationId))
    .filter(({ status }) => status === "active")
    .filter(({ effectiveMonth }) => effectiveMonth <= input.month)
    .sort((left, right) => right.effectiveMonth.localeCompare(left.effectiveMonth))[0];
  if (!policy) throw new PayrollError("payroll_policy_missing");

  const history = confirmedHistoryForMonth(
    await dependencies.loadYearHistory(
      actor.organizationId,
      employee.profileId,
      input.month.slice(0, 4),
    ),
    input.month,
  );

  const selectedMonthNumber = Number(input.month.slice(5, 7));
  const hireMonthInSelectedYear = hireDate.slice(0, 4) === input.month.slice(0, 4)
    ? Number(hireDate.slice(5, 7))
    : 1;
  const openingRequired = history.length === 0
    && selectedMonthNumber > hireMonthInSelectedYear;

  let opening: OpeningValues;
  if (history.length > 0) {
    opening = openingFromHistory(history[0]);
    assertOpeningMatches(input, opening);
  } else if (openingRequired) {
    if (openingKeys.some((key) => !input[key].trim())) {
      throw new PayrollError("missing_opening_cumulative");
    }
    try {
      opening = normalizedOpening(input);
    } catch {
      throw new PayrollError("missing_opening_cumulative");
    }
  } else {
    opening = zeroOpening;
  }

  const prior = priorTotals(history);
  const calculationInput: PayrollCalculationInput = {
    ...input,
    ...opening,
    employmentMonthsYtd,
  };
  let calculation: ReturnType<typeof calculatePayroll>;
  try {
    calculation = calculatePayroll(
      policyForCalculator(policy),
      calculationInput,
      prior,
    );
  } catch (error) {
    if (error instanceof PayrollError) throw error;
    throw new PayrollError("invalid_request");
  }

  return {
    employee: { ...employee, hireDate },
    policy,
    employmentMonthsYtd,
    openingRequired,
    opening,
    prior,
    normalizedInput: calculationInput,
    calculation,
    calculationVersion: PAYROLL_CALCULATION_VERSION,
  };
}

type SupabaseClient = Awaited<ReturnType<typeof getSupabaseServerClient>>;

export function createPayrollRepository(
  client: Pick<SupabaseClient, "from" | "rpc">,
): PayrollCalculationDependencies {
  return {
    async loadEmployee(_organizationId, memberId) {
      const result = await client.rpc("current_payroll_employee_facts", {
        p_employee_member_id: memberId,
      });
      if (result.error) throw result.error;
      const rows = Array.isArray(result.data) ? result.data : [];
      if (rows.length !== 1) return null;
      const row = rows[0];
      const profileId = Number(row.profile_id);
      const organizationMemberId = Number(row.organization_member_id);
      if (!Number.isSafeInteger(profileId) || profileId < 1
        || !Number.isSafeInteger(organizationMemberId) || organizationMemberId < 1) {
        return null;
      }
      return {
        profileId,
        memberId: organizationMemberId,
        hireDate: row.hire_date ? String(row.hire_date) : null,
      };
    },
    async loadPolicies(organizationId) {
      const result = await client.from("payroll_policies")
        .select("public_id, status, effective_month, pension_employee_rate, medical_employee_rate, medical_employee_fixed_amount, unemployment_employee_rate, housing_fund_employee_rate, social_base_min, social_base_max, housing_base_min, housing_base_max")
        .eq("organization_id", organizationId)
        .eq("status", "active")
        .order("effective_month", { ascending: false });
      if (result.error) throw result.error;
      return (result.data ?? []).map((row) => ({
        publicId: String(row.public_id),
        status: row.status as PayrollPolicyRecord["status"],
        effectiveMonth: String(row.effective_month).slice(0, 7),
        pensionEmployeeRate: String(row.pension_employee_rate),
        medicalEmployeeRate: String(row.medical_employee_rate),
        medicalEmployeeFixedAmount: String(row.medical_employee_fixed_amount),
        unemploymentEmployeeRate: String(row.unemployment_employee_rate),
        housingFundEmployeeRate: String(row.housing_fund_employee_rate),
        socialBaseMin: String(row.social_base_min),
        socialBaseMax: String(row.social_base_max),
        housingBaseMin: String(row.housing_base_min),
        housingBaseMax: String(row.housing_base_max),
      }));
    },
    async loadYearHistory(organizationId, employeeProfileId, year) {
      const result = await client.from("salary")
        .select("payroll_month, status, calculation_version, gross_salary, tax_exempt_income, social_security, special_additional_deduction, other_statutory_deduction, tax_relief, individual_income_tax, opening_cumulative_income, opening_cumulative_tax_exempt_income, opening_cumulative_special_deduction, opening_cumulative_special_additional_deduction, opening_cumulative_other_statutory_deduction, opening_cumulative_tax_relief, opening_cumulative_tax_withheld")
        .eq("organization_id", organizationId)
        .eq("employee_profile_id", employeeProfileId)
        .gte("payroll_month", `${year}-01-01`)
        .lt("payroll_month", `${Number(year) + 1}-01-01`)
        .is("deleted_at", null)
        .order("payroll_month", { ascending: true });
      if (result.error) throw result.error;
      return (result.data ?? []).map((row) => ({
        month: String(row.payroll_month).slice(0, 7),
        status: row.status as PayrollHistoryRow["status"],
        calculationVersion: row.calculation_version
          ? String(row.calculation_version)
          : null,
        grossSalary: String(row.gross_salary ?? "0.00"),
        taxExemptIncome: String(row.tax_exempt_income ?? "0.00"),
        socialSecurity: String(row.social_security ?? "0.00"),
        specialAdditionalDeduction: String(
          row.special_additional_deduction ?? "0.00",
        ),
        otherStatutoryDeduction: String(
          row.other_statutory_deduction ?? "0.00",
        ),
        taxRelief: String(row.tax_relief ?? "0.00"),
        individualIncomeTax: String(row.individual_income_tax ?? "0.00"),
        openingCumulativeIncome: String(
          row.opening_cumulative_income ?? "0.00",
        ),
        openingCumulativeTaxExemptIncome: String(
          row.opening_cumulative_tax_exempt_income ?? "0.00",
        ),
        openingCumulativeSpecialDeduction: String(
          row.opening_cumulative_special_deduction ?? "0.00",
        ),
        openingCumulativeSpecialAdditionalDeduction: String(
          row.opening_cumulative_special_additional_deduction ?? "0.00",
        ),
        openingCumulativeOtherStatutoryDeduction: String(
          row.opening_cumulative_other_statutory_deduction ?? "0.00",
        ),
        openingCumulativeTaxRelief: String(
          row.opening_cumulative_tax_relief ?? "0.00",
        ),
        openingCumulativeTaxWithheld: String(
          row.opening_cumulative_tax_withheld ?? "0.00",
        ),
      }));
    },
  };
}

export type PayrollRequestContext = {
  actorMemberId: number;
  organizationPublicId: string;
};

export async function calculatePayrollForSession(
  context: PayrollRequestContext,
  input: PayrollSaveRequest,
) {
  const client = await getSupabaseServerClient();
  const member = await client.from("organization_members")
    .select("organization_id")
    .eq("id", context.actorMemberId)
    .single();
  if (member.error || !member.data) {
    throw new PayrollError("unauthorized");
  }
  const organization = await client.from("organizations")
    .select("public_id")
    .eq("id", member.data.organization_id)
    .single();
  if (organization.error || !organization.data
    || String(organization.data.public_id) !== context.organizationPublicId) {
    throw new PayrollError("unauthorized");
  }
  return calculatePayrollForActor({
    memberId: context.actorMemberId,
    organizationId: Number(member.data.organization_id),
  }, input, createPayrollRepository(client));
}
