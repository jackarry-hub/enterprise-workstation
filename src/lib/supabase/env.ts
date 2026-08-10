const SUPABASE_ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
] as const;

// Check the raw authority before URL parsing can normalize alternate host spellings.
const LOCAL_HTTP_URL = /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?=[/?#]|$)/;

export type SupabaseEnv = {
  url: string;
  publishableKey: string;
};

export function hasSupabaseEnv() {
  return SUPABASE_ENV_KEYS.every((key) => Boolean(process.env[key]?.trim()));
}

export function getSupabaseEnv(): SupabaseEnv {
  const values = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  };
  const missing = SUPABASE_ENV_KEYS.filter((key) => !values[key]?.trim());

  if (missing.length > 0) {
    throw new Error(`Supabase 配置缺失：${missing.join(", ")}`);
  }

  const rawUrl = (values.NEXT_PUBLIC_SUPABASE_URL as string).trim();
  const hasExplicitLocalHttpAuthority = LOCAL_HTTP_URL.test(rawUrl);
  const publishableKey = (
    values.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string
  ).trim();

  let projectUrl: URL;
  try {
    projectUrl = new URL(rawUrl);
  } catch {
    throw new Error("Supabase 配置无效：NEXT_PUBLIC_SUPABASE_URL");
  }

  const isSecure = projectUrl.protocol === "https:";
  const isAllowedLocalHttp = projectUrl.protocol === "http:"
    && hasExplicitLocalHttpAuthority;
  if (
    (!isSecure && !isAllowedLocalHttp)
    || projectUrl.username.length > 0
    || projectUrl.password.length > 0
  ) {
    throw new Error("Supabase 配置无效：NEXT_PUBLIC_SUPABASE_URL");
  }

  if (isSecretSupabaseKey(publishableKey)) {
    throw new Error(
      "Supabase 配置无效：NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    );
  }

  return {
    url: projectUrl.toString().replace(/\/$/, ""),
    publishableKey,
  };
}

function isSecretSupabaseKey(value: string) {
  if (/^(?:sb_secret_|service_role$)/i.test(value)) return true;

  const payload = value.split(".")[1];
  if (!payload || typeof globalThis.atob !== "function") return false;

  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
    const claims = JSON.parse(globalThis.atob(`${normalized}${padding}`));
    return claims?.role === "service_role";
  } catch {
    return false;
  }
}
