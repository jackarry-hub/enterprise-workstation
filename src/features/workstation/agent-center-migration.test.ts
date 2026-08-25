// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const migrationPath = resolve(process.cwd(), "supabase/migrations/202608250002_agent_center.sql");

describe("commercial agent center migration", () => {
  const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8").toLowerCase() : "";

  it("creates internal agent center tables without store semantics", () => {
    expect(migration).toContain("create table public.agent_definitions");
    expect(migration).toContain("create table public.agent_permissions");
    expect(migration).toContain("create table public.agent_invocations");
    expect(migration).toContain("create table public.agent_execution_logs");
    expect(migration).not.toContain("agent_store");
    expect(migration).not.toContain("purchase");
    expect(migration).not.toContain("install");
  });

  it("protects agent center tables with RLS and no delete policy", () => {
    for (const table of [
      "agent_definitions",
      "agent_permissions",
      "agent_invocations",
      "agent_execution_logs",
    ]) {
      expect(migration).toContain(`alter table public.${table} enable row level security`);
      expect(migration).toContain(`alter table public.${table} force row level security`);
    }
    expect(migration).toContain("agent_definitions_org_status_idx");
    expect(migration).toContain("agent_permissions_agent_idx");
    expect(migration).toContain("agent_invocations_agent_started_idx");
    expect(migration).not.toContain("_delete");
  });

  it("seeds the eight enterprise agents requested for v1", () => {
    for (const agentName of [
      "任务拆解 agent",
      "智能派单 agent",
      "飞书通知 agent",
      "员工画像 agent",
      "薪资核算 agent",
      "报账审核 agent",
      "知识库问答 agent",
      "项目复盘 agent",
    ]) {
      expect(migration).toContain(agentName);
    }
  });

  it("seeds callable permissions without invalid role scopes", () => {
    expect(migration).toContain("insert into public.agent_permissions");
    expect(migration).toContain("'all' as scope_type");
    expect(migration).not.toContain("case when agent_scope.visibility_scope = 'list' then 'role'");
  });
});
