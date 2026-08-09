import type { ApprovalPriority, ApprovalStatus, ApprovalType } from "@/features/approvals/approval-types";

export const approvalTypeMeta: Record<ApprovalType, { label: string; shortLabel: string }> = {
  leave: { label: "请假申请", shortLabel: "请假" },
  reimbursement: { label: "报销申请", shortLabel: "报销" },
  purchase: { label: "采购申请", shortLabel: "采购" },
  contract: { label: "合同申请", shortLabel: "合同" },
};

export const approvalStatusMeta: Record<ApprovalStatus, {
  label: string;
  tone: "active" | "success" | "warning" | "neutral";
}> = {
  draft: { label: "草稿", tone: "neutral" },
  pending: { label: "待审批", tone: "warning" },
  approved: { label: "已通过", tone: "success" },
  rejected: { label: "已拒绝", tone: "neutral" },
};

export const approvalPriorityMeta: Record<ApprovalPriority, { label: string; tone: "success" | "warning" | "active" }> = {
  low: { label: "低", tone: "success" },
  medium: { label: "中", tone: "warning" },
  high: { label: "高", tone: "active" },
};
