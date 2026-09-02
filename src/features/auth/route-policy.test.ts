import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  updateSupabaseSession: vi.fn(),
}));

vi.mock("@/lib/supabase/middleware", () => ({
  updateSupabaseSession: dependencies.updateSupabaseSession,
}));

import {
  getSafeReturnPath,
  getWorkspaceAccessFailureReason,
  isPublicAuthPath,
} from "@/features/auth/workspace-access";
import type { WorkspacePermissionCode, WorkspaceRole } from "@/features/auth/workspace-session-types";
import { isLocalPreviewWorkstationPath, middleware } from "@/middleware";

const authUserId = "10000000-0000-4000-8000-000000000001";
const accessBase = {
  tenantId: "10000000-0000-4000-8000-000000000000",
  authUserId,
  organizationId: "10000000-0000-4000-8000-000000000002",
  organizationName: "Quantum Galaxy",
  memberId: 10,
  employeeProfileId: "10000000-0000-4000-8000-000000000003",
  memberStatus: "active",
  displayName: "Test User",
  avatarUrl: null,
  departmentName: "Product",
  jobTitle: "Manager",
  employmentStatus: "active",
  skills: ["product"],
  providerCode: "feishu",
  authProvider: "custom:feishu",
  providerSubject: "subject-employee-001",
  customRoleCodes: [],
  permissionCodes: ["task.manage"],
};

const roleCases = [
  ["executive", "owner", "/dashboard", ["analytics.read"]],
  ["department_head", "department_head", "/projects", ["project.manage"]],
  ["employee", "employee", "/execution", ["task.manage"]],
  ["finance", "finance", "/approvals", ["salary.manage"]],
  ["hr", "hr", "/people", ["hr.manage"]],
] as const satisfies readonly (readonly [WorkspaceRole, string, string, string[]])[];

function accessRow(databaseRole: string, permissionCodes = accessBase.permissionCodes) {
  return { ...accessBase, roleCodes: [databaseRole], permissionCodes };
}

function refreshedSession({
  subject = authUserId,
  data = accessRow("employee"),
  error = null,
  claimData = "not_provisioned",
  claimError = null,
}: {
  subject?: string | null;
  data?: unknown;
  error?: unknown;
  claimData?: unknown;
  claimError?: unknown;
} = {}) {
  const response = NextResponse.next();
  const supabase = {
    rpc: vi.fn().mockImplementation((name: string) =>
      Promise.resolve(
        name === "claim_current_identity"
          ? { data: claimData, error: claimError }
          : { data, error },
      )),
  };
  dependencies.updateSupabaseSession.mockResolvedValue({
    response,
    supabase,
    subject,
  });
  return { response, supabase };
}

describe("public route policy", () => {
  it.each([
    "/login",
    "/auth/login/feishu",
    "/auth/callback",
    "/auth/callback/feishu",
    "/access-pending",
    "/api/auth/feishu/userinfo",
  ])("keeps the planned auth path %s public", (pathname) => {
    expect(isPublicAuthPath(pathname)).toBe(true);
  });

  it.each([
    "/login/reset",
    "/access-pending/details",
    "/auth/callback-unsafe",
    "/api/auth/feishu/userinfo/export",
    "/api/private",
    "/tasks",
  ])("does not broaden public access to %s", (pathname) => {
    expect(isPublicAuthPath(pathname)).toBe(false);
  });

  it.each([
    ["/tasks?filter=mine", "/tasks?filter=mine"],
    ["/", "/"],
    ["https://evil.example/steal", null],
    ["//evil.example/steal", null],
    ["\\evil.example\\steal", null],
    ["tasks", null],
  ])("accepts only a safe relative return path %#", (candidate, expected) => {
    expect(getSafeReturnPath(candidate)).toBe(expected);
  });
});

