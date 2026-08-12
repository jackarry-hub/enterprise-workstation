type DemoEnvironment = Record<string, string | undefined>;

export function isCustomerDemoMode(env: DemoEnvironment = process.env) {
  return env.CUSTOMER_DEMO_MODE === "true";
}
