import { createBoundToolAdapter, type HighRiskToolExecutor } from "@/features/ai-runtime/tool-adapter";

export function createCreatePaymentRecordAdapter(executor: HighRiskToolExecutor) {
  return createBoundToolAdapter("create_payment_record", executor);
}
