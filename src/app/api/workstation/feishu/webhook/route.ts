import {
  createFeishuWebhookHandler,
  defaultFeishuWebhookDependencies,
} from "@/app/api/workstation/feishu/webhook/handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const POST = createFeishuWebhookHandler(defaultFeishuWebhookDependencies);
