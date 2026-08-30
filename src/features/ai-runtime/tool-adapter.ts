export const HIGH_RISK_ACTIONS = [
  "send_message",
  "modify_business_data",
  "create_approval",
  "publish_content",
  "modify_permission",
  "delete_material",
  "export_data",
  "create_payment_record",
] as const;

export type HighRiskAction = (typeof HIGH_RISK_ACTIONS)[number];

export type HighRiskToolContext = {
  tenantId: string;
  organizationId: string;
  actorMemberId: number;
  authUserId: string;
  resourceId: string;
  confirmationId: string;
  executionId: string;
  idempotencyKey: string;
};

export type HighRiskToolResult = {
  success: boolean;
  safeSummary: Record<string, unknown>;
  errorCode?: string;
};

export type HighRiskToolAdapter = {
  action: HighRiskAction;
  execute: (payload: Record<string, unknown>, context: HighRiskToolContext) => Promise<HighRiskToolResult>;
};

export type HighRiskToolExecutor = HighRiskToolAdapter["execute"];

export function isHighRiskAction(value: unknown): value is HighRiskAction {
  return typeof value === "string" && (HIGH_RISK_ACTIONS as readonly string[]).includes(value);
}

export function createBoundToolAdapter(action: HighRiskAction, executor: HighRiskToolExecutor): HighRiskToolAdapter {
  return {
    action,
    async execute(payload, context) {
      const result = await executor(payload, context);
      if (!result || typeof result.success !== "boolean" || !result.safeSummary || typeof result.safeSummary !== "object" || Array.isArray(result.safeSummary)) {
        return { success: false, safeSummary: {}, errorCode: "tool_adapter_invalid_result" };
      }
      return result;
    },
  };
}
