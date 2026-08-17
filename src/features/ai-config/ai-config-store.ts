import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AI_BASE_URL,
  AI_PROVIDER,
  type AiConfigRecord,
  type PublicAiConfig,
} from "@/features/ai-config/ai-config-types";

const COLUMNS = "tenant_id,provider,model_name,api_base_url,encrypted_api_key,api_key_iv,key_hint,updated_at,updated_by" as const;

export function sanitizeAiConfig(
  record: AiConfigRecord | null,
  canManage: boolean,
): PublicAiConfig {
  return {
    provider: AI_PROVIDER,
    apiBaseUrl: AI_BASE_URL,
    model: record?.model_name ?? "deepseek-v4-flash",
    keyConfigured: Boolean(record?.encrypted_api_key && record.api_key_iv),
    keyHint: record?.key_hint ?? null,
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

    async upsert(record: AiConfigRecord): Promise<AiConfigRecord> {
      const { data, error } = await client
        .from("ai_provider_configs")
        .upsert(record, { onConflict: "tenant_id,provider" })
        .select(COLUMNS)
        .single();
      if (error || !data) throw new Error("保存模型配置失败");
      return data as AiConfigRecord;
    },
  };
}

export type AiConfigStore = ReturnType<typeof createAiConfigStore>;
