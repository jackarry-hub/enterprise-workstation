import { describe, expect, it } from "vitest";

import { isCustomerDemoMode } from "@/features/demo/customer-demo-mode";

describe("customer demo mode", () => {
  it("enables only the explicit true flag", () => {
    expect(isCustomerDemoMode({ CUSTOMER_DEMO_MODE: "true" })).toBe(true);
    expect(isCustomerDemoMode({ CUSTOMER_DEMO_MODE: "false" })).toBe(false);
    expect(isCustomerDemoMode({})).toBe(false);
  });
});
