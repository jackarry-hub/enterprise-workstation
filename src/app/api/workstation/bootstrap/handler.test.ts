import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createWorkstationBootstrapHandler,
  defaultWorkstationBootstrapDependencies,
  matchSalaryPolicy,
  numericProfileIdForMember,
  parseNullableNumber,
  shanghaiBusinessDate,
} from "@/app/api/workstation/bootstrap/handler";
import {
  getSupabaseServerClient,
  getSupabaseServiceRoleClient,
} from "@/lib/supabase/server";

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: vi.fn(),
  getSupabaseServiceRoleClient: vi.fn(),
}));

function query(result: { data: unknown[]; error: unknown }) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    then: <TResult1 = typeof result, TResult2 = never>(
      onfulfilled?: ((value: typeof result) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) => Promise.resolve(result).then(onfulfilled, onrejected),
  };
  return builder;
}

describe("workstation bootstrap route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves salary by the numeric employee profile row, not the public UUID", () => {
    expect(numericProfileIdForMember([
      { id: 41, organization_member_id: 6 },
      { id: 42, organization_member_id: 7 },
    ], 7)).toBe(42);
  });

  it("preserves nullable compensation numbers instead of converting absence into zero", () => {
    expect(parseNullableNumber(null)).toBeNull();
    expect(parseNullableNumber(undefined)).toBeNull();
    expect(parseNullableNumber("")).toBeNull();
    expect(parseNullableNumber("  ")).toBeNull();
    expect(parseNullableNumber("not-a-number")).toBeNull();
    expect(parseNullableNumber(false)).toBeNull();
    expect(parseNullableNumber(0)).toBe(0);
    expect(parseNullableNumber("0")).toBe(0);
  });

  it("matches the exact job family, department and fixed effective date", () => {
    const policies = [
      {
        publicId: "organization-wide-engineering",
        departmentId: null,
        jobFamily: "engineering",
        salaryGradeCode: "P6",
        jobLevel: 20,
        baseSalary: 61000,
        salaryBandMin: 56000,
        salaryBandMax: 70000,
        performanceWeight: 0.2,
        effectiveFrom: "2026-08-01",
        effectiveTo: null,
      },
      {
        publicId: "department-engineering",
        departmentId: 21,
        jobFamily: "engineering",
        salaryGradeCode: "P6",
        jobLevel: 20,
        baseSalary: 66000,
        salaryBandMin: 60000,
        salaryBandMax: 74000,
        performanceWeight: 0.2,
        effectiveFrom: "2026-08-15",
        effectiveTo: null,
      },
      {
        publicId: "product-family-only",
        departmentId: 21,
        jobFamily: "product",
        salaryGradeCode: "P6",
        jobLevel: 20,
        baseSalary: 88000,
        salaryBandMin: 82000,
        salaryBandMax: 93000,
        performanceWeight: 0.2,
        effectiveFrom: "2026-08-01",
        effectiveTo: null,
      },
    ];
    const subject = {
      policies,
      departmentId: 21,
      jobFamily: "engineering",
      gradeCode: "P6",
      jobLevel: 20,
      effectiveOn: shanghaiBusinessDate(new Date("2026-08-25T16:00:00.000Z")),
    };

    expect(matchSalaryPolicy(subject)).toMatchObject({
      publicId: "department-engineering",
      jobFamily: "engineering",
      baseSalary: 66000,
    });
    expect(matchSalaryPolicy({ ...subject, jobFamily: "product" })?.jobFamily).toBe("product");
    expect(matchSalaryPolicy({ ...subject, jobLevel: 19 })).toBeNull();
    expect(matchSalaryPolicy({ ...subject, effectiveOn: "2026-07-31" })).toBeNull();
  });

  it("uses the Asia/Shanghai business day at the UTC midnight boundary", () => {
    expect(shanghaiBusinessDate(new Date("2026-08-25T15:59:59.999Z"))).toBe("2026-08-25");
    expect(shanghaiBusinessDate(new Date("2026-08-25T16:00:00.000Z"))).toBe("2026-08-26");
  });

  it("rejects an unauthenticated browser", async () => {
    const response = await createWorkstationBootstrapHandler({
      loadSession: async () => null,
      loadBootstrap: async () => {
        throw new Error("must not load");
      },
    })();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
  });

  it("returns the authenticated employee bootstrap without demo data", async () => {
    const expected = { session: { authenticated: true }, features: { identitySwitch: false } };
    const response = await createWorkstationBootstrapHandler({
      loadSession: async () => ({ member: { id: 7 } }),
      loadBootstrap: async () => expected,
    })();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(expected);
  });

  it("returns the logged fatal request ID with a stable safe code and no database detail", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let loggedRequestId = "";
    const response = await createWorkstationBootstrapHandler({
      loadSession: async () => ({ member: { id: 7 } }),
      loadBootstrap: async (_session, requestId) => {
        loggedRequestId = requestId ?? "";
        throw Object.assign(new Error("database detail must not escape"), {
          queryName: "employee_profiles",
          requestId,
          diagnostic: { errorCode: "42P01", errorType: "PostgrestError" },
        });
      },
    })();

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({
      error: "workstation_unavailable",
      code: "workstation_bootstrap_failed",
      requestId: loggedRequestId,
    });
    expect(error).toHaveBeenCalledWith(
      "workstation_bootstrap_failed",
      expect.objectContaining({
        requestId: loggedRequestId,
        query: "employee_profiles",
        errorCode: "42P01",
        errorType: "PostgrestError",
      }),
    );
    expect(JSON.stringify(body)).not.toContain("database detail must not escape");
    error.mockRestore();
  });

  it("loads visible notification rows through the authenticated client and exposes only safe fields", async () => {
    const members = query({
      data: [{
        id: 42,
        tenant_id: 2,
        organization_id: 3,
        organization_member_id: 7,
        display_name: "张云帆",
        job_title: "产品经理",
        department_id: 21,
        position_template_id: 51,
        skills: ["prd"],
        department: { name: "产品中心" },
      }, {
        id: 43,
        organization_member_id: 8,
        display_name: "李明",
        job_title: "算法工程师",
        department_id: 22,
        position_template_id: 52,
        skills: ["typescript"],
        department: { name: "研发中心" },
      }],
      error: null,
    });
    const projects = query({
      data: [{
        id: 31,
        public_id: "11111111-1111-4111-8111-111111111111",
        name: "企业工作站",
        owner_member_id: 7,
        status: "active",
        health: "on_track",
        progress: 45,
        priority: "high",
        updated_at: "2026-08-18T08:00:00.000Z",
      }],
      error: null,
    });
    const tasks = query({
      data: [
        {
          id: 9001,
          public_id: "22222222-2222-4222-8222-222222222222",
          project_id: 31,
          title: "通知失败任务",
          description: "安全映射",
          assignee_member_id: 7,
          reporter_member_id: 7,
          status: "todo",
          priority: "high",
          start_date: null,
          due_date: "2026-08-25",
          progress: 0,
          acceptance_criteria: "只暴露稳定状态",
          blocker: null,
          review_note: null,
          next_step: null,
          result_summary: null,
          result_link: null,
          result_files: [],
          accepted_at: null,
          submitted_at: null,
          reviewed_at: null,
          completed_at: null,
          version: 2,
          created_at: "2026-08-18T01:00:00.000Z",
          updated_at: "2026-08-18T02:00:00.000Z",
        },
        {
          id: 9002,
          public_id: "33333333-3333-4333-8333-333333333333",
          project_id: 31,
          title: "缺少队列行任务",
          description: "安全默认值",
          assignee_member_id: 7,
          reporter_member_id: 7,
          status: "todo",
          priority: "medium",
          start_date: null,
          due_date: null,
          progress: 0,
          acceptance_criteria: "默认不可用",
          blocker: null,
          review_note: null,
          next_step: null,
          result_summary: null,
          result_link: null,
          result_files: [],
          accepted_at: null,
          submitted_at: null,
          reviewed_at: null,
          completed_at: null,
          version: 1,
          created_at: "2026-08-18T01:00:00.000Z",
          updated_at: "2026-08-18T01:00:00.000Z",
        },
      ],
      error: null,
    });
    const salary = query({
      data: [{
        payroll_month: "2026-08-01",
        base_salary: 20000,
        bonus: 5000,
        performance_bonus: 1000,
        project_bonus: 2000,
        other_bonus: 2000,
        other_income: 0,
        gross_salary: 25000,
        social_base: 20000,
        housing_fund_base: 20000,
        pension_employee: 1600,
        medical_employee: 403,
        unemployment_employee: 100,
        housing_fund_employee: 1400,
        social_security: 3503,
        tax_exempt_income: 0,
        special_additional_deduction: 0,
        other_statutory_deduction: 0,
        tax_relief: 0,
        cumulative_taxable_income: 120000,
        individual_income_tax: 620,
        other_deduction: 80,
        manual_adjustment_reason: "补扣上月餐费",
        deductions: 4123,
        net_salary: 20877,
        calculation_version: "cn-cumulative-withholding-v1",
        status: "processing",
        paid_at: null,
      }],
      error: null,
    });
    const notifications = query({
      data: [{
        task_id: 9001,
        status: "failed",
        last_error_code: "send_failed",
        recipient_open_id: "ou_internal_secret",
        tenant_access_token: "tenant-token-secret",
        app_secret: "app-secret-value",
        provider_error: "raw provider response",
      }],
      error: null,
    });
    const workProfiles = query({
      data: [{
        employee_profile_id: 42,
        summary: "擅长需求拆解",
        preferred_task_types: ["需求分析"],
        growth_goals: ["AI产品设计"],
        weekly_capacity_hours: 36,
        self_skills: [{ name: "客户访谈", level: 4 }],
        updated_at: "2026-08-21T02:00:00.000Z",
      }],
      error: null,
    });
    const departments = query({
      data: [{ id: 21, name: "产品中心" }],
      error: null,
    });
    const selfSalaryPolicy = query({
      data: [{
        public_id: "66666666-6666-4666-8666-666666666666",
        department_id: 21,
        job_family: "product",
        salary_grade_code: "P6",
        job_level: 6,
        base_salary: 42000,
        salary_band_min: 36000,
        salary_band_max: 52000,
        performance_weight: 0.18,
        effective_from: "2026-08-01",
        effective_to: null,
      }],
      error: null,
    });
    const currentSalaryClassification = query({
      data: [{
        organization_member_id: 7,
        salary_grade_code: "P6",
        job_level: 6,
      }],
      error: null,
    });
    const employeeSkills = query({
      data: [{
        employee_profile_id: 42,
        proficiency_level: 5,
        years_experience: 4,
        verification_status: "verified",
        skill: { name: "需求分析" },
      }],
      error: null,
    });
    const agents = query({
      data: [{
        id: 91,
        public_id: "44444444-4444-4444-8444-444444444444",
        name: "任务拆解 Agent",
        icon: "check",
        description: "拆成任务和验收标准",
        model_code: "deepseek-v4-flash",
        prompt_version: "v1",
        system_prompt: " ",
        tool_scope: { tools: ["task.read"] },
        capabilities: ["目标拆解", "验收标准"],
        visibility_scope: "all",
        min_job_level: 1,
        status: "enabled",
        department_id: 21,
      }],
      error: null,
    });
    const agentPermissions = query({
      data: [
        {
          agent_id: 91,
          scope_type: "all",
          min_job_level: 1,
          department_id: null,
          member_id: null,
        },
      ],
      error: null,
    });
    const agentInvocations = query({
      data: [{
        agent_id: 91,
        actor_member_id: 7,
        status: "succeeded",
        latency_ms: 930,
        output_summary: "已生成 4 个任务",
        started_at: "2026-08-25T03:20:00.000Z",
      }],
      error: null,
    });
    const knowledge = query({
      data: [{
        public_id: "55555555-5555-4555-8555-555555555555",
        title: "项目交付验收规范",
        summary: "验收标准、交付材料和签字规则",
        category: "SOP模板",
        tags: ["项目管理"],
        version: 3,
        published_at: "2026-08-22T06:00:00.000Z",
      }],
      error: null,
    });
    const acceptanceHistory = query({ data: [], error: null });
    const builders = {
      members,
      projects,
      tasks,
      salary,
      notifications,
      workProfiles,
      departments,
      selfSalaryPolicy,
      currentSalaryClassification,
      employeeSkills,
      agents,
      agentPermissions,
      agentInvocations,
      knowledge,
      acceptanceHistory,
    };
    const client = {
      from: vi.fn((table: string) => {
        if (table === "employee_profiles") return builders.members;
        if (table === "projects") return builders.projects;
        if (table === "tasks") return builders.tasks;
        if (table === "salary") return builders.salary;
        if (table === "task_notifications") return builders.notifications;
        if (table === "task_acceptance_events") return builders.acceptanceHistory;
        if (table === "departments") return builders.departments;
        if (table === "employee_skills") return builders.employeeSkills;
        if (table === "agent_permissions") return builders.agentPermissions;
        if (table === "agent_invocations") return builders.agentInvocations;
        if (table === "knowledge_documents") return builders.knowledge;
        throw new Error(`unexpected table ${table}`);
      }),
      rpc: vi.fn((name: string) => {
        if (name === "current_employee_salary_classification") {
          return builders.currentSalaryClassification;
        }
        if (name === "current_salary_grade_policy") return builders.selfSalaryPolicy;
        throw new Error(`unexpected rpc ${name}`);
      }),
    };
    const serviceClient = {
      from: vi.fn((table: string) => {
        if (table === "employee_work_profiles") return builders.workProfiles;
        if (table === "agent_definitions") return builders.agents;
        throw new Error(`unexpected service table ${table}`);
      }),
    };
    vi.mocked(getSupabaseServerClient).mockResolvedValue(client as never);
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(serviceClient as never);

    const bootstrap = await defaultWorkstationBootstrapDependencies.loadBootstrap({
      member: { id: 7 },
      profile: {
        displayName: "张云帆",
        departmentName: "产品中心",
        jobTitle: "产品经理",
        avatarUrl: null,
        jobLevel: 6,
      },
      permissionCodes: ["task.manage", "salary.self"],
      roleCodes: ["employee"],
    } as never) as {
      members: Array<Record<string, unknown>>;
      tasks: Array<Record<string, unknown>>;
      payroll: Record<string, Array<Record<string, unknown>>>;
      agents: Array<Record<string, unknown>>;
    };

    expect(client.from).toHaveBeenCalledWith("task_notifications");
    expect(client.from).toHaveBeenCalledWith("departments");
    expect(serviceClient.from).toHaveBeenCalledWith("employee_work_profiles");
    expect(client.rpc).toHaveBeenCalledWith("current_employee_salary_classification");
    expect(client.rpc).toHaveBeenCalledWith("current_salary_grade_policy");
    expect(members.select).toHaveBeenCalledWith(
      expect.not.stringContaining("salary_grade_code"),
    );
    expect(members.select).toHaveBeenCalledWith(
      expect.not.stringContaining("job_level"),
    );
    expect(client.from).toHaveBeenCalledWith("employee_skills");
    expect(serviceClient.from).toHaveBeenCalledWith("agent_definitions");
    expect(client.from).toHaveBeenCalledWith("agent_permissions");
    expect(client.from).toHaveBeenCalledWith("agent_invocations");
    expect(client.from).toHaveBeenCalledWith("knowledge_documents");
    expect(notifications.select).toHaveBeenCalledWith(
      "task_id, status, last_error_code",
    );
    expect(agents.select).toHaveBeenCalledWith(expect.stringContaining("system_prompt"));
    expect(agents.eq).toHaveBeenCalledWith("tenant_id", 2);
    expect(agents.eq).toHaveBeenCalledWith("organization_id", 3);
    expect(agents.select).not.toHaveBeenCalledWith(expect.stringContaining("department:"));
    expect(agentPermissions.select).toHaveBeenCalledWith(expect.stringContaining("scope_type"));
    expect(agentPermissions.select).toHaveBeenCalledWith(expect.stringContaining("department_id"));
    expect(agentInvocations.select).toHaveBeenCalledWith(expect.stringContaining("output_summary"));
    expect(agentInvocations.select).toHaveBeenCalledWith(expect.stringContaining("actor_member_id"));
    expect(agentInvocations.select).not.toHaveBeenCalledWith(expect.stringContaining("agent:"));
    expect(client.from).not.toHaveBeenCalledWith("salary_grade_policies");
    expect(knowledge.select).toHaveBeenCalledWith(expect.stringContaining("public_id"));
    expect(tasks.select).toHaveBeenCalledWith(expect.stringContaining("id, public_id"));
    expect(tasks.select).toHaveBeenCalledWith(expect.stringContaining("version, created_at, updated_at"));
    expect(salary.select).toHaveBeenCalledWith(
      expect.stringContaining("calculation_version"),
    );
    expect(bootstrap.payroll.m7[0]).toMatchObject({
      month: "2026-08",
      grossSalary: 25000,
      pensionEmployee: 1600,
      medicalEmployee: 403,
      unemploymentEmployee: 100,
      housingFundEmployee: 1400,
      social: 3503,
      cumulativeTaxableIncome: 120000,
      tax: 620,
      manualAdjustmentReason: "补扣上月餐费",
      net: 20877,
      calculationVersion: "cn-cumulative-withholding-v1",
    });
    expect(bootstrap.tasks[0].notification).toEqual({
      status: "failed",
      errorCode: "send_failed",
    });
    expect(bootstrap.tasks[0].version).toBe(2);
    expect(bootstrap.tasks[1].notification).toEqual({
      status: "unavailable",
      errorCode: "recipient_unavailable",
    });
    expect(bootstrap.members[0].workProfile).toMatchObject({
      summary: "擅长需求拆解",
      preferredTaskTypes: ["需求分析"],
      growthGoals: ["AI产品设计"],
      weeklyCapacityHours: 36,
      verifiedSkills: [{
        name: "需求分析",
        level: 5,
        yearsExperience: 4,
        verified: true,
      }],
      selfSkills: [{ name: "客户访谈", level: 4 }],
    });
    expect(bootstrap.members[0]).toMatchObject({
      grade: "P6",
      lv: 6,
      salaryBand: expect.objectContaining({
        source: "server",
        policyId: "66666666-6666-4666-8666-666666666666",
        base: 42000,
        min: 36000,
        max: 52000,
        performanceWeight: 0.18,
        matchedDepartment: true,
      }),
    });
    const colleague = bootstrap.members.find((member) => member.id === "m8");
    expect(colleague && "grade" in colleague).toBe(false);
    expect(colleague && "lv" in colleague).toBe(false);
    expect(colleague?.salaryBand).toBeUndefined();
    expect(JSON.stringify(colleague)).not.toMatch(/P6|39000|33000|48000/);
    expect(bootstrap).toMatchObject({
      agents: [
        expect.objectContaining({
          n: "任务拆解 Agent",
          dept: "产品中心",
          runs: 1,
          ok: 100,
        }),
      ],
      runs: [
        expect.objectContaining({
          n: "任务拆解 Agent",
          by: "张云帆",
          out: "已生成 4 个任务",
        }),
      ],
      kb: [
        expect.objectContaining({
          n: "项目交付验收规范",
          c: "SOP模板",
          v: "v3",
        }),
      ],
    });
    expect(bootstrap.agents[0]).toMatchObject({
      canInvoke: false,
      denialReason: "agent_not_configured",
    });
    expect(JSON.stringify(bootstrap)).not.toMatch(
      /task_id|9001|9002|open_id|tenant_access_token|app_secret|raw provider response/i,
    );
  });

  it("keeps department-head Agent access aligned with server authorization without salary permission", async () => {
    const members = query({
      data: [{
        id: 42,
        tenant_id: 2,
        organization_id: 3,
        organization_member_id: 7,
        display_name: "部门负责人",
        job_title: "研发负责人",
        department_id: 21,
        position_template_id: 51,
        skills: [],
        department: { name: "研发中心" },
      }],
      error: null,
    });
    const classifications = query({ data: [], error: null });
    const empty = query({ data: [], error: null });
    const agents = query({
      data: [{
        id: 91,
        public_id: "44444444-4444-4444-8444-444444444444",
        name: "研发 Agent",
        icon: "bot",
        description: "研发部门可调用",
        model_code: "deepseek-chat",
        prompt_version: "v1",
        system_prompt: "Use server-owned context only.",
        tool_scope: { tools: ["task.read"] },
        capabilities: ["任务检索"],
        visibility_scope: "department",
        min_job_level: 6,
        status: "enabled",
        department_id: 21,
      }],
      error: null,
    });
    const agentPermissions = query({
      data: [{
        agent_id: 91,
        scope_type: "dept",
        min_job_level: 6,
        department_id: 21,
        role_code: null,
        member_id: null,
      }],
      error: null,
    });
    const client = {
      from: vi.fn((table: string) => {
        if (table === "employee_profiles") return members;
        if (table === "agent_permissions") return agentPermissions;
        return empty;
      }),
      rpc: vi.fn((name: string) => {
        if (name === "current_employee_salary_classification") return classifications;
        if (name === "current_salary_grade_policy") return empty;
        throw new Error(`unexpected rpc ${name}`);
      }),
    };
    const serviceClient = {
      from: vi.fn((table: string) => {
        if (table === "agent_definitions") return agents;
        return empty;
      }),
    };
    vi.mocked(getSupabaseServerClient).mockResolvedValue(client as never);
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(serviceClient as never);

    const bootstrap = await defaultWorkstationBootstrapDependencies.loadBootstrap({
      member: { id: 7 },
      profile: {
        displayName: "部门负责人",
        departmentName: "研发中心",
        jobTitle: "研发负责人",
        avatarUrl: null,
        jobLevel: 8,
      },
      permissionCodes: ["task.manage"],
      roleCodes: ["department_head"],
    } as never) as { agents: Array<Record<string, unknown>>; members: Array<Record<string, unknown>> };

    expect(client.rpc).toHaveBeenCalledWith("current_employee_salary_classification");
    expect(bootstrap.agents[0]).toMatchObject({ canInvoke: true, denialReason: "" });
    expect(bootstrap.members[0]).not.toHaveProperty("grade");
    expect(bootstrap.members[0]).not.toHaveProperty("lv");
  });

  it("uses the manager-only classification RPC before exposing managed member classifications", async () => {
    const members = query({
      data: [
        {
          id: 42,
          tenant_id: 2,
          organization_id: 3,
          organization_member_id: 7,
          display_name: "薪酬经理",
          job_title: "薪酬经理",
          department_id: 21,
          position_template_id: 51,
          skills: [],
          department: { name: "产品中心" },
        },
        {
          id: 43,
          tenant_id: 2,
          organization_id: 3,
          organization_member_id: 8,
          display_name: "普通同事",
          job_title: "工程师",
          department_id: 22,
          position_template_id: 52,
          skills: [],
          department: { name: "研发中心" },
        },
      ],
      error: null,
    });
    const classifications = query({
      data: [
        { organization_member_id: 7, salary_grade_code: "M4", job_level: 12 },
        { organization_member_id: 8, salary_grade_code: "P4", job_level: 4 },
      ],
      error: null,
    });
    const empty = query({ data: [], error: null });
    const client = {
      from: vi.fn((table: string) => table === "employee_profiles" ? members : empty),
      rpc: vi.fn((name: string) => {
        if (name === "managed_employee_salary_classifications") return classifications;
        throw new Error(`unexpected rpc ${name}`);
      }),
    };
    const serviceClient = { from: vi.fn(() => empty) };
    vi.mocked(getSupabaseServerClient).mockResolvedValue(client as never);
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(serviceClient as never);

    const bootstrap = await defaultWorkstationBootstrapDependencies.loadBootstrap({
      member: { id: 7 },
      profile: {
        displayName: "薪酬经理",
        departmentName: "产品中心",
        jobTitle: "薪酬经理",
        avatarUrl: null,
      },
      permissionCodes: ["salary.manage"],
      roleCodes: ["finance"],
    } as never) as { members: Array<Record<string, unknown>> };

    expect(client.rpc).toHaveBeenCalledWith("managed_employee_salary_classifications");
    expect(members.select).toHaveBeenCalledWith(
      expect.not.stringContaining("salary_grade_code"),
    );
    expect(bootstrap.members).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "m7", grade: "M4", lv: 12 }),
      expect.objectContaining({ id: "m8", grade: "P4", lv: 4 }),
    ]));
  });

  it("falls back to legacy salary columns when payroll calculation migration is not applied", async () => {
    const members = query({
      data: [{
        id: 42,
        organization_member_id: 7,
        display_name: "Legacy User",
        job_title: "Product Manager",
        skills: [],
        department: { name: "Product" },
      }],
      error: null,
    });
    const projects = query({ data: [], error: null });
    const tasks = query({ data: [], error: null });
    const detailedSalary = query({
      data: [],
      error: {
        code: "42703",
        message: "column salary.calculation_version does not exist",
      },
    });
    const legacySalary = query({
      data: [{
        payroll_month: "2026-08-01",
        base_salary: 4000,
        bonus: 0,
        social_security: 0,
        individual_income_tax: 0,
        other_deduction: 0,
        deductions: 0,
        net_salary: 4000,
        status: "paid",
        paid_at: null,
      }],
      error: null,
    });
    const notifications = query({ data: [], error: null });
    const acceptanceHistory = query({ data: [], error: null });
    const workProfiles = query({ data: [], error: null });
    const departments = query({ data: [], error: null });
    const salaryGradePolicies = query({ data: [], error: null });
    const employeeSkills = query({ data: [], error: null });
    const agents = query({ data: [], error: null });
    const agentPermissions = query({ data: [], error: null });
    const agentInvocations = query({ data: [], error: null });
    const knowledge = query({ data: [], error: null });
    let salaryCalls = 0;
    const client = {
      from: vi.fn((table: string) => {
        if (table === "employee_profiles") return members;
        if (table === "projects") return projects;
        if (table === "tasks") return tasks;
        if (table === "salary") return salaryCalls++ === 0 ? detailedSalary : legacySalary;
        if (table === "task_notifications") return notifications;
        if (table === "task_acceptance_events") return acceptanceHistory;
        if (table === "departments") return departments;
        if (table === "salary_grade_policies") return salaryGradePolicies;
        if (table === "employee_skills") return employeeSkills;
        if (table === "agent_definitions") return agents;
        if (table === "agent_permissions") return agentPermissions;
        if (table === "agent_invocations") return agentInvocations;
        if (table === "knowledge_documents") return knowledge;
        throw new Error(`unexpected table ${table}`);
      }),
      rpc: vi.fn(() => query({ data: [], error: null })),
    };
    const serviceClient = {
      from: vi.fn((table: string) => {
        if (table === "employee_work_profiles") return workProfiles;
        throw new Error(`unexpected service table ${table}`);
      }),
    };
    vi.mocked(getSupabaseServerClient).mockResolvedValue(client as never);
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(serviceClient as never);

    const bootstrap = await defaultWorkstationBootstrapDependencies.loadBootstrap({
      member: { id: 7 },
      profile: {
        displayName: "Legacy User",
        departmentName: "Product",
        jobTitle: "Product Manager",
        avatarUrl: null,
      },
      permissionCodes: ["salary.self"],
    } as never) as {
      payroll: Record<string, Array<Record<string, unknown>>>;
    };

    expect(detailedSalary.select).toHaveBeenCalledWith(
      expect.stringContaining("calculation_version"),
    );
    expect(legacySalary.select).toHaveBeenCalledWith(
      "payroll_month, base_salary, bonus, social_security, individual_income_tax, other_deduction, deductions, net_salary, status, paid_at",
    );
    expect(bootstrap.payroll.m7[0]).toMatchObject({
      month: "2026-08",
      gross: 4000,
      deductions: 0,
      net: 4000,
      calculationVersion: "",
    });
  });

  it("correlates optional and synthetic Agent failures with the request bootstrap ID", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const members = query({
      data: [{
        id: 42,
        tenant_id: null,
        organization_id: null,
        organization_member_id: 7,
        display_name: "无 Agent 上下文的员工",
        job_title: "产品经理",
        department_id: 21,
        position_template_id: 51,
        skills: [],
        department: { name: "产品中心" },
      }],
      error: null,
    });
    const failing = query({
      data: null as never,
      error: { code: "42P01", message: "relation must not reach client or log" },
    });
    const client = {
      from: vi.fn((table: string) => table === "employee_profiles" ? members : failing),
      rpc: vi.fn(() => failing),
    };
    vi.mocked(getSupabaseServerClient).mockResolvedValue(client as never);
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue({ from: vi.fn(() => failing) } as never);
    const requestId = "a1111111-1111-4111-8111-111111111119";

    const bootstrap = await defaultWorkstationBootstrapDependencies.loadBootstrap({
      member: { id: 7 },
      profile: {
        displayName: "无 Agent 上下文的员工",
        departmentName: "产品中心",
        jobTitle: "产品经理",
        avatarUrl: null,
        jobLevel: 6,
      },
      permissionCodes: ["task.manage"],
      roleCodes: ["employee"],
    } as never, requestId) as {
      moduleErrors: Record<string, { code: string; requestId: string }>;
    };

    expect(bootstrap.moduleErrors.agents).toEqual({
      code: "workstation_module_unavailable",
      requestId,
    });
    expect(Object.values(bootstrap.moduleErrors).every((error) => error.requestId === requestId)).toBe(true);
    expect(warn).toHaveBeenCalledWith(
      "workstation_bootstrap_optional_query_failed",
      expect.objectContaining({ query: "projects", requestId }),
    );
    expect(warn).toHaveBeenCalledWith(
      "workstation_bootstrap_optional_query_failed",
      expect.objectContaining({ query: "agent_definitions", requestId, reason: "agent_context_unavailable" }),
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain("relation must not reach client or log");
    warn.mockRestore();
  });

  it("keeps the authenticated workstation available when non-identity modules fail", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const members = query({
      data: [{
        id: 42,
        organization_member_id: 7,
        display_name: "商用用户",
        job_title: "项目经理",
        salary_grade_code: "P4",
        job_level: 4,
        skills: [],
        department: { name: "产品中心" },
      }],
      error: null,
    });
    const failing = query({
      data: null as never,
      error: {
        code: "42P01",
        message: "relation does not exist",
      },
    });
    const client = {
      from: vi.fn((table: string) => {
        if (table === "employee_profiles") return members;
        return failing;
      }),
      rpc: vi.fn(() => failing),
    };
    const serviceClient = {
      from: vi.fn(() => failing),
    };
    vi.mocked(getSupabaseServerClient).mockResolvedValue(client as never);
    vi.mocked(getSupabaseServiceRoleClient).mockReturnValue(serviceClient as never);

    const bootstrap = await defaultWorkstationBootstrapDependencies.loadBootstrap({
      member: { id: 7 },
      profile: {
        displayName: "商用用户",
        departmentName: "产品中心",
        jobTitle: "项目经理",
        avatarUrl: null,
      },
      permissionCodes: ["task.manage"],
    } as never) as {
      session: { authenticated: boolean };
      members: unknown[];
      projects: unknown[];
      tasks: unknown[];
      payroll: Record<string, unknown[]>;
      agents: unknown[];
      kb: unknown[];
      moduleErrors: Record<string, { code: string; requestId: string }>;
    };

    expect(bootstrap.session.authenticated).toBe(true);
    expect(bootstrap.members).toHaveLength(1);
    expect(bootstrap.projects).toEqual([]);
    expect(bootstrap.tasks).toEqual([]);
    expect(bootstrap.payroll.m7).toEqual([]);
    expect(bootstrap.agents).toEqual([]);
    expect(bootstrap.kb).toEqual([]);
    expect(bootstrap.moduleErrors).toEqual({
      agents: expect.objectContaining({ code: "workstation_module_unavailable" }),
      directory: expect.objectContaining({ code: "workstation_module_unavailable" }),
      knowledge: expect.objectContaining({ code: "workstation_module_unavailable" }),
      projects: expect.objectContaining({ code: "workstation_module_unavailable" }),
      salary: expect.objectContaining({ code: "workstation_module_unavailable" }),
      tasks: expect.objectContaining({ code: "workstation_module_unavailable" }),
    });
    const requestIds = Object.values(bootstrap.moduleErrors).map((error) => error.requestId);
    expect(requestIds).toHaveLength(6);
    expect(new Set(requestIds).size).toBe(1);
    expect(requestIds[0]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(warn).toHaveBeenCalledWith(
      "workstation_bootstrap_optional_query_failed",
      expect.objectContaining({ query: "projects" }),
    );
    warn.mockRestore();
  });
});
