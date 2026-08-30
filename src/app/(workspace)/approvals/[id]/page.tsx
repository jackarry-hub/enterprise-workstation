import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { RealDataUnavailable } from "@/components/ui/real-data-boundary";
import { ApprovalDetailPage } from "@/features/approvals/approval-detail-page";
import { requireWorkspaceSession } from "@/features/auth/workspace-session";
import { createOperationFixtureContext } from "@/features/operations/operation-actor-compat";
import { hasSupabaseEnv } from "@/lib/supabase/env";

export const metadata: Metadata = { title: "审批详情 | 企业工作站" };

export default async function ApprovalDetailRoute({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireWorkspaceSession();
  const { id } = await params;
  const fixtureContext = createOperationFixtureContext(session);
  if (!fixtureContext.actor && !hasSupabaseEnv()) {
    return (
      <RealDataUnavailable
        title="审批数据暂不可用"
        description="当前账号不会显示演示审批详情。真实审批和报账数据接入后，只会展示你有权查看的记录。"
        backHref="/approvals"
        backLabel="返回审批中心"
      />
    );
  }

  const { loadApprovalDetail } = await import("@/features/approvals/approval-data");
  let approval: Awaited<ReturnType<typeof loadApprovalDetail>>;
  try {
    approval = fixtureContext.actor
      ? await loadApprovalDetail(id)
      : await loadApprovalDetail(id, undefined, {
        allowMockFallback: false,
        viewerEmployeeProfileId: session.member.employeeProfileId,
      });
  } catch {
    return (
      <RealDataUnavailable
        title="审批数据加载失败"
        description="数据库或权限服务暂不可用，请刷新后重试。"
        backHref="/approvals"
        backLabel="返回审批中心"
      />
    );
  }
  if (!approval) notFound();
  return <ApprovalDetailPage approval={approval} dataSource={fixtureContext.actor ? "mock" : "supabase"} />;
}
