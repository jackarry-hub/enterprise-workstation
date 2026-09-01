import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/202608270007_file_storage_commands.sql",
), "utf8").toLowerCase();

describe("file storage commands migration", () => {
  it("establishes the canonical public member id used by file entities", () => {
    expect(sql).toContain("alter table public.organization_members");
    expect(sql).toContain("add column if not exists public_id uuid not null default gen_random_uuid()");
    expect(sql).toContain("create unique index if not exists organization_members_public_id_idx");
    expect(sql).toContain("'uploadedbyid', uploader.public_id");
  });
});
