import { describe, expect, it } from "vitest";

import {
  getLocalPreviewAccessPendingRedirect,
  isLocalPreviewWorkstationPath,
  isStandaloneAuthorizedPath,
} from "@/middleware";

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
    expect(isStandaloneAuthorizedPath("/api/workstation/projects")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/workstation/tasks")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/workstation/tasks/task-1")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/workstation/payroll")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/workstation/payroll/policy")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/workstation/payroll/preview")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/workstation/work-profile")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/auth/logout")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/workstation/admin")).toBe(false);
    expect(isStandaloneAuthorizedPath("/dashboard")).toBe(false);
    expect(isStandaloneAuthorizedPath("/login")).toBe(false);
  });

  it("lets the non-formal fused workstation use demo preview auth", () => {
    expect(
      isLocalPreviewWorkstationPath(
        "/quantxy-ai-workbench-fused.html",
        new URLSearchParams("v=salary-grade"),
      ),
    ).toBe(true);
    expect(
      isLocalPreviewWorkstationPath(
        "/quantxy-ai-workbench-fused.html",
        new URLSearchParams("formal=1"),
      ),
    ).toBe(false);
  });

  it("rescues local preview tabs stuck on auth_error access pending", () => {
    expect(
      getLocalPreviewAccessPendingRedirect(
        new URL("http://localhost:3030/access-pending?reason=auth_error"),
      )?.pathname,
    ).toBe("/quantxy-ai-workbench-fused.html");
    expect(
      getLocalPreviewAccessPendingRedirect(
        new URL("http://127.0.0.1:3030/access-pending?reason=auth_error"),
      )?.searchParams.get("v"),
    ).toBe("local-preview");
    expect(
      getLocalPreviewAccessPendingRedirect(
        new URL("https://work.quantumgalaxy.top/access-pending?reason=auth_error"),
      ),
    ).toBeNull();
    expect(
      getLocalPreviewAccessPendingRedirect(
        new URL("http://localhost:3030/access-pending?reason=not_provisioned"),
      ),
    ).toBeNull();
  });
});
