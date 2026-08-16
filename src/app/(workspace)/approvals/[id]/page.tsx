import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { RealDataUnavailable } from "@/components/ui/real-data-boundary";
import { ApprovalDetailPage } from "@/features/approvals/approval-detail-page";
import { approvalMockResult } from "@/features/approvals/approval-mock-data";
import { requireWorkspaceSession } from "@/features/auth/workspace-session";
import {
  createOperationFixtureContext,
  type WorkspaceIdentityContext,
} from "@/features/operations/operation-actor-compat";

export const metadata: Metadata = { title: "审批详情 | 量子智枢" };

export function generateStaticParams() {
  return approvalMockResult.data.approvals.map(({ id }) => ({ id }));
}

export default async function ApprovalDetailRoute({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireWorkspaceSession();
  const identityContext: WorkspaceIdentityContext =
    createOperationFixtureContext(session);
  if (!identityContext.actor) {
    return <RealDataUnavailable title="审批数据暂不可用" description="当前账号不会显示演示审批记录。真实审批数据接入后，可在权限范围内查看。" backHref="/approvals" backLabel="返回审批中心" />;
  }

  const { id } = await params;
  const { loadApprovalDetail } = await import("@/features/approvals/approval-data");
  const approval = await loadApprovalDetail(id);
  if (!approval) notFound();
  return <ApprovalDetailPage approval={approval} />;
}
