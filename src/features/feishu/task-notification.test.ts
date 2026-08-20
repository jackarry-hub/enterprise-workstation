import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildTaskNotificationLink,
  getFeishuTaskNotificationEnv,
  sendFeishuTaskNotification,
  type FeishuTaskNotificationEnv,
  type FeishuTaskNotificationInput,
} from "@/features/feishu/task-notification";

const taskId = "11111111-1111-4111-8111-111111111111";
const env: FeishuTaskNotificationEnv = {
  appId: "cli_test",
  appSecret: "app-secret",
  appUrl: "https://brain.example",
};
const input: FeishuTaskNotificationInput = {
  taskId,
  recipientOpenId: "ou_employee",
  taskTitle: "完成联调",
  projectName: "企业工作站",
  reporterName: "负责人",
  priority: "high",
  dueDate: "2026-08-25",
  acceptanceCriteria: "负责人验收通过",
};

function responseWithHangingBody() {
  const response = new Response();
  vi.spyOn(response, "json").mockImplementation(
    () => new Promise<never>(() => undefined),
  );
  return response;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Feishu task notification environment", () => {
  it.each([
    {},
    { FEISHU_APP_ID: "cli_test", FEISHU_APP_SECRET: "secret" },
    {
      FEISHU_APP_ID: "cli_test",
      NEXT_PUBLIC_APP_URL: "https://brain.example",
    },
    {
      FEISHU_APP_SECRET: "secret",
      NEXT_PUBLIC_APP_URL: "https://brain.example",
    },
  ])("rejects a missing required setting", (source) => {
    expect(() => getFeishuTaskNotificationEnv(source)).toThrow(
      "configuration_unavailable",
    );
  });

  it.each([
    "https://user:pass@brain.example",
    "https://brain.example/workbench",
    "https://brain.example?tenant=secret",
    "https://brain.example#secret",
    "ftp://brain.example",
    "brain.example",
  ])("rejects a non-root or unsafe app URL: %s", (appUrl) => {
    expect(() => getFeishuTaskNotificationEnv({
      FEISHU_APP_ID: "cli_test",
      FEISHU_APP_SECRET: "secret",
      NEXT_PUBLIC_APP_URL: appUrl,
    })).toThrow("configuration_unavailable");
  });

  it.each([
    ["https://brain.example/", "https://brain.example"],
    ["http://203.0.113.8/", "http://203.0.113.8"],
  ])("accepts a credentialless root HTTP(S) app URL", (appUrl, expected) => {
    expect(getFeishuTaskNotificationEnv({
      FEISHU_APP_ID: " cli_test ",
      FEISHU_APP_SECRET: " app-secret ",
      NEXT_PUBLIC_APP_URL: ` ${appUrl} `,
    })).toEqual({
      appId: "cli_test",
      appSecret: "app-secret",
      appUrl: expected,
    });
  });
});

describe("Feishu task notification links", () => {
  it("builds a deployable task link without identities or tokens", () => {
    const link = buildTaskNotificationLink("https://brain.example", taskId);

    expect(link).toBe(
      `https://brain.example/quantxy-ai-workbench-fused.html?formal=1&task=${taskId}`,
    );
    expect(link).not.toContain("ou_employee");
    expect(link).not.toContain("app-secret");
  });

  it.each([
    "not-a-uuid",
    "11111111-1111-4111-8111-11111111111/../admin",
    "11111111-1111-4111-8111-111111111111?token=secret",
  ])("rejects an invalid task UUID: %s", (invalidTaskId) => {
    expect(() =>
      buildTaskNotificationLink("https://brain.example", invalidTaskId),
    ).toThrow("configuration_unavailable");
  });
});

