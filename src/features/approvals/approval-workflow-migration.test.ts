import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(),
  "supabase/migrations/202608280006_approval_workflow_commands.sql"), "utf8");
const pgTap = readFileSync(resolve(process.cwd(), "supabase/tests/approval_workflow.sql"), "utf8");

describe("commercial approval submission migration", () => {
  it("keeps versioned templates immutable and tenant scoped", () => {
    expect(migration).toContain("create table public.approval_templates");
    expect(migration).toContain("unique(tenant_id,organization_id,template_key,version)");
    expect(migration).toContain("approval_templates_reject_update_delete");
    expect(migration).toContain("alter table public.approval_templates force row level security");
    expect(migration).not.toMatch(/approval_type text[\s\S]+?\('leave'/);
  });

  it("validates exact form fields and resolves approvers only on the server", () => {
    expect(migration).toContain("is_valid_approval_template_definition");
    expect(migration).toContain("is_valid_approval_form");
    expect(migration).toContain("applicant_manager");
    expect(migration).toContain("role.code=v_rule->>'roleCode'");
    expect(migration).toContain("employee.public_id=(v_rule->>'employeePublicId')::uuid");
    expect(migration).toContain("and (v_field->>'maxLength')~'^[1-9][0-9]{0,3}$'");
    expect(migration).toContain("for share of role,assignment,member,employee");
    expect(migration).not.toContain("p_actor_employee");
  });

  it("commits approval, steps, action, idempotency result and audit through one RPC", () => {
    expect(migration).toContain("create or replace function public.submit_current_approval");
    expect(migration).toContain("insert into public.approvals(");
    expect(migration).toContain("insert into public.approval_steps(");
    expect(migration).toContain("insert into public.approval_actions(");
    expect(migration).toContain("approval_command_idempotency");
    expect(migration).toContain("'approval.submitted'");
    expect(migration).toContain("exception when others then");
  });

  it("keeps browser and service roles away from direct writes and internals", () => {
    expect(migration).toContain("revoke all on table public.approval_command_idempotency from public,anon,authenticated,service_role");
    expect(migration).toContain("grant execute on function public.submit_current_approval(uuid,jsonb,uuid,uuid) to authenticated");
    expect(migration).not.toContain("grant execute on function public.submit_current_approval(uuid,jsonb,uuid,uuid) to service_role");
  });

  it("keeps the pgTAP plan synchronized with executable assertions", () => {
    const planned = Number(/select plan\((\d+)\)/.exec(pgTap)?.[1]);
    const assertions = [...pgTap.matchAll(/^select\s+(?:ok|is|isnt|throws_ok|lives_ok|cmp_ok|like|unlike|pass|fail)\s*\(/gm)];
    expect(planned).toBe(86);
    expect(assertions).toHaveLength(planned);
  });

  it("adds one optimistic and idempotent approval action state machine", () => {
    const actionMigration = readFileSync(resolve(process.cwd(),
      "supabase/migrations/202608280007_approval_action_commands.sql"), "utf8");
    expect(actionMigration).toContain("create or replace function public.act_on_current_approval");
    expect(actionMigration).toContain("approval_action_idempotency");
    expect(actionMigration).toContain("approval.version<>expected_version");
    expect(actionMigration).toContain("approval_actions_reject_mutation");
    expect(actionMigration).not.toContain("p_actor_employee");
  });
});
