import { describe, expect, it } from "vitest";

import { loadCustomerDetailData, loadCustomerWorkspaceData, selectCustomerDetail } from "@/features/customers/customer-data";

type Operation = [table: string, operation: string, ...args: unknown[]];
type Result = { data: unknown; error: null; count?: number };

class Query implements PromiseLike<Result> {
  constructor(private readonly table: string, private readonly rows: readonly unknown[], private readonly log: Operation[]) {}
  select(...args: unknown[]) { this.log.push([this.table, "select", ...args]); return this; }
  eq(...args: unknown[]) { this.log.push([this.table, "eq", ...args]); return this; }
  in(...args: unknown[]) { this.log.push([this.table, "in", ...args]); return this; }
  is(...args: unknown[]) { this.log.push([this.table, "is", ...args]); return this; }
  ilike(...args: unknown[]) { this.log.push([this.table, "ilike", ...args]); return this; }
  order(...args: unknown[]) { this.log.push([this.table, "order", ...args]); return this; }
  range(...args: unknown[]) { this.log.push([this.table, "range", ...args]); return this; }
  maybeSingle() { this.log.push([this.table, "maybeSingle"]); return Promise.resolve({ data: this.rows[0] ?? null, error: null }); }
  then<TResult1 = Result, TResult2 = never>(
    onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: [...this.rows], error: null, count: this.table === "customers" ? this.rows.length : undefined }).then(onfulfilled, onrejected);
  }
}

const ids = {
  user: "10000000-0000-4000-8000-000000000001", organization: "10000000-0000-4000-8000-000000000002",
  member: "10000000-0000-4000-8000-000000000003", employee: "10000000-0000-4000-8000-000000000004",
  customer: "20000000-0000-4000-8000-000000000001", contact: "30000000-0000-4000-8000-000000000001",
  opportunity: "40000000-0000-4000-8000-000000000001", followUp: "50000000-0000-4000-8000-000000000001",
};

function fixture(customerName = "数据库客户", wonAmount = "0.00") {
  const log: Operation[] = [];
  const tables: Record<string, readonly unknown[]> = {
    external_identities: [{ tenant_id: 1, organization_id: 2, organization_member_id: 10, identity_provider_id: 3 }],
    tenants: [{ status: "active" }], identity_providers: [{ status: "active" }],
    organizations: [{ public_id: ids.organization }],
    organization_members: [{ id: 10, public_id: ids.member, user_id: ids.user, status: "active" }],
    employee_profiles: [{ public_id: ids.employee, organization_member_id: 10, display_name: "真实负责人", avatar_url: null, job_title: "客户经理", employment_status: "active", department: { name: "客户成功部" } }],
    customers: [{ id: 20, public_id: ids.customer, owner_member_id: 10, name: customerName, registration_code: null, industry: "企业服务", source: "consulting", region: "上海", status: "following", version: 2, created_at: "2026-08-28T00:00:00Z", updated_at: "2026-08-28T02:00:00Z" }],
    customer_contacts: [{ public_id: ids.contact, customer_id: 20, name: "陈总", title: "信息总监", phone: "13800000000", email: "chen@example.com", visibility: "assigned", is_primary: true, version: 1, created_at: "2026-08-28T00:00:00Z", updated_at: "2026-08-28T01:00:00Z" }],
    current_customer_opportunity_metrics: [{ customer_id: 20, opportunity_count: 1, deal_progress: 40, won_amount_cny: wonAmount }],
    current_customer_follow_up_metrics: [{ customer_id: 20, last_contact_at: "2026-08-28T02:00:00Z", next_follow_up_at: "2026-08-29T02:00:00Z" }],
    current_customer_industries: [{ industry: "企业服务" }, { industry: "制造业" }],
    current_customer_opportunities: [{ id: 30, public_id: ids.opportunity, customer_id: 20, owner_member_id: 10, name: "数字化升级", stage: "qualified", amount: "9999999999999999.99", currency: "CNY", expected_close_on: "2026-10-01", loss_reason: null, version: 2, created_at: "2026-08-28T00:00:00Z", updated_at: "2026-08-28T01:00:00Z" }],
    customer_follow_ups: [{ public_id: ids.followUp, customer_id: 20, opportunity_id: 30, actor_member_id: 10, kind: "meeting", content: "已完成需求确认", occurred_at: "2026-08-28T02:00:00Z", next_follow_up_at: "2026-08-29T02:00:00Z" }],
    customer_project_links: [], projects: [],
  };
  return {
    log,
    client: {
      auth: { getUser: async () => ({ data: { user: { id: ids.user } }, error: null }) },
      from: (table: string) => new Query(table, tables[table] ?? [], log),
    },
  };
}

