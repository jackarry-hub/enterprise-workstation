import { describe, expect, it, vi } from "vitest";

import { createSummaryPost } from "@/features/ai-dispatch/summary-route-handler";
import { customerDemoSessions } from "@/features/demo/customer-demo-data";
import { validExecutionSummary } from "@/features/ai-dispatch/summary-contract.test";

const manager = customerDemoSessions.find(
  ({ identity }) => identity.providerSubject === "customer-demo:demo-product-head",
)!;
const employee = customerDemoSessions.find(
  ({ identity }) => identity.providerSubject === "customer-demo:demo-engineer",
)!;
const execution = {
  goal: "完成移动端 V1",
  tasks: [{
    title: "移动端开发",
    assignee: "陈晨",
    status: "done" as const,
    submission: "成果链接与回归报告",
    review_comment: "通过",
    rejection_count: 1,
  }],
};

describe("POST /api/ai/summary", () => {
  it("calls DeepSeek with server-only configuration for a responsible person", async () => {
    const generate = vi.fn().mockResolvedValue({
      summary: validExecutionSummary,
      model: "deepseek-v4-flash",
      repaired: false,
    });
    const POST = createSummaryPost({
      env: { DEEPSEEK_API_KEY: "server-only-test-key", DEEPSEEK_MODEL: "deepseek-v4-flash" },
      getSession: async () => manager,
      generate,
    });
    const response = await POST(new Request("http://localhost/api/ai/summary", {
      method: "POST",
      body: JSON.stringify({ execution }),
    }));
    expect(response.status).toBe(200);
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      execution,
      apiKey: "server-only-test-key",
      model: "deepseek-v4-flash",
    }));
  });

  it("rejects employees, malformed records, and a missing server key", async () => {
    const generate = vi.fn();
    const employeePost = createSummaryPost({
      env: { DEEPSEEK_API_KEY: "server-only-test-key" },
      getSession: async () => employee,
      generate,
    });
    const managerPost = createSummaryPost({ env: {}, getSession: async () => manager, generate });
    expect((await employeePost(new Request("http://localhost/api/ai/summary", {
      method: "POST", body: JSON.stringify({ execution }),
    }))).status).toBe(403);
    expect((await managerPost(new Request("http://localhost/api/ai/summary", {
      method: "POST", body: JSON.stringify({ execution: { goal: "x", tasks: [] } }),
    }))).status).toBe(400);
    expect((await managerPost(new Request("http://localhost/api/ai/summary", {
      method: "POST", body: JSON.stringify({ execution }),
    }))).status).toBe(503);
    expect(generate).not.toHaveBeenCalled();
  });
});
