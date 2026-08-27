import { describe, expect, it } from "vitest";

import type { Customer } from "@/features/customers/customer-types";
import {
  buildCustomerStats,
  filterCustomers,
  getCustomerDistribution,
} from "@/features/customers/customer-selectors";

describe("customer selectors", () => {
  const customers: Customer[] = [
    {
      id: "10000000-0000-4000-8000-000000000001", version: 1, name: "真实数据库客户",
      registrationCode: null, contacts: [], owner: { id: "owner-1", commandId: "m1", displayName: "张负责人", department: "销售部", title: "经理" },
      status: "following", source: "consulting", industry: "企业服务", region: "上海",
      lastContactAt: null, nextFollowUpAt: null, dealProgress: 40, dealAmount: "0.00",
      createdAt: "2026-08-02T00:00:00Z", updatedAt: "2026-08-02T00:00:00Z",
      relatedProjects: [], contracts: [], sourceLinks: [], opportunities: [], activities: [], detailState: "complete",
    },
    {
      id: "10000000-0000-4000-8000-000000000002", version: 1, name: "已成交客户",
      registrationCode: null, contacts: [], owner: { id: "owner-2", commandId: "m2", displayName: "李负责人", department: "销售部", title: "经理" },
      status: "won", source: "referral", industry: "制造业", region: "苏州",
      lastContactAt: null, nextFollowUpAt: null, dealProgress: 100, dealAmount: "120000.00",
      createdAt: "2026-07-02T00:00:00Z", updatedAt: "2026-07-02T00:00:00Z",
      relatedProjects: [], contracts: [], sourceLinks: [], opportunities: [], activities: [], detailState: "complete",
    },
  ];

  it("filters query, status, source, and industry together", () => {
    const target = customers[0];
    const result = filterCustomers(customers, {
      query: target.name.slice(0, 2),
      status: target.status,
      source: target.source,
      industry: target.industry,
    });

    expect(result.map(({ id }) => id)).toContain(target.id);
    expect(result.every((customer) => (
      customer.status === target.status
      && customer.source === target.source
      && customer.industry === target.industry
    ))).toBe(true);
  });

  it("builds visible customer statistics", () => {
    const stats = buildCustomerStats(customers, 2);

    expect(stats.total).toBe(customers.length);
    expect(stats.pageCount).toBe(2);
    expect(stats.dealAmount).toBe("120000.00");
    expect(stats.following).toBeGreaterThan(0);
    expect(stats.won).toBeGreaterThan(0);
  });

  it("sums decimal-string won amounts without IEEE-754 rounding", () => {
    const stats = buildCustomerStats([
      { ...customers[0], dealAmount: "9999999999999999.99" },
      { ...customers[1], dealAmount: "0.01" },
    ]);
    expect(stats.dealAmount).toBe("10000000000000000.00");
  });

  it("builds stable source, industry, and region distributions", () => {
    expect(getCustomerDistribution(customers, "source").reduce((sum, item) => sum + item.value, 0)).toBe(customers.length);
    expect(getCustomerDistribution(customers, "industry").reduce((sum, item) => sum + item.value, 0)).toBe(customers.length);
    expect(getCustomerDistribution(customers, "region").reduce((sum, item) => sum + item.value, 0)).toBe(customers.length);
  });
});
