import { describe, expect, it } from "vitest";

import { handleAiChat } from "@/features/ai-config/ai-chat-handler";
import type { AiConfigRecord } from "@/features/ai-config/ai-config-types";
import { encryptApiKey } from "@/features/ai-config/ai-secret-crypto";
import { executiveWorkspaceSession } from "@/test/workspace-session-test-utils";

const encryptionKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const secret = "sk-server-only-secret";

async function configuredRecord(): Promise<AiConfigRecord> {
  const encrypted = await encryptApiKey(secret, encryptionKey);
  return {
    tenant_id: executiveWorkspaceSession.tenantId,
    provider: "deepseek",
    model_name: "deepseek-chat",
    api_base_url: "https://api.deepseek.com",
    encrypted_api_key: encrypted.ciphertext,
    api_key_iv: encrypted.iv,
    key_hint: encrypted.hint,
    updated_at: "2026-08-17T12:00:00.000Z",
    updated_by: executiveWorkspaceSession.authUserId,
  };
}

function request(body: unknown) {
  return new Request("https://workspace.test/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("handleAiChat", () => {
  it("returns 401 without a workspace session", async () => {
    const response = await handleAiChat(request({ messages: [] }), {
      session: null,
      encryptionKey,
      store: { get: async () => null },
      fetchImpl: fetch,
      consumeRateLimit: () => true,
    });

    expect(response.status).toBe(401);
  });

  it("requires a configured encrypted server key", async () => {
    const response = await handleAiChat(
      request({ messages: [{ role: "user", content: "你好" }] }),
      {
        session: executiveWorkspaceSession,
        encryptionKey,
        store: { get: async () => null },
        fetchImpl: fetch,
        consumeRateLimit: () => true,
      },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "ai_not_configured" });
  });

  it("rejects oversized and structurally invalid requests before upstream access", async () => {
    const record = await configuredRecord();
    let upstreamCalls = 0;
    const fetchImpl: typeof fetch = async () => {
      upstreamCalls += 1;
      return Response.json({});
    };
    const common = {
      session: executiveWorkspaceSession,
      encryptionKey,
      store: { get: async () => record },
      fetchImpl,
      consumeRateLimit: () => true,
    };
    const tooLarge = await handleAiChat(
      request({ messages: [{ role: "user", content: "x".repeat(66_000) }] }),
      common,
    );
    const tooMany = await handleAiChat(
      request({
        messages: Array.from({ length: 31 }, () => ({
          role: "user",
          content: "hello",
        })),
      }),
      common,
    );

    expect(tooLarge.status).toBe(413);
    expect(tooMany.status).toBe(400);
    expect(upstreamCalls).toBe(0);
  });

  it("decrypts the key server-side and forwards only to the fixed DeepSeek endpoint", async () => {
    const record = await configuredRecord();
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const fetchImpl: typeof fetch = async (input, init) => {
      capturedUrl = String(input);
      capturedInit = init;
      return Response.json({ choices: [{ message: { content: "完成" } }] });
    };
    const response = await handleAiChat(
      request({
        model: "browser-override-must-be-ignored",
        messages: [{ role: "user", content: "生成计划" }],
        max_tokens: 900,
      }),
      {
        session: executiveWorkspaceSession,
        encryptionKey,
        store: { get: async () => record },
        fetchImpl,
        consumeRateLimit: () => true,
      },
    );

    expect(response.status).toBe(200);
    expect(capturedUrl).toBe("https://api.deepseek.com/chat/completions");
    expect(new Headers(capturedInit?.headers).get("Authorization")).toBe(
      `Bearer ${secret}`,
    );
    expect(JSON.parse(String(capturedInit?.body))).toMatchObject({
      model: "deepseek-chat",
      messages: [{ role: "user", content: "生成计划" }],
      max_tokens: 900,
    });
    expect(JSON.stringify(await response.json())).not.toContain(secret);
  });

  it("hides upstream authentication details and handles timeouts", async () => {
    const record = await configuredRecord();
    const authResponse = await handleAiChat(
      request({ messages: [{ role: "user", content: "hello" }] }),
      {
        session: executiveWorkspaceSession,
        encryptionKey,
        store: { get: async () => record },
        fetchImpl: async () => new Response(`bad key ${secret}`, { status: 401 }),
        consumeRateLimit: () => true,
      },
    );
    const timeoutResponse = await handleAiChat(
      request({ messages: [{ role: "user", content: "hello" }] }),
      {
        session: executiveWorkspaceSession,
        encryptionKey,
        store: { get: async () => record },
        fetchImpl: async () => {
          throw new DOMException("timed out", "TimeoutError");
        },
        consumeRateLimit: () => true,
      },
    );

    expect(authResponse.status).toBe(502);
    expect(JSON.stringify(await authResponse.json())).not.toContain(secret);
    expect(timeoutResponse.status).toBe(504);
  });

  it("returns 429 when the tenant/user limit is exhausted", async () => {
    const response = await handleAiChat(
      request({ messages: [{ role: "user", content: "hello" }] }),
      {
        session: executiveWorkspaceSession,
        encryptionKey,
        store: { get: async () => await configuredRecord() },
        fetchImpl: fetch,
        consumeRateLimit: () => false,
      },
    );

    expect(response.status).toBe(429);
  });
});
