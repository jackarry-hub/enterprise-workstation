import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { getAuthHarnessEnvironment } from "./auth-state";

test("configuration failure is request-correlated and never publishes a complete directory snapshot", async ({ request }) => {
  test.skip(
    Boolean(process.env.FEISHU_APP_ID?.trim() || process.env.FEISHU_APP_SECRET?.trim()),
    "This local failure-correlation path requires Feishu credentials to be unset.",
  );

  const response = await request.post("/api/workstation/directory-sync");
  const body = await response.json();
  const requestId = response.headers()["x-request-id"];

  expect(response.status()).toBe(502);
  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  expect(body).toMatchObject({
    error: {
      code: "directory_configuration_invalid",
      requestId,
    },
  });
  expect(body.error.runId).toMatch(/^[0-9a-f-]{36}$/i);
  expect(JSON.stringify(body)).not.toContain("FEISHU_APP_SECRET");

  const environment = getAuthHarnessEnvironment();
  const admin = createClient(environment.supabaseUrl, environment.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const persisted = await admin
    .from("directory_sync_runs")
    .select("status, snapshot_complete, error_count, request_id")
    .eq("request_id", requestId)
    .single();

  expect(persisted.error).toBeNull();
  expect(persisted.data).toEqual({
    status: "failed",
    snapshot_complete: false,
    error_count: 1,
    request_id: requestId,
  });
});

test("unsigned Feishu contact events are rejected before durable ingestion", async ({ request }) => {
  test.skip(
    !process.env.FEISHU_VERIFICATION_TOKEN?.trim() || !process.env.FEISHU_ENCRYPT_KEY?.trim()
      || !process.env.FEISHU_APP_ID?.trim() || !process.env.FEISHU_TENANT_KEY?.trim(),
    "Local signed-webhook verification requires isolated non-production Feishu settings.",
  );
  const response = await request.post("/api/workstation/feishu/webhook", {
    data: {
      schema: "2.0",
      header: {
        event_id: "synthetic-unsigned-event",
        event_type: "contact.user.updated_v3",
        create_time: String(Date.now()),
        token: process.env.FEISHU_VERIFICATION_TOKEN,
        app_id: process.env.FEISHU_APP_ID,
        tenant_key: process.env.FEISHU_TENANT_KEY,
      },
      event: { object: { open_id: "ou_synthetic" } },
    },
  });
  expect(response.status()).toBe(401);
  expect(await response.json()).toEqual({ error: "webhook_unauthorized" });
});
