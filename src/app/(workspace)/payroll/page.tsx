import type { Metadata } from "next";

import { PayrollPage } from "@/features/salary/payroll-page";
import { loadSalary } from "@/features/salary/salary-data";

export const metadata: Metadata = { title: "薪资管理 | 企业工作站" };

export default async function PayrollRoute() {
  const result = await loadSalary();
  return <PayrollPage result={result} />;
}
