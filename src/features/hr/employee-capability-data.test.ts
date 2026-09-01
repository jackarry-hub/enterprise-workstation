import { describe, expect, it, vi } from "vitest";

import { loadEmployeeCapabilityCenter, parseEmployeeCapabilityCenter } from "@/features/hr/employee-data";

const employeeId = "92000000-0000-4000-8000-000000000001";
const organizationId = "92000000-0000-4000-8000-000000000002";

const valid = {
  canViewWork: true,
  canViewAgent: true,
  workProfile: { summary: "负责商业交付", preferredTaskTypes: ["项目交付"], growthGoals: ["项目管理"],
    weeklyCapacityHours: 40, selfSkills: [{ name: "交付", level: 4 }], updatedAt: "2026-09-01T08:00:00Z" },
  skills: [{ id: "92000000-0000-4000-8000-000000000003", code: "DELIVERY", name: "项目交付", level: 4,
    yearsExperience: 5, source: "manager", verificationStatus: "verified", updatedAt: "2026-09-01T08:00:00Z" }],
  workload: { openTasks: 2, inProgressTasks: 1, awaitingReviewTasks: 1, completedTasks: 8 },
  assignments: [], evidence: [], agentRuns: [],
};

describe("employee capability center", () => {
  it("accepts the canonical capability contract and rejects unsafe shapes", () => {
    expect(parseEmployeeCapabilityCenter(valid)).toEqual(expect.objectContaining({ canViewWork: true,
      skills: [expect.objectContaining({ verificationStatus: "verified" })] }));
    expect(parseEmployeeCapabilityCenter({ ...valid, workload: { openTasks: -1 } })).toBeNull();
    expect(parseEmployeeCapabilityCenter({ ...valid, skills: [{ secret: "leak" }] })).toBeNull();
  });

  it("loads through the scoped RPC and fails closed", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: valid, error: null });
    const result = await loadEmployeeCapabilityCenter(employeeId, organizationId,
      async () => ({ rpc } as never));
    expect(result.data?.workload?.completedTasks).toBe(8);
    expect(rpc).toHaveBeenCalledWith("current_employee_capability_center", {
      p_employee_public_id: employeeId, p_organization_public_id: organizationId, p_limit: 50,
    });
    const invalid = await loadEmployeeCapabilityCenter(employeeId, organizationId,
      async () => ({ rpc: vi.fn().mockResolvedValue({ data: { secret: "no" }, error: null }) } as never));
    expect(invalid.data).toBeUndefined();
    expect(invalid.loadError).toMatch(/加载失败/);
  });
});
