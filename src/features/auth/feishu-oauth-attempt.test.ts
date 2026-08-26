import { describe, expect, it } from "vitest";

import {
  consumeFeishuOAuthAttempt,
  createFeishuOAuthAttempt,
  type FeishuOAuthAttemptRepository,
} from "@/features/auth/feishu-oauth-attempt";

function repository(): FeishuOAuthAttemptRepository & { rows: Map<string, { digest: string; used: boolean }> } {
  const rows = new Map<string, { digest: string; used: boolean }>();
  return {
    rows,
    async create(input) {
      rows.set(input.attemptId, { digest: input.nonceDigest, used: false });
    },
    async consume(input) {
      const row = rows.get(input.attemptId);
      if (!row || row.used || row.digest !== input.nonceDigest) return false;
      row.used = true;
      return true;
    },
  };
}

describe("Feishu OAuth application attempt", () => {
  it("persists only a nonce digest and a validated relative return path", async () => {
    const repo = repository();
    const attempt = await createFeishuOAuthAttempt("/finance?tab=month", repo);
    const stored = repo.rows.get(attempt.attemptId);

    expect(attempt.nonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(stored?.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(stored?.digest).not.toContain(attempt.nonce);
    expect(attempt.returnPath).toBe("/finance?tab=month");
  });

  it("atomically accepts one matching nonce and rejects replay", async () => {
    const repo = repository();
    const attempt = await createFeishuOAuthAttempt("https://evil.example", repo);

    await expect(consumeFeishuOAuthAttempt(attempt.attemptId, attempt.nonce, repo)).resolves.toBe(true);
    await expect(consumeFeishuOAuthAttempt(attempt.attemptId, attempt.nonce, repo)).resolves.toBe(false);
    expect(attempt.returnPath).toBeNull();
  });
});
