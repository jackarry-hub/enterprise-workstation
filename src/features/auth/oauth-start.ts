import { getAuthEnv } from "@/features/auth/auth-env";
import { getEnabledOAuthProvider } from "@/features/auth/oauth-provider-registry";
import { getSafeReturnPath, isPublicAuthPath } from "@/features/auth/workspace-access";
import { getSupabaseServerClient } from "@/lib/supabase/server";

function buildOAuthCallbackUrl(appUrl: string, returnPath?: string | null) {
  const callback = new URL("/auth/callback", appUrl);
  const safeReturnPath = getSafeReturnPath(returnPath);
  if (!safeReturnPath) return callback.href;
  const destination = new URL(safeReturnPath, callback.origin);
  if (isPublicAuthPath(destination.pathname)) return callback.href;
  callback.searchParams.set("next", safeReturnPath);
  return callback.href;
}

export async function getOAuthStartUrl(code: string, returnPath?: string | null) {
  const provider = getEnabledOAuthProvider(code);
  if (!provider) return null;
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: provider.supabaseProvider,
    options: { redirectTo: buildOAuthCallbackUrl(getAuthEnv().appUrl, returnPath) },
  });
  return error ? null : data.url;
}
