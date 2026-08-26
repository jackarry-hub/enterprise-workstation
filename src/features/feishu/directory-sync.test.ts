import { describe, expect, it, vi } from "vitest";

import { loadFeishuDirectorySnapshot, revokeDepartedMemberAccess } from "@/features/feishu/directory-sync";

const directoryEnv = { appId: "cli_test", appSecret: "app-secret" };
const activeStatus = {
  is_activated: true,
  is_exited: false,
  is_frozen: false,
  is_resigned: false,
  is_unjoin: false,
};

function directoryUsersFetch(
  rootUsers: Array<Record<string, unknown>>,
  departmentUsers?: Array<Record<string, unknown>>,
) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/auth/v3/tenant_access_token/internal")) {
      return Response.json({ code: 0, tenant_access_token: "tenant-secret" });
    }
    if (url.includes("/departments/0/children")) {
      return Response.json({
        code: 0,
        data: {
          has_more: false,
          items: departmentUsers
            ? [{ open_department_id: "od-product", name: "产品部" }]
            : [],
        },
      });
    }
    return Response.json({
      code: 0,
      data: {
        has_more: false,
        items: url.includes("department_id=0") ? rootUsers : departmentUsers ?? [],
      },
    });
  });
}

describe("Feishu directory snapshot", () => {
  it("delegates immediate offboarding to one transactional repository command", async () => {
    const calls: Array<{ memberPublicId: string; eventId: string }> = [];
    const result = await revokeDepartedMemberAccess(
      "71000000-0000-4000-8000-000000000001",
      "evt-departed-1",
      async (input) => { calls.push(input); return true; },
    );
    expect(result).toBe(true);
    expect(calls).toEqual([{ memberPublicId: "71000000-0000-4000-8000-000000000001", eventId: "evt-departed-1" }]);
  });

  it("loads departments and employees with an app token without exposing the token", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/auth/v3/tenant_access_token/internal")) {
        expect(init?.body).toContain("cli_test");
        return Response.json({ code: 0, tenant_access_token: "tenant-secret" });
      }
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer tenant-secret");
      if (url.includes("/departments/0/children")) {
        return Response.json({
          code: 0,
          data: {
            has_more: false,
            items: [{
              open_department_id: "od-product",
              department_id: "product",
              name: "产品部",
              parent_department_id: "0",
              leader_user_id: "ou-leader",
            }],
          },
        });
      }
      if (url.includes("department_id=0")) {
        return Response.json({
          code: 0,
          data: { has_more: false, items: [{
            open_id: "ou-owner",
            user_id: "owner",
            name: "负责人",
            job_title: "CEO",
            status: activeStatus,
          }] },
        });
      }
      return Response.json({
        code: 0,
        data: { has_more: false, items: [{
          open_id: "ou-employee",
          user_id: "employee",
          name: "产品同事",
          job_title: "产品经理",
          status: activeStatus,
        }] },
      });
    });

    const snapshot = await loadFeishuDirectorySnapshot(
      { appId: "cli_test", appSecret: "app-secret" },
      fetchImpl,
    );

    expect(snapshot).toMatchObject({
      complete: true,
      departments: [{
        externalId: "od-product",
        name: "产品部",
        leaderOpenId: "ou-leader",
      }],
      employees: [
        { openId: "ou-owner", primaryDepartmentExternalId: null },
        { openId: "ou-employee", primaryDepartmentExternalId: "od-product" },
      ],
    });
    expect(snapshot.positions).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "CEO" }),
      expect.objectContaining({ name: "产品经理" }),
    ]));
    expect(JSON.stringify(snapshot)).not.toContain("tenant-secret");
    expect(JSON.stringify(snapshot)).not.toContain("app-secret");
  });

  it("keeps a missing Feishu title empty so directory sync does not overwrite a real role title", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/auth/v3/tenant_access_token/internal")) {
        return Response.json({ code: 0, tenant_access_token: "tenant-secret" });
      }
      if (url.includes("/departments/0/children")) {
        return Response.json({ code: 0, data: { has_more: false, items: [] } });
      }
      return Response.json({ code: 0, data: { has_more: false, items: [{
        open_id: "ou-owner",
        user_id: "owner",
        name: "负责人",
        status: activeStatus,
      }] } });
    });

    const snapshot = await loadFeishuDirectorySnapshot(
      { appId: "cli_test", appSecret: "app-secret" },
      fetchImpl,
    );

    expect(snapshot.employees[0]).toMatchObject({ jobTitle: "", jobTitleExternalId: null });
    expect(snapshot.positions).toEqual([]);
  });
});

