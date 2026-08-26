import { describe, expect, it } from "vitest";

import {
  handleGetAiConfig,
  handlePutAiConfig,
} from "@/features/ai-config/ai-config-handler";
import type { AiConfigUpdateCommand } from "@/features/ai-config/ai-config-store";
import { AiConfigStoreError } from "@/features/ai-config/ai-config-store";
import type {
  AiConfigRecord,
  PublicAiConfig,
} from "@/features/ai-config/ai-config-types";
import { executiveWorkspaceSession } from "@/test/workspace-session-test-utils";

const encryptionKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const aiAdminSession = {
  ...executiveWorkspaceSession,
  permissionCodes: [
    ...executiveWorkspaceSession.permissionCodes,
    "ai.config.manage" as const,
  ],
};
const existing: AiConfigRecord = {
  tenant_id: aiAdminSession.tenantId,
  provider: "deepseek",
  model_name: "deepseek-v4-flash",
  api_base_url: "https://api.deepseek.com",
  encrypted_api_key: "stored-ciphertext",
  api_key_iv: "stored-iv",
  key_hint: "8bcf",
  updated_at: "2026-08-17T12:00:00.000Z",
  updated_by: aiAdminSession.authUserId,
};
const employeeWorkspaceSession = {
  ...aiAdminSession,
  roleCodes: ["employee" as const],
  permissionCodes: ["task.execute" as const],
  primaryRole: "employee" as const,
  landingPath: "/execution",
  isAdmin: false,
  actor: {
    ...executiveWorkspaceSession.actor,
    role: "employee" as const,
    roleLabel: "普通员工",
    landingPath: "/execution",
  },
};

function deps(record: AiConfigRecord | null = existing) {
  const saved: AiConfigRecord | null = null;
  let command: Record<string, unknown> | null = null;
  return {
    value: {
      session: aiAdminSession,
      encryptionKey,
      store: {
        get: async () => record,
        update: async (
          next: AiConfigUpdateCommand,
        ): Promise<Omit<PublicAiConfig, "canManage">> => {
          command = next;
          return {
            provider: "deepseek" as const,
            apiBaseUrl: "https://api.deepseek.com" as const,
            model: next.model,
            keyConfigured: Boolean(record?.encrypted_api_key || next.encryptedKey),
            keyHint: next.keyHint ?? record?.key_hint ?? null,
            updatedAt: "2026-08-17T13:00:00.000Z",
          };
        },
      },
    },
    saved: () => saved,
    command: () => command,
  };
}

