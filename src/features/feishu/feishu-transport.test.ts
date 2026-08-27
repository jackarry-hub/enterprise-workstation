import { describe, expect, it, vi } from "vitest";

import type { HttpInstance } from "@larksuiteoapi/node-sdk";

import {
  createBoundedFeishuHttpInstance,
  createFeishuTransport,
} from "@/features/feishu/feishu-transport";

const idempotencyKey = "41000000-0000-4000-8000-000000000001";

describe("official Feishu SDK transport", () => {
  it("bounds SDK token and message HTTP calls to eight seconds", async () => {
    const request = vi.fn().mockResolvedValue({});
    const post = vi.fn().mockResolvedValue({});
    const passthrough = vi.fn().mockResolvedValue({});
    const base = {
      request, post,
      get: passthrough, delete: passthrough, head: passthrough,
      options: passthrough, put: passthrough, patch: passthrough,
    } as unknown as HttpInstance;
    const bounded = createBoundedFeishuHttpInstance(base);

    await bounded.request({ url: "https://open.feishu.cn/token", timeout: 60_000 });
    await bounded.post("https://open.feishu.cn/message", {}, { timeout: 60_000 });

    expect(request).toHaveBeenCalledWith(expect.objectContaining({ timeout: 8_000 }));
    expect(post).toHaveBeenCalledWith(
      "https://open.feishu.cn/message", {}, expect.objectContaining({ timeout: 8_000 }),
    );
  });

  it("uses the durable attempt token as the provider message UUID", async () => {
    const create = vi.fn().mockResolvedValue({ code: 0, data: { message_id: "om_123" } });
    const clientFactory = vi.fn(() => ({ im: { v1: { message: { create } } } }));
    const transport = createFeishuTransport({ appId: " cli_test ", appSecret: " secret " }, clientFactory);

    await expect(transport.sendInteractiveCard({
      recipientOpenId: "ou_employee",
      idempotencyKey,
      card: { header: { title: "真实任务" } },
    })).resolves.toEqual({ messageId: "om_123" });

    expect(clientFactory).toHaveBeenCalledWith({ appId: "cli_test", appSecret: "secret" });
    expect(create).toHaveBeenCalledWith({
      params: { receive_id_type: "open_id" },
      data: {
        receive_id: "ou_employee",
        msg_type: "interactive",
        content: JSON.stringify({ header: { title: "真实任务" } }),
        uuid: idempotencyKey,
      },
    });
  });

  it("records an explicit provider rejection as a confirmed send failure", async () => {
    const response = { code: 999, msg: "provider details" };
    const clientFactory = () => ({
      im: { v1: { message: { create: vi.fn().mockResolvedValue(response) } } },
    });
    const transport = createFeishuTransport({ appId: "cli_test", appSecret: "secret" }, clientFactory);

    await expect(transport.sendInteractiveCard({
      recipientOpenId: "ou_employee",
      idempotencyKey,
      card: {},
    })).rejects.toThrow(/^send_failed$/);
  });

  it("keeps a success response without a message ID unconfirmed", async () => {
    const clientFactory = () => ({
      im: { v1: { message: { create: vi.fn().mockResolvedValue({ code: 0, data: {} }) } } },
    });
    const transport = createFeishuTransport({ appId: "cli_test", appSecret: "secret" }, clientFactory);
    await expect(transport.sendInteractiveCard({
      recipientOpenId: "ou_employee", idempotencyKey, card: {},
    })).rejects.toThrow(/^delivery_unconfirmed$/);
  });

  it.each([
    ["null response", null],
    ["missing code", { data: { message_id: "om_123" } }],
    ["string code", { code: "0", data: { message_id: "om_123" } }],
    ["fractional code", { code: 0.5, data: { message_id: "om_123" } }],
  ])("keeps a malformed %s unconfirmed", async (_label, response) => {
    const create = vi.fn().mockResolvedValue(response);
    const transport = createFeishuTransport(
      { appId: "cli_test", appSecret: "secret" },
      () => ({ im: { v1: { message: { create } } } }),
    );

    await expect(transport.sendInteractiveCard({
      recipientOpenId: "ou_employee", idempotencyKey, card: {},
    })).rejects.toThrow(/^delivery_unconfirmed$/);
  });

  it("redacts an SDK failure and rejects invalid idempotency before the SDK call", async () => {
    const providerFailure = "secret provider response";
    const create = vi.fn().mockRejectedValue(new Error(providerFailure));
    const transport = createFeishuTransport(
      { appId: "cli_test", appSecret: "secret" },
      () => ({ im: { v1: { message: { create } } } }),
    );

    await expect(transport.sendInteractiveCard({
      recipientOpenId: "ou_employee",
      idempotencyKey,
      card: {},
    })).rejects.toThrow(/^delivery_unconfirmed$/);
    await expect(transport.sendInteractiveCard({
      recipientOpenId: "ou_employee",
      idempotencyKey: "not-a-uuid",
      card: {},
    })).rejects.toThrow(/^configuration_unavailable$/);
    expect(create).toHaveBeenCalledTimes(1);
  });
});
