import Link from "next/link";
import { Banknote, CalendarClock, ChevronRight, FileSignature, SearchX, ShoppingCart } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { StatusBadge } from "@/components/ui/status-badge";
import { approvalPriorityMeta, approvalStatusMeta, approvalTypeMeta } from "@/features/approvals/approval-meta";
import type { Approval, ApprovalType } from "@/features/approvals/approval-types";
import { cn } from "@/lib/utils";

const typeIcons = { reimbursement: Banknote, purchase: ShoppingCart, contract: FileSignature } satisfies Record<ApprovalType, typeof Banknote>;
const typeClasses: Record<ApprovalType, string> = {
  reimbursement: "from-success to-chart-2",
  purchase: "from-chart-3 to-primary",
  contract: "from-chart-5 to-primary",
};

function formatSubmittedAt(value: string) {
  return value.replace("2026-", "").replace("-", "/");
}

export function ApprovalList({ approvals }: { approvals: Approval[] }) {
  if (approvals.length === 0) {
    return (
      <Empty className="min-h-72 border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon"><SearchX aria-hidden="true" /></EmptyMedia>
          <EmptyTitle>没有匹配的审批</EmptyTitle>
          <EmptyDescription>请调整审批范围、类型或搜索关键词。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="grid gap-2.5">
      {approvals.map((approval) => {
        const Icon = typeIcons[approval.type];
        const status = approvalStatusMeta[approval.status];
        const priority = approvalPriorityMeta[approval.priority];
        return (
          <Link
            key={approval.id}
            href={`/approvals/${approval.id}`}
            aria-label={`查看${approval.applicant.displayName}的${approvalTypeMeta[approval.type].label}`}
            className="group grid gap-3 rounded-2xl border border-glass-border bg-background/68 p-3 transition-all hover:-translate-y-0.5 hover:bg-background/90 hover:shadow-[0_12px_30px_rgba(55,94,155,0.08)] md:grid-cols-[minmax(240px,1.3fr)_minmax(150px,.8fr)_minmax(170px,.9fr)_150px_92px_22px] md:items-center"
          >
            <div className="flex min-w-0 items-center gap-3">
              <span className={cn("grid size-12 shrink-0 place-items-center rounded-2xl bg-linear-to-br text-primary-foreground shadow-sm", typeClasses[approval.type])}><Icon aria-hidden="true" className="size-5" /></span>
              <div className="min-w-0">
                <div className="flex items-center gap-2"><p className="truncate font-semibold text-foreground">{approval.title}</p><StatusBadge status={status.tone}>{status.label}</StatusBadge></div>
                <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{approval.code}</p>
              </div>
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <Avatar className="size-8">
                {approval.applicant.avatarUrl ? <AvatarImage src={approval.applicant.avatarUrl} alt={approval.applicant.displayName} /> : null}
                <AvatarFallback className="bg-primary/10 text-xs text-primary">{approval.applicant.displayName.slice(-2)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0"><p className="truncate text-sm font-medium text-foreground">{approval.applicant.displayName}</p><p className="truncate text-xs text-muted-foreground">{approval.applicant.department}</p></div>
            </div>
            <div className="min-w-0"><p className="truncate text-sm font-semibold text-foreground">{approval.summary}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">{approval.currentStep} · {approval.owner.displayName}</p></div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><CalendarClock aria-hidden="true" className="size-3.5 text-primary" /><span>{formatSubmittedAt(approval.submittedAt)}</span></div>
            <StatusBadge status={priority.tone}>{priority.label}优先级</StatusBadge>
            <ChevronRight aria-hidden="true" className="hidden size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 md:block" />
          </Link>
        );
      })}
    </div>
  );
}
