import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { RealDataUnavailable } from "@/components/ui/real-data-boundary";
import { requireWorkspaceSession } from "@/features/auth/workspace-session";
import { EmployeeDetailPage } from "@/features/hr/employee-detail-page";
import {
  createOperationFixtureContext,
  type WorkspaceIdentityContext,
} from "@/features/operations/operation-actor-compat";

export const metadata: Metadata = {
  title: "员工档案 | 企业工作站",
};

export default async function EmployeeDetailRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireWorkspaceSession();
  const identityContext: WorkspaceIdentityContext =
    createOperationFixtureContext(session);
  if (!identityContext.actor) {
    return <RealDataUnavailable title="员工数据暂不可用" description="当前账号不会显示演示员工档案。真实组织数据接入后，只会展示你有权查看的人员信息。" backHref="/people" backLabel="返回员工目录" />;
  }

  const { id } = await params;
  const { getEmployeeDetail, loadEmployeeDirectory } = await import("@/features/hr/employee-data");
  const directory = await loadEmployeeDirectory();
  const employee = getEmployeeDetail(id, directory);

  if (!employee) {
    notFound();
  }

  return <EmployeeDetailPage employee={employee} />;
}
