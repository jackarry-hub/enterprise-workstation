import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  getSupabaseServerClient: vi.fn(),
  redirect: vi.fn((href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`);
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: dependencies.getSupabaseServerClient,
}));

vi.mock("next/navigation", () => ({ redirect: dependencies.redirect }));

import {
  getSafeReturnPath,
  hasWorkspacePermission,
  parseWorkspaceAccess,
} from "@/features/auth/workspace-access";
import {
  getWorkspaceSession,
  requireWorkspaceSession,
} from "@/features/auth/workspace-session";

const base = {
  tenantId: "10000000-0000-4000-8000-000000000000",
  authUserId: "10000000-0000-4000-8000-000000000001",
  organizationId: "10000000-0000-4000-8000-000000000002",
  organizationName: "量子星河",
  memberId: 10,
  employeeProfileId: "10000000-0000-4000-8000-000000000003",
  memberStatus: "active",
  displayName: "测试员工",
  avatarUrl: null,
  departmentName: "AI事业部",
  jobTitle: "产品经理",
  employmentStatus: "active",
  skills: ["product", "需求分析"],
  providerCode: "feishu",
  authProvider: "custom:feishu",
  providerSubject: "subject-employee-001",
  permissionCodes: ["task.manage"],
};

describe("parseWorkspaceAccess", () => {
  it.each([
    ["owner", "executive", "CEO", "/dashboard"],
    ["department_head", "department_head", "管理层", "/department"],
    ["employee", "employee", "普通员工", "/execution"],
    ["finance", "finance", "财务", "/finance"],
    ["hr", "hr", "人事", "/hr"],
  ] as const)(
    "maps database role %s to the %s workspace role",
    (databaseRole, role, roleLabel, landingPath) => {
      const session = parseWorkspaceAccess({
        ...base,
        roleCodes: [databaseRole],
      });

      expect(session).toMatchObject({
        tenantId: base.tenantId,
        identity: {
          providerCode: "feishu",
          authProvider: "custom:feishu",
          providerSubject: "subject-employee-001",
        },
        profile: { skills: ["product", "需求分析"] },
        primaryRole: role,
        landingPath,
        actor: {
          name: "测试员工",
          role,
          roleLabel,
          department: "AI事业部",
          title: "产品经理",
          landingPath,
        },
      });
    },
  );

  it("uses the documented business-role priority and treats admin as a flag", () => {
    const session = parseWorkspaceAccess({
      ...base,
      roleCodes: ["employee", "admin", "hr", "finance", "department_head", "owner"],
    });

    expect(session).toMatchObject({ primaryRole: "executive", isAdmin: true });
  });

  it("does not use the organization display name as a tenant authorization check", () => {
    const session = parseWorkspaceAccess({
      ...base,
      organizationName: "第二个合法组织",
      roleCodes: ["employee"],
    });

    expect(session?.organization.name).toBe("第二个合法组织");
  });

  it("returns only the provider-neutral identity summary", () => {
    const session = parseWorkspaceAccess({
      ...base,
      roleCodes: ["employee"],
      openId: "must-not-leak",
      unionId: "must-not-leak",
      providerTenantKey: "must-not-leak",
      token: "must-not-leak",
    });

    expect(session?.identity).toEqual({
      providerCode: "feishu",
      authProvider: "custom:feishu",
      providerSubject: "subject-employee-001",
    });
    expect(JSON.stringify(session)).not.toMatch(
      /openId|unionId|providerTenantKey|must-not-leak|token/,
    );
  });

  it.each([
    ["tenantId"],
    ["providerCode"],
    ["authProvider"],
    ["providerSubject"],
    ["skills"],
  ] as const)("rejects a row missing required field %s", (field) => {
    const value: Record<string, unknown> = {
      ...base,
      roleCodes: ["employee"],
    };
    delete value[field];

    expect(parseWorkspaceAccess(value)).toBeNull();
  });

  it.each([
    null,
    [],
    [{ ...base, roleCodes: ["employee"] }],
    "workspace",
  ])("rejects a non-record RPC result %#", (value) => {
    expect(parseWorkspaceAccess(value)).toBeNull();
  });

  it.each([
    ["authUserId", "not-a-uuid"],
    ["tenantId", "not-a-uuid"],
    ["organizationId", "not-a-uuid"],
    ["employeeProfileId", "not-a-uuid"],
    ["memberId", 0],
    ["memberId", 1.5],
    ["memberId", "10"],
  ] as const)("rejects malformed identifier %s", (field, value) => {
    expect(
      parseWorkspaceAccess({
        ...base,
        roleCodes: ["employee"],
        [field]: value,
      }),
    ).toBeNull();
  });

  it.each([
    ["memberStatus", "invited"],
    ["memberStatus", null],
    ["employmentStatus", "departed"],
    ["employmentStatus", null],
  ] as const)("rejects unavailable status %s=%s", (field, value) => {
    expect(
      parseWorkspaceAccess({
        ...base,
        roleCodes: ["employee"],
        [field]: value,
      }),
    ).toBeNull();
  });

  it.each(["probation", "active", "on_leave"])(
    "accepts employment status %s",
    (employmentStatus) => {
      expect(
        parseWorkspaceAccess({
          ...base,
          employmentStatus,
          roleCodes: ["employee"],
        }),
      ).not.toBeNull();
    },
  );

  it.each([
    ["avatarUrl", undefined],
    ["avatarUrl", 12],
    ["organizationName", null],
    ["displayName", ""],
    ["departmentName", "   "],
    ["jobTitle", null],
    ["providerCode", ""],
    ["providerCode", "Feishu"],
    ["authProvider", " custom:feishu"],
    ["providerSubject", "subject\ninvalid"],
  ] as const)("rejects malformed nullable or text field %s", (field, value) => {
    expect(
      parseWorkspaceAccess({
        ...base,
        roleCodes: ["employee"],
        [field]: value,
      }),
    ).toBeNull();
  });

  it("accepts a non-empty avatar URL string", () => {
    expect(
      parseWorkspaceAccess({
        ...base,
        avatarUrl: "https://cdn.example.test/avatar.png",
        roleCodes: ["employee"],
      })?.profile.avatarUrl,
    ).toBe("https://cdn.example.test/avatar.png");
  });

  it.each([
    ["admin-only", ["admin"]],
    ["unknown", ["superuser"]],
    ["mixed known and unknown", ["employee", "superuser"]],
    ["duplicate", ["employee", "employee"]],
    ["wrong item type", ["employee", 7]],
    ["not an array", "employee"],
  ])("rejects %s role codes", (_label, roleCodes) => {
    expect(parseWorkspaceAccess({ ...base, roleCodes })).toBeNull();
  });

  it.each([
    ["unknown", ["task.manage", "workspace.root"]],
    ["duplicate", ["task.manage", "task.manage"]],
    ["wrong item type", ["task.manage", null]],
    ["not an array", "task.manage"],
  ])("rejects %s permission codes", (_label, permissionCodes) => {
    expect(
      parseWorkspaceAccess({
        ...base,
        roleCodes: ["employee"],
        permissionCodes,
      }),
    ).toBeNull();
  });

  it.each([
    ["not an array", "product"],
    ["wrong item type", ["product", null]],
    ["empty", [""]],
    ["not trimmed", [" product"]],
    ["not lowercased", ["Product"]],
    ["duplicate", ["product", "product"]],
    ["too long", ["x".repeat(41)]],
    ["too many", Array.from({ length: 31 }, (_, index) => `skill-${index}`)],
  ])("rejects malformed skills: %s", (_label, skills) => {
    expect(
      parseWorkspaceAccess({
        ...base,
        roleCodes: ["employee"],
        skills,
      }),
    ).toBeNull();
  });
});

describe("hasWorkspacePermission", () => {
  it("checks only validated database permission codes", () => {
    const session = parseWorkspaceAccess({
      ...base,
      roleCodes: ["employee"],
      permissionCodes: ["task.manage"],
    });

    expect(session).not.toBeNull();
    expect(hasWorkspacePermission(session!, "task.manage")).toBe(true);
    expect(hasWorkspacePermission(session!, "organization.manage")).toBe(false);
  });
});

describe("getSafeReturnPath", () => {
  it.each([
    ["NUL", "/finance\u0000details"],
    ["tab", "/finance\tdetails"],
    ["line feed", "/finance\ndetails"],
    ["carriage return", "/finance\rdetails"],
    ["other C0", "/finance\u001fdetails"],
    ["DEL", "/finance\u007fdetails"],
    ["encoded NUL", "/finance%00details"],
    ["encoded tab", "/finance%09details"],
    ["encoded line feed", "/finance%0adetails"],
    ["encoded carriage return", "/finance%0Ddetails"],
    ["encoded DEL", "/finance%7fdetails"],
  ])("rejects %s in a return path", (_label, candidate) => {
    expect(getSafeReturnPath(candidate)).toBeNull();
  });

  it.each([
    ["encoded protocol-relative path", "/%2f%2fevil.example/steal"],
    ["encoded backslash authority", "/%5cevil.example/steal"],
    ["encoded double backslash", "/safe%5c%5cevil.example/steal"],
    ["double-encoded backslash", "/%255cevil.example/steal"],
    ["mixed slash and backslash", "/%2f%5cevil.example/steal"],
  ])("rejects an %s trick", (_label, candidate) => {
    expect(getSafeReturnPath(candidate)).toBeNull();
  });

  it("rejects malformed percent encoding without throwing", () => {
    expect(() => getSafeReturnPath("/finance?bad=%zz")).not.toThrow();
    expect(getSafeReturnPath("/finance?bad=%zz")).toBeNull();
  });

  it("keeps a valid relative path, query, and fragment", () => {
    expect(
      getSafeReturnPath(
        "/finance?tab=month&note=hello%20world#summary",
      ),
    ).toBe("/finance?tab=month&note=hello%20world#summary");
  });
});

describe("workspace session server helpers", () => {
  beforeEach(() => {
    dependencies.getSupabaseServerClient.mockReset();
    dependencies.redirect.mockClear();
  });

  function client({
    subject = base.authUserId,
    claimsError = null,
    rpcData = { ...base, roleCodes: ["employee"] },
    rpcError = null,
  }: {
    subject?: string | null;
    claimsError?: unknown;
    rpcData?: unknown;
    rpcError?: unknown;
  } = {}) {
    return {
      auth: {
        getClaims: vi.fn().mockResolvedValue({
          data: subject === null ? null : { claims: { sub: subject } },
          error: claimsError,
        }),
      },
      rpc: vi.fn().mockResolvedValue({ data: rpcData, error: rpcError }),
    };
  }

  it("does not call the access RPC without an authenticated subject", async () => {
    const supabase = client({ subject: null });
    dependencies.getSupabaseServerClient.mockResolvedValue(supabase);

    await expect(getWorkspaceSession()).resolves.toBeNull();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("returns a validated session whose user matches the auth claim", async () => {
    const supabase = client();
    dependencies.getSupabaseServerClient.mockResolvedValue(supabase);

    await expect(getWorkspaceSession()).resolves.toMatchObject({
      authUserId: base.authUserId,
      tenantId: base.tenantId,
      primaryRole: "employee",
    });
  });

  it("rejects an RPC identity that does not match the auth claim", async () => {
    const supabase = client({
      rpcData: {
        ...base,
        authUserId: "20000000-0000-4000-8000-000000000099",
        roleCodes: ["employee"],
      },
    });
    dependencies.getSupabaseServerClient.mockResolvedValue(supabase);

    await expect(getWorkspaceSession()).resolves.toBeNull();
  });

  it("uses stable errors for claims and RPC failures", async () => {
    dependencies.getSupabaseServerClient.mockResolvedValueOnce(
      client({ claimsError: { message: "provider details" } }),
    );
    await expect(getWorkspaceSession()).rejects.toThrow("无法验证当前登录状态");

    dependencies.getSupabaseServerClient.mockResolvedValueOnce(
      client({ rpcError: { message: "database details" } }),
    );
    await expect(getWorkspaceSession()).rejects.toThrow("无法读取当前工作身份");
  });

  it("redirects unauthenticated users to login", async () => {
    dependencies.getSupabaseServerClient.mockResolvedValue(client({ subject: null }));

    await expect(requireWorkspaceSession()).rejects.toThrow(
      "NEXT_REDIRECT:/login",
    );
  });

  it("redirects authenticated users without valid access to the pending page", async () => {
    dependencies.getSupabaseServerClient.mockResolvedValue(
      client({ rpcData: null }),
    );

    await expect(requireWorkspaceSession()).rejects.toThrow(
      "NEXT_REDIRECT:/access-pending?reason=not_provisioned",
    );
  });
});
