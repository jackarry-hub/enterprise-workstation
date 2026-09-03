// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(process.cwd(), "supabase/migrations/202609030003_knowledge_draft_current_version.sql"),
  "utf8",
).toLowerCase();

describe("knowledge draft current version migration", () => {
  it("tracks the first current draft version without replacing published versions", () => {
    expect(sql).toContain("after insert on public.knowledge_document_versions");
    expect(sql).toContain("document.status = 'draft'");
    expect(sql).toContain("document.current_version_id is null");
    expect(sql).toContain("set current_version_id = new.id");
  });

  it("backfills the latest draft version for existing incomplete drafts", () => {
    expect(sql).toContain("with latest_draft as");
    expect(sql).toContain("version.version_number desc");
    expect(sql).toContain("set current_version_id = latest.id");
  });

  it("keeps the trigger helper unavailable to API roles", () => {
    expect(sql).toContain("revoke all on function public.sync_knowledge_draft_current_version()");
    expect(sql).toContain("from public, anon, authenticated, service_role");
  });
});
