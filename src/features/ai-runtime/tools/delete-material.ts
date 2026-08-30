import { createBoundToolAdapter, type HighRiskToolExecutor } from "@/features/ai-runtime/tool-adapter";

export function createDeleteMaterialAdapter(executor: HighRiskToolExecutor) {
  return createBoundToolAdapter("delete_material", executor);
}
