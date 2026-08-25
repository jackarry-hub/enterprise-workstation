import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createWorkstationBootstrapHandler,
  defaultWorkstationBootstrapDependencies,
  numericProfileIdForMember,
} from "@/app/api/workstation/bootstrap/handler";
import { getSupabaseServerClient } from "@/lib/supabase/server";

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: vi.fn(),
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
    const salary = query({ data: [], error: null });
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
    const agents = query({
      data: [{
        id: 91,
        public_id: "44444444-4444-4444-8444-444444444444",
        name: "任务拆解 Agent",
        icon: "check",
        description: "拆成任务和验收标准",
        model_code: "deepseek-v4-flash",
        prompt_version: "v1",
        capabilities: ["目标拆解", "验收标准"],
        visibility_scope: "all",
        min_job_level: 1,
        status: "enabled",
        department: { name: "产品中心" },
      }],
      error: null,
    });
    const agentPermissions = query({
      data: [
        {
          agent_id: 91,
          scope_type: "all",
          min_job_level: 1,
          department: null,
          member_id: null,
        },
      ],
      error: null,
    });
    const agentInvocations = query({
      data: [{
        agent_id: 91,
        status: "succeeded",
        latency_ms: 930,
        output_summary: "已生成 4 个任务",
        started_at: "2026-08-25T03:20:00.000Z",
        agent: {
          name: "任务拆解 Agent",
          department: { name: "产品中心" },
        },
        actor: {
          id: 7,
          profile: [{ display_name: "张云帆" }],
        },
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
    const builders = {
      members,
      projects,
      tasks,
      salary,
      notifications,
      workProfiles,
      employeeSkills,
      agents,
      agentPermissions,
      agentInvocations,
      knowledge,
    };
    const client = {
      from: vi.fn((table: string) => {
        if (table === "employee_profiles") return builders.members;
        if (table === "projects") return builders.projects;
        if (table === "tasks") return builders.tasks;
        if (table === "salary") return builders.salary;
        if (table === "task_notifications") return builders.notifications;
        if (table === "employee_work_profiles") return builders.workProfiles;
        if (table === "employee_skills") return builders.employeeSkills;
        if (table === "agent_definitions") return builders.agents;
        if (table === "agent_permissions") return builders.agentPermissions;
        if (table === "agent_invocations") return builders.agentInvocations;
        if (table === "knowledge_documents") return builders.knowledge;
        throw new Error(`unexpected table ${table}`);
      }),
    };
    vi.mocked(getSupabaseServerClient).mockResolvedValue(client as never);

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
    };

    expect(client.from).toHaveBeenCalledWith("task_notifications");
    expect(client.from).toHaveBeenCalledWith("employee_work_profiles");
    expect(client.from).toHaveBeenCalledWith("employee_skills");
    expect(client.from).toHaveBeenCalledWith("agent_definitions");
    expect(client.from).toHaveBeenCalledWith("agent_permissions");
    expect(client.from).toHaveBeenCalledWith("agent_invocations");
    expect(client.from).toHaveBeenCalledWith("knowledge_documents");
    expect(notifications.select).toHaveBeenCalledWith(
      "task_id, status, last_error_code",
    );
    expect(agents.select).toHaveBeenCalledWith(expect.stringContaining("public_id"));
    expect(agentPermissions.select).toHaveBeenCalledWith(expect.stringContaining("scope_type"));
    expect(agentInvocations.select).toHaveBeenCalledWith(expect.stringContaining("output_summary"));
    expect(knowledge.select).toHaveBeenCalledWith(expect.stringContaining("public_id"));
    expect(tasks.select).toHaveBeenCalledWith(expect.stringContaining("id, public_id"));
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
    expect(JSON.stringify(bootstrap)).not.toMatch(
      /task_id|9001|9002|open_id|tenant_access_token|app_secret|raw provider response/i,
    );
  });
});
