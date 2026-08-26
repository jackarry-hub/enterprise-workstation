import "server-only";

import { createClient } from "@supabase/supabase-js";

import {
  FeishuWebhookError,
  getFeishuWebhookConfig,
  verifyFeishuWebhook,
  type FeishuWebhookConfig,
  type SanitizedFeishuEvent,
} from "@/features/feishu/webhook-event";
import { getSupabaseEnv } from "@/lib/supabase/env";

export type FeishuWebhookPersistenceResult = {
  status: "applied" | "duplicate" | "reconcile";
  cursor: string;
};

export type FeishuWebhookDependencies = {
  config: FeishuWebhookConfig | (() => FeishuWebhookConfig);
  now?: () => number;
  persist: (event: SanitizedFeishuEvent) => Promise<FeishuWebhookPersistenceResult>;
};

function json(value: unknown, status: number) {
  return Response.json(value, { status, headers: { "cache-control": "no-store" } });
}

export function createFeishuWebhookHandler(dependencies: FeishuWebhookDependencies) {
  return async function feishuWebhook(request: Request) {
    let rawBody: string;
    try {
      rawBody = await request.text();
      const config = typeof dependencies.config === "function" ? dependencies.config() : dependencies.config;
      const verified = await verifyFeishuWebhook(request, rawBody, config, dependencies.now?.());
      if (verified.kind === "challenge") return json({ challenge: verified.challenge }, 200);
      const result = await dependencies.persist(verified.event);
      return json({ accepted: true, status: result.status, cursor: result.cursor }, 202);
    } catch (error) {
      const code = error instanceof FeishuWebhookError ? error.code : "webhook_unavailable";
      const status = code === "webhook_unauthorized" || code === "webhook_replay_window" ? 401
        : code === "webhook_payload_invalid" || code === "webhook_event_unsupported" ? 400
          : 503;
      return json({ error: code }, status);
    }
  };
}

function adminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) throw new Error("webhook_unavailable");
  return createClient(getSupabaseEnv().url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export const defaultFeishuWebhookDependencies: FeishuWebhookDependencies = {
  config: getFeishuWebhookConfig,
  async persist(event) {
    const config = getFeishuWebhookConfig();
    const { data, error } = await adminClient().rpc("ingest_feishu_webhook_event", {
      p_app_id: config.appId,
      p_tenant_key: config.tenantKey,
      p_provider_event_id: event.eventId,
      p_event_type: event.eventType,
      p_entity_type: event.entityType,
      p_entity_external_id: event.entityExternalId,
      p_entity_sequence: event.sequence,
      p_payload_digest: event.payloadDigest,
    });
    if (error || !data || typeof data !== "object") throw new Error("webhook_unavailable");
    const row = data as Record<string, unknown>;
    if (!(["applied", "duplicate", "reconcile"] as const).includes(row.status as never) || typeof row.cursor !== "string") {
      throw new Error("webhook_unavailable");
    }
    return { status: row.status as FeishuWebhookPersistenceResult["status"], cursor: row.cursor };
  },
};
