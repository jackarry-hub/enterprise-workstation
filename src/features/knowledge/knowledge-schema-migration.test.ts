import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(path.join(
  process.cwd(),
  "supabase/migrations/202608300001_knowledge_versions.sql",
), "utf8").toLowerCase();

describe("knowledge access migration", () => {
  it("creates tenant-scoped directories, immutable versions, grants and citations", () => {
    for (const table of [
      "knowledge_directories",
      "knowledge_document_versions",
      "knowledge_permissions",
      "knowledge_sources",
    ]) expect(migration).toContain(`create table public.${table}`);
    expect(migration).toContain("reject_published_knowledge_version_mutation");
    expect(migration).toContain("can_access_knowledge_document");
  });

  it("forces row-level security on every knowledge access table", () => {
    for (const table of [
      "knowledge_documents",
      "knowledge_directories",
      "knowledge_document_versions",
      "knowledge_permissions",
      "knowledge_sources",
    ]) expect(migration).toContain(`alter table public.${table} force row level security`);
  });
});
