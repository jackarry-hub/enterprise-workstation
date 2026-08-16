import { describe, expect, it, vi } from "vitest";

import { createDispatchPost } from "@/features/ai-dispatch/dispatch-route-handler";
import { DeepSeekDispatchError } from "@/features/ai-dispatch/deepseek-dispatch";
import { customerDemoSessions } from "@/features/demo/customer-demo-data";
import { validDispatchPlan } from "@/test/ai-dispatch-test-utils";

describe("POST /api/ai/dispatch", () => {
  it("rejects a base employee even when legacy demo permissions contain task.manage", async () => {
    const employee = customerDemoSessions.find(
      ({ identity }) => identity.providerSubject === "customer-demo:demo-engineer",
    )!;
    const generate = vi.fn();
    const POST = createDispatchPost({
      env: { DEEPSEEK_API_KEY: "server-only-test-key" },
      getSession: async () => employee,
      generate,
    });

    const response = await POST(new Request("http://localhost/api/ai/dispatch", {
      method: "POST",
      body: JSON.stringify({ command: "下发任务" }),
    }));

    expect(response.status).toBe(403);
    expect(generate).not.toHaveBeenCalled();
  });

  it("uses the existing customer demo session when the server is in demo mode", async () => {
    const generate = vi.fn().mockResolvedValue({ plan: validDispatchPlan, model: "deepseek-v4-flash", repaired: false });
    const POST = createDispatchPost({
      env: { CUSTOMER_DEMO_MODE: "true", DEEPSEEK_API_KEY: "server-only-test-key" },
      generate,
    });

    const response = await POST(new Request("http://localhost/api/ai/dispatch", {
      method: "POST",
      body: JSON.stringify({ command: "3天内完成移动端V1" }),
    }));

    expect(response.status).toBe(200);
    expect(generate).toHaveBeenCalledOnce();
  });

  it("keeps the customer demo usable with a clearly labeled local fallback when DeepSeek is unreachable", async () => {
    const generate = vi.fn().mockRejectedValue(new DeepSeekDispatchError(
      "upstream",
      "服务器无法连接 DeepSeek API（EACCES）",
    ));
    const POST = createDispatchPost({
      env: { CUSTOMER_DEMO_MODE: "true", DEEPSEEK_API_KEY: "server-only-test-key" },
      generate,
    });

    const response = await POST(new Request("http://localhost/api/ai/dispatch", {
      method: "POST",
      body: JSON.stringify({ command: "目标：3天内完成移动端V1\n截止日期：2026-08-18" }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ model: "demo-fallback", source: "demo_fallback", mode: "demo" });
    expect(payload.plan.tasks).toHaveLength(5);
    expect(payload.plan.summary).toContain("本地演示规则");
  });

  it("keeps the customer demo usable when a new computer has not configured the DeepSeek key yet", async () => {
    const generate = vi.fn();
    const POST = createDispatchPost({
      env: { CUSTOMER_DEMO_MODE: "true" },
      generate,
    });

    const response = await POST(new Request("http://localhost/api/ai/dispatch", {
      method: "POST",
      body: JSON.stringify({ command: "目标：制定一周官网升级计划\n截止日期：2026-08-22" }),
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(generate).not.toHaveBeenCalled();
    expect(payload).toMatchObject({ model: "demo-fallback", source: "demo_fallback", mode: "demo" });
    expect(payload.plan.tasks.length).toBeGreaterThanOrEqual(3);
  });

  it("shows a useful configuration error outside customer demo mode", async () => {
    const POST = createDispatchPost({
      env: { DEEPSEEK_API_KEY: "server-only-test-key" },
      getSession: async () => customerDemoSessions[0],
      generate: vi.fn().mockRejectedValue(new DeepSeekDispatchError(
        "upstream",
        "DeepSeek API 返回 422：Model Not Exist",
        422,
      )),
    });

    const response = await POST(new Request("http://localhost/api/ai/dispatch", {
      method: "POST",
      body: JSON.stringify({ command: "3天内完成移动端V1" }),
    }));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: {
        code: "ai_invalid_configuration",
        message: "DeepSeek 模型或请求参数不兼容：DeepSeek API 返回 422：Model Not Exist",
      },
    });
  });

  it("returns an explicit server-only configuration error when the API key is missing", async () => {
    const POST = createDispatchPost({
      env: {},
      getSession: async () => customerDemoSessions[0],
      generate: vi.fn(),
    });

    const response = await POST(new Request("http://localhost/api/ai/dispatch", {
      method: "POST",
      body: JSON.stringify({ command: "3天内完成移动端V1" }),
    }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: { code: "ai_not_configured", message: "AI调度服务尚未配置，请联系管理员。" },
    });
  });

  it("calls the service with the existing demo team and never accepts a client-supplied roster", async () => {
    const generate = vi.fn().mockResolvedValue({ plan: validDispatchPlan, model: "deepseek-v4-flash", repaired: false });
    const POST = createDispatchPost({
      env: { DEEPSEEK_API_KEY: "server-only-test-key", DEEPSEEK_MODEL: "deepseek-v4-flash" },
      getSession: async () => customerDemoSessions[0],
      generate,
    });

    const response = await POST(new Request("http://localhost/api/ai/dispatch", {
      method: "POST",
      body: JSON.stringify({ command: "3天内完成移动端V1", team: [{ name: "伪造员工" }] }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ plan: validDispatchPlan, model: "deepseek-v4-flash", mode: "demo" });
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      command: "3天内完成移动端V1",
      apiKey: "server-only-test-key",
      model: "deepseek-v4-flash",
      team: expect.arrayContaining([expect.objectContaining({ name: "张伟" }), expect.objectContaining({ name: "陈晨" })]),
    }));
    expect(JSON.stringify(generate.mock.calls[0][0].team)).not.toContain("伪造员工");
  });

  it("rejects unauthenticated and malformed requests without calling DeepSeek", async () => {
    const generate = vi.fn();
    const unauthenticated = createDispatchPost({
      env: { DEEPSEEK_API_KEY: "server-only-test-key" },
      getSession: async () => null,
      generate,
    });
    const authenticated = createDispatchPost({
      env: { DEEPSEEK_API_KEY: "server-only-test-key" },
      getSession: async () => customerDemoSessions[0],
      generate,
    });

    expect((await unauthenticated(new Request("http://localhost/api/ai/dispatch", { method: "POST", body: JSON.stringify({ command: "有效目标" }) }))).status).toBe(401);
    expect((await authenticated(new Request("http://localhost/api/ai/dispatch", { method: "POST", body: JSON.stringify({ command: "  " }) }))).status).toBe(400);
    expect(generate).not.toHaveBeenCalled();
  });
});
