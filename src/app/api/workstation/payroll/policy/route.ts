import {
  createPayrollPolicyHandler,
  defaultPayrollPolicyDependencies,
} from "@/app/api/workstation/payroll/policy/handler";

export const dynamic = "force-dynamic";

const handler = createPayrollPolicyHandler(defaultPayrollPolicyDependencies);

export const GET = handler.GET;
export const PUT = handler.PUT;
