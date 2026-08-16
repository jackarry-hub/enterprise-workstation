import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { RealDataUnavailable } from "@/components/ui/real-data-boundary";
import { requireWorkspaceSession } from "@/features/auth/workspace-session";
import {
  createOperationFixtureContext,
  type WorkspaceIdentityContext,
} from "@/features/operations/operation-actor-compat";
import { PayrollDetailPage } from "@/features/salary/payroll-detail-page";
import { salaryMockResult } from "@/features/salary/salary-mock-data";

export const metadata: Metadata = { title: "工资详情 | 量子智枢" };

export function generateStaticParams() {
  return salaryMockResult.data.records.map(({ id }) => ({ id }));
}

export default async function PayrollDetailRoute({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireWorkspaceSession();
  const identityContext: WorkspaceIdentityContext =
    createOperationFixtureContext(session);
  if (!identityContext.actor) {
    return <RealDataUnavailable title="薪资数据暂不可用" description="当前账号不会显示演示工资单。真实薪资数据接入后，只会展示你有权查看的记录。" backHref="/payroll" backLabel="返回薪资管理" />;
  }

  const { id } = await params;
  const { loadSalaryDetail } = await import("@/features/salary/salary-data");
  const record = await loadSalaryDetail(id);
  if (!record) notFound();
  return <PayrollDetailPage record={record} />;
}
