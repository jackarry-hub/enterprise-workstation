// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const envExample = readFileSync(resolve(process.cwd(), ".env.example"), "utf8");
const compose = readFileSync(resolve(process.cwd(), "compose.yaml"), "utf8");
const stagingCompose = readFileSync(resolve(process.cwd(), "compose.staging.yaml"), "utf8");

const runtimeVariables = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_APP_URL",
  "FEISHU_TENANT_KEY",
  "FEISHU_APP_ID",
  "FEISHU_APP_SECRET",
  "FEISHU_DIRECTORY_SYNC_CRON_SECRET",
  "SUPABASE_SERVICE_ROLE_KEY",
  "AI_CONFIG_ENCRYPTION_KEY",
  "AGENT_INVOCATION_RECOVERY_CRON_SECRET",
  "TASK_NOTIFICATION_RECOVERY_CRON_SECRET",
  "FILE_UPLOAD_CLEANUP_CRON_SECRET",
  "INTERNAL_WORKER_TOKEN",
  "KNOWLEDGE_PROCESSOR_URL",
  "KNOWLEDGE_PROCESSOR_SECRET",
  "KNOWLEDGE_PROCESSOR_ALLOWED_HOSTS",
  "KNOWLEDGE_SOURCE_ALLOWED_HOSTS",
  "RATE_LIMIT_HASH_PEPPER",
  "RATE_LIMIT_TRUSTED_IP_HEADER",
] as const;

const stagingVariables = [
  "QUANTXY_ENVIRONMENT",
  "QUANTXY_DATABASE_URL",
  "QUANTXY_STAGING_DATABASE_HOST",
  "QUANTXY_STAGING_DATABASE_PORT",
  "QUANTXY_STAGING_DATABASE_NAME",
  "QUANTXY_STAGING_DATABASE_USER",
  "QUANTXY_STAGING_DATABASE_SSLMODE",
  "QUANTXY_RELEASE_CANDIDATE_COMMIT",
  "QUANTXY_RELEASE_EVIDENCE_MANIFEST",
  "QUANTXY_RELEASE_EVIDENCE_ROOT",
  "QUANTXY_RELEASE_EVIDENCE_PUBLIC_KEY_FILE",
] as const;

function assignment(variable: string) {
  return new RegExp(`^${variable}=\\S+`, "m");
}

describe("commercial deployment environment contract", () => {
  it("documents every required runtime and Staging variable without blank placeholders", () => {
    for (const variable of [...runtimeVariables, ...stagingVariables]) {
      expect(envExample, variable).toMatch(assignment(variable));
    }
  });

  it("injects every required runtime variable into the workstation container", () => {
    for (const variable of runtimeVariables) {
      expect(compose, variable).toContain(`${variable}:`);
    }
  });

  it("keeps Staging database and signed evidence inputs out of the application container", () => {
    for (const variable of stagingVariables) {
      expect(compose, variable).not.toContain(`${variable}:`);
    }
  });

  it("keeps Staging off host ports and joins only the named edge network", () => {
    expect(compose).toContain("${APP_BIND_ADDRESS:-0.0.0.0}:${APP_PORT:-3010}:3000");
    expect(compose).toContain("${QUANTXY_IMAGE_TAG:-latest}");
    expect(stagingCompose).toContain("ports: !override []");
    expect(stagingCompose).toContain("${QUANTXY_EDGE_ALIAS:?QUANTXY_EDGE_ALIAS is required}");
    expect(stagingCompose).toContain("${QUANTXY_EDGE_NETWORK:?QUANTXY_EDGE_NETWORK is required}");
    expect(stagingCompose).not.toContain("3010:3000");
  });
});
