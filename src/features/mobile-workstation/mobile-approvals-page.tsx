"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useState } from "react";

import type { ApprovalResult } from "@/features/approvals/approval-types";
import { useWorkspaceSession } from "@/features/auth/workspace-session-provider";

const statusLabels = { draft: "草稿", pending: "待审批", approved: "已通过", rejected: "已拒绝" } as const;

export function MobileApprovalsPage({ result }: { result: ApprovalResult }) {
  const { actor } = useWorkspaceSession();
  const [tab, setTab] = useState<"pending" | "mine">("pending");
  const visible = result.data.approvals.filter((approval) => tab === "mine" ? approval.applicant.displayName === actor.name || approval.initiatedByViewer : approval.status === "pending" && (actor.role === "executive" || approval.owner.displayName === actor.name || approval.applicant.department === actor.department));
  return (
    <main className="mobile-page">
      <header className="mobile-page-header"><div><h1>审批</h1><p>及时处理需要你确认的事项</p></div></header>
      <div role="tablist" aria-label="审批分类" className="mobile-segmented-tabs"><button role="tab" aria-selected={tab === "pending"} onClick={() => setTab("pending")}>待我审批</button><button role="tab" aria-selected={tab === "mine"} onClick={() => setTab("mine")}>我发起的</button></div>
      <section aria-label="审批列表" className="mobile-list-surface mt-4">
        {visible.length ? visible.slice(0, 4).map((approval) => <Link data-testid="mobile-approval-row" key={approval.id} href={`/approvals/${approval.id}`} prefetch={false} aria-label={`处理审批：${approval.title}`} className="mobile-approval-row"><span className="min-w-0 flex-1"><strong className="block truncate text-[15px] text-[#16233d]">{approval.title} · {approval.summary}</strong><span className="mt-1 block truncate text-xs text-[#718099]">{approval.applicant.displayName} · {approval.submittedAt.slice(5)}</span></span><span className="mobile-status-pill">{statusLabels[approval.status]}</span><ChevronRight aria-hidden="true" className="size-4 text-[#718099]" /></Link>) : <p className="px-4 py-12 text-center text-sm text-muted-foreground">这里暂时没有审批</p>}
      </section>
    </main>
  );
}

