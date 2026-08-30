import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { inflateRawSync } from "node:zlib";

export const REQUIRED_DELIVERY_ARTIFACTS = Object.freeze([
  "docs/operations/external-release-manifest.schema.json",
  "docs/operations/architecture.md",
  "docs/operations/database-er.md",
  "docs/operations/data-dictionary.md",
  "docs/operations/permission-matrix.md",
  "docs/operations/feishu-sync-rules.md",
  "docs/operations/openapi.yaml",
  "docs/operations/admin-manual.md",
  "docs/operations/employee-manual.md",
  "docs/operations/import-templates/customers.csv",
  "docs/operations/import-templates/employees.xlsx",
  "docs/operations/deployment-manual.md",
  "docs/operations/backup-restore-manual.md",
  "docs/operations/incident-response.md",
  "docs/operations/release-runbook.md",
  "docs/operations/rollback-runbook.md",
  "docs/operations/security-test-report.md",
  "docs/operations/performance-test-report.md",
  "docs/operations/third-party-services.md",
  "docs/operations/secret-locations.md",
  "docs/operations/third-party-fees.md",
  "docs/operations/known-limitations.md",
  "docs/operations/commercial-acceptance-checklist.md",
]);

const REQUIRED_SECTIONS = Object.freeze({
  "architecture.md": ["## Context", "## Runtime topology", "## Trust boundaries", "## Failure model"],
  "database-er.md": ["## Tenant and identity", "## Business domains", "## Integrity rules"],
  "data-dictionary.md": ["## Scope", "## Table catalogue", "## Sensitive data"],
  "permission-matrix.md": ["## Roles", "## Permission matrix", "## Verification"],
  "feishu-sync-rules.md": ["## Authority", "## Identity mapping", "## Conflict handling", "## Offboarding"],
  "admin-manual.md": ["## Initial setup", "## Daily operations", "## Audit and export", "## Failure handling"],
  "employee-manual.md": ["## Sign in", "## Daily workflow", "## Privacy and permissions", "## Getting help"],
  "deployment-manual.md": ["## Authorization gate", "## Preflight", "## Staging deployment", "## Production boundary"],
  "backup-restore-manual.md": ["## Backup policy", "## Restore drill", "## RPO and RTO", "## Evidence"],
  "incident-response.md": ["## Severity", "## First response", "## Containment", "## Evidence and review"],
  "release-runbook.md": ["## Candidate freeze", "## Staging", "## Canary", "## Production authorization"],
  "rollback-runbook.md": ["## Stop conditions", "## Application rollback", "## Database recovery", "## Verification"],
  "security-test-report.md": ["## Scope", "## Automated results", "## Staging evidence", "## Open risks"],
  "performance-test-report.md": ["## Profile", "## Thresholds", "## Results", "## Evidence status"],
  "third-party-services.md": ["## Service inventory", "## Failure behavior", "## Data boundaries", "## Exit plan"],
  "secret-locations.md": ["## Rules", "## Location register", "## Rotation"],
  "third-party-fees.md": ["## Cost owners", "## Fee model", "## Budget controls"],
  "known-limitations.md": ["## Current blockers", "## Excluded scope", "## Release impact"],
  "commercial-acceptance-checklist.md": ["## Local evidence", "## Staging evidence", "## Final release gate"],
});

const CUSTOMER_HEADERS = Object.freeze([
  "name", "registrationCode", "ownerEmployeePublicId", "industry", "source", "region",
  "contactName", "contactTitle", "contactPhone", "contactEmail", "contactVisibility", "contactIsPrimary",
]);
const EMPLOYEE_HEADERS = Object.freeze([
  "employeeNo", "displayName", "workEmail", "mobile", "departmentCode", "jobTitle",
  "managerEmployeeNo", "employmentStatus", "hireDate", "feishuOpenId", "roles",
]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function migrationDigest(rootDir = process.cwd()) {
  const directory = path.join(rootDir, "supabase", "migrations");
  const files = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  const digest = createHash("sha256");
  for (const file of files) {
    digest.update(file, "utf8");
    digest.update("\0");
    digest.update(await readFile(path.join(directory, file)));
    digest.update("\0");
  }
  return digest.digest("hex");
}

function parseCsvRow(line) {
  const fields = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) { fields.push(field); field = ""; }
    else field += character;
  }
  if (quoted) throw new Error("csv_quote_unclosed");
  fields.push(field);
  return fields;
}

