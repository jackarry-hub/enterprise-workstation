import type { SupabaseClient } from "@supabase/supabase-js";

import { parseWorkspaceAccess } from "@/features/auth/workspace-access";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function getWorkspaceApiSession(client?: SupabaseClient) {
  const supabase = client ?? await getSupabaseServerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData.user;
  if (userError || !user) return null;

  const { data, error } = await supabase.rpc("current_workspace_access");
  if (error) return null;
  const session = parseWorkspaceAccess(data);
  return session?.authUserId === user.id ? session : null;
}
