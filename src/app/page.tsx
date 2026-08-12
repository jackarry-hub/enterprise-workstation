import { redirect } from "next/navigation";

import { getWorkspaceSession } from "@/features/auth/workspace-session";
import { customerDemoSessions } from "@/features/demo/customer-demo-data";
import { isCustomerDemoMode } from "@/features/demo/customer-demo-mode";

export default async function Home() {
  if (isCustomerDemoMode()) redirect(customerDemoSessions[0].landingPath);

  let destination: string;
  try {
    const session = await getWorkspaceSession();
    destination = session?.landingPath ?? "/login";
  } catch {
    destination = "/access-pending?reason=configuration_error";
  }
  redirect(destination);
}
