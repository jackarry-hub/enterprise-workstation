import { describe, expect, it } from "vitest";

import { approvalMockResult } from "@/features/approvals/approval-mock-data";
import { filterApprovals, getApprovalDetail, getApprovalStats } from "@/features/approvals/approval-selectors";

describe("approval selectors", () => {
  it("provides the approved queue summary", () => {
    expect(getApprovalStats(approvalMockResult.data.approvals)).toEqual({ pending: 3, initiated: 1, approved: 2, rejected: 1 });
  });

  it("combines queue, type, and search filters", () => {
    const rows = filterApprovals(approvalMockResult.data.approvals, {
      query: "王芳",
      queue: "pending",
      type: "reimbursement",
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].code).toBe("EXP-20260804-002");
  });

  it("supports exact approved and rejected status filters from summary cards", () => {
    expect(filterApprovals(approvalMockResult.data.approvals, { query: "", queue: "approved", type: "all" })).toHaveLength(2);
    expect(filterApprovals(approvalMockResult.data.approvals, { query: "", queue: "rejected", type: "all" })).toHaveLength(1);
  });

  it("resolves public approval details with fixed steps and history", () => {
    const approval = getApprovalDetail(
      "81000000-0000-4000-8000-000000000002",
      approvalMockResult,
    );

    expect(approval?.steps.length).toBeGreaterThanOrEqual(3);
    expect(approval?.actions[0].actionType).toBe("submit");
  });
});
