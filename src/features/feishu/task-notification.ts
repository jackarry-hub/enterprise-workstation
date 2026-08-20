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

type EnvSource = Readonly<Record<string, string | undefined>>;
type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;
type JsonRecord = Record<string, unknown>;

const FEISHU_API_ORIGIN = "https://open.feishu.cn";
const REQUEST_TIMEOUT_MS = 8_000;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function configurationUnavailable(): never {
  throw new Error("configuration_unavailable");
}

function nonEmptyText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function jsonRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
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

async function fetchJsonWithTimeout(
  fetchImpl: FetchLike,
  input: RequestInfo | URL,
  init: RequestInit,
) {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new Error("request_timeout"));
    }, REQUEST_TIMEOUT_MS);
  });

  try {
    const request = (async () => {
      const response = await fetchImpl(input, {
        ...init,
        signal: controller.signal,
      });
      const body = await responseBody(response);
      return { response, body };
    })();
    return await Promise.race([
      request,
      timeout,
    ]);
  } finally {
    clearTimeout(timeoutId!);
  }
}

async function responseBody(response: Response) {
  return jsonRecord(await response.json().catch(() => null));
}

async function tenantAccessToken(
  env: FeishuTaskNotificationEnv,
  fetchImpl: FetchLike,
) {
  try {
    const { response, body } = await fetchJsonWithTimeout(
      fetchImpl,
      `${FEISHU_API_ORIGIN}/open-apis/auth/v3/tenant_access_token/internal`,
      {
        method: "POST",
        headers: new Headers({
          "content-type": "application/json; charset=utf-8",
        }),
        body: JSON.stringify({ app_id: env.appId, app_secret: env.appSecret }),
      },
    );
    const token = nonEmptyText(body?.tenant_access_token);
    if (!response.ok || body?.code !== 0 || !token) {
      throw new Error("token_unavailable");
    }
    return token;
  } catch {
    throw new Error("token_unavailable");
  }
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
  fetchImpl: FetchLike = fetch,
): Promise<{ messageId: string }> {
  const notificationEnv = validatedEnv(env);
  const taskUrl = buildTaskNotificationLink(notificationEnv.appUrl, input.taskId);
  const token = await tenantAccessToken(notificationEnv, fetchImpl);

  try {
    const { response, body } = await fetchJsonWithTimeout(
      fetchImpl,
      `${FEISHU_API_ORIGIN}/open-apis/im/v1/messages?receive_id_type=open_id`,
      {
        method: "POST",
        headers: new Headers({
          authorization: `Bearer ${token}`,
          "content-type": "application/json; charset=utf-8",
        }),
        body: JSON.stringify({
          receive_id: input.recipientOpenId,
          msg_type: "interactive",
          content: JSON.stringify(notificationCard(input, taskUrl)),
        }),
      },
    );
    const data = jsonRecord(body?.data);
    const messageId = nonEmptyText(data?.message_id);
    if (!response.ok || body?.code !== 0 || !messageId) {
      throw new Error("send_failed");
    }
    return { messageId };
  } catch {
    throw new Error("send_failed");
  }
}
