import { afterEach, describe, expect, it, vi } from "vitest";

import {
  loadProjectDetail,
  type ProjectDetailClientFactory,
} from "@/features/projects/data/project-detail-data";
import { mockProjects } from "@/features/projects/mock-data";

function createQuery(response: { data: unknown; error: null }) {
  const query = {
    select: () => query,
    eq: () => query,
    in: () => query,
    is: () => query,
    order: () => query,
    limit: () => query,
    maybeSingle: async () => response,
    then: (
      resolve: (value: typeof response) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(response).then(resolve, reject),
  };

  return query;
}

describe("loadProjectDetail", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("falls back to the matching mock project when Supabase is unavailable", async () => {
    const result = await loadProjectDetail(
      mockProjects[0].id,
      async () => {
        throw new Error("Supabase configuration missing");
      },
      { allowMockFallback: true },
    );

    expect(result?.source).toBe("mock");
    expect(result?.detail.project.id).toBe("40000000-0000-4000-8000-000000000001");
    expect(result?.detail.owner.displayName).toBe("张伟");
  });

  it("does not substitute another mock project for an unknown id", async () => {
    const result = await loadProjectDetail(
      "unknown-project",
      async () => {
        throw new Error("offline");
      },
      { allowMockFallback: true },
    );

    expect(result).toBeUndefined();
  });

  it("falls back to mock data when a configured Supabase request fails", async () => {
    const result = await loadProjectDetail(
      mockProjects[0].id,
      async () => {
        throw new Error("permission denied");
      },
    );

    expect(result?.source).toBe("mock");
    expect(result?.detail.project.id).toBe(mockProjects[0].id);
  });

  it("does not silently fall back to mock data in production", async () => {
    vi.stubEnv("NODE_ENV", "production");

    await expect(loadProjectDetail(
      mockProjects[0].id,
      async () => {
        throw new Error("permission denied");
      },
    )).rejects.toThrow("permission denied");
  });

  it("uses employee profiles for Supabase-backed project members", async () => {
    const responses: Record<string, { data: unknown; error: null }> = {
      projects: {
        data: {
          id: 91,
          public_id: mockProjects[0].id,
          organization_id: 1,
          objective_id: null,
          code: "PRJ-REAL-001",
          name: "真实项目",
          description: "来自 Supabase 的项目数据",
          owner_member_id: 902,
          created_by_member_id: 902,
          status: "active",
          health: "healthy",
          priority: "high",
          start_date: "2026-08-01",
          due_date: "2026-09-01",
          actual_end_date: null,
          progress: 20,
          created_at: "2026-08-01T00:00:00.000Z",
          updated_at: "2026-08-01T00:00:00.000Z",
        },
        error: null,
      },
      project_members: {
        data: [{
          id: 7,
          public_id: "membership-real-owner",
          organization_id: 1,
          project_id: 91,
          member_id: 902,
          role: "owner",
          allocation_percent: 100,
          joined_at: "2026-08-01T00:00:00.000Z",
          left_at: null,
        }],
        error: null,
      },
      organization_members: {
        data: [{
          id: 902,
          public_id: "member-real-owner",
          user_id: "user-real-owner",
        }],
        error: null,
      },
      employee_profiles: {
        data: [{
          public_id: "employee-real-owner",
          organization_member_id: 902,
          display_name: "周岚",
          avatar_url: "https://example.com/avatar.png",
          job_title: "项目总监",
          department: { name: "技术研发部" },
        }],
        error: null,
      },
      milestones: { data: [], error: null },
      tasks: { data: [], error: null },
      project_activities: { data: [], error: null },
      project_risks: { data: [], error: null },
    };
    const factory = (async () => ({
      from: (table: string) => createQuery(responses[table]),
    })) as unknown as ProjectDetailClientFactory;

    const result = await loadProjectDetail(
      mockProjects[0].id,
      factory,
      { allowMockFallback: false },
    );

    expect(result?.source).toBe("supabase");
    expect(result?.detail.owner).toEqual({
      id: "member-real-owner",
      employeePublicId: "employee-real-owner",
      displayName: "周岚",
      department: "技术研发部",
      title: "项目总监",
      avatarUrl: "https://example.com/avatar.png",
    });
    expect(result?.detail.objective).toBeUndefined();
  });
});
