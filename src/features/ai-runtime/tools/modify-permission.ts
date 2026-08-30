import { createBoundToolAdapter, type HighRiskToolExecutor } from "@/features/ai-runtime/tool-adapter";

export function createModifyPermissionAdapter(executor: HighRiskToolExecutor) {
  return createBoundToolAdapter("modify_permission", executor);
}
