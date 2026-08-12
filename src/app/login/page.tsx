import { redirect } from "next/navigation";

import { signInWithFeishu } from "@/features/auth/actions";
import { LoginCard } from "@/features/auth/login-card";
import { getWorkspaceSession } from "@/features/auth/workspace-session";
import { customerDemoSessions } from "@/features/demo/customer-demo-data";
import { isCustomerDemoMode } from "@/features/demo/customer-demo-mode";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (isCustomerDemoMode()) redirect(customerDemoSessions[0].landingPath);

  let session: Awaited<ReturnType<typeof getWorkspaceSession>> = null;
  let sessionLookupFailed = false;
  try {
    session = await getWorkspaceSession();
  } catch {
    sessionLookupFailed = true;
  }
  if (session) redirect(session.landingPath);

  const { error } = await searchParams;
  return (
    <main
      id="main-content"
      className="workspace-mesh grid min-h-screen place-items-center px-4 py-10"
    >
      <LoginCard
        action={signInWithFeishu}
        errorCode={sessionLookupFailed ? "login_unavailable" : error ?? null}
      />
    </main>
  );
}
