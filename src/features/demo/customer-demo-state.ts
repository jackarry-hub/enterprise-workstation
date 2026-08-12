export const CUSTOMER_DEMO_STORAGE_NAMESPACE = "customer-demo-shared";

const customerDemoBusinessKeys = [
  `enterprise-workspace.operations.v1:${CUSTOMER_DEMO_STORAGE_NAMESPACE}`,
  `enterprise-workspace.decision-workbench.v1:${CUSTOMER_DEMO_STORAGE_NAMESPACE}`,
  `enterprise-workspace.projects.v1:${CUSTOMER_DEMO_STORAGE_NAMESPACE}`,
  "enterprise-workspace.customers.v1",
  "enterprise-workspace.settings.v1",
] as const;

export function resetCustomerDemoState(
  storage?: Pick<Storage, "removeItem">,
) {
  const target = storage
    ?? (typeof window === "undefined" ? undefined : window.localStorage);
  if (!target) return;
  customerDemoBusinessKeys.forEach((key) => target.removeItem(key));

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("enterprise-workspace:operations-changed"));
    window.dispatchEvent(new CustomEvent("enterprise-workspace:projects-changed"));
    window.dispatchEvent(new CustomEvent("enterprise-workspace:customers-changed"));
  }
}
