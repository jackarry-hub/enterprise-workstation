import { NextResponse } from "next/server";

import { getAuthEnv } from "@/features/auth/auth-env";
import { assertCommercialServerRuntimeConfiguration } from "@/features/commercial/runtime-configuration";
import { getRateLimitEnvironment } from "@/features/security/distributed-rate-limit";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";

export const REQUIRED_MIGRATION_MARKER = "202608300021";

type ReadinessDependencies = {
  checkConfiguration: () => void;
  readDatabaseStatus: () => PromiseLike<{ data: unknown; error: unknown }>;
};

function parseDatabaseStatus(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  return typeof source.database === "boolean"
    && typeof source.migrationReady === "boolean"
    && typeof source.migrationMarker === "string"
    ? {
      database: source.database,
      migrationReady: source.migrationReady,
      migrationMarker: source.migrationMarker,
    }
    : null;
}

export const defaultReadinessDependencies: ReadinessDependencies = {
  checkConfiguration: () => {
    getSupabaseEnv();
    getAuthEnv();
    getRateLimitEnvironment();
    assertCommercialServerRuntimeConfiguration();
  },
  readDatabaseStatus: () => getSupabaseServiceRoleClient().rpc(
    "commercial_readiness_status",
    { p_required_marker: REQUIRED_MIGRATION_MARKER },
  ),
};

export function createReadinessHandler(dependencies: ReadinessDependencies) {
  return async function ready() {
    let configuration = false;
    let database = false;
    let migration = false;
    try {
      dependencies.checkConfiguration();
      configuration = true;
      const result = await dependencies.readDatabaseStatus();
      const status = result.error ? null : parseDatabaseStatus(result.data);
      database = status?.database === true;
      migration = status?.migrationReady === true
        && status.migrationMarker === REQUIRED_MIGRATION_MARKER;
    } catch {
      database = false;
      migration = false;
    }
    const ready = configuration && database && migration;
    return NextResponse.json(
      {
        status: ready ? "ready" : "not_ready",
        checks: { configuration, database, migration },
      },
      {
        status: ready ? 200 : 503,
        headers: { "cache-control": "no-store" },
      },
    );
  };
}
