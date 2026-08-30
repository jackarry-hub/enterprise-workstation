import { createBoundToolAdapter, type HighRiskToolExecutor } from "@/features/ai-runtime/tool-adapter";

export function createPublishContentAdapter(executor: HighRiskToolExecutor) {
  return createBoundToolAdapter("publish_content", executor);
}
