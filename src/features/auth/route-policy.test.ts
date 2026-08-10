import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
import type { WorkspaceRole } from "@/features/auth/workspace-session-types";
import { middleware } from "@/middleware";

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
  permissionCodes: ["task.manage"],
};

const roleCases = [
  ["executive", "owner", "/dashboard"],
  ["department_head", "department_head", "/department"],
  ["employee", "employee", "/execution"],
  ["finance", "finance", "/finance"],
  ["hr", "hr", "/hr"],
] as const satisfies readonly (readonly [WorkspaceRole, string, string])[];

function accessRow(databaseRole: string) {
  return { ...accessBase, roleCodes: [databaseRole] };
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

  it.each(["/login", "/auth/callback", "/access-pending", "/api/auth/feishu/userinfo"])(
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
    "allows the %s role to reach its server-checked landing path",
    async (_workspaceRole, databaseRole, landingPath) => {
      refreshedSession({ data: accessRow(databaseRole) });

      const response = await middleware(
        new NextRequest(`https://brain.example${landingPath}`),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBeNull();
    },
  );

  it.each(roleCases)(
    "allows the %s role to use tasks and the legacy attendance redirect route",
    async (_workspaceRole, databaseRole) => {
      refreshedSession({ data: accessRow(databaseRole) });
      const tasks = await middleware(
        new NextRequest("https://brain.example/tasks"),
      );
      refreshedSession({ data: accessRow(databaseRole) });
      const attendance = await middleware(
        new NextRequest("https://brain.example/attendance"),
      );

      expect(tasks.headers.get("location")).toBeNull();
      expect(attendance.headers.get("location")).toBeNull();
    },
  );

  it("returns a role mismatch to the trusted session landing path", async () => {
    refreshedSession({ data: accessRow("employee") });

    const response = await middleware(
      new NextRequest("https://brain.example/people"),
    );

    expect(response.headers.get("location")).toBe(
      "https://brain.example/execution?notice=no_access",
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
});
