import { getWorkspaceSession } from "@/features/auth/workspace-session";
import {
  PayrollError,
  calculatePayrollForSession,
  parsePayrollSaveRequest,
  type PayrollRequestContext,
  type PayrollSaveRequest,
} from "@/features/payroll-calculation/server-service";

type PayrollPreviewSession = {
  member: { id: number };
  organization: { id: string };
  permissionCodes: readonly string[];
};

export type PayrollPreviewDependencies = {
  loadSession: () => Promise<PayrollPreviewSession | null>;
  preview: (
    context: PayrollRequestContext,
    input: PayrollSaveRequest,
  ) => Promise<unknown>;
};

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function payrollFailure(error: unknown) {
  const code = error instanceof PayrollError
    ? error.code
    : error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "payroll_update_failed";
  const statusByCode: Record<string, number> = {
    unauthorized: 401,
    forbidden: 403,
    invalid_request: 400,
    employee_not_found: 404,
    employee_hire_date_missing: 409,
    payroll_policy_missing: 409,
    missing_opening_cumulative: 409,
    missing_history: 409,
    opening_cumulative_mismatch: 409,
    confirmed_payroll_immutable: 409,
    payroll_update_failed: 409,
  };
  return json({ error: statusByCode[code] ? code : "payroll_update_failed" },
    statusByCode[code] ?? 409);
}

async function readRequest(request: Request) {
  try {
    return parsePayrollSaveRequest(await request.json());
  } catch {
    return null;
  }
}

export function createPayrollPreviewHandler(
  dependencies: PayrollPreviewDependencies,
) {
  return async function previewPayroll(request: Request) {
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
      return json(await dependencies.preview(context, input));
    } catch (error) {
      return payrollFailure(error);
    }
  };
}

export const defaultPayrollPreviewDependencies: PayrollPreviewDependencies = {
  loadSession: getWorkspaceSession,
  async preview(context, input) {
    const result = await calculatePayrollForSession(context, input);
    return {
      employee: result.employee,
      policy: result.policy,
      employmentMonthsYtd: result.employmentMonthsYtd,
      openingRequired: result.openingRequired,
      opening: result.opening,
      calculation: result.calculation,
      calculationVersion: result.calculationVersion,
    };
  },
};

export { payrollFailure };
