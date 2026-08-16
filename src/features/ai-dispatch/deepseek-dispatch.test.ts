import { describe, expect, it, vi } from "vitest";

import { buildDemoTeamContext } from "@/features/ai-dispatch/demo-team-context";
import {
  DEFAULT_DEEPSEEK_MODEL,
  DeepSeekDispatchError,
  generateDeepSeekDispatchPlan,
  normalizeDeepSeekModel,
} from "@/features/ai-dispatch/deepseek-dispatch";
import { validDispatchPlan } from "@/test/ai-dispatch-test-utils";

function jsonResponse(content: string, model = DEFAULT_DEEPSEEK_MODEL) {
  return new Response(JSON.stringify({
    choices: [{ message: { content } }],
    model,
  }), { status: 200, headers: { "content-type": "application/json" } });
}

describe("DeepSeek dispatch service", () => {
  it("maps legacy model aliases to the current DeepSeek models", () => {
    expect(normalizeDeepSeekModel("deepseek-chat")).toBe("deepseek-v4-flash");
    expect(normalizeDeepSeekModel("deepseek-reasoner")).toBe("deepseek-v4-pro");
    expect(normalizeDeepSeekModel("deepseek-v4-pro")).toBe("deepseek-v4-pro");
  });

  it("uses the configured model and returns a validated plan", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(JSON.stringify(validDispatchPlan), "deepseek-v4-pro"));

    await expect(generateDeepSeekDispatchPlan({
      command: "3天内完成移动端V1",
      apiKey: "server-only-test-key",
      model: "deepseek-v4-pro",
      team: buildDemoTeamContext(),
      fetchImpl,
      now: new Date("2026-08-13T09:00:00+08:00"),
    })).resolves.toEqual({ plan: validDispatchPlan, model: "deepseek-v4-pro", repaired: false });

    const [, request] = fetchImpl.mock.calls[0];
    expect(request.headers.Authorization).toBe("Bearer server-only-test-key");
    expect(JSON.parse(request.body)).toMatchObject({
      model: "deepseek-v4-pro",
      response_format: { type: "json_object" },
      stream: false,
    });
    expect(request.body).toContain("陈晨");
  });

  it("repairs one invalid JSON response and validates the repaired result", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse("not-json"))
      .mockResolvedValueOnce(jsonResponse(JSON.stringify(validDispatchPlan)));

    await expect(generateDeepSeekDispatchPlan({
      command: "安排团队完成本周客户交付",
      apiKey: "server-only-test-key",
      team: buildDemoTeamContext(),
      fetchImpl,
    })).resolves.toMatchObject({ plan: validDispatchPlan, repaired: true });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1][1].body).toContain("修复");
  });

  it("returns a stable invalid-response error after the single repair attempt fails", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse("still-not-json"));

    await expect(generateDeepSeekDispatchPlan({
      command: "安排团队完成本周客户交付",
      apiKey: "server-only-test-key",
      team: buildDemoTeamContext(),
      fetchImpl,
    })).rejects.toMatchObject({ code: "invalid_response" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("preserves a safe upstream status and error message", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { message: "Model Not Exist" },
    }), { status: 422, headers: { "content-type": "application/json" } }));

    await expect(generateDeepSeekDispatchPlan({
      command: "安排团队完成本周客户交付",
      apiKey: "server-only-test-key",
      team: buildDemoTeamContext(),
      fetchImpl,
    })).rejects.toMatchObject({
      code: "upstream",
      status: 422,
      message: "DeepSeek API 返回 422：Model Not Exist",
    });
  });

  it("aborts the whole generation after the configured timeout", async () => {
    const fetchImpl = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));

    await expect(generateDeepSeekDispatchPlan({
      command: "3天内完成移动端V1",
      apiKey: "server-only-test-key",
      team: buildDemoTeamContext(),
      fetchImpl,
      timeoutMs: 10,
    })).rejects.toEqual(expect.objectContaining<Partial<DeepSeekDispatchError>>({ code: "timeout" }));
  });
});
