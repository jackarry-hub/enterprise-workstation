import {
  AppType,
  Client,
  Domain,
  LoggerLevel,
  defaultHttpInstance,
  type HttpInstance,
  type HttpRequestOptions,
} from "@larksuiteoapi/node-sdk";

const REQUEST_TIMEOUT_MS = 8_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type InteractiveCard = Record<string, unknown>;

export type FeishuTransportConfig = {
  appId: string;
  appSecret: string;
};

export type FeishuTransport = {
  sendInteractiveCard(input: {
    recipientOpenId: string;
    card: InteractiveCard;
    idempotencyKey: string;
  }): Promise<{ messageId: string }>;
};

type FeishuClientLike = {
  im: {
    v1: {
      message: {
        create(payload: {
          params: { receive_id_type: "open_id" };
          data: {
            receive_id: string;
            msg_type: "interactive";
            content: string;
            uuid: string;
          };
        }): Promise<{
          code?: number;
          data?: { message_id?: string };
        }>;
      };
    };
  };
};

type ClientFactory = (config: FeishuTransportConfig) => FeishuClientLike;

function safeText(value: unknown, maximum: number) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.length <= maximum && !/[\u0000-\u001f\u007f]/.test(text)
    ? text
    : null;
}

function boundedOptions<D>(options: HttpRequestOptions<D> | undefined) {
  return { ...options, timeout: REQUEST_TIMEOUT_MS };
}

export function createBoundedFeishuHttpInstance(base: HttpInstance): HttpInstance {
  return {
    request: (options) => base.request(boundedOptions(options)),
    get: (url, options) => base.get(url, boundedOptions(options)),
    delete: (url, options) => base.delete(url, boundedOptions(options)),
    head: (url, options) => base.head(url, boundedOptions(options)),
    options: (url, options) => base.options(url, boundedOptions(options)),
    post: (url, data, options) => base.post(url, data, boundedOptions(options)),
    put: (url, data, options) => base.put(url, data, boundedOptions(options)),
    patch: (url, data, options) => base.patch(url, data, boundedOptions(options)),
  };
}

function defaultClientFactory(config: FeishuTransportConfig): FeishuClientLike {
  return new Client({
    appId: config.appId,
    appSecret: config.appSecret,
    appType: AppType.SelfBuild,
    domain: Domain.Feishu,
    loggerLevel: LoggerLevel.error,
    httpInstance: createBoundedFeishuHttpInstance(defaultHttpInstance as unknown as HttpInstance),
  });
}

export function createFeishuTransport(
  config: FeishuTransportConfig,
  clientFactory: ClientFactory = defaultClientFactory,
): FeishuTransport {
  const appId = safeText(config.appId, 200);
  const appSecret = safeText(config.appSecret, 512);
  if (!appId || !appSecret) throw new Error("configuration_unavailable");

  const client = clientFactory({ appId, appSecret });
  return {
    async sendInteractiveCard({ recipientOpenId, card, idempotencyKey }) {
      const recipient = safeText(recipientOpenId, 200);
      if (!recipient || !UUID_PATTERN.test(idempotencyKey)) {
        throw new Error("configuration_unavailable");
      }
      let content: string;
      try {
        content = JSON.stringify(card);
      } catch {
        throw new Error("configuration_unavailable");
      }
      if (!content || content.length > 100_000) throw new Error("configuration_unavailable");

      let response: unknown;
      try {
        response = await client.im.v1.message.create({
          params: { receive_id_type: "open_id" },
          data: {
            receive_id: recipient,
            msg_type: "interactive",
            content,
            uuid: idempotencyKey.toLowerCase(),
          },
        });
      } catch {
        // The provider may have accepted the UUID before the connection failed.
        // Preserve the durable attempt so a later retry reuses the same UUID.
        throw new Error("delivery_unconfirmed");
      }
      if (!response || typeof response !== "object" || Array.isArray(response)) {
        throw new Error("delivery_unconfirmed");
      }
      const result = response as Record<string, unknown>;
      if (!Number.isInteger(result.code)) throw new Error("delivery_unconfirmed");
      if (result.code !== 0) throw new Error("send_failed");
      const data = result.data && typeof result.data === "object" && !Array.isArray(result.data)
        ? result.data as Record<string, unknown>
        : null;
      const messageId = safeText(data?.message_id, 512);
      if (!messageId) throw new Error("delivery_unconfirmed");
      return { messageId };
    },
  };
}
