const FEISHU_USERINFO_URL =
  "https://open.feishu.cn/open-apis/authen/v1/user_info";

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
  if (data.tenant_key !== tenantKey) throw new Error("wrong_feishu_tenant");
  if (
    typeof data.open_id !== "string" ||
    typeof data.union_id !== "string" ||
    typeof data.name !== "string"
  ) {
    throw new Error("invalid_feishu_identity");
  }

  return {
    sub: data.open_id,
    name: data.name,
    ...(typeof data.avatar_url === "string"
      ? { picture: data.avatar_url }
      : {}),
    ...(typeof data.email === "string" ? { email: data.email } : {}),
    open_id: data.open_id,
    union_id: data.union_id,
    tenant_key: data.tenant_key,
  };
}

export async function handleFeishuUserInfo(
  request: Request,
  dependencies: { tenantKey: string; fetchImpl?: typeof fetch },
) {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ") || authorization.length > 4096) {
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
