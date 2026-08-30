import type { ApprovalFilters, ApprovalResult } from "@/features/approvals/approval-types";

export function filterApprovals(approvals: ApprovalResult["data"]["approvals"], filters: ApprovalFilters) {
  const query = filters.query.trim().toLocaleLowerCase("zh-CN");
  return approvals.filter((approval) => {
    const matchesQuery = !query || [approval.title, approval.code, approval.summary, approval.applicant.displayName, approval.applicant.department, approval.owner.displayName]
      .some((value) => value.toLocaleLowerCase("zh-CN").includes(query));
    const matchesType = filters.type === "all" || approval.type === filters.type;
    const matchesQueue = filters.queue === "all"
      || (filters.queue === "pending" && approval.actionableByViewer)
      || (filters.queue === "mine" && approval.initiatedByViewer)
      || (filters.queue === "completed" && ["approved", "rejected", "returned", "cancelled"].includes(approval.status));
    return matchesQuery && matchesType && matchesQueue;
  });
}

export function getApprovalDetail(publicId: string, result: ApprovalResult) {
  return result.data.approvals.find((approval) => approval.id === publicId);
}
