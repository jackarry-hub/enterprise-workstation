import {
  createFeishuTransport,
  type FeishuTransport,
} from "@/features/feishu/feishu-transport";

export type FeishuTaskNotificationEnv = {
  appId: string;
  appSecret: string;
  appUrl: string;
};

export type FeishuTaskNotificationInput = {
  taskId: string;
  recipientOpenId: string;
  taskTitle: string;
  projectName: string;
  reporterName: string;
  priority: string;
  dueDate: string;
  acceptanceCriteria: string;
};

export type FeishuTaskBatchNotificationInput = {
  recipientOpenId: string;
  reporterName: string;
  tasks: Array<Omit<
    FeishuTaskNotificationInput,
    "recipientOpenId" | "reporterName"
  >>;
};

type EnvSource = Readonly<Record<string, string | undefined>>;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type FeishuDeliveryOptions = {
  idempotencyKey: string;
  transport?: FeishuTransport;
};

export type FeishuTaskEventNotificationInput = {
  taskId: string;
  recipientOpenId: string;
  eventType: "task.assigned" | "task.submitted" | "task.review_passed" | "task.review_rejected" | "task.reopened";
  taskTitle: string;
  projectName: string;
  actorName: string;
  reviewNote: string;
};

function configurationUnavailable(): never {
  throw new Error("configuration_unavailable");
}

function nonEmptyText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function rootAppUrl(value: unknown) {
  const text = nonEmptyText(value);
  if (!text) return configurationUnavailable();

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return configurationUnavailable();
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:")
    || url.username
    || url.password
    || url.pathname !== "/"
    || url.search
    || url.hash
  ) {
    return configurationUnavailable();
  }

  return url.origin;
}

function validatedEnv(env: FeishuTaskNotificationEnv) {
  const appId = nonEmptyText(env.appId);
  const appSecret = nonEmptyText(env.appSecret);
  if (!appId || !appSecret) return configurationUnavailable();
  return { appId, appSecret, appUrl: rootAppUrl(env.appUrl) };
}

function notificationCard(
  input: FeishuTaskNotificationInput,
  taskUrl: string,
) {
  const messageSummary = [
    `**任务：** ${input.taskTitle}`,
    `**项目：** ${input.projectName}`,
    `**发起人：** ${input.reporterName}`,
    `**优先级：** ${input.priority}`,
    `**截止日期：** ${input.dueDate}`,
    `**验收标准：** ${input.acceptanceCriteria}`,
  ].join("\n");

  return {
    config: { wide_screen_mode: true },
    header: {
      template: "blue",
      title: { tag: "plain_text", content: "你有一项新任务" },
    },
    elements: [
      { tag: "markdown", content: messageSummary },
      {
        tag: "action",
        actions: [{
          tag: "button",
          type: "primary",
          text: { tag: "plain_text", content: "查看并领取" },
          url: taskUrl,
        }],
      },
    ],
  };
}

function batchNotificationCard(
  input: FeishuTaskBatchNotificationInput,
  taskUrl: string,
) {
  const taskSections = input.tasks.map((task, index) => [
    `**${index + 1}. ${task.taskTitle}**`,
    `${task.projectName} · ${task.priority} · 截止 ${task.dueDate}`,
    `验收：${task.acceptanceCriteria}`,
  ].join("\n")).join("\n\n");

  return {
    config: { wide_screen_mode: true },
    header: {
      template: "blue",
      title: {
        tag: "plain_text",
        content: `你有 ${input.tasks.length} 项新任务`,
      },
    },
    elements: [
      {
        tag: "markdown",
        content: `**发起人：** ${input.reporterName}\n\n${taskSections}`,
      },
      {
        tag: "action",
        actions: [{
          tag: "button",
          type: "primary",
          text: { tag: "plain_text", content: "查看并领取" },
          url: taskUrl,
        }],
      },
    ],
  };
}

export function getFeishuTaskNotificationEnv(
  env: EnvSource = process.env,
): FeishuTaskNotificationEnv {
  return validatedEnv({
    appId: env.FEISHU_APP_ID ?? "",
    appSecret: env.FEISHU_APP_SECRET ?? "",
    appUrl: env.NEXT_PUBLIC_APP_URL ?? "",
  });
}

export function buildTaskNotificationLink(appUrl: string, taskId: string) {
  if (!UUID_PATTERN.test(taskId)) return configurationUnavailable();
  const url = new URL(
    "/quantxy-ai-workbench-fused.html",
    rootAppUrl(appUrl),
  );
  url.searchParams.set("formal", "1");
  url.searchParams.set("task", taskId);
  return url.toString();
}

