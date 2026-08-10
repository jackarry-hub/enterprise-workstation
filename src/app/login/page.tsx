import { redirect } from "next/navigation";

import { signInWithFeishu } from "@/features/auth/actions";
import { LoginCard } from "@/features/auth/login-card";
import { getWorkspaceSession } from "@/features/auth/workspace-session";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await getWorkspaceSession();
  if (session) redirect(session.landingPath);

  const { error } = await searchParams;
  return (
    <main
      id="main-content"
      className="workspace-mesh grid min-h-screen place-items-center px-4 py-10"
    >
      <LoginCard action={signInWithFeishu} errorCode={error ?? null} />
    </main>
  );
}
