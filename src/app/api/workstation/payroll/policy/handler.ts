import { createHash } from "node:crypto";

import { getWorkspaceSession } from "@/features/auth/workspace-session";
import { calculatePayroll } from "@/features/payroll-calculation/calculator";
import {
  formatFractionRate,
  formatMoney,
  formatRatePercent,
  parseFractionRate,
  parseMoney,
  parseRate,
} from "@/features/payroll-calculation/money";
import type {
  PayrollCalculationInput,
  PayrollPolicyInput,
  PriorPayrollTotals,
} from "@/features/payroll-calculation/types";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type PayrollPolicySession = {
  member: { id: number };
  permissionCodes: readonly string[];
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
  createdAt: string;
  activatedAt: string | null;
};

export type PayrollPolicyPersistenceInput = {
  actorMemberId: number;
  action: "saveDraft" | "activate";
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
  exampleConfirmationHash: string | null;
};

export type PayrollActivationExample = {
  confirmationHash: string;
  sample: ReturnType<typeof calculatePayroll>;
};

type MaybePromise<T> = T | Promise<T>;

export type PayrollPolicyDependencies = {
  loadSession: () => Promise<PayrollPolicySession | null>;
  loadPolicies: (actorMemberId: number) => Promise<PayrollPolicyRecord[]>;
  buildActivationExample: (
    policy: PayrollPolicyPersistenceInput,
  ) => MaybePromise<PayrollActivationExample>;
  savePolicy: (input: PayrollPolicyPersistenceInput) => Promise<unknown>;
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

function policyForCalculator(
  policy: PayrollPolicyPersistenceInput,
): PayrollPolicyInput {
  return {
    id: "activation-example",
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

export function buildPayrollActivationExample(
  policy: PayrollPolicyPersistenceInput,
): PayrollActivationExample {
  const input: PayrollCalculationInput = {
    month: policy.effectiveMonth,
    employmentMonthsYtd: 1,
    baseSalary: "10000.00",
    performanceBonus: "0.00",
    projectBonus: "0.00",
    otherBonus: "0.00",
    otherIncome: "0.00",
    socialBase: "10000.00",
    housingFundBase: "10000.00",
    taxExemptIncome: "0.00",
    specialAdditionalDeduction: "0.00",
    otherStatutoryDeduction: "0.00",
    taxRelief: "0.00",
    otherDeduction: "0.00",
    manualAdjustmentReason: "",
    openingCumulativeIncome: "0.00",
    openingCumulativeTaxExemptIncome: "0.00",
    openingCumulativeSpecialDeduction: "0.00",
    openingCumulativeSpecialAdditionalDeduction: "0.00",
    openingCumulativeOtherStatutoryDeduction: "0.00",
    openingCumulativeTaxRelief: "0.00",
    openingCumulativeTaxWithheld: "0.00",
  };
  const sample = calculatePayroll(policyForCalculator(policy), input, zeroPrior);
  const canonicalPolicy = {
    effectiveMonth: policy.effectiveMonth,
    pensionEmployeeRate: policy.pensionEmployeeRate,
    medicalEmployeeRate: policy.medicalEmployeeRate,
    medicalEmployeeFixedAmount: policy.medicalEmployeeFixedAmount,
    unemploymentEmployeeRate: policy.unemploymentEmployeeRate,
    housingFundEmployeeRate: policy.housingFundEmployeeRate,
    socialBaseMin: policy.socialBaseMin,
    socialBaseMax: policy.socialBaseMax,
    housingBaseMin: policy.housingBaseMin,
    housingBaseMax: policy.housingBaseMax,
  };
  const confirmationHash = createHash("sha256")
    .update(JSON.stringify({ policy: canonicalPolicy, sample }))
    .digest("hex");
  return { confirmationHash, sample };
}

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function publicPolicy(record: PayrollPolicyRecord) {
  return {
    ...record,
    pensionEmployeeRate: formatRatePercent(
      parseFractionRate(record.pensionEmployeeRate),
    ),
    medicalEmployeeRate: formatRatePercent(
      parseFractionRate(record.medicalEmployeeRate),
    ),
    unemploymentEmployeeRate: formatRatePercent(
      parseFractionRate(record.unemploymentEmployeeRate),
    ),
    housingFundEmployeeRate: formatRatePercent(
      parseFractionRate(record.housingFundEmployeeRate),
    ),
  };
}

function persistenceFromRecord(
  actorMemberId: number,
  record: PayrollPolicyRecord,
): PayrollPolicyPersistenceInput {
  return {
    actorMemberId,
    action: "saveDraft",
    effectiveMonth: record.effectiveMonth,
    pensionEmployeeRate: record.pensionEmployeeRate,
    medicalEmployeeRate: record.medicalEmployeeRate,
    medicalEmployeeFixedAmount: record.medicalEmployeeFixedAmount,
    unemploymentEmployeeRate: record.unemploymentEmployeeRate,
    housingFundEmployeeRate: record.housingFundEmployeeRate,
    socialBaseMin: record.socialBaseMin,
    socialBaseMax: record.socialBaseMax,
    housingBaseMin: record.housingBaseMin,
    housingBaseMax: record.housingBaseMax,
    exampleConfirmationHash: null,
  };
}

function normalizePolicyBody(
  body: Record<string, unknown>,
  actorMemberId: number,
): { input: PayrollPolicyPersistenceInput } | { error: string } {
  const action = body.action;
  if (action !== "saveDraft" && action !== "activate") {
    return { error: "invalid_request" };
  }
  const effectiveMonth = typeof body.effectiveMonth === "string"
    && /^\d{4}-(0[1-9]|1[0-2])$/.test(body.effectiveMonth)
    ? body.effectiveMonth
    : null;
  if (!effectiveMonth) return { error: "invalid_month" };

  const rateKeys = [
    "pensionEmployeeRate",
    "medicalEmployeeRate",
    "unemploymentEmployeeRate",
    "housingFundEmployeeRate",
  ] as const;
  const moneyKeys = [
    "medicalEmployeeFixedAmount",
    "socialBaseMin",
    "socialBaseMax",
    "housingBaseMin",
    "housingBaseMax",
  ] as const;
  const rates = {} as Record<(typeof rateKeys)[number], string>;
  const amounts = {} as Record<(typeof moneyKeys)[number], string>;
  try {
    for (const key of rateKeys) {
      if (typeof body[key] !== "string") return { error: "invalid_rate" };
      rates[key] = formatFractionRate(parseRate(body[key]));
    }
    for (const key of moneyKeys) {
      if (typeof body[key] !== "string") return { error: "invalid_money" };
      amounts[key] = formatMoney(parseMoney(body[key]));
    }
  } catch (error) {
    const code = error instanceof Error ? error.message : "invalid_request";
    return { error: code === "invalid_rate" ? "invalid_rate" : "invalid_money" };
  }
  if (parseMoney(amounts.socialBaseMin) > parseMoney(amounts.socialBaseMax)
    || parseMoney(amounts.housingBaseMin) > parseMoney(amounts.housingBaseMax)) {
    return { error: "invalid_base_range" };
  }
  const exampleConfirmationHash = typeof body.exampleConfirmationHash === "string"
    && /^[0-9a-f]{64}$/.test(body.exampleConfirmationHash)
    ? body.exampleConfirmationHash
    : null;
  if (action === "activate" && !exampleConfirmationHash) {
    return { error: "activation_example_mismatch" };
  }
  return {
    input: {
      actorMemberId,
      action,
      effectiveMonth,
      ...rates,
      ...amounts,
      exampleConfirmationHash,
    },
  };
}

async function readObject(request: Request) {
  try {
    const value: unknown = await request.json();
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function createPayrollPolicyHandler(
  dependencies: PayrollPolicyDependencies,
) {
  async function authorize() {
    const session = await dependencies.loadSession();
    if (!session) {
      return {
        ok: false as const,
        response: json({ error: "unauthorized" }, 401),
      };
    }
    if (!session.permissionCodes.includes("salary.manage")) {
      return {
        ok: false as const,
        response: json({ error: "forbidden" }, 403),
      };
    }
    return { ok: true as const, session };
  }

  return {
    GET: async () => {
      const authorization = await authorize();
      if (!authorization.ok) return authorization.response;
      const { session } = authorization;
      try {
        const records = await dependencies.loadPolicies(session.member.id);
        const ordered = [...records].sort((left, right) => (
          right.createdAt.localeCompare(left.createdAt)
        ));
        const active = ordered.find(({ status }) => status === "active") ?? null;
        const draft = ordered.find(({ status }) => status === "draft") ?? null;
        const draftExample = draft
          ? await dependencies.buildActivationExample(
            persistenceFromRecord(session.member.id, draft),
          )
          : null;
        return json({
          active: active ? publicPolicy(active) : null,
          history: ordered.map(publicPolicy),
          draftExample,
        });
      } catch {
        return json({ error: "payroll_policy_unavailable" }, 503);
      }
    },

    PUT: async (request: Request) => {
      const authorization = await authorize();
      if (!authorization.ok) return authorization.response;
      const body = await readObject(request);
      if (!body) return json({ error: "invalid_request" }, 400);
      const parsed = normalizePolicyBody(body, authorization.session.member.id);
      if ("error" in parsed) {
        const status = parsed.error === "activation_example_mismatch" ? 409 : 400;
        return json({ error: parsed.error }, status);
      }
      if (parsed.input.action === "activate") {
        const example = await dependencies.buildActivationExample(parsed.input);
        if (example.confirmationHash !== parsed.input.exampleConfirmationHash) {
          return json({ error: "activation_example_mismatch" }, 409);
        }
      }
      try {
        const saved = await dependencies.savePolicy(parsed.input);
        const savedObject = saved && typeof saved === "object" ? saved : {};
        if (parsed.input.action !== "activate") {
          return json({
            ...savedObject,
            draftExample: await dependencies.buildActivationExample(parsed.input),
          });
        }
        return json(saved);
      } catch {
        return json({ error: "payroll_policy_update_failed" }, 409);
      }
    },
  };
}

export const defaultPayrollPolicyDependencies: PayrollPolicyDependencies = {
  loadSession: getWorkspaceSession,
  async loadPolicies(actorMemberId) {
    const client = await getSupabaseServerClient();
    const member = await client.from("organization_members")
      .select("organization_id")
      .eq("id", actorMemberId)
      .single();
    if (member.error || !member.data) {
      throw member.error ?? new Error("organization_not_found");
    }
    const result = await client.from("payroll_policies")
      .select("public_id, status, effective_month, pension_employee_rate, medical_employee_rate, medical_employee_fixed_amount, unemployment_employee_rate, housing_fund_employee_rate, social_base_min, social_base_max, housing_base_min, housing_base_max, created_at, activated_at")
      .eq("organization_id", member.data.organization_id)
      .order("created_at", { ascending: false });
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
      createdAt: String(row.created_at),
      activatedAt: row.activated_at ? String(row.activated_at) : null,
    }));
  },
  buildActivationExample: buildPayrollActivationExample,
  async savePolicy(input) {
    const client = await getSupabaseServerClient();
    const payload: Partial<PayrollPolicyPersistenceInput> = { ...input };
    delete payload.actorMemberId;
    const result = await client.rpc("save_payroll_policy_v1", {
      p_payload: payload,
    });
    if (result.error) throw result.error;
    return {
      status: input.action === "activate" ? "active" : "draft",
      publicId: String(result.data),
    };
  },
};
