import type { Metadata } from "next";

import { loadApprovals } from "@/features/approvals/approval-data";
import { ApprovalsPage } from "@/features/approvals/approvals-page";

export const metadata: Metadata = { title: "审批中心 | 企业工作站" };

export default async function ApprovalsRoute() {
  const result = await loadApprovals();
  return <ApprovalsPage result={result} />;
}
