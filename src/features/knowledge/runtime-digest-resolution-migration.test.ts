// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/202609030002_runtime_digest_resolution.sql"),
  "utf8",
).toLowerCase();

describe("runtime digest resolution migration", () => {
  it("locks public schema creation before allowing trusted digest resolution", () => {
    expect(sql).toContain("revoke create on schema public from public, anon, authenticated, service_role");
    expect(sql).not.toContain("search_path = public");
    expect(sql.match(/set search_path = pg_catalog, public/g)).toHaveLength(7);
  });

  it.each([
    "execute_knowledge_command(text, jsonb, uuid, uuid)",
    "search_current_knowledge(text, integer, uuid)",
    "queue_knowledge_reindex(uuid, uuid, uuid)",
    "complete_knowledge_processing_job(uuid, uuid, boolean, jsonb, text)",
    "enqueue_ai_runtime_job(",
    "get_feishu_offboarding_proof(text)",
    "task8_legacy_revoke_departed_member_access(uuid, text)",
  ])("repairs %s", (signature) => {
    expect(sql).toContain(`alter function public.${signature}`);
  });
});
