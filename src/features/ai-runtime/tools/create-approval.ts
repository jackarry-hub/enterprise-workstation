import { createBoundToolAdapter, type HighRiskToolExecutor } from "@/features/ai-runtime/tool-adapter";

export function createCreateApprovalAdapter(executor: HighRiskToolExecutor) {
  return createBoundToolAdapter("create_approval", executor);
}
