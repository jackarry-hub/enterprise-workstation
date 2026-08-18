import { describe, expect, it, vi } from "vitest";

import { loadFeishuDirectorySnapshot } from "@/features/feishu/directory-sync";

describe("Feishu directory snapshot", () => {
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
            status: { is_activated: true },
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
          status: { is_activated: true },
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
        status: { is_activated: true },
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
