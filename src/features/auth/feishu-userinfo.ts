import { buildProviderIdentityClaims } from "@/features/auth/provider-identity-claims.mjs";

const FEISHU_USERINFO_URL =
  "https://open.feishu.cn/open-apis/authen/v1/user_info";
const TOKEN68_PATTERN = /^[A-Za-z0-9._~+/-]+=*$/;

type FeishuEnvelope = {
  code?: number;
  data?: Record<string, unknown>;
};

export function normalizeFeishuUserInfo(
  body: FeishuEnvelope,
  tenantKey: string,
) {
  const data = body.data;
  if (body.code !== 0 || !data) throw new Error("invalid_feishu_response");
  if (
    typeof data.tenant_key !== "string" ||
    data.tenant_key.trim().length === 0
  ) {
    throw new Error("invalid_feishu_identity");
  }
  const providerTenantKey = data.tenant_key.trim();
  if (providerTenantKey !== tenantKey.trim()) {
    throw new Error("wrong_feishu_tenant");
  }
  if (typeof data.name !== "string" || data.name.trim().length === 0) {
    throw new Error("invalid_feishu_identity");
  }

  let claims;
  try {
    claims = buildProviderIdentityClaims({
      openId: data.open_id,
      unionId: data.union_id,
      email: data.email,
      emailVerified:
        data.email_verified === undefined || data.email_verified === true,
      ignoreInvalidEmail: true,
    });
  } catch {
    throw new Error("invalid_feishu_identity");
  }

  return {
    sub: claims.providerSubject,
    provider_subject: claims.providerSubject,
    provider_tenant_key: providerTenantKey,
    provider_match_keys: claims.providerMatchKeys,
    name: data.name.trim(),
    ...(typeof data.avatar_url === "string"
      ? { picture: data.avatar_url }
      : {}),
    ...(claims.verifiedEmail
      ? {
          email: claims.verifiedEmail,
          verified_email: claims.verifiedEmail,
        }
      : {}),
    ...(claims.normalizedOpenId
      ? { open_id: claims.normalizedOpenId }
      : {}),
    ...(claims.normalizedUnionId
      ? { union_id: claims.normalizedUnionId }
      : {}),
    tenant_key: providerTenantKey,
  };
}

export async function handleFeishuUserInfo(
  request: Request,
  dependencies: { tenantKey: string; fetchImpl?: typeof fetch },
) {
  const authorization = request.headers.get("authorization") ?? "";
  const bearerToken = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";
  if (!TOKEN68_PATTERN.test(bearerToken) || authorization.length > 4096) {
    return Response.json({ error: "invalid_request" }, { status: 401 });
  }

  try {
    const upstream = await (dependencies.fetchImpl ?? fetch)(
      FEISHU_USERINFO_URL,
      {
        method: "GET",
        cache: "no-store",
        headers: { Authorization: authorization, Accept: "application/json" },
        signal: AbortSignal.timeout(5000),
      },
    );
    if (upstream.status === 401) {
      return Response.json({ error: "invalid_request" }, { status: 401 });
    }
    if (!upstream.ok) {
      return Response.json({ error: "upstream_failed" }, { status: 502 });
    }

    const identity = normalizeFeishuUserInfo(
      (await upstream.json()) as FeishuEnvelope,
      dependencies.tenantKey,
    );
    return Response.json(identity, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    const wrongTenant =
      error instanceof Error && error.message === "wrong_feishu_tenant";
    return Response.json(
      { error: wrongTenant ? "wrong_feishu_tenant" : "upstream_failed" },
      { status: wrongTenant ? 403 : 502 },
    );
  }
}
