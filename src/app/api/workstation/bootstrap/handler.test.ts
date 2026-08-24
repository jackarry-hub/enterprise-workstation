import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createWorkstationBootstrapHandler,
  defaultWorkstationBootstrapDependencies,
  numericProfileIdForMember,
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

  it("loads visible notification rows through the authenticated client and exposes only safe fields", async () => {
    const members = query({
      data: [{
        id: 42,
        organization_member_id: 7,
        display_name: "张云帆",
        job_title: "产品经理",
        skills: ["prd"],
        department: { name: "产品中心" },
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
    const builders = {
      members,
      projects,
      tasks,
      salary,
      notifications,
      workProfiles,
      employeeSkills,
    };
    const client = {
      from: vi.fn((table: string) => {
        if (table === "employee_profiles") return builders.members;
        if (table === "projects") return builders.projects;
        if (table === "tasks") return builders.tasks;
        if (table === "salary") return builders.salary;
        if (table === "task_notifications") return builders.notifications;
        if (table === "employee_skills") return builders.employeeSkills;
        throw new Error(`unexpected table ${table}`);
      }),
    };
    const serviceClient = {
      from: vi.fn((table: string) => {
        if (table === "employee_work_profiles") return builders.workProfiles;
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
      },
      permissionCodes: ["task.manage"],
    } as never) as {
      members: Array<Record<string, unknown>>;
      tasks: Array<Record<string, unknown>>;
      payroll: Record<string, Array<Record<string, unknown>>>;
    };

    expect(client.from).toHaveBeenCalledWith("task_notifications");
    expect(serviceClient.from).toHaveBeenCalledWith("employee_work_profiles");
    expect(client.from).toHaveBeenCalledWith("employee_skills");
    expect(notifications.select).toHaveBeenCalledWith(
      "task_id, status, last_error_code",
    );
    expect(tasks.select).toHaveBeenCalledWith(expect.stringContaining("id, public_id"));
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
    expect(JSON.stringify(bootstrap)).not.toMatch(
      /task_id|9001|9002|open_id|tenant_access_token|app_secret|raw provider response/i,
    );
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
    const workProfiles = query({ data: [], error: null });
    const employeeSkills = query({ data: [], error: null });
    let salaryCalls = 0;
    const client = {
      from: vi.fn((table: string) => {
        if (table === "employee_profiles") return members;
        if (table === "projects") return projects;
        if (table === "tasks") return tasks;
        if (table === "salary") return salaryCalls++ === 0 ? detailedSalary : legacySalary;
        if (table === "task_notifications") return notifications;
        if (table === "employee_skills") return employeeSkills;
        throw new Error(`unexpected table ${table}`);
      }),
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
});
