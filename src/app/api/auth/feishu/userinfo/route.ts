import { getAuthEnv } from "@/features/auth/auth-env";
import { handleFeishuUserInfo } from "@/features/auth/feishu-userinfo";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handleFeishuUserInfo(request, {
    tenantKey: getAuthEnv().feishuTenantKey,
  });
}
