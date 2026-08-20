import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildTaskNotificationLink,
  getFeishuTaskNotificationEnv,
  sendFeishuTaskNotification,
  type FeishuTaskNotificationEnv,
  type FeishuTaskNotificationInput,
} from "@/features/feishu/task-notification";

const taskId = "11111111-1111-4111-8111-111111111111";
const envExample = readFileSync(
  resolve(process.cwd(), ".env.example"),
  "utf8",
);
const deploymentGuide = readFileSync(
  resolve(process.cwd(), "docs/deployment/phase1-supabase-feishu.md"),
  "utf8",
);
const notificationDeploymentPlaceholders = {
  NEXT_PUBLIC_APP_URL: "https://workstation.example.com",
  FEISHU_APP_ID: "cli_your_feishu_app_id",
  FEISHU_APP_SECRET: "your_server_only_feishu_app_secret",
  SUPABASE_SERVICE_ROLE_KEY: "your_server_only_supabase_service_role_key",
} as const;
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

function envAssignments(source: string) {
  return source.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return [];

    const assignment = trimmed.match(
      /^(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=(.*)$/,
    );
    if (!assignment) return [];

    return [{
      name: assignment[1],
      value: assignment[2].trim(),
    }];
  });
}

function expectNotificationDeploymentEnvContract(source: string) {
  const assignments = envAssignments(source);

  for (const [name, approvedValue] of Object.entries(
    notificationDeploymentPlaceholders,
  )) {
    const matchingAssignments = assignments.filter(
      (assignment) => assignment.name === name,
    );

    expect(
      matchingAssignments,
      `${name} must have exactly one non-comment assignment`,
    ).toHaveLength(1);
    expect(
      matchingAssignments[0].value,
      `${name} must use its approved placeholder value`,
    ).toBe(approvedValue);
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Feishu task notification environment", () => {
  it("documents every notification setting with an obvious placeholder", () => {
    expectNotificationDeploymentEnvContract(envExample);
  });

  it("keeps the authoritative deployment cutover in acceptance-safe order", () => {
    const orderedMarkers = [
      "### A. 飞书能力配置（不向全员开放）",
      "### B. 部署代码、HTTPS APP URL 与运行时秘密",
      "### C. 应用数据库迁移",
      "### D. 限定测试范围",
      "### E. 指定员工验收",
      "### F. 验收后扩大全员",
    ];
    const markerIndexes = orderedMarkers.map((marker) =>
      deploymentGuide.indexOf(marker)
    );

    expect(markerIndexes.every((index) => index >= 0)).toBe(true);
    expect(markerIndexes).toEqual([...markerIndexes].sort((a, b) => a - b));

    const testScopeSection = deploymentGuide.slice(
      markerIndexes[3],
      markerIndexes[4],
    );
    expect(testScopeSection).toContain("真实消息发送必须先发布版本");
    expect(testScopeSection).toContain("指定测试员工");
    expect(deploymentGuide.slice(0, markerIndexes[4])).not.toContain(
      "应用可用范围覆盖所有会接收任务的员工",
    );

    const expandAllSection = deploymentGuide.slice(markerIndexes[5]);
    expect(expandAllSection).toContain("应用可用范围");
    expect(expandAllSection).toContain("所有会接收任务的员工");
  });

  it.each([
    [
      "FEISHU_APP_SECRET",
      "fake_test_only_A1b2C3d4E5f6G7h8J9k0L1m2N3p4Q5r6",
    ],
    [
      "SUPABASE_SERVICE_ROLE_KEY",
      "fake_test_only_Z9y8X7w6V5u4T3s2R1q0P9n8M7l6K5j4",
    ],
  ])("rejects a second real-like %s assignment", (name, fakeValue) => {
    const mutatedEnv = `${envExample.trimEnd()}\n${name}=${fakeValue}\n`;

    expect(() => expectNotificationDeploymentEnvContract(mutatedEnv)).toThrow();
  });

  it.each([
    ["an empty secret", "FEISHU_APP_SECRET", ""],
    [
      "a fake JWT-like value",
      "FEISHU_APP_SECRET",
      "eyJmYWtlIjp0cnVlfQ.eyJ0ZXN0Ijoib25seSJ9.fake_signature",
    ],
    [
      "a fake sk-prefixed value",
      "FEISHU_APP_SECRET",
      "sk-fake_test_only_0123456789abcdef",
    ],
    [
      "a fake high-entropy value",
      "SUPABASE_SERVICE_ROLE_KEY",
      "fake_test_only_aB3dE5fG7hJ9kL2mN4pQ6rS8tV0xYz1A",
    ],
    [
      "an unapproved production-shaped domain",
      "NEXT_PUBLIC_APP_URL",
      "https://workstation.example.net",
    ],
    [
      "an unapproved secret placeholder",
      "FEISHU_APP_SECRET",
      "fake_unapproved_secret_for_test_only",
    ],
  ])("rejects %s", (_case, name, fakeValue) => {
    const mutatedEnv = envExample.replace(
      new RegExp(`^${name}=.*$`, "m"),
      `${name}=${fakeValue}`,
    );

    expect(() => expectNotificationDeploymentEnvContract(mutatedEnv)).toThrow();
  });

  it("ignores comments and unrelated placeholder assignments", () => {
    const mutatedEnv = [
      envExample.trimEnd(),
      "# FEISHU_APP_SECRET=fake_commented_test_value",
      "UNRELATED_PLACEHOLDER=your_unrelated_placeholder",
      "",
    ].join("\n");

    expect(() => expectNotificationDeploymentEnvContract(mutatedEnv)).not.toThrow();
  });

  it("describes the app URL as the employee-accessible deployment origin for task deep links", () => {
    expect(envExample).toMatch(
      /# .*员工.*浏览器.*访问.*最终部署 origin.*任务深链.*\r?\nNEXT_PUBLIC_APP_URL=https:\/\/workstation\.example\.com/m,
    );
    expect(envExample).not.toMatch(
      /^NEXT_PUBLIC_APP_URL=https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\/?$/m,
    );
  });

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
