import {
  createOAuthStartHandler,
  defaultOAuthStartDependencies,
} from "@/app/auth/login/feishu/handler";

export const dynamic = "force-dynamic";
export const GET = createOAuthStartHandler(defaultOAuthStartDependencies);