export async function sendFeishuTaskNotification(
  input: FeishuTaskNotificationInput,
  env: FeishuTaskNotificationEnv,
  options: FeishuDeliveryOptions,
): Promise<{ messageId: string }> {
  const notificationEnv = validatedEnv(env);
  const taskUrl = buildTaskNotificationLink(notificationEnv.appUrl, input.taskId);
  return sendInteractiveCard(
    input.recipientOpenId,
    notificationCard(input, taskUrl),
    notificationEnv,
    options,
  );
}

function escapedMarkdownText(value: string) {
  return value.replace(/[\\`*_{}\[\]()#+\-.!|>]/g, "\\$&");
}

function eventNotificationCard(input: FeishuTaskEventNotificationInput, taskUrl: string) {
  const meta = {
    "task.assigned": { title: "收到新任务", action: "查看并领取", template: "blue" },
    "task.submitted": { title: "任务待验收", action: "查看并验收", template: "orange" },
    "task.review_passed": { title: "任务已通过验收", action: "查看结果", template: "green" },
    "task.review_rejected": { title: "任务被退回修改", action: "查看验收意见", template: "red" },
    "task.reopened": { title: "任务已重新打开", action: "查看最新要求", template: "blue" },
  }[input.eventType];
  return {
    config: { wide_screen_mode: true },
    header: { template: meta.template, title: { tag: "plain_text", content: meta.title } },
    elements: [
      { tag: "markdown", content: [`**任务：** ${escapedMarkdownText(input.taskTitle)}`, `**项目：** ${escapedMarkdownText(input.projectName)}`, `**操作人：** ${escapedMarkdownText(input.actorName)}`, input.reviewNote ? `**说明：** ${escapedMarkdownText(input.reviewNote)}` : ""].filter(Boolean).join("\n") },
      { tag: "action", actions: [{ tag: "button", type: "primary", text: { tag: "plain_text", content: meta.action }, url: taskUrl }] },
    ],
  };
}

export async function sendFeishuTaskBatchNotification(
  input: FeishuTaskBatchNotificationInput,
  env: FeishuTaskNotificationEnv,
  options: FeishuDeliveryOptions,
): Promise<{ messageId: string }> {
  const notificationEnv = validatedEnv(env);
  const recipientOpenId = nonEmptyText(input.recipientOpenId);
  if (!recipientOpenId || input.tasks.length < 1 || input.tasks.length > 20) {
    return configurationUnavailable();
  }
  const taskUrl = buildTaskNotificationLink(
    notificationEnv.appUrl,
    input.tasks[0].taskId,
  );
  return sendInteractiveCard(
    recipientOpenId,
    batchNotificationCard(input, taskUrl),
    notificationEnv,
    options,
  );
}

export async function sendFeishuTaskEventNotification(
  input: FeishuTaskEventNotificationInput,
  env: FeishuTaskNotificationEnv,
  options: FeishuDeliveryOptions,
) {
  const notificationEnv = validatedEnv(env);
  const taskUrl = buildTaskNotificationLink(notificationEnv.appUrl, input.taskId);
  return sendInteractiveCard(input.recipientOpenId, eventNotificationCard(input, taskUrl), notificationEnv, options);
}

let cachedTransport: {
  appId: string;
  appSecret: string;
  transport: FeishuTransport;
} | null = null;

function defaultTransport(notificationEnv: FeishuTaskNotificationEnv) {
  if (cachedTransport?.appId === notificationEnv.appId
      && cachedTransport.appSecret === notificationEnv.appSecret) {
    return cachedTransport.transport;
  }
  const transport = createFeishuTransport(notificationEnv);
  cachedTransport = {
    appId: notificationEnv.appId,
    appSecret: notificationEnv.appSecret,
    transport,
  };
  return transport;
}

async function sendInteractiveCard(
  recipientOpenId: string,
    card: ReturnType<typeof notificationCard> | ReturnType<typeof eventNotificationCard>,
  notificationEnv: FeishuTaskNotificationEnv,
  options: FeishuDeliveryOptions,
) {
  const transport = options.transport ?? defaultTransport(notificationEnv);
  return transport.sendInteractiveCard({
    recipientOpenId,
    card,
    idempotencyKey: options.idempotencyKey,
  });
}
