import { createBoundToolAdapter, type HighRiskToolExecutor } from "@/features/ai-runtime/tool-adapter";

export function createExportDataAdapter(executor: HighRiskToolExecutor) {
  return createBoundToolAdapter("export_data", executor);
}
