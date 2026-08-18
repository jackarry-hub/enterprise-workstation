import { describe, expect, it } from "vitest";

import { isStandaloneAuthorizedPath } from "@/middleware";

describe("standalone workstation middleware boundary", () => {
  it("protects the fused workstation with Feishu while self-authorizing APIs stay reachable", () => {
    expect(isStandaloneAuthorizedPath("/quantxy-ai-workbench-fused.html")).toBe(false);
    expect(isStandaloneAuthorizedPath("/api/demo-auth/login")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/demo-auth/session")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/demo-auth/logout")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/ai/config")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/ai/chat")).toBe(true);
    expect(isStandaloneAuthorizedPath("/workstation-server-adapter.js")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/workstation/bootstrap")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/workstation/directory-sync")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/workstation/tasks")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/workstation/tasks/task-1")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/workstation/payroll")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/auth/logout")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/workstation/admin")).toBe(false);
    expect(isStandaloneAuthorizedPath("/dashboard")).toBe(false);
    expect(isStandaloneAuthorizedPath("/login")).toBe(false);
  });
});
