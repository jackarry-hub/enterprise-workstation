import { PayrollWorkspace } from "@/features/salary/payroll-workspace";
import { salaryMockResult } from "@/features/salary/salary-mock-data";
import type { SalaryResult } from "@/features/salary/salary-types";

export function PayrollPage({ result = salaryMockResult }: { result?: SalaryResult }) {
  return <PayrollWorkspace result={result} />;
}
