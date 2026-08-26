import "server-only";

import { createDecipheriv, createHash, timingSafeEqual } from "node:crypto";

export const FEISHU_CONTACT_EVENT_TYPES = [
  "contact.user.created_v3",
  "contact.user.updated_v3",
  "contact.user.deleted_v3",
  "contact.department.created_v3",
  "contact.department.updated_v3",
  "contact.department.deleted_v3",
] as const;

export type FeishuContactEventType = typeof FEISHU_CONTACT_EVENT_TYPES[number];
export type FeishuWebhookConfig = {
  verificationToken: string;
  encryptKey: string;
  appId: string;
  tenantKey: string;
};

export type SanitizedFeishuEvent = {
  eventId: string;
  eventType: FeishuContactEventType;
  entityType: "user" | "department";
  entityExternalId: string;
  sequence: number;
  payloadDigest: string;
};

export class FeishuWebhookError extends Error {
  constructor(public readonly code: "webhook_unauthorized" | "webhook_replay_window" | "webhook_payload_invalid" | "webhook_event_unsupported") {
    super(code);
    this.name = "FeishuWebhookError";
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function constantTimeTextEqual(actual: string, expected: string) {
  const actualDigest = createHash("sha256").update(actual, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}

function parseJson(value: string) {
  try {
    const parsed = record(JSON.parse(value));
    if (!parsed) throw new Error("invalid");
    return parsed;
  } catch {
    throw new FeishuWebhookError("webhook_payload_invalid");
  }
}

function decryptEnvelope(encrypted: string, encryptKey: string) {
  try {
    const encoded = Buffer.from(encrypted, "base64");
    if (encoded.length <= 16) throw new Error("invalid");
    const key = createHash("sha256").update(encryptKey, "utf8").digest();
    const decipher = createDecipheriv("aes-256-cbc", key, encoded.subarray(0, 16));
    return Buffer.concat([decipher.update(encoded.subarray(16)), decipher.final()]).toString("utf8");
  } catch {
    throw new FeishuWebhookError("webhook_payload_invalid");
  }
}

function configured(config: FeishuWebhookConfig) {
  return [config.verificationToken, config.encryptKey, config.appId, config.tenantKey]
    .every((value) => typeof value === "string" && value.trim() === value && value.length >= 3 && value.length <= 512);
}

export function getFeishuWebhookConfig(env: NodeJS.ProcessEnv = process.env): FeishuWebhookConfig {
  const config = {
    verificationToken: env.FEISHU_VERIFICATION_TOKEN?.trim() ?? "",
    encryptKey: env.FEISHU_ENCRYPT_KEY?.trim() ?? "",
    appId: env.FEISHU_APP_ID?.trim() ?? "",
    tenantKey: env.FEISHU_TENANT_KEY?.trim() ?? "",
  };
  if (!configured(config)) throw new FeishuWebhookError("webhook_unauthorized");
  return config;
}

function verifySignature(request: Request, rawBody: string, config: FeishuWebhookConfig, nowSeconds: number) {
  const timestampText = request.headers.get("x-lark-request-timestamp") ?? "";
  const nonce = request.headers.get("x-lark-request-nonce") ?? "";
  const signature = request.headers.get("x-lark-signature") ?? "";
  const timestamp = Number(timestampText);
  if (!/^\d{10}$/.test(timestampText) || !nonce || !/^[0-9a-f]{64}$/i.test(signature)) {
    throw new FeishuWebhookError("webhook_unauthorized");
  }
  if (Math.abs(nowSeconds - timestamp) > 300) throw new FeishuWebhookError("webhook_replay_window");
  const expected = createHash("sha256")
    .update(`${timestampText}${nonce}${config.encryptKey}${rawBody}`, "utf8")
    .digest("hex");
  if (!constantTimeTextEqual(signature.toLowerCase(), expected)) throw new FeishuWebhookError("webhook_unauthorized");
}

export async function verifyFeishuWebhook(
  request: Request,
  rawBody: string,
  config: FeishuWebhookConfig,
  nowSeconds = Math.floor(Date.now() / 1_000),
): Promise<{ kind: "challenge"; challenge: string } | { kind: "event"; event: SanitizedFeishuEvent }> {
  if (!configured(config) || Buffer.byteLength(rawBody, "utf8") > 1_048_576) {
    throw new FeishuWebhookError("webhook_payload_invalid");
  }
  const envelope = parseJson(rawBody);
  if (envelope.type === "url_verification") {
    const token = text(envelope.token);
    const challenge = text(envelope.challenge);
    if (!token || !constantTimeTextEqual(token, config.verificationToken)) throw new FeishuWebhookError("webhook_unauthorized");
    if (!challenge || challenge.length > 512) throw new FeishuWebhookError("webhook_payload_invalid");
    return { kind: "challenge", challenge };
  }

  verifySignature(request, rawBody, config, nowSeconds);
  const encrypted = text(envelope.encrypt);
  const payloadText = encrypted ? decryptEnvelope(encrypted, config.encryptKey) : rawBody;
  const payload = encrypted ? parseJson(payloadText) : envelope;
  if (payload.type === "url_verification") {
    const token = text(payload.token);
    const challenge = text(payload.challenge);
    if (!token || !constantTimeTextEqual(token, config.verificationToken)) {
      throw new FeishuWebhookError("webhook_unauthorized");
    }
    if (!challenge || challenge.length > 512) {
      throw new FeishuWebhookError("webhook_payload_invalid");
    }
    return { kind: "challenge", challenge };
  }
  const header = record(payload.header);
  const event = record(payload.event);
  const object = record(event?.object) ?? record(event?.user) ?? record(event?.department);
  if (!header || !event || !object) throw new FeishuWebhookError("webhook_payload_invalid");

  const token = text(header.token);
  const appId = text(header.app_id);
  const tenantKey = text(header.tenant_key);
  if (!token || !appId || !tenantKey
      || !constantTimeTextEqual(token, config.verificationToken)
      || !constantTimeTextEqual(appId, config.appId)
      || !constantTimeTextEqual(tenantKey, config.tenantKey)) {
    throw new FeishuWebhookError("webhook_unauthorized");
  }
  const eventId = text(header.event_id);
  const eventType = text(header.event_type);
  const createTime = text(header.create_time);
  if (!eventId || eventId.length > 200 || !eventType || !createTime || !/^\d{10,16}$/.test(createTime)) {
    throw new FeishuWebhookError("webhook_payload_invalid");
  }
  if (!FEISHU_CONTACT_EVENT_TYPES.includes(eventType as FeishuContactEventType)) {
    throw new FeishuWebhookError("webhook_event_unsupported");
  }
  const entityType = eventType.includes(".user.") ? "user" : "department";
  const entityExternalId = text(entityType === "user"
    ? object.open_id ?? object.user_id
    : object.open_department_id ?? object.department_id);
  if (!entityExternalId || entityExternalId.length > 200) throw new FeishuWebhookError("webhook_payload_invalid");
  const sequence = Number(createTime.length === 10 ? `${createTime}000` : createTime);
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new FeishuWebhookError("webhook_payload_invalid");

  return {
    kind: "event",
    event: {
      eventId,
      eventType: eventType as FeishuContactEventType,
      entityType,
      entityExternalId,
      sequence,
      payloadDigest: createHash("sha256").update(payloadText, "utf8").digest("hex"),
    },
  };
}
