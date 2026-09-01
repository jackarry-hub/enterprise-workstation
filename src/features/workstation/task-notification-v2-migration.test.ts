import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/202608270008_notification_outbox_v2.sql"),
  "utf8",
);
const dispatcher = readFileSync(
  resolve(process.cwd(), "src/features/workstation/task-notification.ts"),
  "utf8",
);
const batchDispatcher = readFileSync(
  resolve(process.cwd(), "src/features/workstation/task-notification-batch.ts"),
  "utf8",
);
const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
};

const serviceFunctions = [
  "claim_task_notification_delivery_v2(uuid,uuid,uuid,uuid)",
  "record_task_notification_provider_acceptance_v2(uuid,uuid,uuid,uuid,uuid,integer,uuid,text)",
  "complete_task_notification_delivery_v2(uuid,uuid,uuid,uuid,uuid,integer)",
  "fail_task_notification_delivery_v2(uuid,uuid,uuid,uuid,uuid,integer,text)",
];

describe("notification outbox v2 migration", () => {
  it("persists provider identity, lease ownership, and state payloads", () => {
    expect(sql).toMatch(/create table public\.task_notification_delivery_attempts/i);
    expect(sql).toMatch(/attempt_token uuid not null unique/i);
    expect(sql).toMatch(/provider_request_id uuid not null/i);
    expect(sql).toMatch(/lease_token uuid not null/i);
    expect(sql).toMatch(/lease_generation integer not null default 1 check \(lease_generation > 0\)/i);
    expect(sql).toMatch(/task_notification_attempt_state_payload_ck[\s\S]*state = 'claimed'[\s\S]*state = 'provider_accepted'[\s\S]*state = 'sent'[\s\S]*state = 'failed'/i);
    expect(sql).toMatch(/task_notification_attempt_notification_scope_idx[\s\S]*tenant_id, organization_id, notification_id/i);
  });

  it("rotates a lease without changing the provider UUID", () => {
    expect(sql).toMatch(/v_new_lease_token := gen_random_uuid\(\)[\s\S]*while v_new_lease_token = v_attempt\.lease_token[\s\S]*set lease_token = v_new_lease_token,[\s\S]*lease_generation = attempt\.lease_generation \+ 1/i);
    expect(sql).toMatch(/'attemptToken', v_attempt\.attempt_token,[\s\S]*'providerRequestId', v_attempt\.provider_request_id,[\s\S]*'leaseToken', v_attempt\.lease_token/i);
    expect(sql).toMatch(/lease_token is distinct from p_lease_token[\s\S]*lease_generation is distinct from p_lease_generation[\s\S]*lease_expires_at <= clock_timestamp\(\)/i);
    expect(sql).toMatch(/p_error_code is null[\s\S]*p_error_code not in/i);
  });

  it("locks notification before attempt in every state transition", () => {
    const transitions = sql.split(/create or replace function public\./i)
      .filter((part) => /^(record_task_notification_provider_acceptance_v2|complete_task_notification_delivery_v2|fail_task_notification_delivery_v2)/i.test(part));
    expect(transitions).toHaveLength(3);
    for (const transition of transitions) {
      expect(transition.indexOf("for update of notification")).toBeGreaterThan(-1);
      expect(transition.indexOf("for update;")).toBeGreaterThan(transition.indexOf("for update of notification"));
      expect(transition).not.toContain("for update of attempt, notification");
    }
  });

  it("loads composite rows separately so PostgreSQL can assign rowtypes", () => {
    expect(sql).toMatch(/select notification\.\*\s+into v_notification/i);
    expect(sql).toMatch(/select tenant\.\* into strict v_tenant/i);
    expect(sql).toMatch(/select organization\.\* into strict v_organization/i);
    expect(sql).toMatch(/select task\.\* into strict v_task/i);
    expect(sql).not.toMatch(/select tenant, organization, task, notification/i);
  });

  it("makes delivery mutation RPCs service-role only and retires legacy writes", () => {
    for (const signature of serviceFunctions) {
      const escaped = signature.replace(/[()]/g, "\\$&");
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${escaped}[\\s\\S]*from public, anon, authenticated, service_role`, "i"));
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${escaped}[\\s\\S]*to service_role`, "i"));
    }
    expect(sql).toMatch(/revoke all on function public\.record_task_notification_delivery\(uuid,uuid,uuid,text,text,text\)[\s\S]*service_role/i);
    expect((sql.match(/is distinct from 'service_role'/gi) ?? [])).toHaveLength(4);
  });

  it("authorizes manual retries against the task project ACL", () => {
    expect(sql).toMatch(/authorize_current_task_notification_retry[\s\S]*auth\.uid\(\)[\s\S]*can_manage_project\(v_task\.project_id\)/i);
    expect(sql).toMatch(/grant execute on function public\.authorize_current_task_notification_retry\(uuid\)[\s\S]*to authenticated/i);
    expect(sql).toMatch(/revoke all on function public\.authorize_current_task_notification_retry\(uuid\)[\s\S]*public, anon, authenticated, service_role/i);
  });

  it("keeps recovery in PostgreSQL and sends one provider identity per notification", () => {
    expect(dispatcher).not.toContain("unconfirmedDeliveries");
    expect(dispatcher).toContain("record_task_notification_provider_acceptance_v2");
    expect(dispatcher).toContain("complete_task_notification_delivery_v2");
    expect(dispatcher).toContain("claim_task_notification_delivery_v2");
    expect(batchDispatcher).not.toContain("bindBatch");
    expect(batchDispatcher).toContain("tasks: [taskPayload(claim)]");
  });

  it("pins the approved official SDK exactly", () => {
    expect(packageJson.dependencies?.["@larksuiteoapi/node-sdk"]).toBe("1.73.0");
  });
});
