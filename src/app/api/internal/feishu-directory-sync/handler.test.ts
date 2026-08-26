import { describe, expect, it } from "vitest";

import { createFeishuDirectorySyncCronHandler } from "@/app/api/internal/feishu-directory-sync/handler";

describe("Feishu directory cron", () => {
  it("uses a constant-time bearer boundary and never invokes work for a wrong secret", async () => {
    let runs = 0;
    const handler = createFeishuDirectorySyncCronHandler({
      cronSecret: "s".repeat(32),
      run: async () => { runs += 1; return { runId: "run-1", cursor: "8", status: "completed", retryAfter: null }; },
    });
    const response = await handler(new Request("https://work.quantxy.test/api/internal/feishu-directory-sync", {
      method: "POST", headers: { authorization: "Bearer wrong" },
    }));
    expect(response.status).toBe(401);
    expect(runs).toBe(0);
  });

  it("returns only sanitized worker control metadata", async () => {
    const secret = "s".repeat(32);
    const response = await createFeishuDirectorySyncCronHandler({
      cronSecret: secret,
      run: async () => ({ runId: "run-1", cursor: "8", status: "completed", retryAfter: null }),
    })(new Request("https://work.quantxy.test/api/internal/feishu-directory-sync", {
      method: "POST", headers: { authorization: `Bearer ${secret}` },
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ runId: "run-1", cursor: "8", status: "completed", retryAfter: null });
  });
});
