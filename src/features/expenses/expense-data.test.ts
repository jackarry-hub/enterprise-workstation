import { describe, expect, it } from "vitest";

import { loadExpenseFormOptions } from "@/features/expenses/expense-data";

type QueryResponse = { data: unknown; error: Error | null };

function createQuery(response: QueryResponse) {
  const query = {
    select: () => query,
    eq: () => query,
    in: () => query,
    is: () => query,
    not: () => query,
    order: () => query,
    or: () => query,
    range: () => query,
    limit: () => query,
    maybeSingle: () => Promise.resolve({
      data: Array.isArray(response.data) ? response.data[0] ?? null : response.data,
      error: response.error,
    }),
    then: (
      resolve: (value: QueryResponse) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(response).then(resolve, reject),
  };
  return query;
}

describe("expense form options", () => {
  it("uses a unique immutable keyset order for resumable draft discovery", async () => {
    const orders: string[] = [];
    const responses: Record<string, QueryResponse> = {
      employee_profiles: { data: [{ id: 41, organization_member_id: 901 }], error: null },
      projects: { data: [], error: null },
      expense_reports: { data: [], error: null },
    };
    const factory = (async () => ({
      from: (table: string) => {
        const query = createQuery(responses[table]);
        if (table === "expense_reports") {
          query.order = ((column: string) => {
            orders.push(column);
            return query;
          }) as never;
        }
        return query;
      },
    })) as never;

    await loadExpenseFormOptions(901, factory);

    expect(orders).toEqual(["created_at", "public_id"]);
  });

  it("can recover one exact persisted draft by public id", async () => {
    const draftId = "40000000-0000-4000-8000-000000000001";
    const equalityCalls: Array<[string, unknown]> = [];
    const responses: Record<string, QueryResponse> = {
      employee_profiles: { data: [{ id: 41, organization_member_id: 901 }], error: null },
      projects: { data: [], error: null },
      expense_reports: {
        data: [{
          public_id: draftId,
          version: 2,
          project_id: null,
          expense_type: "office",
          amount: "88.20",
          expense_date: "2026-08-28",
          description: "办公耗材",
          receipt_file_ids: [],
          created_at: "2026-08-28T07:00:00Z",
          updated_at: "2026-08-28T08:00:00Z",
        }],
        error: null,
      },
    };
    const factory = (async () => ({
      from: (table: string) => {
        const query = createQuery(responses[table]);
        if (table === "expense_reports") {
          query.eq = ((column: string, value: unknown) => {
            equalityCalls.push([column, value]);
            return query;
          }) as never;
        }
        return query;
      },
    })) as never;

    const result = await loadExpenseFormOptions(901, factory, { draftPublicId: draftId });

    expect(equalityCalls).toContainEqual(["public_id", draftId]);
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0].id).toBe(draftId);
  });

  it("returns only active member projects and the requester's verified PDF/image receipts", async () => {
    const responses: Record<string, QueryResponse> = {
      employee_profiles: {
        data: [{ id: 41, organization_member_id: 901 }],
        error: null,
      },
      projects: {
        data: [
          { id: 21, public_id: "20000000-0000-4000-8000-000000000001", code: "PRJ-001", name: "客户交付", owner_member_id: 901, status: "active", archived_at: null },
          { id: 22, public_id: "20000000-0000-4000-8000-000000000002", code: "PRJ-002", name: "无关项目", owner_member_id: 999, status: "active", archived_at: null },
          { id: 23, public_id: "20000000-0000-4000-8000-000000000003", code: "PRJ-003", name: "已取消项目", owner_member_id: 901, status: "cancelled", archived_at: null },
        ],
        error: null,
      },
      project_members: {
        data: [{ project_id: 21, member_id: 901, left_at: null }],
        error: null,
      },
      files: {
        data: [
          { public_id: "30000000-0000-4000-8000-000000000001", project_id: 21, original_name: "高铁票.pdf", mime_type: "application/pdf", size_bytes: 128, uploaded_by_member_id: 901, verified_at: "2026-08-28T01:00:00Z" },
          { public_id: "30000000-0000-4000-8000-000000000002", project_id: 21, original_name: "现场照片.png", mime_type: "image/png", size_bytes: 256, uploaded_by_member_id: 901, verified_at: "2026-08-28T01:00:00Z" },
          { public_id: "30000000-0000-4000-8000-000000000003", project_id: 21, original_name: "说明.txt", mime_type: "text/plain", size_bytes: 64, uploaded_by_member_id: 901, verified_at: "2026-08-28T01:00:00Z" },
        ],
        error: null,
      },
      expense_reports: { data: [], error: null },
    };
    const factory = (async () => ({
      from: (table: string) => createQuery(responses[table]),
    })) as never;

    const result = await loadExpenseFormOptions(901, factory);

    expect(result).toEqual({
      source: "supabase",
      projects: [{
        id: "20000000-0000-4000-8000-000000000001",
        code: "PRJ-001",
        name: "客户交付",
        receipts: [
          { id: "30000000-0000-4000-8000-000000000001", name: "高铁票.pdf", mimeType: "application/pdf", sizeBytes: 128 },
          { id: "30000000-0000-4000-8000-000000000002", name: "现场照片.png", mimeType: "image/png", sizeBytes: 256 },
        ],
      }],
      drafts: [],
    });
  });

  it("returns persisted requester drafts so a refresh can resume submission", async () => {
    const responses: Record<string, QueryResponse> = {
      employee_profiles: { data: [{ id: 41, organization_member_id: 901 }], error: null },
      projects: { data: [], error: null },
      expense_reports: {
        data: [{
          public_id: "40000000-0000-4000-8000-000000000001",
          version: 2,
          project_id: null,
          expense_type: "office",
          amount: "88.20",
          expense_date: "2026-08-28",
          description: "办公耗材",
          receipt_file_ids: [],
          updated_at: "2026-08-28T08:00:00Z",
        }],
        error: null,
      },
    };
    const factory = (async () => ({
      from: (table: string) => createQuery(responses[table]),
    })) as never;

    await expect(loadExpenseFormOptions(901, factory)).resolves.toMatchObject({
      source: "supabase",
      projects: [],
      drafts: [{
        id: "40000000-0000-4000-8000-000000000001",
        version: 2,
        projectId: null,
        expenseType: "office",
        amount: "88.20",
        expenseDate: "2026-08-28",
        description: "办公耗材",
        receiptFileIds: [],
      }],
    });
  });

  it("returns an explicit unavailable state instead of fixture data when loading fails", async () => {
    const factory = (async () => ({
      from: () => createQuery({ data: null, error: new Error("offline") }),
    })) as never;

    await expect(loadExpenseFormOptions(901, factory)).resolves.toEqual({
      source: "supabase",
      projects: [],
      drafts: [],
      loadError: "费用关联项目与票据加载失败，请刷新后重试。",
    });
  });
});
