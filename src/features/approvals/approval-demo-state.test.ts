import { describe, expect, it } from "vitest";

import {
  applyApprovalDecision,
  readDemoApprovals,
  saveDemoApproval,
} from "@/features/approvals/approval-demo-state";
import { approvalMockResult } from "@/features/approvals/approval-mock-data";

const leaveApproval = approvalMockResult.data.approvals[0];

describe("approval demo state", () => {
  it("advances approval to the next responsible person before final completion", () => {
    const forwarded = applyApprovalDecision(leaveApproval, {
      decision: "approve",
      feedback: "同意，继续复核。",
      actedAt: "2026-08-14 10:30",
    });

    expect(forwarded).toMatchObject({
      status: "pending",
      currentStep: "职能部门复核",
      owner: { displayName: "赵敏" },
    });

    const completed = applyApprovalDecision(forwarded, {
      decision: "approve",
      feedback: "复核通过。",
      actedAt: "2026-08-14 10:35",
    });
    expect(completed).toMatchObject({ status: "approved", currentStep: "流程完成" });
  });

  it("persists a decision and overlays it on the original demo list", () => {
    const storage = window.localStorage;
    storage.clear();
    const rejected = applyApprovalDecision(leaveApproval, {
      decision: "reject",
      feedback: "请补充交接说明。",
      actedAt: "2026-08-14 10:40",
    });

    saveDemoApproval(rejected, storage);

    expect(readDemoApprovals(approvalMockResult.data.approvals, storage)[0]).toMatchObject({
      status: "rejected",
      currentStep: "已退回申请人",
    });
  });
});
