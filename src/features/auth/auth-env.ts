export type AuthEnv = { appUrl: string };

type AuthEnvSource = Readonly<Record<string, string | undefined>>;

export function getAuthEnv(env: AuthEnvSource = process.env): AuthEnv {
  const appUrl = env.NEXT_PUBLIC_APP_URL?.trim();
  if (!appUrl) throw new Error("认证配置缺失");

  let parsed: URL;
  try {
    parsed = new URL(appUrl);
  } catch {
    throw new Error("应用地址必须使用 http 或 https");
  }

  const localHostname = ["localhost", "127.0.0.1", "::1"].includes(
    parsed.hostname,
  );
  if (
    (parsed.protocol !== "https:"
      && !(parsed.protocol === "http:" && localHostname))
    || parsed.username
    || parsed.password
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash
  ) {
    throw new Error("应用地址必须使用 http 或 https");
  }

  return { appUrl: parsed.origin };
}

export function getAuthRedirectOrigin(
  requestUrl: URL,
  env: AuthEnvSource = process.env,
) {
  try {
    return getAuthEnv(env).appUrl;
  } catch {
    return requestUrl.origin;
  }
}

export function getLegacyFeishuAdapterTenantKey(
  env: AuthEnvSource = process.env,
) {
  const tenantKey = env.FEISHU_TENANT_KEY?.trim();
  if (!tenantKey) throw new Error("认证配置缺失");
  return tenantKey;
}
