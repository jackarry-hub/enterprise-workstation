import assert from "node:assert/strict";
import test from "node:test";

import { classifyCounts, verifyDataApi } from "./verify-remote.mjs";

const readyCounts = {
  tenants: 1,
  organizations: 1,
  roles: 6,
  permissions: 18,
  role_permissions: 52,
  departments: 5,
  identity_providers: 1,
  organization_members: 0,
  employee_profiles: 0,
  projects: 0,
  tasks: 0,
  audit_logs: 0,
};

test("accepts required system data and empty business tables", () => {
  const report = classifyCounts(readyCounts);

  assert.equal(report.systemReady, true);
  assert.equal(report.businessDataImported, false);
  assert.deepEqual(report.nonEmptyBusinessTables, []);
});

test("flags any business record instead of hiding it", () => {
  const report = classifyCounts({ ...readyCounts, projects: 1 });

  assert.equal(report.businessDataImported, true);
  assert.deepEqual(report.nonEmptyBusinessTables, ["projects"]);
});

test("fails closed when a required system table has no configuration", () => {
  const report = classifyCounts({ ...readyCounts, role_permissions: 0 });

  assert.equal(report.systemReady, false);
  assert.deepEqual(report.missingSystemData, ["role_permissions"]);
});

test("checks the public Data API without exposing the key", async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    return { ok: true, status: 200 };
  };

  await verifyDataApi(
    {
      url: "https://abcxyz.supabase.co",
      publishableKey: "sb_publishable_public",
    },
    fetchImpl,
  );

  assert.equal(
    requests[0].url,
    "https://abcxyz.supabase.co/rest/v1/tenants?select=id&limit=0",
  );
  assert.equal(requests[0].options.headers.apikey, "sb_publishable_public");
  assert.equal("Authorization" in requests[0].options.headers, false);
});
