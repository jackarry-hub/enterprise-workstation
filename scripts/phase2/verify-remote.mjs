import { pathToFileURL } from "node:url";

import { createClient } from "@supabase/supabase-js";

import { loadRemoteConfig } from "./remote-config.mjs";

const SYSTEM_TABLES = [
  "tenants",
  "organizations",
  "roles",
  "permissions",
  "role_permissions",
  "departments",
  "identity_providers",
];

const BUSINESS_TABLES = [
  "organization_members",
  "employee_profiles",
  "member_roles",
  "files",
  "objectives",
  "projects",
  "project_members",
  "milestones",
  "tasks",
  "task_comments",
  "daily_reports",
  "project_activities",
  "project_risks",
  "file_relations",
  "attendance",
  "approvals",
  "approval_steps",
  "approval_actions",
  "salary",
  "decision_commands",
  "department_work_orders",
  "task_dependencies",
  "support_requests",
  "leave_requests",
  "payroll_runs",
  "knowledge_documents",
  "audit_events",
  "external_identities",
  "audit_logs",
];

export function classifyCounts(counts) {
  const missingSystemData = SYSTEM_TABLES.filter(
    (table) => (counts[table] ?? 0) === 0,
  );
  const nonEmptyBusinessTables = BUSINESS_TABLES.filter(
    (table) => (counts[table] ?? 0) > 0,
  );

  return {
    systemReady: missingSystemData.length === 0,
    businessDataImported: nonEmptyBusinessTables.length > 0,
    missingSystemData,
    nonEmptyBusinessTables,
    systemCounts: Object.fromEntries(
      SYSTEM_TABLES.map((table) => [table, counts[table] ?? 0]),
    ),
    businessCounts: Object.fromEntries(
      BUSINESS_TABLES.map((table) => [table, counts[table] ?? 0]),
    ),
  };
}

export async function verifyDataApi(config, fetchImpl = fetch) {
  const response = await fetchImpl(
    `${config.url}/rest/v1/tenants?select=id&limit=0`,
    {
    headers: {
      apikey: config.publishableKey,
    },
    },
  );
  if (!response.ok) {
    throw new Error(`Supabase Data API 连接失败：HTTP ${response.status}`);
  }
}

async function countRows(client, table) {
  const { count, error } = await client
    .from(table)
    .select("*", { count: "exact", head: true });
  if (error) {
    throw new Error(`远程表验证失败：${table} (${error.code ?? "unknown"})`);
  }
  return count ?? 0;
}

export async function verifyRemoteState(client) {
  const tables = [...SYSTEM_TABLES, ...BUSINESS_TABLES];
  const entries = await Promise.all(
    tables.map(async (table) => [table, await countRows(client, table)]),
  );
  const counts = Object.fromEntries(entries);

  const { error: skillsError } = await client
    .from("employee_profiles")
    .select("skills", { count: "exact", head: true });
  if (skillsError) {
    throw new Error(
      `员工技能字段验证失败：${skillsError.code ?? "unknown"}`,
    );
  }

  return {
    ...classifyCounts(counts),
    skillsColumnReady: true,
    auditLogsReady: Object.hasOwn(counts, "audit_logs"),
  };
}

export async function runRemoteVerification() {
  const config = loadRemoteConfig();
  await verifyDataApi(config);

  const client = createClient(config.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const report = await verifyRemoteState(client);
  const safeReport = {
    projectRef: config.projectRef,
    dataApiConnected: true,
    ...report,
  };

  console.log(JSON.stringify(safeReport, null, 2));
  if (!report.systemReady || report.businessDataImported) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runRemoteVerification();
}
