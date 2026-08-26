import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createFeishuWebhookHandler } from "@/app/api/workstation/feishu/webhook/handler";

const rawBody = JSON.stringify({
  schema: "2.0",
  header: {
    event_id: "evt-deduplicated",
    event_type: "contact.user.updated_v3",
    create_time: "1800000000000",
    token: "verify",
    app_id: "cli_isolated",
    tenant_key: "tenant_isolated",
  },
  event: { object: { open_id: "ou_employee" } },
});

function request(signed = true) {
  const timestamp = "1800000000";
  const nonce = "nonce";
  const signature = createHash("sha256").update(`${timestamp}${nonce}encrypt${rawBody}`).digest("hex");
  return new Request("https://work.quantxy.test/api/workstation/feishu/webhook", {
    method: "POST",
    headers: signed ? {
      "x-lark-request-timestamp": timestamp,
      "x-lark-request-nonce": nonce,
      "x-lark-signature": signature,
    } : {},
    body: rawBody,
  });
}

describe("Feishu webhook route", () => {
  it("rejects an unsigned production event without persistence", async () => {
    let persisted = 0;
    const response = await createFeishuWebhookHandler({
      config: { verificationToken: "verify", encryptKey: "encrypt", appId: "cli_isolated", tenantKey: "tenant_isolated" },
      now: () => 1_800_000_000,
      persist: async () => { persisted += 1; return { status: "applied", cursor: "1" }; },
    })(request(false));

    expect(response.status).toBe(401);
    expect(persisted).toBe(0);
  });

  it("acknowledges durable provider-event dedupe without applying twice", async () => {
    const seen = new Set<string>();
    let applied = 0;
    const handler = createFeishuWebhookHandler({
      config: { verificationToken: "verify", encryptKey: "encrypt", appId: "cli_isolated", tenantKey: "tenant_isolated" },
      now: () => 1_800_000_000,
      persist: async (event) => {
        if (seen.has(event.eventId)) return { status: "duplicate", cursor: "1" };
        seen.add(event.eventId); applied += 1;
        return { status: "applied", cursor: "1" };
      },
    });

    expect((await handler(request())).status).toBe(202);
    expect((await handler(request())).status).toBe(202);
    expect(applied).toBe(1);
  });
});
