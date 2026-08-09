import { describe, expect, it } from "vitest";

import { customersMockData } from "@/features/customers/customer-mock-data";
import {
  buildCustomerStats,
  filterCustomers,
  getCustomerDistribution,
} from "@/features/customers/customer-selectors";

describe("customer selectors", () => {
  it("filters query, status, source, and industry together", () => {
    const target = customersMockData[0];
    const result = filterCustomers(customersMockData, {
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
    const stats = buildCustomerStats(customersMockData);

    expect(stats.total).toBe(customersMockData.length);
    expect(stats.following).toBeGreaterThan(0);
    expect(stats.won).toBeGreaterThan(0);
  });

  it("builds stable source, industry, and region distributions", () => {
    expect(getCustomerDistribution(customersMockData, "source").reduce((sum, item) => sum + item.value, 0)).toBe(customersMockData.length);
    expect(getCustomerDistribution(customersMockData, "industry").reduce((sum, item) => sum + item.value, 0)).toBe(customersMockData.length);
    expect(getCustomerDistribution(customersMockData, "region").reduce((sum, item) => sum + item.value, 0)).toBe(customersMockData.length);
  });
});
