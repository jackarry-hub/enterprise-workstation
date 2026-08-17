export type AiConfigEnv = {
  encryptionKey: Uint8Array;
  supabaseServiceRoleKey: string;
};

const REQUIRED_KEYS = [
  "AI_CONFIG_ENCRYPTION_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

export function getAiConfigEnv(): AiConfigEnv {
  const values = {
    AI_CONFIG_ENCRYPTION_KEY: process.env.AI_CONFIG_ENCRYPTION_KEY?.trim(),
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
  };
  const missing = REQUIRED_KEYS.filter((key) => !values[key]);
  if (missing.length > 0) {
    throw new Error(`AI 服务端配置缺失：${missing.join(", ")}`);
  }

  const encodedKey = values.AI_CONFIG_ENCRYPTION_KEY as string;
  const encryptionKey = decodeEncryptionKey(encodedKey);
  if (!encryptionKey) {
    throw new Error("AI 服务端配置无效：AI_CONFIG_ENCRYPTION_KEY");
  }

  return {
    encryptionKey,
    supabaseServiceRoleKey: values.SUPABASE_SERVICE_ROLE_KEY as string,
  };
}

function decodeEncryptionKey(value: string) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    return null;
  }
  try {
    const decoded = Buffer.from(value, "base64");
    return decoded.length === 32 ? new Uint8Array(decoded) : null;
  } catch {
    return null;
  }
}
