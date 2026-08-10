import { redirect } from "next/navigation";

import { getWorkspaceSession } from "@/features/auth/workspace-session";

export const dynamic = "force-dynamic";

export default async function Home() {
  let destination: string;
  try {
    const session = await getWorkspaceSession();
    destination = session?.landingPath ?? "/login";
  } catch {
    destination = "/access-pending?reason=configuration_error";
  }
  redirect(destination);
}
