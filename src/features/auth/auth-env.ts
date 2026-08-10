export type AuthEnv = { appUrl: string; feishuTenantKey: string };

type AuthEnvSource = Readonly<Record<string, string | undefined>>;

export function getAuthEnv(env: AuthEnvSource = process.env): AuthEnv {
  const appUrl = env.NEXT_PUBLIC_APP_URL?.trim();
  const feishuTenantKey = env.FEISHU_TENANT_KEY?.trim();
  if (!appUrl || !feishuTenantKey) throw new Error("认证配置缺失");

  let parsed: URL;
  try {
    parsed = new URL(appUrl);
  } catch {
    throw new Error("应用地址必须使用 http 或 https");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("应用地址必须使用 http 或 https");
  }

  return { appUrl: parsed.origin, feishuTenantKey };
}
