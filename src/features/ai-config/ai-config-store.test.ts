import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import {
  createAiConfigStore,
  sanitizeAiConfig,
} from "@/features/ai-config/ai-config-store";
import {
  AI_MODELS,
  isAllowedAiModel,
  type AiConfigRecord,
} from "@/features/ai-config/ai-config-types";

const record: AiConfigRecord = {
  tenant_id: "11111111-1111-4111-8111-111111111111",
  provider: "deepseek",
  model_name: "deepseek-v4-flash",
  api_base_url: "https://api.deepseek.com",
  encrypted_api_key: "ciphertext-value",
  api_key_iv: "iv-value",
  key_hint: "8bcf",
  updated_at: "2026-08-17T12:00:00.000Z",
  updated_by: "22222222-2222-4222-8222-222222222222",
};

describe("AI config types and sanitizer", () => {
  it("accepts only the supported DeepSeek models", () => {
    expect(AI_MODELS).toEqual([
      "deepseek-v4-flash",
      "deepseek-chat",
      "deepseek-reasoner",
    ]);
    expect(isAllowedAiModel("deepseek-chat")).toBe(true);
    expect(isAllowedAiModel("custom-model")).toBe(false);
  });

  it("returns only safe configuration metadata", () => {
    expect(sanitizeAiConfig(record, true)).toEqual({
      provider: "deepseek",
      apiBaseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      keyConfigured: true,
      keyHint: "8bcf",
      updatedAt: "2026-08-17T12:00:00.000Z",
      canManage: true,
    });
  });
});

describe("createAiConfigStore", () => {
  it("scopes configuration reads to the tenant and provider", async () => {
    const filters: Array<[string, string]> = [];
    const query = {
      select() {
        return this;
      },
      eq(column: string, value: string) {
        filters.push([column, value]);
        return this;
      },
      async maybeSingle() {
        return { data: record, error: null };
      },
    };
    const client = {
      from(table: string) {
        expect(table).toBe("ai_provider_configs");
        return query;
      },
    } as unknown as SupabaseClient;

    const result = await createAiConfigStore(client).get(record.tenant_id);

    expect(result).toEqual(record);
    expect(filters).toEqual([
      ["tenant_id", record.tenant_id],
      ["provider", "deepseek"],
    ]);
  });

  it("upserts one tenant provider record and returns the saved row", async () => {
    let saved: unknown;
    let conflict = "";
    const query = {
      upsert(value: unknown, options: { onConflict: string }) {
        saved = value;
        conflict = options.onConflict;
        return this;
      },
      select() {
        return this;
      },
      async single() {
        return { data: record, error: null };
      },
    };
    const client = {
      from() {
        return query;
      },
    } as unknown as SupabaseClient;

    const result = await createAiConfigStore(client).upsert(record);

    expect(saved).toEqual(record);
    expect(conflict).toBe("tenant_id,provider");
    expect(result).toEqual(record);
  });
});
