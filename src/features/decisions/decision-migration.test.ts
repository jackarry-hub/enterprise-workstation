// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/202609040001_decision_command_closure.sql"), "utf8").toLowerCase();
const repairSql = readFileSync(resolve(process.cwd(), "supabase/migrations/202609040002_decision_command_runtime_repair.sql"), "utf8").toLowerCase();
describe("decision command closure migration", () => {
  it.each(["decision_command_attachments", "decision_plan_versions", "decision_command_operations", "decision_archives"])("creates and tenant-protects %s", (table) => {
    expect(sql).toContain(`create table public.${table}`); expect(sql).toContain(`alter table public.${table} enable row level security`); expect(sql).toContain(`alter table public.${table} force row level security`);
  });
  it("keeps confirmation atomic, versioned and idempotent", () => {
    expect(sql).toContain("create or replace function public.confirm_current_decision_plan"); expect(sql).toContain("for update"); expect(sql).toContain("version_conflict"); expect(sql).toContain("if v_command.project_id is not null"); expect(sql).toContain("decision_command_operations");
  });
  it("creates only real project artifacts and emits audit records", () => {
    expect(sql).toContain("insert into public.projects"); expect(sql).toContain("insert into public.milestones"); expect(sql).toContain("insert into public.tasks"); expect(sql).toContain("insert into public.task_dependencies"); expect(sql).toContain("public.append_audit_log"); expect(sql).not.toContain("public.can_access_project");
  });
  it("archives only completed work and creates a durable knowledge draft", () => { expect(sql).toContain("create or replace function public.complete_current_decision_command"); expect(sql).toContain("v_total<>v_done"); expect(sql).toContain("insert into public.knowledge_documents"); expect(sql).toContain("insert into public.knowledge_document_versions"); expect(sql).toContain("insert into public.decision_archives"); });
  it("does not replace the global audit action contract", () => { expect(sql).not.toContain("drop constraint if exists audit_logs_action_check"); });
  it("uses PostgreSQL-supported JSON object counting in fresh and upgraded databases", () => {
    expect(sql).not.toContain("jsonb_object_length(");
    expect(repairSql).toContain("jsonb_object_keys(v_milestone_ids)");
    expect(repairSql).toContain("jsonb_object_keys(v_task_ids)");
  });
  it("writes the archive table's actual snapshot and actor columns", () => {
    expect(sql).toContain("knowledge_document_id,snapshot,created_by_member_id");
    expect(repairSql).toContain("knowledge_document_id,snapshot,created_by_member_id");
    expect(repairSql).not.toContain("knowledge_document_id,summary,metrics,archived_by_member_id");
  });
});
