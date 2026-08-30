import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import path from "node:path";

import {
  runScan,
  scanFormalImports,
  scanPublicSourceTerms,
} from "./scan-formal-public-surface.mjs";

const root = process.cwd();

test("formal source graph has no fixture or browser business repository", async () => {
  const report = await scanFormalImports(root);
  assert.deepEqual(report.violations, []);
  assert.equal(report.files.some((file) => file.includes("quantxy-ai-workbench-fused")), false);
});

test("excluded public routes and terms are absent while migration assets remain preserved", async () => {
  assert.equal(existsSync(path.join(root, "src/app/(workspace)/leave/page.tsx")), false);
  assert.equal(existsSync(path.join(root, "src/app/(workspace)/attendance/page.tsx")), false);
  assert.equal(existsSync(path.join(root, "quantxy-ai-workbench-fused.html")), true);
  assert.equal(existsSync(path.join(root, "public/workstation-server-adapter.js")), true);
  assert.deepEqual(await scanPublicSourceTerms(root), []);
});

test("CLI-compatible report fails closed when built output is requested but missing", async () => {
  const report = await runScan({
    root: path.join(root, ".scanner-missing-root"),
    formalImports: false,
    builtPublicOutput: true,
    terms: "leave|attendance|请假|考勤",
    allowlist: [],
  });
  assert.equal(report.status, "FAIL");
  assert.equal(report.builtPublicOutput[0]?.reason, "built-output-missing");
});
