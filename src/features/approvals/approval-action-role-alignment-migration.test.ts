import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(),
  "supabase/migrations/202608280009_approval_action_role_alignment.sql"), "utf8");

describe("approval action role alignment migration", () => {
  it("grants the action permission to server approver baseline roles and keeps it aligned", () => {
    expect(migration).toContain("permission.code='approval.act'");
    expect(migration).toContain("'owner','admin','department_head','supervisor','employee','finance','hr'");
    expect(migration).toContain("roles_approval_action_before_update");
    expect(migration).toContain("roles_approval_action_after_insert");
    expect(migration).toContain("roles_approval_action_after_update");
  });

  it("requires approval.act in the database identity used by direct action RPCs", () => {
    expect(migration).toContain("create or replace function public.current_approval_actor_identity()");
    expect(migration).toContain("current_approval_command_identity('approval.act')");
    expect(migration).toContain("revoke all on function public.current_approval_actor_identity()");
  });
});