function findEndOfCentralDirectory(buffer) {
  for (let index = buffer.length - 22; index >= Math.max(0, buffer.length - 65_557); index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) return index;
  }
  return -1;
}

function readZipEntries(buffer) {
  const end = findEndOfCentralDirectory(buffer);
  if (end < 0) throw new Error("xlsx_zip_invalid");
  const entryCount = buffer.readUInt16LE(end + 10);
  let cursor = buffer.readUInt32LE(end + 16);
  const entries = new Map();
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error("xlsx_central_directory_invalid");
    const compression = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const fileNameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + fileNameLength).toString("utf8");
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("xlsx_local_entry_invalid");
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
    const content = compression === 0 ? compressed : compression === 8 ? inflateRawSync(compressed) : null;
    if (!content) throw new Error("xlsx_compression_unsupported");
    entries.set(name, content);
    cursor += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

function xmlText(source) {
  return source.replace(/<[^>]+>/g, " ")
    .replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"').replaceAll("&#39;", "'");
}

export async function validateOpenApi(filePath) {
  const source = await readFile(filePath, "utf8");
  return /^openapi:\s*3\.1\.\d+\s*$/m.test(source)
    && /^info:\s*$/m.test(source)
    && /^paths:\s*$/m.test(source)
    && /^\s{2}\/api\/health\/ready:\s*$/m.test(source)
    && /^\s{2}\/api\/workstation\/bootstrap:\s*$/m.test(source)
    && /^\s{2}\/api\/workstation\/customers:\s*$/m.test(source)
    && /^\s{2}\/api\/workstation\/tasks:\s*$/m.test(source)
    && /^\s{2}\/api\/workstation\/projects:\s*$/m.test(source)
    && /^components:\s*$/m.test(source)
    && !/\bexample\.com\b|Bearer\s+[A-Za-z0-9_-]{16,}/.test(source);
}

export async function validateImportTemplates(paths) {
  const issues = [];
  for (const filePath of paths) {
    if (filePath.endsWith(".csv")) {
      try {
        const source = (await readFile(filePath, "utf8")).replace(/^\uFEFF/, "");
        const lines = source.split(/\r?\n/).filter((line) => line.trim() !== "");
        const header = parseCsvRow(lines[0] ?? "");
        if (JSON.stringify(header) !== JSON.stringify(CUSTOMER_HEADERS)) issues.push("customers_csv_headers_invalid");
        if (lines.length < 2 || lines.slice(1).some((line) => parseCsvRow(line).length !== CUSTOMER_HEADERS.length)) issues.push("customers_csv_sample_invalid");
      } catch { issues.push("customers_csv_invalid"); }
    } else if (filePath.endsWith(".xlsx")) {
      try {
        const entries = readZipEntries(await readFile(filePath));
        if (!entries.has("xl/workbook.xml") || !entries.has("xl/worksheets/sheet1.xml")) throw new Error("xlsx_structure_invalid");
        const xmlSources = [...entries.entries()].filter(([name]) => name.endsWith(".xml"))
          .map(([, bytes]) => bytes.toString("utf8"));
        const combined = xmlSources.map(xmlText).join(" ");
        const combinedRaw = xmlSources.join(" ");
        for (const header of EMPLOYEE_HEADERS) if (!combined.includes(header)) issues.push(`employees_xlsx_header_missing:${header}`);
        if (!combinedRaw.includes("填写说明") || !combinedRaw.includes("员工导入")) issues.push("employees_xlsx_sheets_invalid");
      } catch { issues.push("employees_xlsx_invalid"); }
    }
  }
  return [...new Set(issues)];
}

