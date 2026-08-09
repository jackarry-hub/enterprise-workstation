import { approvalMockResult } from "@/features/approvals/approval-mock-data";

export async function loadApprovals() {
  return approvalMockResult;
}

export async function loadApprovalDetail(publicId: string) {
  return approvalMockResult.data.approvals.find((approval) => approval.id === publicId);
}
