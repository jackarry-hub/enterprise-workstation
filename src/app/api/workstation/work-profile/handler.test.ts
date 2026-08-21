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

describe("work profile update route", () => {
  it("rejects an unauthenticated request", async () => {
    const saveProfile = vi.fn();
    const response = await createWorkProfileUpdateHandler({
      loadSession: async () => null,
      saveProfile,
    })(request(validProfile));

    expect(response.status).toBe(401);
    expect(saveProfile).not.toHaveBeenCalled();
  });

  it("rejects invalid profile input before persistence", async () => {
    const saveProfile = vi.fn();
    const response = await createWorkProfileUpdateHandler({
      loadSession: async () => ({ member: { id: 7 } }),
      saveProfile,
    })(request({ ...validProfile, weeklyCapacityHours: 100 }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_request" });
    expect(saveProfile).not.toHaveBeenCalled();
  });

  it("writes only the signed-in employee profile and returns safe fields", async () => {
    const saved = { ...validProfile, updatedAt: "2026-08-21T02:00:00.000Z" };
    const saveProfile = vi.fn().mockResolvedValue(saved);
    const response = await createWorkProfileUpdateHandler({
      loadSession: async () => ({ member: { id: 7 } }),
      saveProfile,
    })(request({ ...validProfile, memberId: 999, summary: ` ${validProfile.summary} ` }));

    expect(response.status).toBe(200);
    expect(saveProfile).toHaveBeenCalledWith(7, validProfile);
    await expect(response.json()).resolves.toEqual({ profile: saved });
  });

  it("maps persistence failures to one stable response", async () => {
    const response = await createWorkProfileUpdateHandler({
      loadSession: async () => ({ member: { id: 7 } }),
      saveProfile: async () => {
        throw new Error("database details and employee data leaked");
      },
    })(request(validProfile));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "profile_save_failed" });
  });
});
