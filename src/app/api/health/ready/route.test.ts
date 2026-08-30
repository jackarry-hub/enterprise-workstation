import { describe, expect, it, vi } from "vitest";

import {
  createReadinessHandler,
  REQUIRED_MIGRATION_MARKER,
} from "@/app/api/health/ready/handler";

function healthy() {
  return {
    checkConfiguration: vi.fn(),
    readDatabaseStatus: vi.fn().mockResolvedValue({
      data: {
        database: true,
        migrationReady: true,
        migrationMarker: REQUIRED_MIGRATION_MARKER,
        checkedAt: "2026-08-30T12:00:00Z",
      },
      error: null,
    }),
  };
}

describe("commercial readiness", () => {
  it("returns ready only when configuration, database and marker are healthy", async () => {
    const response = await createReadinessHandler(healthy())();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      status: "ready",
      checks: { configuration: true, database: true, migration: true },
    });
  });

  it("returns 503 without database details when reachability fails", async () => {
    const dependencies = healthy();
    dependencies.readDatabaseStatus.mockResolvedValue({
      data: null,
      error: { message: "password=private host=db.internal" },
    });
    const response = await createReadinessHandler(dependencies)();
    expect(response.status).toBe(503);
    const body = JSON.stringify(await response.json());
    expect(body).toBe('{"status":"not_ready","checks":{"configuration":true,"database":false,"migration":false}}');
    expect(body).not.toMatch(/password|internal/);
  });

  it("returns 503 when the database reports an older migration", async () => {
    const dependencies = healthy();
    dependencies.readDatabaseStatus.mockResolvedValue({
      data: { database: true, migrationReady: false, migrationMarker: "202608300020" },
      error: null,
    });
    const response = await createReadinessHandler(dependencies)();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "not_ready",
      checks: { configuration: true, database: true, migration: false },
    });
  });

  it("does not contact the database after configuration validation throws", async () => {
    const dependencies = healthy();
    dependencies.checkConfiguration.mockImplementation(() => { throw new Error("secret value"); });
    const response = await createReadinessHandler(dependencies)();
    expect(response.status).toBe(503);
    expect(dependencies.readDatabaseStatus).not.toHaveBeenCalled();
  });
});
