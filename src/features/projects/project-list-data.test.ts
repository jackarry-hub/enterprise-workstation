import { afterEach, describe, expect, it, vi } from "vitest";

import {
  loadProjectList,
  type ProjectListClientFactory,
} from "@/features/projects/data/project-list-data";
import { mockProjects } from "@/features/projects/mock-data";

type QueryResponse = { data: unknown; error: Error | null };

function createQuery(response: QueryResponse) {
  const query = {
    select: () => query,
    eq: () => query,
    in: () => query,
    is: () => query,
    order: () => query,
    limit: () => query,
    then: (
      resolve: (value: QueryResponse) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(response).then(resolve, reject),
  };

  return query;
}

describe("loadProjectList", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("falls back to the complete mock portfolio when Supabase is unavailable", async () => {
    const result = await loadProjectList(async () => {
      throw new Error("offline");
    });

    expect(result.source).toBe("mock");
    expect(result.projects).toHaveLength(mockProjects.length);
    expect(result.reminders.length).toBeGreaterThan(0);
  });

  it("does not silently fall back to mock data in production", async () => {
    vi.stubEnv("NODE_ENV", "production");

    await expect(loadProjectList(async () => {
      throw new Error("offline");
    })).rejects.toThrow("offline");
  });

  it("assembles projects, owners, members and milestones from Supabase", async () => {
    const responses: Record<string, QueryResponse> = {
      projects: {
        data: [
          {
            id: 11,
            public_id: "project-real-1",
            organization_id: 1,
            objective_id: 31,
            code: "PRJ-REAL-001",
            name: "客户数据平台",
            owner_member_id: 101,
            status: "active",
            health: "at_risk",
            priority: "high",
            start_date: "2026-08-01",
            due_date: "2026-09-30",
            progress: 46,
          },
          {
            id: 12,
            public_id: "project-real-2",
            organization_id: 1,
            objective_id: null,
            code: "PRJ-REAL-002",
            name: "知识库升级",
            owner_member_id: 102,
            status: "completed",
            health: "on_track",
            priority: "medium",
            start_date: "2026-06-01",
            due_date: "2026-07-31",
            progress: 100,
          },
        ],
        error: null,
      },
      project_members: {
        data: [
          { public_id: "membership-1", project_id: 11, member_id: 101, role: "owner", left_at: null },
          { public_id: "membership-2", project_id: 11, member_id: 102, role: "member", left_at: null },
          { public_id: "membership-3", project_id: 12, member_id: 102, role: "owner", left_at: null },
        ],
        error: null,
      },
      milestones: {
        data: [
          { public_id: "milestone-1", project_id: 11, name: "数据模型确认", due_date: "2026-08-10", status: "in_progress" },
          { public_id: "milestone-2", project_id: 12, name: "正式上线", due_date: "2026-07-31", status: "completed" },
        ],
        error: null,
      },
      objectives: {
        data: [{ id: 31, title: "建设统一客户数据能力" }],
        error: null,
      },
      organization_members: {
        data: [
          { id: 101, public_id: "member-101", user_id: "user-101" },
          { id: 102, public_id: "member-102", user_id: "user-102" },
        ],
        error: null,
      },
      employee_profiles: {
        data: [
          { organization_member_id: 101, display_name: "林远", avatar_url: null, job_title: "项目总监", department: { name: "总经办" } },
          { organization_member_id: 102, display_name: "王芳", avatar_url: null, job_title: "产品经理", department: { name: "产品研发部" } },
        ],
        error: null,
      },
    };
    const factory = (async () => ({
      auth: {
        getUser: async () => ({ data: { user: { id: "user-101" } }, error: null }),
      },
      from: (table: string) => createQuery(responses[table]),
    })) as unknown as ProjectListClientFactory;

    const result = await loadProjectList(factory, { allowMockFallback: false });

    expect(result.source).toBe("supabase");
    expect(result.projects).toHaveLength(2);
    expect(result.projects[0]).toMatchObject({
      id: "project-real-1",
      objectiveTitle: "建设统一客户数据能力",
      memberCount: 2,
      viewerRole: "owner",
      owner: {
        id: "member-101",
        displayName: "林远",
        department: "总经办",
        title: "项目总监",
      },
    });
    expect(result.stats.map(({ value }) => value)).toEqual([2, 1, 1, 1]);
    expect(result.reminders).toEqual([
      {
        id: "milestone-1",
        projectName: "客户数据平台",
        milestoneName: "数据模型确认",
        dueDate: "2026-08-10",
        status: "urgent",
      },
    ]);
  });
});
