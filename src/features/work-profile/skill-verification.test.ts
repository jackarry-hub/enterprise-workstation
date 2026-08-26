import { describe, expect, it, vi } from "vitest";

import { createSkillVerificationHandler } from "@/features/work-profile/skill-verification-handler";

const skillId = "30000000-0000-4000-8000-000000000001";
const requestId = "40000000-0000-4000-8000-000000000001";

function request(body: unknown) {
  return new Request(`https://workspace.test/api/workstation/skills/${skillId}/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("employee skill verification route", () => {
  it("denies an employee before a verification command is invoked", async () => {
    const verifySkill = vi.fn();
    const response = await createSkillVerificationHandler({
      loadSession: async () => ({ member: { id: 7, status: "active" }, permissionCodes: [] }),
      verifySkill,
      createRequestId: () => requestId,
    })(request({ decision: "verified", reason: "岗位能力材料已复核" }), {
      params: Promise.resolve({ skillId }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "forbidden" });
    expect(verifySkill).not.toHaveBeenCalled();
  });

  it("lets an authorized HR member record a bounded verification decision", async () => {
    const verifySkill = vi.fn().mockResolvedValue({
      outcome: "success",
      skillId,
      verificationStatus: "verified",
    });
    const response = await createSkillVerificationHandler({
      loadSession: async () => ({ member: { id: 8, status: "active" }, permissionCodes: ["hr.manage"] }),
      verifySkill,
      createRequestId: () => requestId,
    })(request({ decision: "verified", reason: " 岗位能力材料已复核 " }), {
      params: Promise.resolve({ skillId }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      verification: { skillId, verificationStatus: "verified" },
    });
    expect(verifySkill).toHaveBeenCalledWith({
      skillId,
      decision: "verified",
      reason: "岗位能力材料已复核",
      requestId,
    });
  });

  it("maps a real foreign skill target to not found without leaking provider details", async () => {
    const response = await createSkillVerificationHandler({
      loadSession: async () => ({ member: { id: 8, status: "active" }, permissionCodes: ["hr.manage"] }),
      verifySkill: async () => ({ outcome: "failure", error: "not_found" }),
      createRequestId: () => requestId,
    })(request({ decision: "verified", reason: "岗位能力材料已复核" }), {
      params: Promise.resolve({ skillId }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "skill_not_found" });
  });

  it("rejects malformed verification input before the authenticated command", async () => {
    const verifySkill = vi.fn();
    const response = await createSkillVerificationHandler({
      loadSession: async () => ({ member: { id: 8, status: "active" }, permissionCodes: ["hr.manage"] }),
      verifySkill,
    })(request({ decision: null, reason: "岗位能力材料已复核" }), {
      params: Promise.resolve({ skillId }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_request" });
    expect(verifySkill).not.toHaveBeenCalled();
  });
});
