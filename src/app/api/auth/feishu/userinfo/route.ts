import { getLegacyFeishuAdapterTenantKey } from "@/features/auth/auth-env";
import { handleFeishuUserInfo } from "@/features/auth/feishu-userinfo";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  let tenantKey: string;
  try {
    tenantKey = getLegacyFeishuAdapterTenantKey();
  } catch {
    return Response.json(
      { error: "server_misconfigured" },
      { status: 500 },
    );
  }

  return handleFeishuUserInfo(request, {
    tenantKey,
  });
}
