import { afterEach, describe, expect, it, vi } from "vitest";

import {
  loadProjectDetail,
  mapCanonicalAcceptanceEvent,
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
    maybeSingle: async () => ({
      data: Array.isArray(response.data) ? response.data[0] ?? null : response.data,
      error: response.error,
    }),
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
    vi.stubEnv("WORKSTATION_ALLOW_MOCK_DATA", "true");
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
    vi.stubEnv("WORKSTATION_ALLOW_MOCK_DATA", "true");
    const result = await loadProjectDetail(
      "unknown-project",
      async () => {
        throw new Error("offline");
      },
      { allowMockFallback: true },
    );

    expect(result).toBeUndefined();
  });

  it("does not fall back to mock data unless preview data is explicitly enabled", async () => {
    await expect(loadProjectDetail(
      mockProjects[0].id,
      async () => {
        throw new Error("permission denied");
      },
    )).rejects.toThrow("permission denied");
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
          category: "企业项目",
          budget_amount: "120000.00",
          owner_member_id: 902,
          created_by_member_id: 902,
          status: "active",
          health: "healthy",
          priority: "high",
          start_date: "2026-08-01",
          due_date: "2026-09-01",
          actual_end_date: null,
          progress: 20,
          version: 3,
          created_at: "2026-08-01T00:00:00.000Z",
          updated_at: "2026-08-01T00:00:00.000Z",
        },
        error: null,
      },
      external_identities: {
        data: { tenant_id: 1, organization_id: 1, organization_member_id: 902, identity_provider_id: 71 },
        error: null,
      },
      tenants: { data: { status: "active" }, error: null },
      identity_providers: { data: { status: "active" }, error: null },
      organizations: { data: { public_id: "10000000-0000-4000-8000-000000000001" }, error: null },
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
          status: "active",
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
          employment_status: "active",
          department: { name: "技术研发部" },
        }],
        error: null,
      },
      milestones: { data: [], error: null },
      tasks: { data: [], error: null },
      task_comments: { data: [], error: null },
      daily_reports: { data: [], error: null },
      project_activities: { data: [{
        public_id: "42200000-0000-4000-8000-000000000001",
        organization_id: 1,
        actor_member_id: 902,
        user_id: "user-real-owner",
        action_type: "project_note_added",
        content: "补充客户验收说明",
        created_at: "2026-08-27T02:30:00.000Z",
      }], error: null },
      project_risks: { data: [{
        public_id: "42300000-0000-4000-8000-000000000001",
        organization_id: 1,
        title: "客户验收延期",
        level: "high",
        owner_member_id: 902,
        status: "monitoring",
        deadline: "2026-09-01",
        created_at: "2026-08-27T02:00:00.000Z",
        updated_at: "2026-08-27T02:00:00.000Z",
      }], error: null },
      files: { data: [{
        id: 81,
        public_id: "42000000-0000-4000-8000-000000000001",
        organization_id: 1,
        project_id: 91,
        task_id: null,
        bucket: "workbench-files",
        object_path: "tenants/t/organizations/o/projects/p/uploads/u/file.pdf",
        original_name: "验收材料.pdf",
        mime_type: "application/pdf",
        size_bytes: 128,
        sha256: "a".repeat(64),
        access_scope: "restricted",
        uploaded_by_member_id: 902,
        verified_at: "2026-08-27T02:00:00.000Z",
        created_at: "2026-08-27T02:00:00.000Z",
      }], error: null },
      file_relations: { data: [{
        public_id: "42100000-0000-4000-8000-000000000001",
        organization_id: 1,
        project_id: 91,
        file_id: 81,
        relation_type: "project",
        task_id: null,
        milestone_id: null,
        daily_report_id: null,
        task_comment_id: null,
        created_by_member_id: 902,
        created_at: "2026-08-27T02:00:00.000Z",
      }], error: null },
    };
    const factory = (async () => ({
      auth: { getUser: async () => ({ data: { user: { id: "user-real-owner" } }, error: null }) },
      rpc: async (name: string) => ({ data: name === "current_task_acceptance_history" ? []
        : name === "current_project_operating_model" ? {
          canManage: true, sops: [], sopRuns: [], decisions: [], retrospective: null, trace: [],
        } : true, error: null }),
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
      commandId: "m902",
      displayName: "周岚",
      department: "技术研发部",
      title: "项目总监",
      avatarUrl: "https://example.com/avatar.png",
    });
    expect(result?.detail.objective).toBeUndefined();
    expect(result?.access).toEqual({ canManage: true, viewerMemberId: "member-real-owner" });
    expect(result?.detail.files).toEqual([expect.objectContaining({
      id: "42000000-0000-4000-8000-000000000001",
      originalName: "验收材料.pdf",
      uploadedById: "member-real-owner",
      verifiedAt: "2026-08-27T02:00:00.000Z",
    })]);
    expect(result?.detail.fileRelations).toEqual([expect.objectContaining({
      fileId: "42000000-0000-4000-8000-000000000001",
      relationType: "project",
    })]);
    expect(result?.detail.project.createdById).toBe("member-real-owner");
    expect(result?.detail.project.organizationId).toBe("10000000-0000-4000-8000-000000000001");
    expect(result?.detail.activities).toEqual([expect.objectContaining({
      actionType: "project_note_added",
      userId: "member-real-owner",
    })]);
    expect(result?.detail.risks).toEqual([expect.objectContaining({
      ownerId: "member-real-owner",
    })]);
  });

  it("accepts only canonical acceptance history DTOs", () => {
    expect(mapCanonicalAcceptanceEvent({
      event_public_id: "42000000-0000-4000-8000-000000000001",
      task_public_id: "42000000-0000-4000-8000-000000000002",
      event_type: "review_passed",
      actor_employee_public_id: "42000000-0000-4000-8000-000000000003",
      actor_name: "审查人",
      task_version: 4,
      result_text: "正式验收结果",
      result_link: "https://example.com/evidence",
      result_files: ["42000000-0000-4000-8000-000000000004"],
      decision: "pass",
      note: "证据完整",
      occurred_at: "2026-08-28T08:00:00.000Z",
    })).toEqual(expect.objectContaining({
      eventType: "review_passed",
      taskVersion: 4,
      decision: "pass",
    }));

    expect(() => mapCanonicalAcceptanceEvent({
      event_public_id: "not-a-uuid",
      task_public_id: "42000000-0000-4000-8000-000000000002",
      event_type: "invented_event",
      actor_employee_public_id: "42000000-0000-4000-8000-000000000003",
      actor_name: "审查人",
      task_version: 0,
      result_files: [],
      occurred_at: "invalid-time",
    })).toThrow("acceptance_history_invalid");
  });
});
