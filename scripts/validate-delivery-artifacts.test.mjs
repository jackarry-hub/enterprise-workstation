import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { parseDeliveryManifest, validateImportTemplates, validateOpenApi, validateRequiredDocumentSections } from "./validate-delivery-artifacts.mjs";

const rootDir = process.cwd();

test("OpenAPI contract contains the production health and core business paths", async () => {
  assert.equal(await validateOpenApi(path.join(rootDir, "docs", "operations", "openapi.yaml")), true);
});

test("CSV and XLSX templates are structurally usable", async () => {
  assert.deepEqual(await validateImportTemplates([
    path.join(rootDir, "docs", "operations", "import-templates", "customers.csv"),
    path.join(rootDir, "docs", "operations", "import-templates", "employees.xlsx"),
  ]), []);
});

test("all operational documents contain their required decision sections", async () => {
  assert.deepEqual(await validateRequiredDocumentSections({ rootDir }), []);
});

test("delivery manifest rows use five explicit fields", () => {
  assert.deepEqual(parseDeliveryManifest("| `docs/operations/a.md` | `" + "a".repeat(40) + "` | `" + "b".repeat(64) + "` | `" + "c".repeat(64) + "` | `node check` |\n"), [{
    artifact: "docs/operations/a.md",
    candidate: "a".repeat(40),
    migrationSha256: "b".repeat(64),
    sha256: "c".repeat(64),
    validation: "node check",
  }]);
});

