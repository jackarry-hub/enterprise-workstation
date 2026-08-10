import { redirect } from "next/navigation";

import { getWorkspaceSession } from "@/features/auth/workspace-session";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getWorkspaceSession();
  redirect(session?.landingPath ?? "/login");
}
