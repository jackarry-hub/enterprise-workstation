import { createBoundToolAdapter, type HighRiskToolExecutor } from "@/features/ai-runtime/tool-adapter";

export function createSendMessageAdapter(executor: HighRiskToolExecutor) {
  return createBoundToolAdapter("send_message", executor);
}
