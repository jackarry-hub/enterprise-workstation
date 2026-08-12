import type { ApprovalFilters, ApprovalResult, ApprovalStats } from "@/features/approvals/approval-types";

export function getApprovalStats(approvals: ApprovalResult["data"]["approvals"]): ApprovalStats {
  return {
    pending: approvals.filter(({ status }) => status === "pending").length,
    initiated: approvals.filter(({ initiatedByViewer }) => initiatedByViewer).length,
    approved: approvals.filter(({ status }) => status === "approved").length,
    rejected: approvals.filter(({ status }) => status === "rejected").length,
  };
}

export function filterApprovals(approvals: ApprovalResult["data"]["approvals"], filters: ApprovalFilters) {
  const query = filters.query.trim().toLocaleLowerCase("zh-CN");
  return approvals.filter((approval) => {
    const matchesQuery = !query || [approval.title, approval.code, approval.summary, approval.applicant.displayName, approval.applicant.department, approval.owner.displayName]
      .some((value) => value.toLocaleLowerCase("zh-CN").includes(query));
    const matchesType = filters.type === "all" || approval.type === filters.type;
    const matchesQueue = filters.queue === "all"
      || (filters.queue === "pending" && approval.status === "pending")
      || (filters.queue === "mine" && approval.initiatedByViewer)
      || (filters.queue === "completed" && ["approved", "rejected"].includes(approval.status))
      || (filters.queue === "approved" && approval.status === "approved")
      || (filters.queue === "rejected" && approval.status === "rejected");
    return matchesQuery && matchesType && matchesQueue;
  });
}

export function getApprovalDetail(publicId: string, result: ApprovalResult) {
  return result.data.approvals.find((approval) => approval.id === publicId);
}
