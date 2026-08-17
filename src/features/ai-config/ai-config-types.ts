export const AI_PROVIDER = "deepseek" as const;
export const AI_BASE_URL = "https://api.deepseek.com" as const;
export const AI_MODELS = [
  "deepseek-v4-flash",
  "deepseek-chat",
  "deepseek-reasoner",
] as const;

export type AiModel = (typeof AI_MODELS)[number];

export type AiConfigRecord = {
  tenant_id: string;
  provider: typeof AI_PROVIDER;
  model_name: AiModel;
  api_base_url: typeof AI_BASE_URL;
  encrypted_api_key: string | null;
  api_key_iv: string | null;
  key_hint: string | null;
  updated_at: string;
  updated_by: string;
};

export type PublicAiConfig = {
  provider: typeof AI_PROVIDER;
  apiBaseUrl: typeof AI_BASE_URL;
  model: AiModel;
  keyConfigured: boolean;
  keyHint: string | null;
  updatedAt: string | null;
  canManage: boolean;
};

export function isAllowedAiModel(value: unknown): value is AiModel {
  return typeof value === "string" && AI_MODELS.some((model) => model === value);
}
