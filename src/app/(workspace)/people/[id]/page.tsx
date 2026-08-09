import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { EmployeeDetailPage } from "@/features/hr/employee-detail-page";
import { getEmployeeDetail, loadEmployeeDirectory } from "@/features/hr/employee-data";

export const metadata: Metadata = {
  title: "员工档案 | 企业工作站",
};

export default async function EmployeeDetailRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const directory = await loadEmployeeDirectory();
  const employee = getEmployeeDetail(id, directory);

  if (!employee) {
    notFound();
  }

  return <EmployeeDetailPage employee={employee} />;
}