describe("AI configuration handlers", () => {
  it("returns 401 without a workspace session", async () => {
    const fixture = deps();
    const response = await handleGetAiConfig({
      ...fixture.value,
      session: null,
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("returns only sanitized configuration metadata", async () => {
    const response = await handleGetAiConfig(deps().value);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body).toEqual({
      provider: "deepseek",
      apiBaseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-flash",
      keyConfigured: true,
      keyHint: "8bcf",
      updatedAt: "2026-08-17T12:00:00.000Z",
      canManage: true,
    });
    expect(JSON.stringify(body)).not.toContain("stored-ciphertext");
    expect(JSON.stringify(body)).not.toContain("stored-iv");
  });

  it("does not mark an active employee without ai.config.manage as able to manage configuration", async () => {
    const response = await handleGetAiConfig({
      ...deps().value,
      session: employeeWorkspaceSession,
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body).toMatchObject({
      canManage: false,
      keyConfigured: true,
      model: "deepseek-v4-flash",
      keyHint: null,
    });
    expect(JSON.stringify(body)).not.toContain("stored-ciphertext");
    expect(JSON.stringify(body)).not.toContain("stored-iv");
    expect(JSON.stringify(body)).not.toContain("8bcf");
  });

  it("rejects an active employee without ai.config.manage before any configuration write", async () => {
    const fixture = deps();
    const response = await handlePutAiConfig(
      new Request("https://workspace.test/api/ai/config", {
        method: "PUT",
        body: JSON.stringify({ model: "deepseek-chat" }),
      }),
      {
        ...fixture.value,
        session: employeeWorkspaceSession,
      },
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
    expect(fixture.saved()).toBeNull();
  });

  it("still rejects configuration updates without an internal workspace session", async () => {
    const fixture = deps();
    const response = await handlePutAiConfig(
      new Request("https://workspace.test/api/ai/config", {
        method: "PUT",
        body: JSON.stringify({ model: "deepseek-chat" }),
      }),
      { ...fixture.value, session: null },
    );

    expect(response.status).toBe(401);
    expect(fixture.saved()).toBeNull();
  });

  it("sends a model-only command that lets the RPC preserve the existing encrypted key", async () => {
    const fixture = deps();
    const response = await handlePutAiConfig(
      new Request("https://workspace.test/api/ai/config", {
        method: "PUT",
        headers: { "Idempotency-Key": "30000000-0000-4000-8000-000000000001" },
        body: JSON.stringify({ model: "deepseek-chat" }),
      }),
      fixture.value,
    );

    expect(response.status).toBe(200);
    expect(fixture.command()).toMatchObject({
      provider: "deepseek",
      model: "deepseek-chat",
      encryptedKey: null,
      keyHint: null,
    });
    expect(fixture.command()?.requestId).toBe("30000000-0000-4000-8000-000000000001");
    expect(fixture.saved()).toBeNull();
  });

  it("encrypts a submitted key and never returns it", async () => {
    const submitted = "sk-new-private-7xyz";
    const fixture = deps();
    const response = await handlePutAiConfig(
      new Request("https://workspace.test/api/ai/config", {
        method: "PUT",
        headers: { "Idempotency-Key": "30000000-0000-4000-8000-000000000002" },
        body: JSON.stringify({
          model: "deepseek-reasoner",
          apiKey: submitted,
        }),
      }),
      fixture.value,
    );
    const body = await response.json();
    const command = fixture.command();

    expect(response.status).toBe(200);
    expect(command?.encryptedKey).not.toBe(submitted);
    expect(command?.keyHint).toBe("7xyz");
    expect(JSON.parse(command?.encryptedKey as string)).toMatchObject({
      v: 1,
      ciphertext: expect.any(String),
      iv: expect.any(String),
    });
    expect(JSON.stringify(body)).not.toContain(submitted);
    expect(body).toMatchObject({
      model: "deepseek-reasoner",
      keyConfigured: true,
      keyHint: "7xyz",
    });
  });

  it("rejects unsupported models and malformed keys without changing data", async () => {
    const invalidModel = deps();
    const modelResponse = await handlePutAiConfig(
      new Request("https://workspace.test/api/ai/config", {
        method: "PUT",
        body: JSON.stringify({ model: "unsafe-model" }),
      }),
      invalidModel.value,
    );
    const invalidKey = deps();
    const keyResponse = await handlePutAiConfig(
      new Request("https://workspace.test/api/ai/config", {
        method: "PUT",
        body: JSON.stringify({ model: "deepseek-chat", apiKey: "plain" }),
      }),
      invalidKey.value,
    );

    expect(modelResponse.status).toBe(400);
    expect(keyResponse.status).toBe(400);
    expect(invalidModel.saved()).toBeNull();
    expect(invalidKey.saved()).toBeNull();
  });

  it("rejects a missing or malformed Idempotency-Key before calling the command store", async () => {
    const missing = deps();
    const missingResponse = await handlePutAiConfig(
      new Request("https://workspace.test/api/ai/config", {
        method: "PUT",
        body: JSON.stringify({ model: "deepseek-chat" }),
      }),
      missing.value,
    );
    const malformed = deps();
    const malformedResponse = await handlePutAiConfig(
      new Request("https://workspace.test/api/ai/config", {
        method: "PUT",
        headers: { "Idempotency-Key": "not-a-uuid" },
        body: JSON.stringify({ model: "deepseek-chat" }),
      }),
      malformed.value,
    );

    expect(missingResponse.status).toBe(400);
    expect(await missingResponse.json()).toEqual({ error: "invalid_idempotency_key" });
    expect(malformedResponse.status).toBe(400);
    expect(await malformedResponse.json()).toEqual({ error: "invalid_idempotency_key" });
    expect(missing.command()).toBeNull();
    expect(malformed.command()).toBeNull();
  });

  it("maps duplicate and invalid command errors to safe stable responses", async () => {
    const duplicate = await handlePutAiConfig(
      new Request("https://workspace.test/api/ai/config", {
        method: "PUT",
        headers: { "Idempotency-Key": "30000000-0000-4000-8000-000000000005" },
        body: JSON.stringify({ model: "deepseek-chat" }),
      }),
      {
        session: aiAdminSession,
        encryptionKey,
        store: {
          update: async () => { throw new AiConfigStoreError("23505"); },
        },
      },
    );
    const invalid = await handlePutAiConfig(
      new Request("https://workspace.test/api/ai/config", {
        method: "PUT",
        headers: { "Idempotency-Key": "30000000-0000-4000-8000-000000000006" },
        body: JSON.stringify({ model: "deepseek-chat" }),
      }),
      {
        session: aiAdminSession,
        encryptionKey,
        store: {
          update: async () => { throw new AiConfigStoreError("22023"); },
        },
      },
    );

    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toEqual({ error: "duplicate_request" });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "invalid_request" });
  });
});
