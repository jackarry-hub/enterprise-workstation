import { webcrypto } from "node:crypto";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type EncryptedApiKey = {
  ciphertext: string;
  iv: string;
  hint: string;
};

export async function encryptApiKey(
  value: string,
  key: Uint8Array,
): Promise<EncryptedApiKey> {
  const cryptoKey = await importEncryptionKey(key, ["encrypt"]);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const encrypted = await webcrypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    encoder.encode(value),
  );

  return {
    ciphertext: Buffer.from(encrypted).toString("base64"),
    iv: Buffer.from(iv).toString("base64"),
    hint: value.slice(-4),
  };
}

export async function decryptApiKey(
  payload: Pick<EncryptedApiKey, "ciphertext" | "iv">,
  key: Uint8Array,
) {
  try {
    const cryptoKey = await importEncryptionKey(key, ["decrypt"]);
    const decrypted = await webcrypto.subtle.decrypt(
      { name: "AES-GCM", iv: Buffer.from(payload.iv, "base64") },
      cryptoKey,
      Buffer.from(payload.ciphertext, "base64"),
    );
    return decoder.decode(decrypted);
  } catch {
    throw new Error("模型密钥解密失败");
  }
}

async function importEncryptionKey(
  value: Uint8Array,
  usages: KeyUsage[],
) {
  if (value.byteLength !== 32) {
    throw new Error("模型密钥加密配置无效");
  }
  return webcrypto.subtle.importKey(
    "raw",
    value,
    { name: "AES-GCM" },
    false,
    usages,
  );
}
