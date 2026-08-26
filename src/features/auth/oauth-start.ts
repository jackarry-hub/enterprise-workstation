import { getAuthEnv } from "@/features/auth/auth-env";
import { getEnabledOAuthProvider } from "@/features/auth/oauth-provider-registry";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  createFeishuOAuthAttempt,
  type FeishuOAuthAttempt,
} from "@/features/auth/feishu-oauth-attempt";

function buildOAuthCallbackUrl(appUrl: string, attempt: FeishuOAuthAttempt) {
  const callback = new URL("/auth/callback", appUrl);
  callback.searchParams.set("attempt", attempt.attemptId);
  if (attempt.returnPath) callback.searchParams.set("next", attempt.returnPath);
  return callback.href;
}

export type OAuthStartResult = { url: string; nonce: string; maxAge: number };

export async function createOAuthStart(
  code: string,
  returnPath: string | null | undefined,
  dependencies: {
    createAttempt: (returnPath?: string | null) => Promise<FeishuOAuthAttempt>;
    signIn: (redirectTo: string) => Promise<{ url: string | null }>;
    appUrl: string;
  },
): Promise<OAuthStartResult | null> {
  const provider = getEnabledOAuthProvider(code);
  if (!provider) return null;
  const attempt = await dependencies.createAttempt(returnPath);
  const data = await dependencies.signIn(buildOAuthCallbackUrl(dependencies.appUrl, attempt));
  return data.url ? { url: data.url, nonce: attempt.nonce, maxAge: attempt.maxAge } : null;
}

export async function getOAuthStartUrl(code: string, returnPath?: string | null) {
  const provider = getEnabledOAuthProvider(code);
  if (!provider) return null;
  const supabase = await getSupabaseServerClient();
  return createOAuthStart(code, returnPath, {
    createAttempt: createFeishuOAuthAttempt,
    appUrl: getAuthEnv().appUrl,
    signIn: async (redirectTo) => {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: provider.supabaseProvider,
        options: { redirectTo },
      });
      return { url: error ? null : data.url };
    },
  });
}
