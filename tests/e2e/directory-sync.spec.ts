import { createHash, randomUUID } from "node:crypto";

import { expect, test, type APIRequestContext } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { getAuthHarnessEnvironment } from "./auth-state";

const webhookReady = [
  process.env.FEISHU_VERIFICATION_TOKEN,
  process.env.FEISHU_ENCRYPT_KEY,
  process.env.FEISHU_APP_ID,
  process.env.FEISHU_TENANT_KEY,
].every((value) => Boolean(value?.trim()));
const localDatabase = /localhost|127\.0\.0\.1/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
const commercialGate = process.env.FEISHU_E2E_ALLOW_SYNTHETIC === "1" && webhookReady && localDatabase;

function officialEvent(eventId: string, eventType: string, externalId: string, sequence = Date.now()) {
  const externalIdKey = eventType.includes("department") ? "open_department_id" : "open_id";
  return JSON.stringify({
    schema: "2.0",
    header: {
      event_id: eventId,
      event_type: eventType,
      create_time: String(sequence),
      token: process.env.FEISHU_VERIFICATION_TOKEN,
      app_id: process.env.FEISHU_APP_ID,
      tenant_key: process.env.FEISHU_TENANT_KEY,
    },
    event: { object: { [externalIdKey]: externalId } },
  });
}

function signedHeaders(rawBody: string) {
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const nonce = randomUUID();
  const signature = createHash("sha256")
    .update(`${timestamp}${nonce}${process.env.FEISHU_ENCRYPT_KEY}${rawBody}`, "utf8")
    .digest("hex");
  return {
    "content-type": "application/json",
    "x-lark-request-timestamp": timestamp,
    "x-lark-request-nonce": nonce,
    "x-lark-signature": signature,
  };
}

async function ingest(request: APIRequestContext, rawBody: string) {
  return request.post("/api/workstation/feishu/webhook", {
    data: rawBody,
    headers: signedHeaders(rawBody),
  });
}

test.describe("commercial Feishu directory source contracts", () => {
  test.skip(!commercialGate, "Requires an isolated local Supabase stack and non-production Feishu test settings.");

  test("signed ingestion is durable and a lost-response retry returns the same terminal result", async ({ request }) => {
    const eventId = `synthetic-${randomUUID()}`;
    const rawBody = officialEvent(eventId, "contact.user.updated_v3", `ou_synthetic_${randomUUID().replaceAll("-", "")}`);
    const first = await ingest(request, rawBody);
    const retry = await ingest(request, rawBody);

    expect(first.status()).toBe(202);
    expect(retry.status()).toBe(202);
    expect(await retry.json()).toEqual(await first.json());

    const environment = getAuthHarnessEnvironment();
    const admin = createClient(environment.supabaseUrl, environment.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const persisted = await admin.from("feishu_webhook_events")
      .select("provider_event_id, disposition, payload_digest")
      .eq("provider_event_id", eventId);
    expect(persisted.error).toBeNull();
    expect(persisted.data).toHaveLength(1);
    expect(persisted.data?.[0]).toMatchObject({
      provider_event_id: eventId,
      disposition: "applied",
      payload_digest: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  test("out-of-order ingestion creates an organization issue and resolution is retry-idempotent", async ({ request }) => {
    const openId = `ou_synthetic_${randomUUID().replaceAll("-", "")}`;
    const sequence = Date.now();
    const first = await ingest(request, officialEvent(`synthetic-${randomUUID()}`, "contact.user.updated_v3", openId, sequence));
    const stale = await ingest(request, officialEvent(`synthetic-${randomUUID()}`, "contact.user.updated_v3", openId, sequence - 1));
    expect(first.status()).toBe(202);
    expect(stale.status()).toBe(202);
    expect(await stale.json()).toMatchObject({ accepted: true, status: "reconcile" });

    const environment = getAuthHarnessEnvironment();
    const admin = createClient(environment.supabaseUrl, environment.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const issue = await admin.from("feishu_sync_conflicts")
      .select("public_id, status, code")
      .eq("code", "OUT_OF_ORDER_EVENT")
      .order("created_at", { ascending: false })
      .limit(1).single();
    expect(issue.error).toBeNull();
    const issueId = issue.data!.public_id;
    const resolved = await request.post(`/api/workstation/feishu/sync-issues/${issueId}/resolve`);
    const retried = await request.post(`/api/workstation/feishu/sync-issues/${issueId}/resolve`);
    expect(resolved.status()).toBe(200);
    expect(retried.status()).toBe(200);
    expect(await retried.json()).toEqual({ status: "resolved" });
  });

  test("full, incremental and reconciliation runs use the durable worker without request interception", async ({ request }) => {
    test.skip(
      !process.env.FEISHU_APP_SECRET?.trim() || !process.env.FEISHU_DIRECTORY_SYNC_CRON_SECRET?.trim(),
      "Requires non-production Feishu directory test credentials and a local cron secret.",
    );
    const full = await request.post("/api/workstation/directory-sync", { data: { mode: "full" } });
    expect(full.status()).toBe(200);
    expect(await full.json()).toMatchObject({ status: "completed", runId: expect.any(String) });

    const rawBody = officialEvent(
      `synthetic-${randomUUID()}`,
      "contact.department.updated_v3",
      `od_synthetic_${randomUUID().replaceAll("-", "")}`,
    );
    expect((await ingest(request, rawBody)).status()).toBe(202);
    const authorization = `Bearer ${process.env.FEISHU_DIRECTORY_SYNC_CRON_SECRET}`;
    const incremental = await request.post("/api/internal/feishu-directory-sync", { headers: { authorization } });
    const reconcile = await request.post("/api/internal/feishu-directory-sync", { headers: { authorization } });
    expect(incremental.status()).toBe(200);
    expect(await incremental.json()).toMatchObject({ status: "completed", cursor: expect.any(String) });
    expect(reconcile.status()).toBe(200);
    expect(await reconcile.json()).toMatchObject({ status: "completed" });
  });

  test("a signed deleted-user event completes durable transactional offboarding", async ({ request }) => {
    const openId = process.env.FEISHU_E2E_OFFBOARD_OPEN_ID?.trim();
    test.skip(!openId, "Requires a disposable local user seeded for offboarding.");
    const eventId = `synthetic-offboard-${randomUUID()}`;
    const rawBody = officialEvent(eventId, "contact.user.deleted_v3", openId!);
    const first = await ingest(request, rawBody);
    const retry = await ingest(request, rawBody);
    expect(first.status()).toBe(202);
    expect(await retry.json()).toEqual(await first.json());

    const environment = getAuthHarnessEnvironment();
    const admin = createClient(environment.supabaseUrl, environment.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const identity = await admin.from("external_identities")
      .select("organization_member_id, status, auth_user_id")
      .eq("provider_subject", `open_id:${openId!.toLowerCase()}`).single();
    expect(identity.data).toMatchObject({ status: "revoked", auth_user_id: null });
    const member = await admin.from("organization_members").select("status")
      .eq("id", identity.data!.organization_member_id).single();
    expect(member.data).toEqual({ status: "revoked" });
    const eventIdDigest = createHash("sha256").update(eventId).digest("hex");
    const audit = await admin.from("audit_logs").select("id", { count: "exact" })
      .eq("action", "identity.revoked").contains("metadata", { eventIdDigest });
    expect(audit.count).toBe(1);
  });
});