describe("workspace access failure policy", () => {
  it.each([
    [null, null, "not_provisioned"],
    [{ ...accessBase, memberStatus: "suspended", roleCodes: ["employee"] }, null, "suspended"],
    [{ ...accessBase, employmentStatus: "departed", roleCodes: ["employee"] }, null, "departed"],
    [{ ...accessBase, roleCodes: [] }, null, "misconfigured"],
    [accessRow("employee"), { message: "private database detail" }, "misconfigured"],
  ] as const)(
    "maps an unavailable workspace result to %s",
    (data, error, expected) => {
      expect(getWorkspaceAccessFailureReason(data, error)).toBe(expected);
    },
  );

  it.each([
    ["not_provisioned", "not_provisioned"],
    ["suspended", "suspended"],
    ["departed", "departed"],
  ] as const)(
    "uses the generic identity claim result %s when active workspace access is absent",
    async (claimData, reason) => {
      const { supabase } = refreshedSession({ data: null, claimData });

      const response = await middleware(
        new NextRequest("https://brain.example/tasks"),
      );

      expect(supabase.rpc).toHaveBeenNthCalledWith(1, "current_workspace_access");
      expect(supabase.rpc).toHaveBeenNthCalledWith(2, "claim_current_identity");
      expect(response.headers.get("location")).toBe(
        `https://brain.example/access-pending?reason=${reason}`,
      );
    },
  );

  it("does not disclose an unavailable status from another auth identity", () => {
    expect(
      getWorkspaceAccessFailureReason(
        {
          ...accessBase,
          authUserId: "20000000-0000-4000-8000-000000000099",
          memberStatus: "suspended",
          roleCodes: ["employee"],
        },
        null,
        authUserId,
      ),
    ).toBe("misconfigured");
  });
});

