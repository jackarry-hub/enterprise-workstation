import { describe, expect, it, vi } from "vitest";

import { createWorkProfileUpdateHandler } from "@/app/api/workstation/work-profile/handler";

function request(body: unknown) {
  return new Request("https://workspace.test/api/workstation/work-profile", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validProfile = {
  summary: "负责客户需求拆解与产品方案落地",
  preferredTaskTypes: ["需求分析", "产品规划"],
  growthGoals: ["AI产品设计"],
  weeklyCapacityHours: 36,
  selfSkills: [{ name: "需求分析", level: 5 }],
};

function currentSession() {
  return {
    tenantId: "10000000-0000-4000-8000-000000000001",
    authUserId: "90000000-0000-4000-8000-000000000007",
    organization: { id: "20000000-0000-4000-8000-000000000001" },
    member: {
      id: 7,
      employeeProfileId: "10000000-0000-4000-8000-000000000007",
      status: "active" as const,
    },
  };
}

describe("work profile update route", () => {
  it("rejects an unauthenticated request", async () => {
    const updateProfile = vi.fn();
    const response = await createWorkProfileUpdateHandler({
      loadSession: async () => null,
      updateProfile,
    })(request(validProfile));

    expect(response.status).toBe(401);
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it("rejects invalid profile input before persistence", async () => {
    const updateProfile = vi.fn();
    const response = await createWorkProfileUpdateHandler({
      loadSession: async () => currentSession(),
      updateProfile,
    })(request({ ...validProfile, weeklyCapacityHours: 100 }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_request" });
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it("uses the authenticated RPC without browser authority fields", async () => {
    const saved = { ...validProfile, updatedAt: "2026-08-21T02:00:00.000Z" };
    const updateProfile = vi.fn().mockResolvedValue({ outcome: "success", profile: saved });
    const response = await createWorkProfileUpdateHandler({
      loadSession: async () => currentSession(),
      updateProfile,
      createRequestId: () => "40000000-0000-4000-8000-000000000001",
    })(request({ ...validProfile, memberId: 999, summary: ` ${validProfile.summary} ` }));

    expect(response.status).toBe(200);
    expect(updateProfile).toHaveBeenCalledWith(
      validProfile,
      "40000000-0000-4000-8000-000000000001",
    );
    await expect(response.json()).resolves.toEqual({ profile: saved });
  });

  it("maps persistence failures to one stable response", async () => {
    const response = await createWorkProfileUpdateHandler({
      loadSession: async () => currentSession(),
      updateProfile: async () => {
        throw new Error("database details and employee data leaked");
      },
    })(request(validProfile));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "profile_save_failed" });
  });

  it("maps a profile omitted by composite scope to a stable not found response", async () => {
    const response = await createWorkProfileUpdateHandler({
      loadSession: async () => ({
        tenantId: "10000000-0000-4000-8000-000000000001",
        authUserId: "90000000-0000-4000-8000-000000000007",
        organization: { id: "20000000-0000-4000-8000-000000000001" },
        member: { id: 7, employeeProfileId: "10000000-0000-4000-8000-000000000007", status: "active" as const },
      }),
      updateProfile: async () => ({ outcome: "failure", error: "profile_not_found" }),
    })(request(validProfile));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "profile_not_found" });
  });
});
