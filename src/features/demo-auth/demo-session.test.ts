import { describe, expect, it } from "vitest";

import type { DemoAuthEnv } from "@/features/demo-auth/demo-auth-env";
import {
  createDemoSessionToken,
  createDemoWorkspaceSession,
  verifyDemoSessionToken,
} from "@/features/demo-auth/demo-session";

const env: DemoAuthEnv = {
  username: "admin",
  password: "correct-horse-battery",
  tenantId: "10000000-0000-4000-8000-000000000000",
  signingKey: new Uint8Array(32).fill(7),
};

describe("signed demo session", () => {
  it("round-trips a tenant-scoped session and maps it to an admin workspace", async () => {
    const now = new Date("2026-08-17T08:00:00.000Z");
    const token = await createDemoSessionToken(env, false, now);
    const claims = await verifyDemoSessionToken(token, env, now);

    expect(claims).toEqual({
      version: 1,
      tenantId: env.tenantId,
      authUserId: "90000000-0000-4000-8000-000000000001",
      expiresAt: 1786982400,
    });

    const session = createDemoWorkspaceSession(claims!);
    expect(session.tenantId).toBe(env.tenantId);
    expect(session.primaryRole).toBe("executive");
    expect(session.isAdmin).toBe(true);
  });

  it("rejects expired and tampered cookies", async () => {
    const issuedAt = new Date("2026-08-17T08:00:00.000Z");
    const token = await createDemoSessionToken(env, false, issuedAt);

    await expect(
      verifyDemoSessionToken(token, env, new Date("2026-08-17T16:00:01.000Z")),
    ).resolves.toBeNull();
    await expect(
      verifyDemoSessionToken(`${token.slice(0, -1)}x`, env, issuedAt),
    ).resolves.toBeNull();
  });
});
