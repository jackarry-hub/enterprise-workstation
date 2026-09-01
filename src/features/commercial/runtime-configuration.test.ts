import { describe, expect, it } from "vitest";

import { assertCommercialServerRuntimeConfiguration } from "@/features/commercial/runtime-configuration";

const valid = {
  FEISHU_APP_ID: "cli_staging",
  FEISHU_APP_SECRET: "feishu-secret",
  FEISHU_DIRECTORY_SYNC_CRON_SECRET: "directory-sync-secret-with-32-characters",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  AI_CONFIG_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  AGENT_INVOCATION_RECOVERY_CRON_SECRET: "agent-recovery-secret-with-32-characters",
  TASK_NOTIFICATION_RECOVERY_CRON_SECRET: "notification-recovery-secret-32-characters",
  FILE_UPLOAD_CLEANUP_CRON_SECRET: "file-cleanup-secret-with-32-characters",
  INTERNAL_WORKER_TOKEN: "knowledge-worker-token-with-32-characters",
  KNOWLEDGE_PROCESSOR_URL: "https://processor.staging.example/v1/jobs",
  KNOWLEDGE_PROCESSOR_SECRET: "knowledge-processor-secret-32-characters",
  KNOWLEDGE_PROCESSOR_ALLOWED_HOSTS: "processor.staging.example",
  KNOWLEDGE_SOURCE_ALLOWED_HOSTS: "project.supabase.co",
} as const;

describe("commercial server runtime configuration", () => {
  it("accepts a complete server-only configuration", () => {
    expect(() => assertCommercialServerRuntimeConfiguration(valid)).not.toThrow();
  });

  it.each(Object.keys(valid))("fails closed when %s is absent", (key) => {
    expect(() => assertCommercialServerRuntimeConfiguration({ ...valid, [key]: undefined }))
      .toThrow("readiness_configuration_missing");
  });

  it("rejects malformed encryption keys and processor targets", () => {
    expect(() => assertCommercialServerRuntimeConfiguration({ ...valid, AI_CONFIG_ENCRYPTION_KEY: "not-base64" }))
      .toThrow("readiness_configuration_missing");
    expect(() => assertCommercialServerRuntimeConfiguration({ ...valid, KNOWLEDGE_PROCESSOR_URL: "http://processor.staging.example/v1/jobs" }))
      .toThrow("readiness_configuration_missing");
    expect(() => assertCommercialServerRuntimeConfiguration({ ...valid, KNOWLEDGE_PROCESSOR_ALLOWED_HOSTS: "different.example" }))
      .toThrow("readiness_configuration_missing");
    expect(() => assertCommercialServerRuntimeConfiguration({ ...valid, KNOWLEDGE_SOURCE_ALLOWED_HOSTS: "127.0.0.1" }))
      .toThrow("readiness_configuration_missing");
  });
});
