import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SettingsPage } from "@/features/settings/settings-page";
import { settingsPayload } from "@/features/settings/settings-data.test";
import { renderWithSpecificWorkspaceSession } from "@/test/workspace-session-test-utils";
import { executiveWorkspaceSession } from "@/test/workspace-session-test-utils";

describe("SettingsPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads real settings and keeps Feishu identity read-only", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => String(input).includes("enterprise-initialization")
      ? Response.json({ status: "ready", canInitialize: true, departmentCount: 5, positionCount: 12, skillCount: 20 })
      : Response.json(settingsPayload)));
    renderWithSpecificWorkspaceSession(<SettingsPage />, { ...executiveWorkspaceSession, permissionCodes: ["settings.manage"] });
    expect(await screen.findByLabelText("企业名称")).toHaveValue("量子星河");
    await userEvent.click(screen.getByRole("tab", { name: "个人设置" }));
    expect(screen.getByText("飞书身份只读")).toBeVisible();
    expect(screen.queryByLabelText("新密码")).not.toBeInTheDocument();
  });

  it("persists a versioned namespace through the API and never writes localStorage", async () => {
    const changed = { ...settingsPayload, organization: { ...settingsPayload.organization, name: "量子星河集团" }, versions: { ...settingsPayload.versions, organization: 3 } };
    let settingsReads = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("enterprise-initialization")) return Response.json({ status: "ready", canInitialize: true, departmentCount: 5, positionCount: 12, skillCount: 20 });
      if (init?.method === "PUT") return Response.json({ namespace: "organization", version: 3 });
      settingsReads += 1;
      return Response.json(settingsReads === 1 ? settingsPayload : changed);
    }); vi.stubGlobal("fetch", fetchMock);
    renderWithSpecificWorkspaceSession(<SettingsPage />, { ...executiveWorkspaceSession, permissionCodes: ["settings.manage"] });
    const name = await screen.findByLabelText("企业名称"); await userEvent.clear(name); await userEvent.type(name, "量子星河集团"); await userEvent.click(screen.getByRole("button", { name: "保存设置" }));
    expect(await screen.findByText("设置已保存，刷新后仍有效")).toBeVisible();
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url) === "/api/workstation/settings")).toHaveLength(3));
    const request = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT")?.[1] as RequestInit; expect(JSON.parse(String(request.body))).toMatchObject({ namespace: "organization", expectedVersion: 2, settings: { name: "量子星河集团" } });
    expect(window.localStorage.length).toBe(0);
  });

  it("encrypts and persists the DeepSeek configuration through the server API", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("enterprise-initialization")) return Response.json({ status: "ready", canInitialize: true, departmentCount: 5, positionCount: 12, skillCount: 20 });
      if (url === "/api/ai/config" && init?.method === "PUT") return Response.json({ provider: "deepseek", apiBaseUrl: "https://api.deepseek.com", model: "deepseek-chat", keyConfigured: true, keyHint: "3456", updatedAt: "2026-09-03T00:00:00.000Z", canManage: true });
      if (url === "/api/ai/config") return Response.json({ provider: "deepseek", apiBaseUrl: "https://api.deepseek.com", model: "deepseek-chat", keyConfigured: false, keyHint: null, updatedAt: null, canManage: true });
      return Response.json(settingsPayload);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWithSpecificWorkspaceSession(<SettingsPage />, { ...executiveWorkspaceSession, permissionCodes: ["settings.manage", "ai.config.manage"] });
    await screen.findByLabelText("企业名称");
    await userEvent.click(screen.getByRole("tab", { name: "AI 模型" }));
    await screen.findByText("等待配置密钥");
    await userEvent.type(screen.getByLabelText("DeepSeek API Key"), "sk-test-key-123456");
    await userEvent.click(screen.getByRole("button", { name: "保存 AI 配置" }));
    expect(await screen.findByText("密钥已配置")).toBeVisible();
    const request = fetchMock.mock.calls.find(([url, init]) => String(url) === "/api/ai/config" && init?.method === "PUT")?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({ model: "deepseek-chat", apiKey: "sk-test-key-123456" });
    expect(window.localStorage.length).toBe(0);
  });
});