describe("Feishu directory pagination fails closed", () => {
  it("rejects an exhausted global page budget before returning a snapshot", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/auth/v3/tenant_access_token/internal")) {
        return Response.json({ code: 0, tenant_access_token: "tenant-secret" });
      }
      if (url.includes("/departments/0/children")) {
        return Response.json({
          code: 0,
          data: { has_more: false, items: [{ open_department_id: "od-product", name: "产品部" }] },
        });
      }
      return Response.json({
        code: 0,
        data: {
          has_more: false,
          items: [{ open_id: "ou-user", name: "员工", status: activeStatus }],
        },
      });
    });

    await expect(loadFeishuDirectorySnapshot(directoryEnv, fetchImpl, { maxPages: 2 }))
      .rejects.toMatchObject({ code: "directory_pagination_limit" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("rejects a repeated page token instead of accepting a partial directory", async () => {
    let departmentPage = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/auth/v3/tenant_access_token/internal")) {
        return Response.json({ code: 0, tenant_access_token: "tenant-secret" });
      }
      if (!url.includes("/departments/0/children")) {
        return Response.json({ code: 0, data: { has_more: false, items: [] } });
      }
      departmentPage += 1;
      return Response.json({
        code: 0,
        data: {
          has_more: departmentPage <= 2,
          page_token: "repeated-token",
          items: [],
        },
      });
    });

    await expect(loadFeishuDirectorySnapshot(directoryEnv, fetchImpl, { maxPages: 5 }))
      .rejects.toMatchObject({ code: "directory_pagination_invalid" });
    expect(departmentPage).toBe(2);
  });

  it("rejects a missing next page token with a stable pagination error", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/auth/v3/tenant_access_token/internal")) {
        return Response.json({ code: 0, tenant_access_token: "tenant-secret" });
      }
      return Response.json({ code: 0, data: { has_more: true, items: [] } });
    });

    await expect(loadFeishuDirectorySnapshot(directoryEnv, fetchImpl, { maxPages: 5 }))
      .rejects.toMatchObject({ code: "directory_pagination_invalid" });
  });

  it("rejects a code-zero response with a malformed page instead of publishing an empty snapshot", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/auth/v3/tenant_access_token/internal")) {
        return Response.json({ code: 0, tenant_access_token: "tenant-secret" });
      }
      return Response.json({ code: 0, data: { has_more: false, items: {} } });
    });

    await expect(loadFeishuDirectorySnapshot(directoryEnv, fetchImpl))
      .rejects.toMatchObject({ code: "directory_payload_invalid" });
  });

  it("rejects malformed directory entities instead of silently dropping them", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/auth/v3/tenant_access_token/internal")) {
        return Response.json({ code: 0, tenant_access_token: "tenant-secret" });
      }
      return Response.json({
        code: 0,
        data: {
          has_more: false,
          items: [{ open_department_id: "od-missing-name" }],
        },
      });
    });

    await expect(loadFeishuDirectorySnapshot(directoryEnv, fetchImpl))
      .rejects.toMatchObject({ code: "directory_payload_invalid" });
  });

  it.each([
    ["missing", undefined],
    ["non-object", "active"],
    ["empty", {}],
    ["non-boolean flag", { ...activeStatus, is_activated: "true" }],
  ])("rejects a %s employee lifecycle status", async (_label, status) => {
    const employee = {
      open_id: "ou-user",
      name: "员工",
      ...(status === undefined ? {} : { status }),
    };

    await expect(loadFeishuDirectorySnapshot(
      directoryEnv,
      directoryUsersFetch([employee]),
    )).rejects.toMatchObject({ code: "directory_payload_invalid" });
  });

  it.each(["is_frozen", "is_resigned", "is_exited"] as const)(
    "maps an explicitly true %s lifecycle flag to inactive",
    async (flag) => {
      const snapshot = await loadFeishuDirectorySnapshot(
        directoryEnv,
        directoryUsersFetch([{
          open_id: `ou-${flag}`,
          name: "离职或冻结员工",
          status: { ...activeStatus, [flag]: true },
        }]),
      );

      expect(snapshot.employees).toEqual([
        expect.objectContaining({ openId: `ou-${flag}`, isActive: false }),
      ]);
    },
  );

  it("rejects conflicting lifecycle states for the same employee across departments", async () => {
    const activeEmployee = {
      open_id: "ou-conflict",
      name: "状态冲突员工",
      status: activeStatus,
    };
    const frozenEmployee = {
      ...activeEmployee,
      status: { ...activeStatus, is_frozen: true },
    };

    await expect(loadFeishuDirectorySnapshot(
      directoryEnv,
      directoryUsersFetch([activeEmployee], [frozenEmployee]),
    )).rejects.toMatchObject({ code: "directory_payload_invalid" });
  });
});
