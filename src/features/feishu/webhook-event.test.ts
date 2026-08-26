import { createCipheriv, createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { verifyFeishuWebhook } from "@/features/feishu/webhook-event";

const config = {
  verificationToken: "verification-token",
  encryptKey: "encryption-secret",
  appId: "cli_isolated",
  tenantKey: "tenant_isolated",
};
const now = 1_800_000_000;

function signedRequest(body: string, timestamp = now) {
  const nonce = "nonce-1";
  const signature = createHash("sha256")
    .update(`${timestamp}${nonce}${config.encryptKey}${body}`)
    .digest("hex");
  return new Request("https://work.quantxy.test/api/workstation/feishu/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-lark-request-timestamp": String(timestamp),
      "x-lark-request-nonce": nonce,
      "x-lark-signature": signature,
    },
    body,
  });
}

function eventBody(eventType = "contact.user.updated_v3") {
  return JSON.stringify({
    schema: "2.0",
    header: {
      event_id: "evt-001",
      event_type: eventType,
      create_time: "1800000000000",
      token: config.verificationToken,
      app_id: config.appId,
      tenant_key: config.tenantKey,
    },
    event: { object: { open_id: "ou_employee" } },
  });
}

describe("official Feishu webhook verification", () => {
  it("verifies the raw-body signature and returns only sanitized event metadata", async () => {
    const rawBody = eventBody();
    const result = await verifyFeishuWebhook(signedRequest(rawBody), rawBody, config, now);

    expect(result).toEqual({
      kind: "event",
      event: expect.objectContaining({
        eventId: "evt-001",
        eventType: "contact.user.updated_v3",
        entityType: "user",
        entityExternalId: "ou_employee",
        sequence: 1_800_000_000_000,
        payloadDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    });
    expect(JSON.stringify(result)).not.toContain(config.verificationToken);
  });

  it("rejects unsigned, stale and undeclared event types", async () => {
    const rawBody = eventBody();
    await expect(verifyFeishuWebhook(new Request("https://work.quantxy.test", { method: "POST", body: rawBody }), rawBody, config, now))
      .rejects.toMatchObject({ code: "webhook_unauthorized" });
    await expect(verifyFeishuWebhook(signedRequest(rawBody, now - 601), rawBody, config, now))
      .rejects.toMatchObject({ code: "webhook_replay_window" });
    const unknown = eventBody("im.message.receive_v1");
    await expect(verifyFeishuWebhook(signedRequest(unknown), unknown, config, now))
      .rejects.toMatchObject({ code: "webhook_event_unsupported" });
  });

  it("decrypts the official AES-256-CBC encrypted envelope before token checks", async () => {
    const plaintext = eventBody("contact.user.deleted_v3");
    const key = createHash("sha256").update(config.encryptKey).digest();
    const iv = Buffer.alloc(16, 7);
    const cipher = createCipheriv("aes-256-cbc", key, iv);
    const encrypted = Buffer.concat([iv, cipher.update(plaintext, "utf8"), cipher.final()]).toString("base64");
    const rawBody = JSON.stringify({ encrypt: encrypted });

    const result = await verifyFeishuWebhook(signedRequest(rawBody), rawBody, config, now);
    expect(result).toMatchObject({ kind: "event", event: { eventType: "contact.user.deleted_v3" } });
  });

  it("verifies and decrypts an encrypted URL challenge before token validation", async () => {
    const plaintext = JSON.stringify({
      type: "url_verification",
      token: config.verificationToken,
      challenge: "challenge-encrypted-1",
    });
    const key = createHash("sha256").update(config.encryptKey).digest();
    const iv = Buffer.alloc(16, 9);
    const cipher = createCipheriv("aes-256-cbc", key, iv);
    const encrypted = Buffer.concat([iv, cipher.update(plaintext, "utf8"), cipher.final()]).toString("base64");
    const rawBody = JSON.stringify({ encrypt: encrypted });

    await expect(verifyFeishuWebhook(signedRequest(rawBody), rawBody, config, now))
      .resolves.toEqual({ kind: "challenge", challenge: "challenge-encrypted-1" });
  });
});
