import type { SupabaseClient } from "@supabase/supabase-js";

import { parseWorkspaceAccess } from "@/features/auth/workspace-access";
import type { DemoAuthEnv } from "@/features/demo-auth/demo-auth-env";
import { getDemoAuthEnv } from "@/features/demo-auth/demo-auth-env";
import {
  createDemoWorkspaceSession,
  readDemoSessionToken,
  verifyDemoSessionToken,
} from "@/features/demo-auth/demo-session";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function getWorkspaceApiSession(
  request?: Request,
  client?: SupabaseClient,
  providedDemoEnv?: DemoAuthEnv,
) {
  if (request) {
    const demoEnv = providedDemoEnv ?? readDemoEnv();
    if (demoEnv) {
      const token = readDemoSessionToken(request.headers.get("cookie"));
      const claims = await verifyDemoSessionToken(token, demoEnv);
      if (claims) return createDemoWorkspaceSession(claims);
    }
  }

  const supabase = client ?? await getSupabaseServerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData.user;
  if (userError || !user) return null;

  const { data, error } = await supabase.rpc("current_workspace_access");
  if (error) return null;
  const session = parseWorkspaceAccess(data);
  return session?.authUserId === user.id ? session : null;
}

function readDemoEnv() {
  try {
    return getDemoAuthEnv();
  } catch {
    return null;
  }
}
