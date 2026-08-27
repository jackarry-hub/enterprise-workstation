import { describe, expect, it, vi } from "vitest";

import {
  loadProjectCollection,
  type ProjectCollectionClientFactory,
} from "@/features/projects/data/project-collection-data";

type QueryResponse = { data: unknown; error: Error | null };

function createQuery(response: QueryResponse) {
  const query = {
    select: () => query,
    eq: () => query,
    in: () => query,
    is: () => query,
    order: () => query,
    limit: () => query,
    maybeSingle: async () => ({
      data: Array.isArray(response.data) ? response.data[0] ?? null : response.data,
      error: response.error,
    }),
    then: (resolve: (value: QueryResponse) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(response).then(resolve, reject),
  };
  return query;
}

describe("loadProjectCollection", () => {
  it("batch-loads real responsive page data without synthetic activity stages", async () => {
    const projectId = "b1000000-0000-4000-8000-000000000001";
    const parentObjectiveId = "b1000000-0000-4000-8000-000000000009";
    const responses: Record<string, QueryResponse> = {
      projects: { data: [{
        id: 11, public_id: projectId, organization_id: 1, objective_id: 501,
        code: "PRJ-001", name: "真实客户项目", description: "真实数据",
        category: "企业项目", budget_amount: "88000.00", owner_member_id: 101,
        created_by_member_id: 101, status: "active", health: "on_track", priority: "high",
        start_date: "2026-08-01", due_date: "2026-09-30", actual_end_date: null,
        progress: 35, version: 2, created_at: "2026-08-01T00:00:00.000Z",
        updated_at: "2026-08-27T00:00:00.000Z",
      }], error: null },
      external_identities: { data: {
        tenant_id: 1, organization_id: 1, organization_member_id: 101, identity_provider_id: 71,
      }, error: null },
      tenants: { data: { status: "active" }, error: null },
      identity_providers: { data: { status: "active" }, error: null },
      organizations: { data: { public_id: "10000000-0000-4000-8000-000000000001" }, error: null },
      project_members: { data: [{
        id: 201, public_id: "b1000000-0000-4000-8000-000000000002",
        organization_id: 1, project_id: 11, member_id: 101, role: "owner",
        allocation_percent: 100, joined_at: "2026-08-01T00:00:00.000Z", left_at: null,
      }], error: null },
      milestones: { data: [{
        id: 301, public_id: "b1000000-0000-4000-8000-000000000003",
        organization_id: 1, project_id: 11, owner_member_id: 101, name: "上线验收",
        description: "完成客户验收", status: "in_progress", start_date: "2026-09-01",
        due_date: "2026-09-30", completed_at: null, progress: 40, sort_order: 0,
        created_at: "2026-08-01T00:00:00.000Z", updated_at: "2026-08-27T00:00:00.000Z",
      }], error: null },
      tasks: { data: [{
        id: 401, public_id: "b1000000-0000-4000-8000-000000000004",
        organization_id: 1, project_id: 11, milestone_id: 301, parent_task_id: null,
        title: "完成联调", description: "覆盖核心流程", acceptance_criteria: "端到端通过",
        assignee_member_id: 101, reporter_member_id: 101, status: "in_progress", priority: "high",
        start_date: "2026-08-20", due_date: "2026-09-10", completed_at: null,
        progress: 60, estimated_hours: 12, sort_order: 0, version: 3,
        created_at: "2026-08-20T00:00:00.000Z", updated_at: "2026-08-27T00:00:00.000Z",
      }], error: null },
      project_activities: { data: [{
        public_id: "b1000000-0000-4000-8000-000000000005", organization_id: 1,
        project_id: 11, actor_member_id: 101, user_id: "user-101", action_type: "task_updated",
        content: "任务进度更新为 60%", created_at: "2026-08-27T00:00:00.000Z",
      }], error: null },
      objectives: { data: [{
        id: 501, public_id: "b1000000-0000-4000-8000-000000000008",
        organization_id: 1, parent_objective_id: 502, owner_member_id: 101,
        created_by_member_id: 101, title: "交付客户门户", description: "完成正式交付",
        scope: "company", status: "active", period_start: "2026-08-01",
        period_end: "2026-09-30", progress: 35,
        created_at: "2026-08-01T00:00:00.000Z", updated_at: "2026-08-27T00:00:00.000Z",
      }], error: null },
      organization_members: { data: [{ id: 101, public_id: "b1000000-0000-4000-8000-000000000006", user_id: "user-101", status: "active" }], error: null },
      employee_profiles: { data: [{
        public_id: "b1000000-0000-4000-8000-000000000007", organization_member_id: 101,
        display_name: "周岚", avatar_url: null, job_title: "项目总监", employment_status: "active", department: { name: "研发部" },
      }], error: null },
    };
    let objectiveQueryCount = 0;
    const from = vi.fn((table: string) => {
      if (table === "objectives" && objectiveQueryCount++ > 0) {
        return createQuery({ data: [{ id: 502, public_id: parentObjectiveId }], error: null });
      }
      return createQuery(responses[table]);
    });
    const factory = (async () => ({
      auth: { getUser: async () => ({ data: { user: { id: "user-101" } }, error: null }) },
      from,
    })) as unknown as ProjectCollectionClientFactory;

    const result = await loadProjectCollection(factory, { allowMockFallback: false });

    expect(result.source).toBe("supabase");
    expect(result.viewer.memberId).toBe("b1000000-0000-4000-8000-000000000006");
    expect(result.availableMembers[0]).toMatchObject({ displayName: "周岚", commandId: "m101" });
    expect(result.details[0]).toMatchObject({
      project: {
        id: projectId,
        organizationId: "10000000-0000-4000-8000-000000000001",
        budgetAmount: "88000.00",
        version: 2,
        objectiveId: "b1000000-0000-4000-8000-000000000008",
        createdById: "b1000000-0000-4000-8000-000000000006",
      },
      objective: {
        parentObjectiveId,
        ownerId: "b1000000-0000-4000-8000-000000000006",
        createdById: "b1000000-0000-4000-8000-000000000006",
      },
      owner: { displayName: "周岚" },
      milestones: [{ name: "上线验收" }],
      tasks: [{ title: "完成联调", acceptanceCriteria: "端到端通过", version: 3 }],
      activities: [{ userId: "b1000000-0000-4000-8000-000000000006" }],
    });
    expect(from.mock.calls.filter(([table]) => table === "tasks")).toHaveLength(1);
    expect(from.mock.calls.filter(([table]) => table === "milestones")).toHaveLength(1);
  });

  it("fails closed instead of replacing a configured database error with fixtures", async () => {
    await expect(loadProjectCollection(async () => {
      throw new Error("permission denied");
    }, { allowMockFallback: false })).rejects.toThrow("permission denied");
  });

  it("preserves the authenticated viewer when there are no projects", async () => {
    const responses: Record<string, QueryResponse> = {
      projects: { data: [], error: null },
      external_identities: { data: {
        tenant_id: 1, organization_id: 1, organization_member_id: 101, identity_provider_id: 71,
      }, error: null },
      tenants: { data: { status: "active" }, error: null },
      identity_providers: { data: { status: "active" }, error: null },
      organizations: { data: { public_id: "10000000-0000-4000-8000-000000000001" }, error: null },
      organization_members: { data: [{
        id: 101, public_id: "b1000000-0000-4000-8000-000000000006",
        user_id: "user-101", status: "active",
      }], error: null },
      employee_profiles: { data: [{
        public_id: "b1000000-0000-4000-8000-000000000007", organization_member_id: 101,
        display_name: "周岚", avatar_url: null, job_title: "项目总监", employment_status: "active", department: { name: "研发部" },
      }], error: null },
    };
    const factory = (async () => ({
      auth: { getUser: async () => ({ data: { user: { id: "user-101" } }, error: null }) },
      from: (table: string) => createQuery(responses[table]),
    })) as unknown as ProjectCollectionClientFactory;

    await expect(loadProjectCollection(factory, { allowMockFallback: false })).resolves.toMatchObject({
      source: "supabase",
      details: [],
      viewer: {
        memberId: "b1000000-0000-4000-8000-000000000006",
        member: { displayName: "周岚", commandId: "m101" },
      },
    });
  });
});
