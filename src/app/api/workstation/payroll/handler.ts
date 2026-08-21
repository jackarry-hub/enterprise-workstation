import { getWorkspaceSession } from "@/features/auth/workspace-session";
import {
  calculatePayrollForSession,
  parsePayrollSaveRequest,
  type PayrollRequestContext,
  type PayrollSaveRequest,
} from "@/features/payroll-calculation/server-service";
import { getSupabaseServerClient } from "@/lib/supabase/server";

import { payrollFailure } from "./preview/handler";

type PayrollSession = {
  member: { id: number };
  organization: { id: string };
  permissionCodes: readonly string[];
};

type CalculatedPayroll = Awaited<ReturnType<typeof calculatePayrollForSession>>;

type SaveCalculatedPayrollInput = {
  context: PayrollRequestContext;
  input: PayrollSaveRequest;
  result: CalculatedPayroll;
};

export type WorkstationPayrollDependencies = {
  loadSession: () => Promise<PayrollSession | null>;
  calculate: (
    context: PayrollRequestContext,
    input: PayrollSaveRequest,
  ) => Promise<CalculatedPayroll>;
  saveCalculatedPayroll: (
    input: SaveCalculatedPayrollInput,
  ) => Promise<unknown>;
};

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function readRequest(request: Request) {
  try {
    return parsePayrollSaveRequest(await request.json());
  } catch {
    return null;
  }
}

export function createWorkstationPayrollHandler(
  dependencies: WorkstationPayrollDependencies,
) {
  return async function savePayroll(request: Request) {
    const session = await dependencies.loadSession();
    if (!session) return json({ error: "unauthorized" }, 401);
    if (!session.permissionCodes.includes("salary.manage")) {
      return json({ error: "forbidden" }, 403);
    }
    const input = await readRequest(request);
    if (!input) return json({ error: "invalid_request" }, 400);
    const context = {
      actorMemberId: session.member.id,
      organizationPublicId: session.organization.id,
    };
    try {
      const result = await dependencies.calculate(context, input);
      return json(await dependencies.saveCalculatedPayroll({
        context,
        input,
        result,
      }));
    } catch (error) {
      return payrollFailure(error);
    }
  };
}

export const defaultWorkstationPayrollDependencies: WorkstationPayrollDependencies = {
  loadSession: getWorkspaceSession,
  calculate: calculatePayrollForSession,
  async saveCalculatedPayroll({ input, result }) {
    const client = await getSupabaseServerClient();
    const { calculation, normalizedInput, policy } = result;
    const payload = {
      memberId: input.memberId,
      month: input.month,
      status: input.status,
      note: input.note,
      policyId: policy.publicId,
      policySnapshot: policy,
      calculationSnapshot: {
        input: normalizedInput,
        result: calculation,
        calculatedAt: new Date().toISOString(),
      },
      calculationVersion: result.calculationVersion,
      baseSalary: normalizedInput.baseSalary,
      performanceBonus: normalizedInput.performanceBonus,
      projectBonus: normalizedInput.projectBonus,
      otherBonus: normalizedInput.otherBonus,
      otherIncome: normalizedInput.otherIncome,
      socialBase: normalizedInput.socialBase,
      housingFundBase: normalizedInput.housingFundBase,
      taxExemptIncome: normalizedInput.taxExemptIncome,
      specialAdditionalDeduction: normalizedInput.specialAdditionalDeduction,
      otherStatutoryDeduction: normalizedInput.otherStatutoryDeduction,
      taxRelief: normalizedInput.taxRelief,
      otherDeduction: normalizedInput.otherDeduction,
      manualAdjustmentReason: normalizedInput.manualAdjustmentReason,
      employmentMonthsYtd: result.employmentMonthsYtd,
      ...result.opening,
      pensionEmployee: calculation.pensionEmployee,
      medicalEmployee: calculation.medicalEmployee,
      unemploymentEmployee: calculation.unemploymentEmployee,
      housingFundEmployee: calculation.housingFundEmployee,
      cumulativeTaxableIncome: calculation.cumulativeTaxableIncome,
      individualIncomeTax: calculation.individualIncomeTax,
    };
    const saved = await client.rpc("save_salary_calculation_v1", {
      p_payload: payload,
    });
    if (saved.error) {
      const message = String(saved.error.message ?? "");
      if (/Confirmed payroll is immutable/i.test(message)) {
        const error = new Error("confirmed_payroll_immutable") as Error & {
          code: string;
        };
        error.code = "confirmed_payroll_immutable";
        throw error;
      }
      throw saved.error;
    }
    return {
      status: input.status === "processing" ? "confirmed" : "draft",
      publicId: String(saved.data),
      calculation,
    };
  },
};