export async function validateRequiredDocumentSections({ rootDir = process.cwd() } = {}) {
  const issues = [];
  for (const [file, sections] of Object.entries(REQUIRED_SECTIONS)) {
    let source = "";
    try { source = await readFile(path.join(rootDir, "docs", "operations", file), "utf8"); }
    catch { issues.push(`document_missing:${file}`); continue; }
    for (const section of sections) if (!source.includes(section)) issues.push(`section_missing:${file}:${section.slice(3)}`);
  }
  return issues;
}

export function parseDeliveryManifest(source) {
  const rows = [];
  for (const line of String(source).split(/\r?\n/)) {
    if (!line.startsWith("| `docs/")) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim().replace(/^`|`$/g, ""));
    if (cells.length === 5) rows.push({ artifact: cells[0], candidate: cells[1], migrationSha256: cells[2], sha256: cells[3], validation: cells[4] });
  }
  return rows;
}

export async function validateChecksumsAndCandidate({ rootDir = process.cwd(), manifestSource } = {}) {
  const source = manifestSource ?? await readFile(path.join(rootDir, "docs", "operations", "commercial-delivery-manifest.md"), "utf8");
  const rows = parseDeliveryManifest(source);
  const issues = [];
  const migrationSha256 = await migrationDigest(rootDir);
  const artifacts = new Set(rows.map((row) => row.artifact));
  for (const artifact of REQUIRED_DELIVERY_ARTIFACTS) if (!artifacts.has(artifact)) issues.push(`manifest_artifact_missing:${artifact}`);
  const candidates = new Set();
  for (const row of rows) {
    if (!/^[0-9a-f]{40}$/.test(row.candidate)) issues.push(`manifest_candidate_invalid:${row.artifact}`);
    else candidates.add(row.candidate);
    if (row.migrationSha256 !== migrationSha256) issues.push(`manifest_migration_mismatch:${row.artifact}`);
    if (!/^[0-9a-f]{64}$/.test(row.sha256)) { issues.push(`manifest_checksum_invalid:${row.artifact}`); continue; }
    try {
      if (sha256(await readFile(path.join(rootDir, row.artifact))) !== row.sha256) issues.push(`manifest_checksum_mismatch:${row.artifact}`);
    } catch { issues.push(`manifest_artifact_unreadable:${row.artifact}`); }
    if (!row.validation) issues.push(`manifest_validation_missing:${row.artifact}`);
  }
  if (candidates.size !== 1) issues.push("manifest_candidate_not_frozen");
  return { valid: issues.length === 0, issues, candidate: candidates.size === 1 ? [...candidates][0] : null, migrationSha256 };
}

export async function validateDeliveryArtifacts({ rootDir = process.cwd() } = {}) {
  const issues = [];
  issues.push(...await validateRequiredDocumentSections({ rootDir }));
  if (!await validateOpenApi(path.join(rootDir, "docs", "operations", "openapi.yaml")).catch(() => false)) issues.push("openapi_invalid");
  issues.push(...await validateImportTemplates([
    path.join(rootDir, "docs", "operations", "import-templates", "customers.csv"),
    path.join(rootDir, "docs", "operations", "import-templates", "employees.xlsx"),
  ]));
  try {
    const schema = JSON.parse(await readFile(path.join(rootDir, "docs", "operations", "external-release-manifest.schema.json"), "utf8"));
    if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema" || schema.type !== "object") issues.push("external_manifest_schema_invalid");
  } catch { issues.push("external_manifest_schema_invalid"); }
  try {
    const manifest = await validateChecksumsAndCandidate({ rootDir });
    issues.push(...manifest.issues);
  } catch { issues.push("delivery_manifest_invalid"); }
  return { status: issues.length ? "BLOCKED" : "PASSED", issues };
}

async function runCli() {
  const report = await validateDeliveryArtifacts();
  if (report.status !== "PASSED") {
    console.error(`BLOCKED delivery_artifacts reason=${report.issues.join(";")}`);
    process.exitCode = 1;
    return;
  }
  console.log(`PASSED delivery_artifacts count=${REQUIRED_DELIVERY_ARTIFACTS.length}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await runCli();
