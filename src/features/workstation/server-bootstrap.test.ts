import { describe, expect, it } from "vitest";

import { buildServerBootstrap } from "@/features/workstation/server-bootstrap";

describe("formal workstation bootstrap", () => {
  it("returns only the signed-in employee's salary while mapping real work records", () => {
    const bootstrap = buildServerBootstrap(
      {
        memberId: 7,
        displayName: "张云帆",
        departmentName: "产品中心",
        jobTitle: "产品经理",
        avatarUrl: null,
        permissionCodes: ["task.manage", "salary.self"],
      },
      {
        members: [
          { id: 7, displayName: "张云帆", departmentName: "产品中心", jobTitle: "产品经理", skills: ["prd"] },
          { id: 8, displayName: "李明", departmentName: "研发中心", jobTitle: "工程师", skills: [] },
        ],
        projects: [
          { id: 31, publicId: "11111111-1111-4111-8111-111111111111", name: "企业工作站", ownerMemberId: 7, status: "active", health: "on_track", progress: 45, priority: "high", updatedAt: "2026-08-18T08:00:00.000Z" },
        ],
        tasks: [
          { publicId: "22222222-2222-4222-8222-222222222222", projectId: 31, title: "完成飞书接入", description: "接入企业账号", assigneeMemberId: 7, reporterMemberId: 8, status: "in_progress", priority: "urgent", startDate: "2026-08-18", dueDate: "2026-08-20", progress: 35, acceptanceCriteria: "员工可登录", blocker: null, reviewNote: null, acceptedAt: "2026-08-18T01:00:00.000Z", submittedAt: null },
        ],
        salary: [
          { payrollMonth: "2026-08-01", baseSalary: 20000, bonus: 3000, performanceBonus: 1000, projectBonus: 1500, otherBonus: 500, socialSecurity: 700, individualIncomeTax: 400, otherDeduction: 100, deductions: 1200, netSalary: 21800, status: "paid", paidAt: "2026-08-10T02:00:00.000Z" },
        ],
      },
    );

    expect(bootstrap.session).toEqual({
      authenticated: true,
      authMode: "feishu",
      dataMode: "server",
      memberId: "m7",
      permissions: ["task.manage", "salary.self"],
    });
    expect(bootstrap.members).toEqual([
      expect.objectContaining({ id: "m7", n: "张云帆", dept: "产品中心" }),
      expect.objectContaining({ id: "m8", n: "李明", dept: "研发中心" }),
    ]);
    expect(bootstrap.projects).toEqual([
      expect.objectContaining({ id: "11111111-1111-4111-8111-111111111111", own: "m7", pr: 45, st: "进行中" }),
    ]);
    expect(bootstrap.tasks).toEqual([
      expect.objectContaining({ id: "22222222-2222-4222-8222-222222222222", p: "11111111-1111-4111-8111-111111111111", own: "m7", createdBy: "m8", st: "进行中", pri: "P0", ac: "员工可登录", acceptedAt: "2026-08-18T01:00:00.000Z", submittedAt: "" }),
    ]);
    expect(bootstrap.payroll).toEqual({
      m7: [expect.objectContaining({ month: "2026-08", base: 20000, performance: 1000, projectBonus: 1500, otherBonus: 500, social: 700, tax: 400, otherDeduction: 100, deductions: 1200, net: 21800 })],
    });
    expect(bootstrap.features).toEqual({ identitySwitch: false, demoReset: false });
  });
});