describe("Feishu task notification delivery", () => {
  it("sends the specified interactive application card to one open_id", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(Response.json({
        code: 0,
        tenant_access_token: "tenant-token",
      }))
      .mockResolvedValueOnce(Response.json({
        code: 0,
        data: { message_id: "om_123" },
      }));

    await expect(
      sendFeishuTaskNotification(input, env, fetchImpl),
    ).resolves.toEqual({ messageId: "om_123" });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [tokenUrl, tokenInit] = fetchImpl.mock.calls[0];
    expect(String(tokenUrl)).toBe(
      "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
    );
    expect(tokenInit?.method).toBe("POST");
    expect(JSON.parse(String(tokenInit?.body))).toEqual({
      app_id: "cli_test",
      app_secret: "app-secret",
    });

    const [messageUrl, messageInit] = fetchImpl.mock.calls[1];
    expect(String(messageUrl)).toBe(
      "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id",
    );
    expect(messageInit?.method).toBe("POST");
    expect(new Headers(messageInit?.headers).get("authorization")).toBe(
      "Bearer tenant-token",
    );
    const messageBody = JSON.parse(String(messageInit?.body));
    expect(messageBody).toMatchObject({
      receive_id: "ou_employee",
      msg_type: "interactive",
    });
    expect(JSON.parse(messageBody.content)).toEqual({
      config: { wide_screen_mode: true },
      header: {
        template: "blue",
        title: { tag: "plain_text", content: "你有一项新任务" },
      },
      elements: [
        {
          tag: "markdown",
          content: [
            "**任务：** 完成联调",
            "**项目：** 企业工作站",
            "**发起人：** 负责人",
            "**优先级：** high",
            "**截止日期：** 2026-08-25",
            "**验收标准：** 负责人验收通过",
          ].join("\n"),
        },
        {
          tag: "action",
          actions: [{
            tag: "button",
            type: "primary",
            text: { tag: "plain_text", content: "查看并领取" },
            url: `https://brain.example/quantxy-ai-workbench-fused.html?formal=1&task=${taskId}`,
          }],
        },
      ],
    });

    const messageRequest = JSON.stringify(fetchImpl.mock.calls[1]);
    expect(messageRequest).not.toContain("app-secret");
    expect(messageRequest).not.toContain("tenant-token");
  });

  it.each([
    ["a non-success token response", Response.json({ code: 999, msg: "app-secret leaked" })],
    ["a malformed token response", new Response("tenant-token leaked")],
    ["a token response without a token", Response.json({ code: 0 })],
  ])("redacts provider details for %s", async (_case, response) => {
    const fetchImpl = vi.fn().mockResolvedValue(response);

    await expect(
      sendFeishuTaskNotification(input, env, fetchImpl),
    ).rejects.toThrow(/^token_unavailable$/);
  });

  it.each([
    ["a non-success send response", Response.json({ code: 999, msg: "tenant-token leaked" })],
    ["a malformed send response", new Response("app-secret leaked")],
    ["a send response without a message id", Response.json({ code: 0, data: {} })],
  ])("redacts provider details for %s", async (_case, response) => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(Response.json({
        code: 0,
        tenant_access_token: "tenant-token",
      }))
      .mockResolvedValueOnce(response);

    await expect(
      sendFeishuTaskNotification(input, env, fetchImpl),
    ).rejects.toThrow(/^send_failed$/);
  });

  it("maps a token request timeout to token_unavailable and aborts at 8 seconds", async () => {
    vi.useFakeTimers();
    let tokenSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      tokenSignal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    });

    const delivery = sendFeishuTaskNotification(input, env, fetchImpl);
    const rejection = expect(delivery).rejects.toThrow(/^token_unavailable$/);
    await vi.advanceTimersByTimeAsync(7_999);
    expect(tokenSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await rejection;
    expect(tokenSignal?.aborted).toBe(true);
  });

  it("times out a hanging token response body as token_unavailable", async () => {
    vi.useFakeTimers();
    let tokenSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      tokenSignal = init?.signal ?? undefined;
      return Promise.resolve(responseWithHangingBody());
    });

    let outcome = "pending";
    void sendFeishuTaskNotification(input, env, fetchImpl).then(
      () => { outcome = "resolved"; },
      (error: unknown) => {
        outcome = error instanceof Error ? error.message : String(error);
      },
    );
    await vi.advanceTimersByTimeAsync(7_999);
    expect(tokenSignal?.aborted).toBe(false);
    expect(outcome).toBe("pending");
    await vi.advanceTimersByTimeAsync(1);

    expect(outcome).toBe("token_unavailable");
    expect(tokenSignal?.aborted).toBe(true);
  });

  it("maps a send request timeout to send_failed and aborts at 8 seconds", async () => {
    vi.useFakeTimers();
    let messageSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(Response.json({
        code: 0,
        tenant_access_token: "tenant-token",
      }))
      .mockImplementationOnce((_url: RequestInfo | URL, init?: RequestInit) => {
        messageSignal = init?.signal ?? undefined;
        return new Promise<Response>(() => undefined);
      });

    const delivery = sendFeishuTaskNotification(input, env, fetchImpl);
    const rejection = expect(delivery).rejects.toThrow(/^send_failed$/);
    await vi.advanceTimersByTimeAsync(0);
    expect(messageSignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(8_000);

    await rejection;
    expect(messageSignal?.aborted).toBe(true);
  });

  it("times out a hanging send response body as send_failed", async () => {
    vi.useFakeTimers();
    let messageSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(Response.json({
        code: 0,
        tenant_access_token: "tenant-token",
      }))
      .mockImplementationOnce((_url: RequestInfo | URL, init?: RequestInit) => {
        messageSignal = init?.signal ?? undefined;
        return Promise.resolve(responseWithHangingBody());
      });

    let outcome = "pending";
    void sendFeishuTaskNotification(input, env, fetchImpl).then(
      () => { outcome = "resolved"; },
      (error: unknown) => {
        outcome = error instanceof Error ? error.message : String(error);
      },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(messageSignal?.aborted).toBe(false);
    expect(outcome).toBe("pending");
    await vi.advanceTimersByTimeAsync(8_000);

    expect(outcome).toBe("send_failed");
    expect(messageSignal?.aborted).toBe(true);
  });

  it("rejects invalid configuration before making an external request", async () => {
    const fetchImpl = vi.fn();

    await expect(sendFeishuTaskNotification(input, {
      ...env,
      appUrl: "https://user:pass@brain.example",
    }, fetchImpl)).rejects.toThrow(/^configuration_unavailable$/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
