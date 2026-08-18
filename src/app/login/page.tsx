import { redirect } from "next/navigation";

import { LoginCard } from "@/features/auth/login-card";
import {
  getSafeReturnPath,
  isPublicAuthPath,
} from "@/features/auth/workspace-access";
import { getWorkspaceSession } from "@/features/auth/workspace-session";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string | string[] }>;
}) {
  let session: Awaited<ReturnType<typeof getWorkspaceSession>> = null;
  let sessionLookupFailed = false;
  try {
    session = await getWorkspaceSession();
  } catch {
    sessionLookupFailed = true;
  }
  if (session) redirect(session.landingPath);

  const { error, next } = await searchParams;
  const safeNext = typeof next === "string" ? getSafeReturnPath(next) : null;
  const loginReturnPath = safeNext
    && !isPublicAuthPath(new URL(safeNext, "https://workspace.invalid").pathname)
    ? safeNext
    : null;
  const loginHref = loginReturnPath
    ? `/auth/login/feishu?next=${encodeURIComponent(loginReturnPath)}`
    : "/auth/login/feishu";
  return (
    <main
      id="main-content"
      className="workspace-mesh grid min-h-screen place-items-center px-4 py-10"
    >
      <LoginCard
        loginHref={loginHref}
        errorCode={sessionLookupFailed ? "login_unavailable" : error ?? null}
      />
    </main>
  );
}