describe("workspace middleware", () => {
  beforeEach(() => {
    dependencies.updateSupabaseSession.mockReset();
  });

  afterEach(() => vi.unstubAllEnvs());

  it.each(["/login", "/auth/callback", "/access-pending", "/api/auth/feishu/userinfo", "/api/health/ready"])(
    "does not query workspace access for public path %s",
    async (pathname) => {
      const { supabase } = refreshedSession({ subject: null });

      const response = await middleware(
        new NextRequest(`https://brain.example${pathname}`),
      );

      expect(response.status).toBe(200);
      expect(supabase.rpc).not.toHaveBeenCalled();
    },
  );

  it("lets the exact cookie-less Agent recovery POST reach its own bearer-secret handler", async () => {
    const response = await middleware(
      new NextRequest("https://brain.example/api/internal/agent-invocation-recovery", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(dependencies.updateSupabaseSession).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin browser mutation before session or route handling", async () => {
    const response = await middleware(
      new NextRequest("https://brain.example/api/workstation/tasks", {
        method: "POST",
        headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "cross_origin_request_rejected" });
    expect(dependencies.updateSupabaseSession).not.toHaveBeenCalled();
  });

  it.each([
    "/api/internal/agent-invocation-recovery-extra",
    "/api/internal/other",
  ])("keeps adjacent internal path %s behind the Supabase session boundary", async (pathname) => {
    refreshedSession({ subject: null });

    const response = await middleware(
      new NextRequest(`https://brain.example${pathname}`, { method: "POST" }),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      `https://brain.example/login?next=${encodeURIComponent(pathname)}`,
    );
    expect(dependencies.updateSupabaseSession).toHaveBeenCalledTimes(1);
  });

  it("redirects an unauthenticated workspace request with a safe return target", async () => {
    refreshedSession({ subject: null });

    const response = await middleware(
      new NextRequest("https://brain.example/tasks?filter=mine"),
    );

    expect(response.headers.get("location")).toBe(
      "https://brain.example/login?next=%2Ftasks%3Ffilter%3Dmine",
    );
  });

  it.each([
    [null, null, "not_provisioned"],
    [{ ...accessBase, memberStatus: "suspended", roleCodes: ["employee"] }, null, "suspended"],
    [{ ...accessBase, employmentStatus: "departed", roleCodes: ["employee"] }, null, "departed"],
    [{ ...accessBase, roleCodes: [] }, null, "misconfigured"],
    [accessRow("employee"), { message: "private database detail" }, "misconfigured"],
  ] as const)(
    "redirects unavailable workspace access to the public %s status",
    async (data, error, reason) => {
      refreshedSession({ data, error });

      const response = await middleware(
        new NextRequest("https://brain.example/tasks"),
      );

      expect(response.headers.get("location")).toBe(
        `https://brain.example/access-pending?reason=${reason}`,
      );
    },
  );

  it.each(roleCases)(
    "allows the %s landing module after its real workflow is ready",
    async (_workspaceRole, databaseRole, landingPath, permissionCodes) => {
      refreshedSession({ data: accessRow(databaseRole, permissionCodes) });

      const response = await middleware(
        new NextRequest(`https://brain.example${landingPath}`),
      );

      expect(response.headers.get("location")).toBeNull();
    },
  );

  it.each(roleCases)(
    "allows the %s role through the workspace root but rejects the retired formal fused UI",
    async (_workspaceRole, databaseRole, landingPath, permissionCodes) => {
      refreshedSession({ data: accessRow(databaseRole, permissionCodes) });

      const rootResponse = await middleware(
        new NextRequest("https://brain.example/"),
      );
      refreshedSession({ data: accessRow(databaseRole, permissionCodes) });
      const fusedResponse = await middleware(
        new NextRequest(
          "https://brain.example/quantxy-ai-workbench-fused.html?formal=1",
        ),
      );

      expect(rootResponse.headers.get("location")).toBeNull();
      expect(fusedResponse.headers.get("location")).toBe(
        `https://brain.example${landingPath}?notice=no_access`,
      );
    },
  );

  it.each(roleCases)(
    "allows the %s role to use tasks when granted but blocks attendance direct routes",
    async (_workspaceRole, databaseRole, landingPath, permissionCodes) => {
      const taskPermissions = Array.from(new Set<WorkspacePermissionCode>([
        ...permissionCodes,
        "task.manage",
      ]));
      refreshedSession({ data: accessRow(databaseRole, taskPermissions) });
      const tasks = await middleware(
        new NextRequest("https://brain.example/tasks"),
      );
      refreshedSession({ data: accessRow(databaseRole, permissionCodes) });
      const attendance = await middleware(
        new NextRequest("https://brain.example/attendance"),
      );

      expect(tasks.headers.get("location")).toBeNull();
      expect(attendance.headers.get("location")).toBe(
        `https://brain.example${landingPath}?notice=no_access`,
      );
    },
  );

  it("allows an active employee into the safe public people directory", async () => {
    refreshedSession({ data: accessRow("employee") });

    const response = await middleware(
      new NextRequest("https://brain.example/people"),
    );

    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-request-x-quantxy-workspace-path")).toBe("/people");
  });

  it("uses no-access status instead of redirecting back to a denied landing page", async () => {
    refreshedSession({ data: accessRow("employee", ["task.execute"]) });

    const response = await middleware(
      new NextRequest("https://brain.example/execution"),
    );

    expect(response.headers.get("location")).toBe(
      "https://brain.example/access-pending?reason=no_access",
    );
  });

  it("copies refreshed cookie values and attributes onto a redirect", async () => {
    const { response: refreshed } = refreshedSession({ subject: null });
    refreshed.cookies.set("sb-session", "rotated", {
      httpOnly: true,
      maxAge: 3600,
      path: "/",
      sameSite: "lax",
      secure: true,
    });

    const response = await middleware(
      new NextRequest("https://brain.example/tasks"),
    );
    const cookie = response.cookies.get("sb-session");

    expect(cookie).toMatchObject({
      name: "sb-session",
      value: "rotated",
      httpOnly: true,
      maxAge: 3600,
      path: "/",
      sameSite: "lax",
      secure: true,
    });
  });

  it("allows the fused preview bypass only from an explicitly enabled local development host", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("WORKSTATION_DEMO_ENABLED", "true");

    expect(isLocalPreviewWorkstationPath(
      new URL("http://127.0.0.1/quantxy-ai-workbench-fused.html?v=preview"),
    )).toBe(true);
    expect(isLocalPreviewWorkstationPath(
      new URL("https://brain.example/quantxy-ai-workbench-fused.html?v=preview"),
    )).toBe(false);

    const { supabase } = refreshedSession({ subject: null });
    const response = await middleware(
      new NextRequest("https://brain.example/quantxy-ai-workbench-fused.html?v=preview"),
    );

    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe(
      "https://brain.example/login?next=%2Fquantxy-ai-workbench-fused.html%3Fv%3Dpreview",
    );
  });

  it("overwrites a caller supplied private route header while preserving refreshed cookies", async () => {
    const { response: refreshed } = refreshedSession({ data: accessRow("employee") });
    refreshed.cookies.set("sb-session", "rotated", { httpOnly: true, path: "/" });

    const response = await middleware(
      new NextRequest("https://brain.example/help", {
        headers: { "x-quantxy-workspace-path": "/settings" },
      }),
    );

    expect(response.headers.get("x-middleware-request-x-quantxy-workspace-path")).toBe("/help");
    expect(response.cookies.get("sb-session")).toMatchObject({
      name: "sb-session",
      value: "rotated",
      httpOnly: true,
      path: "/",
    });
  });
});
