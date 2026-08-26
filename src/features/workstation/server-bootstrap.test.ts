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
          { publicId: "22222222-2222-4222-8222-222222222222", projectId: 31, title: "完成飞书接入", description: "接入企业账号", assigneeMemberId: 7, reporterMemberId: 8, status: "in_progress", priority: "urgent", startDate: "2026-08-18", dueDate: "2026-08-20", progress: 35, acceptanceCriteria: "员工可登录", blocker: null, reviewNote: null, acceptedAt: "2026-08-18T01:00:00.000Z", submittedAt: null, notification: { status: "failed", errorCode: "send_failed" } },
        ],
        salary: [
          {
            payrollMonth: "2026-08-01",
            baseSalary: 20000,
            bonus: 3000,
            performanceBonus: 1000,
            projectBonus: 1500,
            otherBonus: 500,
            otherIncome: 2000,
            grossSalary: 25000,
            socialBase: 20000,
            housingFundBase: 20000,
            pensionEmployee: 1600,
            medicalEmployee: 402,
            unemploymentEmployee: 100,
            housingFundEmployee: 1400,
            socialSecurity: 3502,
            taxExemptIncome: 0,
            specialAdditionalDeduction: 1000,
            otherStatutoryDeduction: 0,
            taxRelief: 0,
            cumulativeTaxableIncome: 120000,
            individualIncomeTax: 620,
            otherDeduction: 80,
            manualAdjustmentReason: "补扣上月餐费",
            deductions: 4122,
            netSalary: 20878,
            calculationVersion: "cn-resident-cumulative-v1",
            status: "paid",
            paidAt: "2026-08-10T02:00:00.000Z",
          },
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
      expect.objectContaining({ id: "22222222-2222-4222-8222-222222222222", p: "11111111-1111-4111-8111-111111111111", own: "m7", createdBy: "m8", st: "进行中", pri: "P0", ac: "员工可登录", acceptedAt: "2026-08-18T01:00:00.000Z", submittedAt: "", notification: { status: "failed", errorCode: "send_failed" } }),
    ]);
    expect(bootstrap.tasks[0].notification).toEqual({
      status: "failed",
      errorCode: "send_failed",
    });
    expect(JSON.stringify(bootstrap)).not.toMatch(/open_id|tenant_access_token|app_secret/i);
    expect(bootstrap.payroll).toEqual({
      m7: [expect.objectContaining({
        month: "2026-08",
        base: 20000,
        performance: 1000,
        projectBonus: 1500,
        otherBonus: 500,
        otherIncome: 2000,
        grossSalary: 25000,
        pensionEmployee: 1600,
        medicalEmployee: 402,
        unemploymentEmployee: 100,
        housingFundEmployee: 1400,
        social: 3502,
        specialAdditionalDeduction: 1000,
        cumulativeTaxableIncome: 120000,
        tax: 620,
        manualAdjustmentReason: "补扣上月餐费",
        deductions: 4122,
        net: 20878,
        calculationVersion: "cn-resident-cumulative-v1",
      })],
    });
    expect(bootstrap.features).toEqual({ identitySwitch: false, demoReset: false });
  });

  it("uses database compensation grade fields for formal workstation members", () => {
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
          {
            id: 7,
            displayName: "张云帆",
            departmentName: "产品中心",
            jobTitle: "产品经理",
            salaryGradeCode: "P6",
            jobLevel: 6,
            skills: ["prd"],
            salaryPolicy: {
              publicId: "policy-product-p6-l6",
              baseSalary: 42000,
              salaryBandMin: 36000,
              salaryBandMax: 52000,
              performanceWeight: 0.18,
              effectiveFrom: "2026-08-01",
              effectiveTo: null,
              matchedDepartment: true,
            },
          },
          {
            id: 8,
            displayName: "李明",
            departmentName: "研发中心",
            jobTitle: "工程师",
            salaryGradeCode: "P4",
            jobLevel: 4,
            skills: [],
            salaryPolicy: {
              publicId: "policy-engineering-p4-l4",
              baseSalary: 39000,
              salaryBandMin: 33000,
              salaryBandMax: 48000,
              performanceWeight: 0.2,
              effectiveFrom: "2026-08-01",
              effectiveTo: null,
              matchedDepartment: true,
            },
          },
        ],
        projects: [],
        tasks: [],
        salary: [],
      },
    );

    expect(bootstrap.members).toEqual([
      expect.objectContaining({
        id: "m7",
        grade: "P6",
        lv: 6,
        salaryBand: expect.objectContaining({
          source: "server",
          policyId: "policy-product-p6-l6",
          base: 42000,
          min: 36000,
          max: 52000,
          performanceWeight: 0.18,
          matchedDepartment: true,
        }),
      }),
      expect.objectContaining({
        id: "m8",
        grade: "P4",
        lv: 4,
      }),
    ]);
    const colleague = bootstrap.members.find((member) => member.id === "m8");
    expect(colleague && "salaryBand" in colleague).toBe(false);
    expect(JSON.stringify(bootstrap.members)).not.toContain("39000");
  });

  it("maps enterprise agent center definitions and recent invocations for the fused workstation", () => {
    const bootstrap = buildServerBootstrap(
      {
        memberId: 7,
        displayName: "张云帆",
        departmentName: "产品中心",
        jobTitle: "产品经理",
        avatarUrl: null,
        permissionCodes: ["task.manage"],
      },
      {
        members: [
          { id: 7, displayName: "张云帆", departmentName: "产品中心", jobTitle: "产品经理", skills: [] },
        ],
        projects: [],
        tasks: [],
        salary: [],
        agents: [
          {
            id: 91,
            publicId: "33333333-3333-4333-8333-333333333333",
            name: "任务拆解 Agent",
            departmentName: "产品中心",
            icon: "check",
            description: "拆成任务、验收和依赖",
            modelCode: "deepseek-v4-flash",
            promptVersion: "v1",
            capabilities: ["目标拆解", "验收标准"],
            visibilityScope: "all",
            minJobLevel: 1,
            allowedDepartmentNames: [],
            allowedMemberIds: [],
            invocationCount: 12,
            successRate: 98.5,
            status: "enabled",
          },
        ],
        agentInvocations: [
          {
            agentId: 91,
            agentName: "任务拆解 Agent",
            departmentName: "产品中心",
            actorMemberId: 7,
            actorName: "张云帆",
            status: "succeeded",
            latencyMs: 830,
            outputSummary: "已生成 6 个子任务",
            startedAt: "2026-08-25T09:30:00.000Z",
          },
        ],
      },
    );

    expect(bootstrap.agents).toEqual([
      expect.objectContaining({
        id: "33333333-3333-4333-8333-333333333333",
        n: "任务拆解 Agent",
        dept: "产品中心",
        ic: "check",
        model: "deepseek-v4-flash",
        on: 1,
        runs: 12,
        ok: 98.5,
        scope: "all",
        minLv: 1,
        d: "拆成任务、验收和依赖",
        f: [
          { k: "input", n: "输入目标或任务", t: "ta" },
          { k: "context", n: "补充上下文（可选）", t: "ta" },
        ],
        abilities: ["目标拆解", "验收标准"],
        promptVersion: "v1",
      }),
    ]);
    expect(bootstrap.runs).toEqual([
      {
        id: "33333333-3333-4333-8333-333333333333",
        n: "任务拆解 Agent",
        dept: "产品中心",
        by: "张云帆",
        at: "2026-08-25 09:30",
        ok: 1,
        ms: 830,
        out: "已生成 6 个子任务",
      },
    ]);
  });

  it("maps published knowledge documents into the formal knowledge center", () => {
    const bootstrap = buildServerBootstrap(
      {
        memberId: 7,
        displayName: "张云帆",
        departmentName: "产品中心",
        jobTitle: "产品经理",
        avatarUrl: null,
        permissionCodes: ["task.manage"],
      },
      {
        members: [],
        projects: [],
        tasks: [],
        salary: [],
        knowledge: [
          {
            publicId: "55555555-5555-4555-8555-555555555555",
            title: "项目交付验收规范",
            category: "SOP模板",
            summary: "验收标准、交付材料和签字规则",
            tags: ["项目管理", "验收"],
            version: 3,
            publishedAt: "2026-08-22T06:00:00.000Z",
          },
        ],
      },
    );

    expect(bootstrap.kb).toEqual([
      {
        id: "55555555-5555-4555-8555-555555555555",
        n: "项目交付验收规范",
        c: "SOP模板",
        v: "v3",
        l: 14,
        sum: "验收标准、交付材料和签字规则",
        tags: ["项目管理", "验收"],
        publishedAt: "2026-08-22T06:00:00.000Z",
      },
    ]);
  });

  it("exposes recipient failures as unavailable without expanding the public status set", () => {
    const bootstrap = buildServerBootstrap(
      {
        memberId: 7,
        displayName: "张云帆",
        departmentName: "产品中心",
        jobTitle: "产品经理",
        avatarUrl: null,
        permissionCodes: ["task.manage"],
      },
      {
        members: [],
        projects: [],
        tasks: [{
          publicId: "22222222-2222-4222-8222-222222222222",
          projectId: 31,
          title: "完成飞书接入",
          description: "接入企业账号",
          assigneeMemberId: 7,
          reporterMemberId: 8,
          status: "todo",
          priority: "high",
          startDate: null,
          dueDate: null,
          progress: 0,
          acceptanceCriteria: "员工可登录",
          blocker: null,
          reviewNote: null,
          notification: {
            status: "failed",
            errorCode: "recipient_unavailable",
          },
        }],
        salary: [],
      },
    );

    expect(bootstrap.tasks[0].notification).toEqual({
      status: "unavailable",
      errorCode: "recipient_unavailable",
    });
  });

  it("merges verified and self-rated skills with real delivery and workload evidence", () => {
    const bootstrap = buildServerBootstrap(
      {
        memberId: 7,
        displayName: "张云帆",
        departmentName: "产品中心",
        jobTitle: "产品经理",
        avatarUrl: null,
        permissionCodes: ["task.manage"],
      },
      {
        members: [{
          id: 7,
          profileId: 42,
          displayName: "张云帆",
          departmentName: "产品中心",
          jobTitle: "产品经理",
          skills: ["产品规划"],
          verifiedSkills: [{
            name: "需求分析",
            level: 5,
            yearsExperience: 4,
            verified: true,
          }],
          workProfile: {
            summary: "擅长复杂需求拆解",
            preferredTaskTypes: ["需求分析"],
            growthGoals: ["AI产品设计"],
            weeklyCapacityHours: 40,
            selfSkills: [
              { name: "客户访谈", level: 4 },
              { name: "需求分析", level: 3 },
            ],
            updatedAt: "2026-08-21T02:00:00.000Z",
          },
        }] as never,
        projects: [],
        tasks: [
          {
            publicId: "10000000-0000-4000-8000-000000000001",
            projectId: 31,
            title: "进行中任务",
            description: "",
            assigneeMemberId: 7,
            reporterMemberId: 7,
            status: "in_progress",
            priority: "high",
            startDate: "2000-01-01",
            dueDate: "2000-01-02",
            progress: 50,
            acceptanceCriteria: "完成",
            blocker: null,
            reviewNote: null,
            notification: { status: "sent", errorCode: "" },
          },
          {
            publicId: "10000000-0000-4000-8000-000000000002",
            projectId: 31,
            title: "按时完成任务",
            description: "",
            assigneeMemberId: 7,
            reporterMemberId: 7,
            status: "done",
            priority: "medium",
            startDate: "2000-01-01",
            dueDate: "2000-01-10",
            progress: 100,
            acceptanceCriteria: "完成",
            blocker: null,
            reviewNote: null,
            acceptedAt: "2000-01-01T08:00:00.000Z",
            submittedAt: "2000-01-03T08:00:00.000Z",
            reviewedAt: "2000-01-09T08:00:00.000Z",
            submissionCount: 1,
            rejectionCount: 0,
            notification: { status: "sent", errorCode: "" },
          },
          {
            publicId: "10000000-0000-4000-8000-000000000003",
            projectId: 31,
            title: "延期完成任务",
            description: "",
            assigneeMemberId: 7,
            reporterMemberId: 7,
            status: "done",
            priority: "medium",
            startDate: "2000-01-01",
            dueDate: "2000-01-10",
            progress: 100,
            acceptanceCriteria: "完成",
            blocker: null,
            reviewNote: null,
            acceptedAt: "2000-01-01T08:00:00.000Z",
            submittedAt: "2000-01-12T08:00:00.000Z",
            reviewedAt: "2000-01-11T08:00:00.000Z",
            submissionCount: 2,
            rejectionCount: 1,
            notification: { status: "sent", errorCode: "" },
          },
        ],
        salary: [],
      },
    );

    expect(bootstrap.members[0]).toMatchObject({
      sk: "需求分析 · 客户访谈 · 产品规划",
      cap: 0.8,
      workProfile: {
        summary: "擅长复杂需求拆解",
        preferredTaskTypes: ["需求分析"],
        growthGoals: ["AI产品设计"],
        weeklyCapacityHours: 40,
        verifiedSkills: [{
          name: "需求分析",
          level: 5,
          yearsExperience: 4,
          verified: true,
        }],
        selfSkills: [
          { name: "客户访谈", level: 4 },
          { name: "需求分析", level: 3 },
        ],
        activeTaskCount: 1,
        overdueTaskCount: 1,
        completedTaskCount: 2,
        onTimeRate: 50,
        firstPassRate: 50,
        qualityScore: 90,
        efficiencyScore: 101,
        performanceSampleCount: 2,
        workloadPercent: 20,
        updatedAt: "2026-08-21T02:00:00.000Z",
      },
    });
  });
});
