import { describe, expect, it, vi } from "vitest";

import { loadApprovalDetail, loadApprovals } from "@/features/approvals/approval-data";

type QueryResponse = { data: unknown; error: Error | null };

function createQuery(response: QueryResponse) {
  const query = {
    select: () => query,
    eq: () => query,
    in: () => query,
    is: () => query,
    order: () => query,
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

describe("approval data", () => {
  it("rejects a malformed real approval id before opening a database client", async () => {
    const factory = vi.fn();

    await expect(loadApprovalDetail("not-a-uuid", factory as never, {
      allowMockFallback: false,
    })).resolves.toBeUndefined();
    expect(factory).not.toHaveBeenCalled();
  });

  it("uses a unique immutable keyset order for the real approval collection", async () => {
    const orders: Array<[string, unknown]> = [];
    const query = createQuery({ data: [], error: null });
    query.order = ((column: string, options: unknown) => {
      orders.push([column, options]);
      return query;
    }) as never;
    const factory = (async () => ({ from: () => query })) as never;

    await loadApprovals(factory, { allowMockFallback: false });

    expect(orders).toEqual([
      ["created_at", { ascending: false }],
      ["public_id", { ascending: false }],
    ]);
  });

  it("assembles reimbursement approvals from real approval, step, action and employee rows", async () => {
    const responses: Record<string, QueryResponse> = {
      approvals: {
        data: [{
          id: 31,
          public_id: "40000000-0000-4000-8000-000000000001",
          organization_id: 1,
          applicant_employee_id: 11,
          owner_employee_id: 12,
          approval_code: "EXP-20260825-001",
          approval_type: "reimbursement",
          title: "客户拜访差旅报账",
          summary: "差旅费 ¥1,260.00",
          form_data: {
            costType: "差旅费",
            amount: 1260,
            currency: "CNY",
            expenseDate: "2026-08-21",
            purpose: "客户现场沟通产生的交通及住宿费用",
          },
          current_step: "财务复核",
          status: "pending",
          submitted_at: "2026-08-25T09:10:00.000Z",
          completed_at: null,
          version: 3,
        }],
        error: null,
      },
      approval_steps: {
        data: [
          {
            public_id: "step-submit",
            approval_id: 31,
            step_order: 1,
            name: "提交申请",
            approver_employee_id: 11,
            status: "approved",
            acted_at: "2026-08-25T09:10:00.000Z",
            comment: "已提交报账",
          },
          {
            public_id: "step-finance",
            approval_id: 31,
            step_order: 2,
            name: "财务复核",
            approver_employee_id: 12,
            status: "pending",
            acted_at: null,
            comment: null,
          },
        ],
        error: null,
      },
      approval_actions: {
        data: [{
          public_id: "action-submit",
          approval_id: 31,
          actor_employee_id: 11,
          action_type: "submit",
          content: "提交报账申请",
          created_at: "2026-08-25T09:10:00.000Z",
        }],
        error: null,
      },
      expense_reports: {
        data: [{
          public_id: "expense-reimburse-1",
          approval_id: 31,
          version: 2,
          status: "submitted",
          payment_reference: null,
        }],
        error: null,
      },
      employee_profiles: {
        data: [
          {
            id: 11,
            public_id: "employee-applicant",
            display_name: "王芳",
            job_title: "产品经理",
            department_id: 21,
            avatar_url: null,
          },
          {
            id: 12,
            public_id: "employee-finance",
            display_name: "赵敏",
            job_title: "财务经理",
            department_id: 22,
            avatar_url: null,
          },
        ],
        error: null,
      },
      departments: {
        data: [
          { id: 21, name: "产品研发部" },
          { id: 22, name: "财务部" },
        ],
        error: null,
      },
    };
    const factory = (async () => ({
      auth: { getUser: async () => ({ data: { user: { id: "viewer" } }, error: null }) },
      from: (table: string) => createQuery(responses[table]),
    })) as never;

    const result = await loadApprovals(factory, { allowMockFallback: false, viewerEmployeeProfileId: "employee-applicant" });
    const detail = await loadApprovalDetail("40000000-0000-4000-8000-000000000001", factory, {
      allowMockFallback: false,
      viewerEmployeeProfileId: "employee-applicant",
    });

    expect(result.source).toBe("supabase");
    expect(result.data.approvals).toHaveLength(1);
    expect(result.data.approvals[0]).toMatchObject({
      id: "40000000-0000-4000-8000-000000000001",
      version: 3,
      code: "EXP-20260825-001",
      type: "reimbursement",
      title: "客户拜访差旅报账",
      applicant: { displayName: "王芳", department: "产品研发部" },
      owner: { displayName: "赵敏", department: "财务部" },
      status: "pending",
      currentStep: "财务复核",
      priority: "high",
      initiatedByViewer: true,
      actionableByViewer: false,
    });
    expect(result.data.approvals[0].fields).toEqual([
      { label: "报账类型", value: "差旅费" },
      { label: "报账金额", value: "¥1,260.00" },
      { label: "费用日期", value: "2026-08-21" },
      { label: "费用说明", value: "客户现场沟通产生的交通及住宿费用" },
    ]);
    expect(detail?.expense).toMatchObject({ id: "expense-reimburse-1", version: 2, status: "submitted" });
    expect(detail?.steps).toHaveLength(2);
    expect(detail?.actions).toHaveLength(1);
    expect(result.data.stats).toEqual({ pending: 0, initiated: 1, approved: 0, rejected: 0 });
  });

  it("resolves a real approval detail by public approval id", async () => {
    const responses: Record<string, QueryResponse> = {
      approvals: {
        data: [{
          id: 31,
          public_id: "40000000-0000-4000-8000-000000000002",
          organization_id: 1,
          applicant_employee_id: 11,
          owner_employee_id: 12,
          approval_code: "EXP-20260825-002",
          approval_type: "reimbursement",
          title: "设备采购报账",
          summary: "设备采购 ¥8,600.00",
          form_data: { costType: "设备采购", amount: 8600, expenseDate: "2026-08-22", purpose: "生产设备采购" },
          current_step: "负责人审批",
          status: "approved",
          submitted_at: "2026-08-25T09:10:00.000Z",
          completed_at: "2026-08-25T10:10:00.000Z",
          version: 4,
        }],
        error: null,
      },
      approval_steps: { data: [], error: null },
      approval_actions: { data: [], error: null },
      expense_reports: {
        data: [{
          public_id: "expense-detail-id",
          approval_id: 31,
          version: 3,
          status: "approved",
          payment_reference: null,
        }],
        error: null,
      },
      employee_profiles: {
        data: [
          { id: 11, public_id: "employee-applicant", display_name: "陈晨", job_title: "测试工程师", department_id: 21, avatar_url: null },
          { id: 12, public_id: "employee-owner", display_name: "董佳瑶", job_title: "负责人", department_id: 21, avatar_url: null },
        ],
        error: null,
      },
      departments: { data: [{ id: 21, name: "工程技术部" }], error: null },
    };
    const factory = (async () => ({
      auth: { getUser: async () => ({ data: { user: { id: "viewer" } }, error: null }) },
      from: (table: string) => createQuery(responses[table]),
    })) as never;

    const detail = await loadApprovalDetail("40000000-0000-4000-8000-000000000002", factory, { allowMockFallback: false });

    expect(detail?.code).toBe("EXP-20260825-002");
    expect(detail?.fields).toContainEqual({ label: "报账金额", value: "¥8,600.00" });
  });

  it("distinguishes a data service failure from an approval that does not exist", async () => {
    const factory = (async () => ({
      from: () => createQuery({ data: null, error: new Error("offline") }),
    })) as never;

    await expect(loadApprovalDetail("40000000-0000-4000-8000-000000000003", factory, {
      allowMockFallback: false,
    })).rejects.toThrow("approval_data_unavailable");
  });
});
