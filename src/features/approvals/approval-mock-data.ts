import type { Approval, ApprovalPerson, ApprovalResult } from "@/features/approvals/approval-types";
import { mockEmployees } from "@/features/hr/employee-mock-data";

function person(index: number): ApprovalPerson {
  const employee = mockEmployees[index];
  return {
    id: employee.profile.id,
    displayName: employee.profile.displayName,
    department: employee.department?.name ?? "待分配",
    jobTitle: employee.profile.jobTitle,
    avatarUrl: employee.profile.avatarUrl,
  };
}

const viewer = person(0);
const wangFang = person(1);
const zhangWei = person(2);
const liuYang = person(3);
const zhouNing = person(4);
const chenChen = person(5);
const liQi = person(6);
const zhaoMin = person(7);

function buildFlow(applicant: ApprovalPerson, owner: ApprovalPerson, status: Approval["status"] = "pending") {
  const completed = status === "approved";
  const rejected = status === "rejected";
  return {
    steps: [
      { id: "step-submit", name: "提交申请", approver: applicant, status: "approved" as const, actedAt: "2026-08-04 09:18", comment: "申请已提交" },
      { id: "step-department", name: "部门负责人审批", approver: owner, status: completed ? "approved" as const : rejected ? "rejected" as const : "pending" as const, actedAt: completed || rejected ? "2026-08-04 10:02" : undefined },
      { id: "step-specialist", name: "职能部门复核", approver: zhaoMin, status: completed ? "approved" as const : "pending" as const, actedAt: completed ? "2026-08-04 11:20" : undefined },
      { id: "step-finish", name: "流程完成", status: completed ? "approved" as const : rejected ? "skipped" as const : "pending" as const, actedAt: completed ? "2026-08-04 11:21" : undefined },
    ],
    actions: [
      { id: `action-${applicant.id}`, actor: applicant, actionType: "submit" as const, content: "提交审批申请", createdAt: "2026-08-04 09:18" },
      ...(completed ? [{ id: `approve-${owner.id}`, actor: owner, actionType: "approve" as const, content: "信息完整，同意申请", createdAt: "2026-08-04 10:02" }] : []),
      ...(rejected ? [{ id: `reject-${owner.id}`, actor: owner, actionType: "reject" as const, content: "请补充业务说明后重新提交", createdAt: "2026-08-04 10:02" }] : []),
    ],
  };
}

const seeds: Array<Omit<Approval, "steps" | "actions">> = [
  {
    id: "81000000-0000-4000-8000-000000000001", code: "LEAVE-20260804-001", type: "leave", title: "请假申请", summary: "年假 2.5 天", applicant: zhangWei, owner: viewer, submittedAt: "2026-08-04 09:18", status: "pending", currentStep: "部门负责人审批", priority: "medium", initiatedByViewer: false,
    fields: [{ label: "请假类型", value: "年假" }, { label: "请假时间", value: "2026-08-06 09:00 — 2026-08-08 12:00" }, { label: "请假时长", value: "2.5 天" }, { label: "请假事由", value: "家庭事务安排，工作已完成交接" }],
  },
  {
    id: "81000000-0000-4000-8000-000000000002", code: "EXP-20260804-002", type: "reimbursement", title: "报销申请", summary: "差旅报销 ¥1,260.00", applicant: wangFang, owner: zhaoMin, submittedAt: "2026-08-04 08:45", status: "pending", currentStep: "财务复核", priority: "high", initiatedByViewer: false,
    fields: [{ label: "报销类型", value: "差旅费" }, { label: "报销金额", value: "¥1,260.00" }, { label: "费用日期", value: "2026-08-01" }, { label: "费用说明", value: "客户现场沟通产生的交通及住宿费用" }],
  },
  {
    id: "81000000-0000-4000-8000-000000000003", code: "PUR-20260804-003", type: "purchase", title: "采购申请", summary: "测试设备采购 ¥8,600.00", applicant: liuYang, owner: viewer, submittedAt: "2026-08-03 17:30", status: "pending", currentStep: "部门负责人审批", priority: "medium", initiatedByViewer: false,
    fields: [{ label: "采购类别", value: "研发设备" }, { label: "采购金额", value: "¥8,600.00" }, { label: "供应商", value: "上海云端科技有限公司" }, { label: "用途", value: "移动端兼容性测试" }],
  },
  {
    id: "81000000-0000-4000-8000-000000000004", code: "CON-20260803-004", type: "contract", title: "合同申请", summary: "软件服务合同 ¥120,000.00", applicant: chenChen, owner: viewer, submittedAt: "2026-08-03 14:12", status: "rejected", currentStep: "法务复核", priority: "high", initiatedByViewer: false,
    fields: [{ label: "合同类型", value: "软件服务" }, { label: "合同金额", value: "¥120,000.00" }, { label: "合作方", value: "星云数字科技有限公司" }, { label: "合同期限", value: "12 个月" }],
  },
  {
    id: "81000000-0000-4000-8000-000000000005", code: "LEAVE-20260802-005", type: "leave", title: "请假申请", summary: "事假 1 天", applicant: zhouNing, owner: liuYang, submittedAt: "2026-08-02 16:40", status: "approved", currentStep: "流程完成", priority: "low", initiatedByViewer: false,
    fields: [{ label: "请假类型", value: "事假" }, { label: "请假时长", value: "1 天" }],
  },
  {
    id: "81000000-0000-4000-8000-000000000006", code: "EXP-20260801-006", type: "reimbursement", title: "报销申请", summary: "办公用品 ¥980.00", applicant: liQi, owner: zhaoMin, submittedAt: "2026-08-01 11:25", status: "approved", currentStep: "流程完成", priority: "low", initiatedByViewer: true,
    fields: [{ label: "报销类型", value: "办公用品" }, { label: "报销金额", value: "¥980.00" }],
  },
];

const approvals = seeds.map((approval) => ({ ...approval, ...buildFlow(approval.applicant, approval.owner, approval.status) }));

export const approvalMockResult: ApprovalResult = {
  source: "mock",
  data: {
    approvals,
    stats: { pending: 18, initiated: 12, approved: 86, rejected: 7 },
  },
};
