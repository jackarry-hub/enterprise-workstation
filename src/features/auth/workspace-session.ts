import { redirect } from "next/navigation";
import { cache } from "react";

import { parseWorkspaceAccess } from "@/features/auth/workspace-access";
import { customerDemoSessions } from "@/features/demo/customer-demo-data";
import { isCustomerDemoMode } from "@/features/demo/customer-demo-mode";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<
  ReturnType<typeof getSupabaseServerClient>
>;

async function getAuthenticatedSubject(supabase: SupabaseServerClient) {
  const { data, error } = await supabase.auth.getClaims();
  if (error) throw new Error("无法验证当前登录状态");

  const subject = data?.claims?.sub;
  return typeof subject === "string" && subject.length > 0 ? subject : null;
}

export const getWorkspaceSession = cache(async () => {
  const supabase = await getSupabaseServerClient();
  const subject = await getAuthenticatedSubject(supabase);
  if (!subject) return null;

  const { data, error } = await supabase.rpc("current_workspace_access");
  if (error) throw new Error("无法读取当前工作身份");

  const session = parseWorkspaceAccess(data);
  return session?.authUserId === subject ? session : null;
});

export async function requireWorkspaceSession() {
  if (isCustomerDemoMode()) return customerDemoSessions[0];
  const supabase = await getSupabaseServerClient();
  const subject = await getAuthenticatedSubject(supabase);
  if (!subject) redirect("/login");

  const session = await getWorkspaceSession();
  if (!session) redirect("/access-pending?reason=not_provisioned");
  return session;
}