describe("customer data", () => {
  it("loads one paginated RLS-scoped list projection without detail payloads or seed fallback", async () => {
    const test = fixture();
    const result = await loadCustomerWorkspaceData(async () => test.client as never, { canManage: true, page: 1 });
    expect(result.data.loadError).toBeUndefined();
    expect(result.data.pagination).toEqual({ page: 1, pageSize: 30, total: 1, hasPrevious: false, hasNext: false });
    expect(result.data.filters).toEqual({ query: "", status: "all", source: "all", industry: "all" });
    expect(result.data.industryOptions).toEqual(["企业服务", "制造业"]);
    expect(result.data.customers[0]).toMatchObject({
      id: ids.customer, name: "数据库客户", contact: { name: "陈总", isPrimary: true },
      owner: { displayName: "真实负责人", employeePublicId: ids.employee }, detailState: "summary",
      opportunities: [], activities: [], dealAmount: "0.00",
    });
    expect(selectCustomerDetail(result, ids.customer)?.name).toBe("数据库客户");
    expect(test.log).toContainEqual(["customers", "range", 0, 29]);
    expect(test.log).toContainEqual(["customers", "order", "updated_at", { ascending: false }]);
    expect(test.log).toContainEqual(["customers", "order", "id", { ascending: false }]);
    expect(test.log).toContainEqual(["customer_contacts", "eq", "tenant_id", 1]);
    expect(test.log).toContainEqual(["customer_contacts", "eq", "organization_id", 2]);
    expect(test.log).toContainEqual(["customer_contacts", "eq", "is_primary", true]);
    expect(test.log.some(([table]) => table === "current_customer_opportunities")).toBe(false);
  });

  it("applies search and filters before exact count and pagination", async () => {
    const test = fixture();
    const result = await loadCustomerWorkspaceData(async () => test.client as never, {
      page: 2,
      filters: { query: "数据库_客户%", status: "following", source: "consulting", industry: "企业服务" },
    });
    expect(result.data.filters).toEqual({
      query: "数据库_客户%", status: "following", source: "consulting", industry: "企业服务",
    });
    expect(test.log).toContainEqual(["customers", "ilike", "name", "%数据库\\_客户\\%%"]);
    expect(test.log).toContainEqual(["customers", "eq", "status", "following"]);
    expect(test.log).toContainEqual(["customers", "eq", "source", "consulting"]);
    expect(test.log).toContainEqual(["customers", "eq", "industry", "企业服务"]);
    expect(test.log).toContainEqual(["customers", "range", 30, 59]);
  });

  it("accepts aggregate won amounts beyond one numeric(18,2) row", async () => {
    const test = fixture("数据库客户", "19999999999999999.98");
    const result = await loadCustomerWorkspaceData(async () => test.client as never);
    expect(result.data.loadError).toBeUndefined();
    expect(result.data.customers[0]?.dealAmount).toBe("19999999999999999.98");
  });

  it("loads detail on demand and preserves numeric(18,2) as decimal text", async () => {
    const test = fixture();
    const result = await loadCustomerDetailData(ids.customer, async () => test.client as never);
    expect(result.loadError).toBeUndefined();
    expect(result.customer).toMatchObject({
      detailState: "complete", opportunities: [{ amount: "9999999999999999.99" }],
      activities: [{ content: "已完成需求确认" }],
    });
    expect(test.log).toContainEqual(["current_customer_opportunities", "range", 0, 100]);
    expect(test.log).toContainEqual(["customer_follow_ups", "eq", "tenant_id", 1]);
    expect(test.log).toContainEqual(["customer_follow_ups", "eq", "organization_id", 2]);
  });

  it("fails closed when authoritative rows are malformed", async () => {
    const test = fixture("   ");
    const result = await loadCustomerWorkspaceData(async () => test.client as never, { canManage: true });
    expect(result.data.customers).toEqual([]);
    expect(result.data.availableOwners).toEqual([]);
    expect(result.data.loadError).toContain("客户数据暂时不可用");
  });
});
