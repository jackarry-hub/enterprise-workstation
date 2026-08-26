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

  it("retries one invalid structured response and returns the next valid JSON object", async () => {
    const record = await configuredRecord();
    const upstreamBodies: Array<Record<string, unknown>> = [];
    let call = 0;
    const fetchImpl: typeof fetch = async (_input, init) => {
      upstreamBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      call += 1;
      if (call === 1) {
        return Response.json({
          choices: [{ finish_reason: "stop", message: { content: "" } }],
        });
      }
      return Response.json({
        choices: [{
          finish_reason: "stop",
          message: { content: '{"tasks":[{"title":"客户访谈"}]}' },
        }],
      });
    };

    const response = await handleAiChat(request({
      messages: [{ role: "user", content: "请用JSON拆解任务" }],
      max_tokens: 2_400,
      structured_output: true,
    }), {
      session: executiveWorkspaceSession,
      encryptionKey,
      store: { get: async () => record },
      fetchImpl,
      consumeRateLimit: () => true,
    });

    expect(response.status).toBe(200);
    expect(call).toBe(2);
    expect(upstreamBodies).toHaveLength(2);
    for (const body of upstreamBodies) {
      expect(body).toMatchObject({
        model: "deepseek-chat",
        max_tokens: 2_400,
        response_format: { type: "json_object" },
        thinking: { type: "disabled" },
      });
    }
    await expect(response.json()).resolves.toEqual({
      choices: [{
        finish_reason: "stop",
        message: { content: '{"tasks":[{"title":"客户访谈"}]}' },
      }],
    });
  });

  it("records authenticated agent invocations after a successful model call", async () => {
    const record = await configuredRecord();
    const headers: unknown[] = [];
    const finals: unknown[] = [];
    let providerBody: Record<string, unknown> | null = null;
    const response = await handleAiChat(request({
      agent_public_id: "33333333-3333-4333-8333-333333333333",
      system: "browser top-level override",
      messages: [
        { role: "system", content: "browser message override" },
        { role: "user", content: "把官网项目拆成任务" },
      ],
      max_tokens: 900,
    }), {
      session: executiveWorkspaceSession,
      encryptionKey,
      store: { get: async () => record },
      fetchImpl: async (_input, init) => {
        providerBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json({ choices: [{ message: { content: "已生成任务拆解方案" } }] });
      },
      consumeRateLimit: () => true,
      authorizeAgentInvocation: async () => ({
        definitionId: 81,
        tenantId: 2,
        organizationId: 3,
        version: "v2",
        systemPrompt: "database-controlled Agent prompt",
        model: "deepseek-reasoner",
        toolCodes: ["task.read"],
      }),
      startAgentInvocation: async (payload) => {
        headers.push(payload);
        return { invocationId: "44444444-4444-4444-8444-444444444444" };
      },
      finalizeAgentInvocation: async (payload) => {
        finals.push(payload);
      },
    });

    expect(response.status).toBe(200);
    expect(headers).toEqual([
      expect.objectContaining({
        agentPublicId: "33333333-3333-4333-8333-333333333333",
        actorMemberId: executiveWorkspaceSession.member.id,
        modelCode: "deepseek-reasoner",
        promptVersion: "v2",
        status: "running",
        inputSummary: "把官网项目拆成任务",
        startedAt: expect.any(String),
      }),
    ]);
    expect(finals).toEqual([
      expect.objectContaining({
        invocationId: "44444444-4444-4444-8444-444444444444",
        status: "succeeded",
        outputSummary: "已生成任务拆解方案",
        errorCode: "",
        completedAt: expect.any(String),
      }),
    ]);
    expect(providerBody).toMatchObject({
      model: "deepseek-reasoner",
      messages: [
        { role: "system", content: "database-controlled Agent prompt" },
        { role: "user", content: "把官网项目拆成任务" },
      ],
    });
    expect(JSON.stringify(providerBody)).not.toMatch(/browser.*override/);
  });

  it("persists an authorized running header before provider work and finalizes it afterward", async () => {
    const record = await configuredRecord();
    const events: string[] = [];
    const response = await handleAiChat(request({
      agent_public_id: "33333333-3333-4333-8333-333333333333",
      messages: [{ role: "user", content: "运行 Agent" }],
    }), {
      session: executiveWorkspaceSession,
      encryptionKey,
      store: { get: async () => record },
      fetchImpl: async () => {
        events.push("provider");
        return Response.json({ choices: [{ message: { content: "完成" } }] });
      },
      consumeRateLimit: () => true,
      authorizeAgentInvocation: async () => ({
        definitionId: 81, tenantId: 2, organizationId: 3, version: "v1",
        systemPrompt: "database prompt", model: "deepseek-chat", toolCodes: ["task.read"],
      }),
      startAgentInvocation: async (payload: { authorizedAgent: { definitionId: number }; status: string }) => {
        expect(payload).toMatchObject({ status: "running", authorizedAgent: { definitionId: 81 } });
        events.push("start");
        return { invocationId: "44444444-4444-4444-8444-444444444444" };
      },
      finalizeAgentInvocation: async (payload: { invocationId: string; status: string }) => {
        expect(payload).toMatchObject({
          invocationId: "44444444-4444-4444-8444-444444444444",
          status: "succeeded",
        });
        events.push("finalize");
      },
    });

    expect(response.status).toBe(200);
    expect(events).toEqual(["start", "provider", "finalize"]);
  });

  it("fails closed before provider work when the authorized running header cannot persist", async () => {
    const record = await configuredRecord();
    let providerCalls = 0;
    const response = await handleAiChat(request({
      agent_public_id: "33333333-3333-4333-8333-333333333333",
      messages: [{ role: "user", content: "运行 Agent" }],
    }), {
      session: executiveWorkspaceSession,
      encryptionKey,
      store: { get: async () => record },
      fetchImpl: async () => {
        providerCalls += 1;
        return Response.json({});
      },
      consumeRateLimit: () => true,
      authorizeAgentInvocation: async () => ({
        definitionId: 81, tenantId: 2, organizationId: 3, version: "v1",
        systemPrompt: "database prompt", model: "deepseek-chat", toolCodes: [],
      }),
      startAgentInvocation: async () => { throw new Error("ledger unavailable"); },
      finalizeAgentInvocation: async () => undefined,
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "agent_invocation_start_failed" });
    expect(providerCalls).toBe(0);
  });

  it("returns authorization failures before sending an Agent request upstream", async () => {
    const record = await configuredRecord();
    let upstreamCalls = 0;
    const response = await handleAiChat(request({
      agent_public_id: "33333333-3333-4333-8333-333333333333",
      messages: [{ role: "user", content: "运行 Agent" }],
    }), {
      session: executiveWorkspaceSession,
      encryptionKey,
      store: { get: async () => record },
      fetchImpl: async () => {
        upstreamCalls += 1;
        return Response.json({});
      },
      consumeRateLimit: () => true,
      authorizeAgentInvocation: async () => {
        throw Object.assign(new Error("agent_not_found"), { code: "agent_not_found" });
      },
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "agent_not_found" });
    expect(upstreamCalls).toBe(0);
  });

  it("fails closed after provider work when terminal finalization fails, leaving the running header recoverable", async () => {
    const record = await configuredRecord();
    let providerCalls = 0;
    const response = await handleAiChat(request({
      agent_public_id: "33333333-3333-4333-8333-333333333333",
      messages: [{ role: "user", content: "运行 Agent" }],
    }), {
      session: executiveWorkspaceSession,
      encryptionKey,
      store: { get: async () => record },
      fetchImpl: async () => {
        providerCalls += 1;
        return Response.json({ choices: [{ message: { content: "完成" } }] });
      },
      consumeRateLimit: () => true,
      authorizeAgentInvocation: async () => ({
        definitionId: 81, tenantId: 2, organizationId: 3, version: "v1",
        systemPrompt: "database prompt", model: "deepseek-chat", toolCodes: [],
      }),
      startAgentInvocation: async () => ({ invocationId: "44444444-4444-4444-8444-444444444444" }),
      finalizeAgentInvocation: async () => {
        throw new Error("database down");
      },
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "agent_invocation_finalize_failed",
    });
    expect(providerCalls).toBe(1);
  });

  it("records terminal timestamps for an Agent timeout", async () => {
    const record = await configuredRecord();
    const headers: Array<Record<string, unknown>> = [];
    const finals: Array<Record<string, unknown>> = [];
    const response = await handleAiChat(request({
      agent_public_id: "33333333-3333-4333-8333-333333333333",
      messages: [{ role: "user", content: "运行 Agent" }],
    }), {
      session: executiveWorkspaceSession,
      encryptionKey,
      store: { get: async () => record },
      fetchImpl: async () => { throw new DOMException("timed out", "TimeoutError"); },
      consumeRateLimit: () => true,
      authorizeAgentInvocation: async () => ({
        definitionId: 81, tenantId: 2, organizationId: 3, version: "v1",
        systemPrompt: "database prompt", model: "deepseek-chat", toolCodes: [],
      }),
      startAgentInvocation: async (payload) => {
        headers.push(payload as unknown as Record<string, unknown>);
        return { invocationId: "44444444-4444-4444-8444-444444444444" };
      },
      finalizeAgentInvocation: async (payload) => { finals.push(payload as unknown as Record<string, unknown>); },
    });

    expect(response.status).toBe(504);
    expect(finals).toEqual([expect.objectContaining({
      status: "failed", errorCode: "upstream_timeout", completedAt: expect.any(String),
    })]);
    expect(new Date(String(finals[0].completedAt)).getTime()).toBeGreaterThanOrEqual(
      new Date(String(headers[0].startedAt)).getTime(),
    );
  });

  it("finalizes an authorized running header when the provider throws before a response", async () => {
    const record = await configuredRecord();
    const finals: Array<Record<string, unknown>> = [];
    const response = await handleAiChat(request({
      agent_public_id: "33333333-3333-4333-8333-333333333333",
      messages: [{ role: "user", content: "运行 Agent" }],
    }), {
      session: executiveWorkspaceSession,
      encryptionKey,
      store: { get: async () => record },
      fetchImpl: async () => { throw new Error("provider network failure"); },
      consumeRateLimit: () => true,
      authorizeAgentInvocation: async () => ({
        definitionId: 81, tenantId: 2, organizationId: 3, version: "v1",
        systemPrompt: "database prompt", model: "deepseek-chat", toolCodes: [],
      }),
      startAgentInvocation: async () => ({ invocationId: "44444444-4444-4444-8444-444444444444" }),
      finalizeAgentInvocation: async (payload) => { finals.push(payload as unknown as Record<string, unknown>); },
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "upstream_unavailable" });
    expect(finals).toEqual([expect.objectContaining({
      status: "failed", errorCode: "upstream_unavailable", completedAt: expect.any(String),
    })]);
  });

  it("returns one stable error after two malformed or truncated structured responses", async () => {
    const record = await configuredRecord();
    let call = 0;
    const fetchImpl: typeof fetch = async () => {
      call += 1;
      return call === 1
        ? Response.json({
          choices: [{
            finish_reason: "length",
            message: { content: '{"tasks":[' },
          }],
        })
        : Response.json({
          choices: [{
            finish_reason: "stop",
            message: { content: '{"tasks":[}' },
          }],
        });
    };

    const response = await handleAiChat(request({
      messages: [{ role: "user", content: "请用JSON拆解任务" }],
      structured_output: true,
    }), {
      session: executiveWorkspaceSession,
      encryptionKey,
      store: { get: async () => record },
      fetchImpl,
      consumeRateLimit: () => true,
    });

    expect(call).toBe(2);
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "upstream_invalid_response",
    });
  });

  it("rejects non-boolean structured mode before upstream access", async () => {
    let upstreamCalls = 0;
    const response = await handleAiChat(request({
      messages: [{ role: "user", content: "hello" }],
      structured_output: "yes",
    }), {
      session: executiveWorkspaceSession,
      encryptionKey,
      store: { get: configuredRecord },
      fetchImpl: async () => {
        upstreamCalls += 1;
        return Response.json({});
      },
      consumeRateLimit: () => true,
    });

    expect(response.status).toBe(400);
    expect(upstreamCalls).toBe(0);
    await expect(response.json()).resolves.toEqual({
      error: "invalid_structured_output",
    });
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
