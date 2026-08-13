import { approvalMockResult } from "@/features/approvals/approval-mock-data";
import type { ApprovalResult } from "@/features/approvals/approval-types";
import { MobileApprovalsPage } from "@/features/mobile-workstation/mobile-approvals-page";

export function ApprovalsPage({ result = approvalMockResult }: { result?: ApprovalResult }) {
  return <MobileApprovalsPage result={result} />;
}
