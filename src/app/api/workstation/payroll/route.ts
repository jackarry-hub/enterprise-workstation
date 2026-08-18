import {
  createWorkstationPayrollHandler,
  defaultWorkstationPayrollDependencies,
} from "@/app/api/workstation/payroll/handler";

export const dynamic = "force-dynamic";
export const POST = createWorkstationPayrollHandler(
  defaultWorkstationPayrollDependencies,
);
