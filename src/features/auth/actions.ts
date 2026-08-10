"use server";

import { redirect } from "next/navigation";

import { getAuthEnv } from "@/features/auth/auth-env";
import { getEnabledOAuthProvider } from "@/features/auth/oauth-provider-registry";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function signInWithOAuthProvider(code: string) {
  const provider = getEnabledOAuthProvider(code);
  if (!provider) redirect("/login?error=login_unavailable");

  let supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>;
  let appUrl: string;
  try {
    supabase = await getSupabaseServerClient();
    appUrl = getAuthEnv().appUrl;
  } catch {
    redirect("/access-pending?reason=configuration_error");
  }

  let oauthUrl: string | null = null;
  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: provider.supabaseProvider,
      options: { redirectTo: `${appUrl}/auth/callback` },
    });
    if (!error) oauthUrl = data.url;
  } catch {
    oauthUrl = null;
  }

  if (!oauthUrl) {
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      // The stable employee-facing error remains available even if cleanup fails.
    }
    redirect("/access-pending?reason=auth_error");
  }

  redirect(oauthUrl);
}

export async function signInWithFeishu() {
  return signInWithOAuthProvider("feishu");
}

export async function signOut() {
  try {
    const supabase = await getSupabaseServerClient();
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // Returning to login is safe even when there is no readable local session.
  }
  redirect("/login?status=signed_out");
}
