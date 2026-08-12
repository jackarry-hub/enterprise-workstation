import { beforeEach, describe, expect, it } from "vitest";

import { CUSTOMER_DEMO_ACTOR_KEY } from "@/features/auth/workspace-session-provider";
import {
  CUSTOMER_DEMO_RESET_EVENT,
  CUSTOMER_DEMO_STORAGE_NAMESPACE,
  resetCustomerDemoState,
} from "@/features/demo/customer-demo-state";

describe("customer demo state reset", () => {
  beforeEach(() => window.localStorage.clear());

  it("removes shared demo business state while preserving the selected identity and unrelated data", () => {
    const businessKeys = [
      `enterprise-workspace.operations.v1:${CUSTOMER_DEMO_STORAGE_NAMESPACE}`,
      `enterprise-workspace.decision-workbench.v1:${CUSTOMER_DEMO_STORAGE_NAMESPACE}`,
      `enterprise-workspace.projects.v1:${CUSTOMER_DEMO_STORAGE_NAMESPACE}`,
      "enterprise-workspace.customers.v1",
      "enterprise-workspace.settings.v1",
    ];
    businessKeys.forEach((key) => window.localStorage.setItem(key, "changed"));
    window.localStorage.setItem(CUSTOMER_DEMO_ACTOR_KEY, "demo-engineer");
    window.localStorage.setItem("unrelated-key", "keep");

    resetCustomerDemoState(window.localStorage);

    businessKeys.forEach((key) => expect(window.localStorage.getItem(key)).toBeNull());
    expect(window.localStorage.getItem(CUSTOMER_DEMO_ACTOR_KEY)).toBe("demo-engineer");
    expect(window.localStorage.getItem("unrelated-key")).toBe("keep");
  });

  it("notifies mounted demo screens to clear transient feedback", () => {
    let resetEvents = 0;
    const handleReset = () => { resetEvents += 1; };
    window.addEventListener(CUSTOMER_DEMO_RESET_EVENT, handleReset);

    resetCustomerDemoState(window.localStorage);

    expect(resetEvents).toBe(1);
    window.removeEventListener(CUSTOMER_DEMO_RESET_EVENT, handleReset);
  });
});
