import type { Metadata } from "next";

import { ApprovalsPage } from "@/features/approvals/approvals-page";
import type { ApprovalResult } from "@/features/approvals/approval-types";
import { requireWorkspaceSession } from "@/features/auth/workspace-session";
import { hasSupabaseEnv } from "@/lib/supabase/env";

export const metadata: Metadata = {
  title: "财务中心 | 企业工作站",
};

export default async function FinanceWorkbenchPage({
  searchParams,
}: {
  searchParams?: Promise<{ expenseDraft?: string | string[] }>;
}) {
  const session = await requireWorkspaceSession();
  const requestedDraft = (await searchParams)?.expenseDraft;
  const draftPublicId = typeof requestedDraft === "string" ? requestedDraft : undefined;
  const { loadApprovals } = await import("@/features/approvals/approval-data");

  if (!hasSupabaseEnv()) {
    const result: ApprovalResult = {
      source: "supabase",
      data: {
        approvals: [],
        stats: { pending: 0, initiated: 0, approved: 0, rejected: 0 },
      },
    };
    return <ApprovalsPage result={result} expenseOptions={{
      source: "supabase",
      projects: [],
      drafts: [],
      loadError: "费用服务尚未配置，暂时无法发起报销。",
    }} />;
  }

  const { loadExpenseFormOptions } = await import("@/features/expenses/expense-data");
  const [result, expenseOptions] = await Promise.all([
    loadApprovals(undefined, {
      viewerEmployeeProfileId: session.member.employeeProfileId,
    }),
    loadExpenseFormOptions(session.member.id, undefined, { draftPublicId }),
  ]);
  return <ApprovalsPage result={result} expenseOptions={expenseOptions} />;
}

