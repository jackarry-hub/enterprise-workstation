import { redirect } from "next/navigation";

import { FORMAL_WORKSTATION_PATH } from "@/features/auth/workspace-access";
import { getWorkspaceSession } from "@/features/auth/workspace-session";

export const dynamic = "force-dynamic";

export default async function Home() {
  let destination: string;
  try {
    const session = await getWorkspaceSession();
    destination = session ? FORMAL_WORKSTATION_PATH : "/login";
  } catch {
    destination = "/access-pending?reason=configuration_error";
  }
  redirect(destination);
}
