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
