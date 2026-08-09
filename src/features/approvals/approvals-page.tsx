import { approvalMockResult } from "@/features/approvals/approval-mock-data";
import type { ApprovalResult } from "@/features/approvals/approval-types";
import { ApprovalsWorkspace } from "@/features/approvals/approvals-workspace";

export function ApprovalsPage({ result = approvalMockResult }: { result?: ApprovalResult }) {
  return <ApprovalsWorkspace result={result} />;
}
