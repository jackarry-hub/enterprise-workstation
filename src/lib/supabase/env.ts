const SUPABASE_ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
] as const;

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

  return {
    url: values.NEXT_PUBLIC_SUPABASE_URL as string,
    publishableKey: values.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string,
  };
}
