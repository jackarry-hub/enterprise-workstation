import { describe, expect, it } from "vitest";

import {
  decryptApiKey,
  encryptApiKey,
} from "@/features/ai-config/ai-secret-crypto";

describe("AI API key encryption", () => {
  const key = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
  const value = "sk-example-private-8bcf";

  it("round-trips a secret without placing plaintext in stored fields", async () => {
    const encrypted = await encryptApiKey(value, key);

    expect(encrypted.hint).toBe("8bcf");
    expect(encrypted.ciphertext).not.toContain(value);
    expect(encrypted.iv).not.toContain(value);
    await expect(decryptApiKey(encrypted, key)).resolves.toBe(value);
  });

  it("uses a new IV for every encryption", async () => {
    const first = await encryptApiKey(value, key);
    const second = await encryptApiKey(value, key);

    expect(second.iv).not.toBe(first.iv);
    expect(second.ciphertext).not.toBe(first.ciphertext);
  });

  it("rejects decryption with a different key", async () => {
    const encrypted = await encryptApiKey(value, key);
    const wrongKey = Uint8Array.from({ length: 32 }, (_, index) => 255 - index);

    await expect(decryptApiKey(encrypted, wrongKey)).rejects.toThrow(
      "模型密钥解密失败",
    );
  });
});
