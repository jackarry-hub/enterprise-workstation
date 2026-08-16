import type { Metadata } from "next";

import { ApprovalsPage } from "@/features/approvals/approvals-page";
import type { ApprovalResult } from "@/features/approvals/approval-types";
import { requireWorkspaceSession } from "@/features/auth/workspace-session";
import {
  createOperationFixtureContext,
  type WorkspaceIdentityContext,
} from "@/features/operations/operation-actor-compat";

export const metadata: Metadata = { title: "审批中心 | 量子智枢" };

export default async function ApprovalsRoute() {
  const session = await requireWorkspaceSession();
  const identityContext: WorkspaceIdentityContext =
    createOperationFixtureContext(session);
  if (!identityContext.actor) {
    const result: ApprovalResult = {
      source: "supabase",
      data: {
        approvals: [],
        stats: { pending: 0, initiated: 0, approved: 0, rejected: 0 },
      },
    };
    return <ApprovalsPage result={result} />;
  }

  const { loadApprovals } = await import("@/features/approvals/approval-data");
  const result = await loadApprovals();
  return <ApprovalsPage result={result} />;
}
