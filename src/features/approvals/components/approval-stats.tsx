import { CheckCircle2, CircleX, Clock3, Send } from "lucide-react";

import { DataCard } from "@/components/ui/data-card";
import type { ApprovalStats as ApprovalStatsValue } from "@/features/approvals/approval-types";

export function ApprovalStats({ stats }: { stats: ApprovalStatsValue }) {
  return (
    <section aria-label="审批统计" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <DataCard compact icon={Clock3} label="待审批" value={String(stats.pending)} trendLabel="当前由我处理" tone="purple" />
      <DataCard compact icon={Send} label="我发起" value={String(stats.initiated)} trendLabel="当前可见范围" tone="green" />
      <DataCard compact icon={CheckCircle2} label="已通过" value={String(stats.approved)} trendLabel="当前可见范围" tone="blue" />
      <DataCard compact icon={CircleX} label="未通过" value={String(stats.rejected)} trendLabel="拒绝、退回或撤销" tone="orange" trendTone="warning" />
    </section>
  );
}
