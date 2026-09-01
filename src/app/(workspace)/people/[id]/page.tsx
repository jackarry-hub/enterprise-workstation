import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireWorkspaceSession } from "@/features/auth/workspace-session";
import {
  getEmployeeDetail,
  loadEmployeeCapabilityCenter,
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
  const session = await requireWorkspaceSession();
  const { id } = await params;
  const [directory, privateProfile, capabilityCenter] = await Promise.all([
    loadEmployeeDirectory(session.organization.id, undefined, { allowMockFallback: false }),
    loadEmployeePrivateProfile(id, session.organization.id),
    loadEmployeeCapabilityCenter(id, session.organization.id),
  ]);
  const employee = getEmployeeDetail(id, directory);

  if (!employee) {
    notFound();
  }

  return <EmployeeDetailPage
    employee={employee}
    privateProfile={privateProfile.data}
    capabilityCenter={capabilityCenter.data}
    capabilityLoadError={capabilityCenter.loadError}
  />;
}
