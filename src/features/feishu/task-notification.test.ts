import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { FeishuTransport } from "@/features/feishu/feishu-transport";
import {
  buildTaskNotificationLink,
  getFeishuTaskNotificationEnv,
  sendFeishuTaskBatchNotification,
  sendFeishuTaskNotification,
  type FeishuTaskBatchNotificationInput,
  type FeishuTaskNotificationEnv,
  type FeishuTaskNotificationInput,
} from "@/features/feishu/task-notification";

const taskId = "11111111-1111-4111-8111-111111111111";
const idempotencyKey = "41000000-0000-4000-8000-000000000001";
const envExample = readFileSync(resolve(process.cwd(), ".env.example"), "utf8");
const deploymentGuide = readFileSync(
  resolve(process.cwd(), "docs/deployment/phase1-supabase-feishu.md"),
  "utf8",
);
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

function transport(sendInteractiveCard = vi.fn().mockResolvedValue({ messageId: "om_123" })) {
  return { sendInteractiveCard } satisfies FeishuTransport;
}

function assignments(source: string) {
  return source.split(/\r?\n/).flatMap((line) => {
    const match = line.trim().match(/^(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=(.*)$/);
    return match ? [{ name: match[1], value: match[2].trim() }] : [];
  });
}

function expectDeploymentContract(source: string) {
  const expected = {
    NEXT_PUBLIC_APP_URL: "https://workstation.example.com",
    FEISHU_APP_ID: "cli_your_feishu_app_id",
    FEISHU_APP_SECRET: "your_server_only_feishu_app_secret",
    SUPABASE_SERVICE_ROLE_KEY: "your_server_only_supabase_service_role_key",
  };
  for (const [name, value] of Object.entries(expected)) {
    const matches = assignments(source).filter((item) => item.name === name);
    expect(matches, `${name} must have exactly one assignment`).toHaveLength(1);
    expect(matches[0].value).toBe(value);
  }
}

describe("Feishu task notification environment", () => {
  it("documents the server-only notification configuration with safe placeholders", () => {
    expectDeploymentContract(envExample);
  });

  it("keeps deployment cutover ordered before expanding the employee scope", () => {
    const markers = [
      "### A. 飞书能力配置（不向全员开放）",
      "### B. 部署代码、HTTPS APP URL 与运行时秘密",
      "### C. 应用数据库迁移",
      "### D. 限定测试范围",
      "### E. 指定员工验收",
      "### F. 验收后扩大全员",
    ];
    const indexes = markers.map((marker) => deploymentGuide.indexOf(marker));
    expect(indexes.every((index) => index >= 0)).toBe(true);
    expect(indexes).toEqual([...indexes].sort((left, right) => left - right));
    expect(deploymentGuide.slice(indexes[3], indexes[4])).toContain("指定测试员工");
    expect(deploymentGuide.slice(indexes[5])).toContain("所有会接收任务的员工");
  });

  it.each([
    {},
    { FEISHU_APP_ID: "cli_test", FEISHU_APP_SECRET: "secret" },
    { FEISHU_APP_ID: "cli_test", NEXT_PUBLIC_APP_URL: "https://brain.example" },
    { FEISHU_APP_SECRET: "secret", NEXT_PUBLIC_APP_URL: "https://brain.example" },
  ])("rejects a missing setting", (source) => {
    expect(() => getFeishuTaskNotificationEnv(source)).toThrow(/^configuration_unavailable$/);
  });

  it.each([
    "https://user:pass@brain.example",
    "https://brain.example/workbench",
    "https://brain.example?tenant=secret",
    "https://brain.example#secret",
    "ftp://brain.example",
    "brain.example",
  ])("rejects an unsafe application URL: %s", (appUrl) => {
    expect(() => getFeishuTaskNotificationEnv({
      FEISHU_APP_ID: "cli_test",
      FEISHU_APP_SECRET: "secret",
      NEXT_PUBLIC_APP_URL: appUrl,
    })).toThrow(/^configuration_unavailable$/);
  });

  it("normalizes a credentialless root application origin", () => {
    expect(getFeishuTaskNotificationEnv({
      FEISHU_APP_ID: " cli_test ",
      FEISHU_APP_SECRET: " app-secret ",
      NEXT_PUBLIC_APP_URL: " https://brain.example/ ",
    })).toEqual({ appId: "cli_test", appSecret: "app-secret", appUrl: "https://brain.example" });
  });
});

describe("Feishu task links", () => {
  it("contains only the formal task deep link", () => {
    const link = buildTaskNotificationLink("https://brain.example", taskId);
    expect(link).toBe(`https://brain.example/tasks?task=${taskId}`);
    expect(link).not.toContain("ou_employee");
    expect(link).not.toContain("app-secret");
  });

  it.each(["not-a-uuid", `${taskId}?token=secret`, `${taskId}/../admin`])(
    "rejects an invalid task ID: %s",
    (invalidTaskId) => {
      expect(() => buildTaskNotificationLink("https://brain.example", invalidTaskId))
        .toThrow(/^configuration_unavailable$/);
    },
  );
});

describe("Feishu task card delivery", () => {
  it("sends one task card through the SDK transport with the durable provider UUID", async () => {
    const sendInteractiveCard = vi.fn().mockResolvedValue({ messageId: "om_123" });

    await expect(sendFeishuTaskNotification(input, env, {
      idempotencyKey,
      transport: transport(sendInteractiveCard),
    })).resolves.toEqual({ messageId: "om_123" });

    expect(sendInteractiveCard).toHaveBeenCalledWith({
      recipientOpenId: "ou_employee",
      idempotencyKey,
      card: {
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
              url: `https://brain.example/tasks?task=${taskId}`,
            }],
          },
        ],
      },
    });
  });

  it("groups several assigned tasks into one compact SDK card", async () => {
    const batch: FeishuTaskBatchNotificationInput = {
      recipientOpenId: "ou_employee",
      reporterName: "负责人",
      tasks: [
        {
          taskId,
          taskTitle: "完成需求访谈",
          projectName: "企业工作站",
          priority: "P0",
          dueDate: "2026-08-24",
          acceptanceCriteria: "提交访谈纪要",
        },
        {
          taskId: "55555555-5555-4555-8555-555555555555",
          taskTitle: "整理验收清单",
          projectName: "企业工作站",
          priority: "P1",
          dueDate: "2026-08-26",
          acceptanceCriteria: "负责人确认清单",
        },
      ],
    };
    const sendInteractiveCard = vi.fn().mockResolvedValue({ messageId: "om_batch" });

    await expect(sendFeishuTaskBatchNotification(batch, env, {
      idempotencyKey,
      transport: transport(sendInteractiveCard),
    })).resolves.toEqual({ messageId: "om_batch" });

    const call = sendInteractiveCard.mock.calls[0][0];
    expect(call.idempotencyKey).toBe(idempotencyKey);
    expect(JSON.stringify(call.card)).toContain("你有 2 项新任务");
    expect(JSON.stringify(call.card)).toContain("整理验收清单");
    expect(JSON.stringify(call.card)).not.toContain("app-secret");
  });

  it("rejects invalid configuration before invoking the transport", async () => {
    const sendInteractiveCard = vi.fn();
    await expect(sendFeishuTaskNotification(input, { ...env, appUrl: "https://user:pass@brain.example" }, {
      idempotencyKey,
      transport: transport(sendInteractiveCard),
    })).rejects.toThrow(/^configuration_unavailable$/);
    expect(sendInteractiveCard).not.toHaveBeenCalled();
  });
});
