import { describe, expect, it } from "vitest";

import {
  handleGetAiConfig,
  handlePutAiConfig,
} from "@/features/ai-config/ai-config-handler";
import type { AiConfigRecord } from "@/features/ai-config/ai-config-types";
import { executiveWorkspaceSession } from "@/test/workspace-session-test-utils";

const encryptionKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const existing: AiConfigRecord = {
  tenant_id: executiveWorkspaceSession.tenantId,
  provider: "deepseek",
  model_name: "deepseek-v4-flash",
  api_base_url: "https://api.deepseek.com",
  encrypted_api_key: "stored-ciphertext",
  api_key_iv: "stored-iv",
  key_hint: "8bcf",
  updated_at: "2026-08-17T12:00:00.000Z",
  updated_by: executiveWorkspaceSession.authUserId,
};
const employeeWorkspaceSession = {
  ...executiveWorkspaceSession,
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
  let saved: AiConfigRecord | null = null;
  return {
    value: {
      session: executiveWorkspaceSession,
      encryptionKey,
      now: () => new Date("2026-08-17T13:00:00.000Z"),
      store: {
        get: async () => record,
        upsert: async (next: AiConfigRecord) => {
          saved = next;
          return next;
        },
      },
    },
    saved: () => saved,
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

  it("marks the model configuration as manageable for an active internal employee", async () => {
    const response = await handleGetAiConfig({
      ...deps().value,
      session: employeeWorkspaceSession,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ canManage: true });
  });

  it("allows an active internal employee to update the shared model configuration", async () => {
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

    expect(response.status).toBe(200);
    expect(fixture.saved()).toMatchObject({
      model_name: "deepseek-chat",
      updated_by: employeeWorkspaceSession.authUserId,
    });
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

  it("updates only the model while preserving the encrypted key", async () => {
    const fixture = deps();
    const response = await handlePutAiConfig(
      new Request("https://workspace.test/api/ai/config", {
        method: "PUT",
        body: JSON.stringify({ model: "deepseek-chat" }),
      }),
      fixture.value,
    );

    expect(response.status).toBe(200);
    expect(fixture.saved()).toMatchObject({
      model_name: "deepseek-chat",
      encrypted_api_key: "stored-ciphertext",
      api_key_iv: "stored-iv",
      key_hint: "8bcf",
    });
  });

  it("encrypts a submitted key and never returns it", async () => {
    const submitted = "sk-new-private-7xyz";
    const fixture = deps();
    const response = await handlePutAiConfig(
      new Request("https://workspace.test/api/ai/config", {
        method: "PUT",
        body: JSON.stringify({
          model: "deepseek-reasoner",
          apiKey: submitted,
        }),
      }),
      fixture.value,
    );
    const body = await response.json();
    const saved = fixture.saved();

    expect(response.status).toBe(200);
    expect(saved?.encrypted_api_key).not.toBe(submitted);
    expect(saved?.key_hint).toBe("7xyz");
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
});
