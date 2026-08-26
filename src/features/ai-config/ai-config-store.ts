import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AI_BASE_URL,
  AI_PROVIDER,
  type AiModel,
  type AiConfigRecord,
  type PublicAiConfig,
} from "@/features/ai-config/ai-config-types";

const COLUMNS = "tenant_id,provider,model_name,api_base_url,encrypted_api_key,api_key_iv,key_hint,updated_at,updated_by" as const;

export type AiConfigUpdateCommand = {
  provider: typeof AI_PROVIDER;
  model: AiModel;
  encryptedKey: string | null;
  keyHint: string | null;
  requestId: string;
};

export class AiConfigStoreError extends Error {
  constructor(readonly code: string | undefined) {
    super("AI configuration command failed");
    this.name = "AiConfigStoreError";
  }
}

type AiConfigUpdateRow = {
  provider: typeof AI_PROVIDER;
  api_base_url: typeof AI_BASE_URL;
  model_name: AiModel;
  key_configured: boolean;
  key_hint: string | null;
  updated_at: string;
};

export function sanitizeAiConfig(
  record: AiConfigRecord | null,
  canManage: boolean,
): PublicAiConfig {
  return {
    provider: AI_PROVIDER,
    apiBaseUrl: AI_BASE_URL,
    model: record?.model_name ?? "deepseek-v4-flash",
    keyConfigured: Boolean(record?.encrypted_api_key && record.api_key_iv),
    keyHint: canManage ? record?.key_hint ?? null : null,
    updatedAt: record?.updated_at ?? null,
    canManage,
  };
}

export function createAiConfigStore(client: SupabaseClient) {
  return {
    async get(tenantId: string): Promise<AiConfigRecord | null> {
      const { data, error } = await client
        .from("ai_provider_configs")
        .select(COLUMNS)
        .eq("tenant_id", tenantId)
        .eq("provider", AI_PROVIDER)
        .maybeSingle();
      if (error) throw new Error("读取模型配置失败");
      return data as AiConfigRecord | null;
    },

    async update(command: AiConfigUpdateCommand): Promise<Omit<PublicAiConfig, "canManage">> {
      const { data, error } = await client.rpc(
        "update_current_ai_provider_config",
        {
          provider: command.provider,
          model: command.model,
          encrypted_key: command.encryptedKey,
          key_hint: command.keyHint,
          request_id: command.requestId,
        },
      );
      if (error || !data) throw new AiConfigStoreError(error?.code);
      const row = data as AiConfigUpdateRow;
      return {
        provider: row.provider,
        apiBaseUrl: row.api_base_url,
        model: row.model_name,
        keyConfigured: row.key_configured,
        keyHint: row.key_hint,
        updatedAt: row.updated_at,
      };
    },
  };
}

export type AiConfigStore = ReturnType<typeof createAiConfigStore>;
