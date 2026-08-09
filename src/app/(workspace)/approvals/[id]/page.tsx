import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { loadApprovalDetail } from "@/features/approvals/approval-data";
import { ApprovalDetailPage } from "@/features/approvals/approval-detail-page";

export const metadata: Metadata = { title: "审批详情 | 企业工作站" };

export default async function ApprovalDetailRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const approval = await loadApprovalDetail(id);
  if (!approval) notFound();
  return <ApprovalDetailPage approval={approval} />;
}
