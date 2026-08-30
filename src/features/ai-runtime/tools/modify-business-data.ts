import { createBoundToolAdapter, type HighRiskToolExecutor } from "@/features/ai-runtime/tool-adapter";

export function createModifyBusinessDataAdapter(executor: HighRiskToolExecutor) {
  return createBoundToolAdapter("modify_business_data", executor);
}
