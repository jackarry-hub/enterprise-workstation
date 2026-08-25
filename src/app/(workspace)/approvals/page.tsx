import type { Metadata } from "next";

import { ApprovalsPage } from "@/features/approvals/approvals-page";
import type { ApprovalResult } from "@/features/approvals/approval-types";
import { requireWorkspaceSession } from "@/features/auth/workspace-session";
import { createOperationFixtureContext } from "@/features/operations/operation-actor-compat";
import { hasSupabaseEnv } from "@/lib/supabase/env";

export const metadata: Metadata = { title: "审批中心 | 企业工作站" };

export default async function ApprovalsRoute() {
  const session = await requireWorkspaceSession();
  const fixtureContext = createOperationFixtureContext(session);
  const { loadApprovals } = await import("@/features/approvals/approval-data");
  if (fixtureContext.actor) {
    const result = await loadApprovals();
    return <ApprovalsPage result={result} />;
  }
  if (!hasSupabaseEnv()) {
    const result: ApprovalResult = {
      source: "supabase",
      data: {
        approvals: [],
        stats: { pending: 0, initiated: 0, approved: 0, rejected: 0 },
      },
    };
    return <ApprovalsPage result={result} />;
  }
  const result = await loadApprovals(undefined, {
    allowMockFallback: false,
    viewerEmployeeProfileId: session.member.employeeProfileId,
  });
  return <ApprovalsPage result={result} />;
}
