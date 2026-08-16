import { describe, expect, it, vi } from "vitest";

import { generateDeepSeekExecutionSummary } from "@/features/ai-dispatch/deepseek-summary";
import { validExecutionSummary } from "@/features/ai-dispatch/summary-contract.test";

function response(content: string) {
  return new Response(JSON.stringify({
    model: "deepseek-v4-flash",
    choices: [{ message: { content } }],
  }), { status: 200, headers: { "content-type": "application/json" } });
}

const execution = {
  goal: "3天内完成移动端V1",
  tasks: [{
    title: "完成移动端开发",
    assignee: "陈晨",
    status: "done" as const,
    submission: "移动端页面与回归报告已提交",
    review_comment: "验收通过",
    rejection_count: 1,
  }],
};

describe("DeepSeek execution summary", () => {
  it("maps the legacy chat model to the current flash model", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(JSON.stringify(validExecutionSummary)));
    await generateDeepSeekExecutionSummary({
      execution,
      apiKey: "key",
      model: "deepseek-chat",
      fetchImpl,
    });

    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).model).toBe("deepseek-v4-flash");
  });

  it("returns a validated real-model summary", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(JSON.stringify(validExecutionSummary)));
    await expect(generateDeepSeekExecutionSummary({
      execution,
      apiKey: "server-only-test-key",
      model: "deepseek-v4-flash",
      fetchImpl,
    })).resolves.toEqual({ summary: validExecutionSummary, model: "deepseek-v4-flash", repaired: false });
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe("Bearer server-only-test-key");
    expect(fetchImpl.mock.calls[0][1].body).toContain("陈晨");
  });

  it("repairs invalid JSON once and then validates", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response("not json"))
      .mockResolvedValueOnce(response(JSON.stringify(validExecutionSummary)));
    await expect(generateDeepSeekExecutionSummary({ execution, apiKey: "key", fetchImpl }))
      .resolves.toMatchObject({ summary: validExecutionSummary, repaired: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
