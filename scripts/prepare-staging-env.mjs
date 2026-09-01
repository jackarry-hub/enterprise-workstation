import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const COPIED_FEISHU_KEYS = ["FEISHU_TENANT_KEY", "FEISHU_APP_ID", "FEISHU_APP_SECRET"];
const GENERATED_LONG_SECRETS = [
  "FEISHU_DIRECTORY_SYNC_CRON_SECRET",
  "AGENT_INVOCATION_RECOVERY_CRON_SECRET",
  "TASK_NOTIFICATION_RECOVERY_CRON_SECRET",
  "FILE_UPLOAD_CLEANUP_CRON_SECRET",
  "INTERNAL_WORKER_TOKEN",
  "KNOWLEDGE_PROCESSOR_SECRET",
  "RATE_LIMIT_HASH_PEPPER",
];

export function parseEnv(text) {
  const values = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    if (values.has(match[1])) throw new Error(`duplicate_environment_key:${match[1]}`);
    values.set(match[1], match[2].trim());
  }
  return values;
}

export function upsertEnv(text, updates) {
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.replace(/\r?\n$/, "").split(/\r?\n/);
  const pending = new Map(Object.entries(updates));
  const result = lines.map((line) => {
    const match = line.match(/^([A-Z0-9_]+)=/);
    if (!match || !pending.has(match[1])) return line;
    const value = pending.get(match[1]);
    pending.delete(match[1]);
    return `${match[1]}=${value}`;
  });
  if (pending.size) {
    result.push("", "# Generated Staging runtime values (server-only unless named public)");
    for (const [key, value] of pending) result.push(`${key}=${value}`);
  }
  return `${result.join(newline)}${newline}`;
}

function safeValue(value) {
  return Boolean(value) && !/replace|placeholder|changeme|your_/i.test(value);
}

export function prepareStagingEnvironment(root = process.cwd(), candidateCommit = undefined) {
  const sourcePath = resolve(root, ".env.local");
  const targetPath = resolve(root, ".env.staging.local");
  if (!existsSync(sourcePath) || !existsSync(targetPath)) throw new Error("staging_environment_file_missing");

  const sourceText = readFileSync(sourcePath, "utf8");
  const targetText = readFileSync(targetPath, "utf8");
  const source = parseEnv(sourceText);
  const target = parseEnv(targetText);
  const updates = {};
  const commit = candidateCommit ?? execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("candidate_commit_invalid");

  for (const key of COPIED_FEISHU_KEYS) {
    if (safeValue(target.get(key))) continue;
    const value = source.get(key);
    if (!safeValue(value)) throw new Error(`source_environment_key_missing:${key}`);
    updates[key] = value;
  }
  for (const key of GENERATED_LONG_SECRETS) {
    if (!safeValue(target.get(key))) updates[key] = randomBytes(48).toString("base64url");
  }
  if (!safeValue(target.get("AI_CONFIG_ENCRYPTION_KEY"))) {
    updates.AI_CONFIG_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  }
  if (!safeValue(target.get("RATE_LIMIT_TRUSTED_IP_HEADER"))) updates.RATE_LIMIT_TRUSTED_IP_HEADER = "x-real-ip";
  if (!safeValue(target.get("QUANTXY_EDGE_NETWORK"))) updates.QUANTXY_EDGE_NETWORK = "quantumgalaxy_edge";
  if (!safeValue(target.get("QUANTXY_EDGE_ALIAS"))) updates.QUANTXY_EDGE_ALIAS = "quantxy-staging-workstation";
  if (target.get("QUANTXY_IMAGE_TAG") !== commit) updates.QUANTXY_IMAGE_TAG = commit;
  if (target.get("QUANTXY_RELEASE_CANDIDATE_COMMIT") !== commit) updates.QUANTXY_RELEASE_CANDIDATE_COMMIT = commit;

  const appUrl = new URL(target.get("NEXT_PUBLIC_APP_URL"));
  const supabaseUrl = new URL(target.get("NEXT_PUBLIC_SUPABASE_URL"));
  if (appUrl.protocol !== "https:" || supabaseUrl.protocol !== "https:") throw new Error("staging_public_url_invalid");
  if (!safeValue(target.get("KNOWLEDGE_PROCESSOR_URL"))) updates.KNOWLEDGE_PROCESSOR_URL = `${appUrl.origin}/api/internal/knowledge-processor`;
  if (!safeValue(target.get("KNOWLEDGE_PROCESSOR_ALLOWED_HOSTS"))) updates.KNOWLEDGE_PROCESSOR_ALLOWED_HOSTS = appUrl.hostname.toLowerCase();
  if (!safeValue(target.get("KNOWLEDGE_SOURCE_ALLOWED_HOSTS"))) updates.KNOWLEDGE_SOURCE_ALLOWED_HOSTS = supabaseUrl.hostname.toLowerCase();

  writeFileSync(targetPath, upsertEnv(targetText, updates), { encoding: "utf8", mode: 0o600 });
  return { updatedKeys: Object.keys(updates).sort(), targetPath };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const result = prepareStagingEnvironment();
    console.log(`PASSED staging_environment_prepared updated_keys=${result.updatedKeys.length}`);
  } catch (error) {
    console.error(`BLOCKED staging_environment_preparation reason=${error instanceof Error ? error.message : "unknown"}`);
    process.exitCode = 1;
  }
}
