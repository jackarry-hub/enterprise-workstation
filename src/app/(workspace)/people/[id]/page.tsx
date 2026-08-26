import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireWorkspaceSession } from "@/features/auth/workspace-session";
import {
  getEmployeeDetail,
  loadEmployeeDirectory,
  loadEmployeePrivateProfile,
} from "@/features/hr/employee-data";
import { EmployeeDetailPage } from "@/features/hr/employee-detail-page";

export const metadata: Metadata = {
  title: "员工档案 | 企业工作站",
};

export default async function EmployeeDetailRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireWorkspaceSession();
  const { id } = await params;
  const [directory, privateProfile] = await Promise.all([
    loadEmployeeDirectory(),
    loadEmployeePrivateProfile(id),
  ]);
  const employee = getEmployeeDetail(id, directory);

  if (!employee) {
    notFound();
  }

  return <EmployeeDetailPage employee={employee} privateProfile={privateProfile.data} />;
}
