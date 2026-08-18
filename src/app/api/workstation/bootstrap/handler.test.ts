import { describe, expect, it } from "vitest";

import {
  createWorkstationBootstrapHandler,
  numericProfileIdForMember,
} from "@/app/api/workstation/bootstrap/handler";

describe("workstation bootstrap route", () => {
  it("resolves salary by the numeric employee profile row, not the public UUID", () => {
    expect(numericProfileIdForMember([
      { id: 41, organization_member_id: 6 },
      { id: 42, organization_member_id: 7 },
    ], 7)).toBe(42);
  });

  it("rejects an unauthenticated browser", async () => {
    const response = await createWorkstationBootstrapHandler({
      loadSession: async () => null,
      loadBootstrap: async () => {
        throw new Error("must not load");
      },
    })();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
  });

  it("returns the authenticated employee bootstrap without demo data", async () => {
    const expected = { session: { authenticated: true }, features: { identitySwitch: false } };
    const response = await createWorkstationBootstrapHandler({
      loadSession: async () => ({ member: { id: 7 } }),
      loadBootstrap: async () => expected,
    })();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(expected);
  });
});
