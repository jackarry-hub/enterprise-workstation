import { describe, expect, it } from "vitest";

import {
  reconcileFeishuDirectory,
  resumeFeishuIncrementalSync,
  runScheduledFeishuDirectorySync,
  startFeishuFullSync,
  type DirectorySyncWorkerDependencies,
} from "@/features/feishu/directory-sync-worker";

function dependencies(overrides: Partial<DirectorySyncWorkerDependencies> = {}): DirectorySyncWorkerDependencies {
  return {
    acquire: async (mode, cursor) => ({ acquired: true, runId: `run-${mode}`, cursor, attempt: 1 }),
    loadSnapshot: async () => ({ complete: true, departments: [], positions: [], employees: [] }),
    applySnapshot: async () => undefined,
    complete: async (runId, cursor) => ({ runId, cursor: cursor ?? "0", status: "completed", retryAfter: null }),
    fail: async (runId, cursor, retryAfter) => ({ runId, cursor, status: "retry", retryAfter }),
    sleep: async () => undefined,
    ...overrides,
  };
}

describe("durable Feishu directory worker", () => {
  it("consumes the durable provider-event cursor before periodic reconciliation", async () => {
    const result = await runScheduledFeishuDirectorySync({
      nextCursor: async () => "41",
      incremental: async (cursor) => ({ runId: "run-event", cursor, status: "completed", retryAfter: null }),
      reconcile: async () => ({ runId: "run-reconcile", cursor: null, status: "completed", retryAfter: null }),
    });
    expect(result).toMatchObject({ runId: "run-event", cursor: "41" });
  });

  it("runs the real full snapshot adapter under a durable lease", async () => {
    let loads = 0;
    const result = await startFeishuFullSync(dependencies({ loadSnapshot: async () => {
      loads += 1;
      return { complete: true, departments: [], positions: [], employees: [] };
    } }));
    expect(result).toEqual({ runId: "run-full", cursor: "0", status: "completed", retryAfter: null });
    expect(loads).toBe(1);
  });

  it("preserves the durable cursor for incremental work", async () => {
    let loads = 0;
    const result = await resumeFeishuIncrementalSync("41", dependencies({
      loadSnapshot: async () => { loads += 1; return { complete: true, departments: [], positions: [], employees: [] }; },
    }));
    expect(result).toMatchObject({ runId: "run-incremental", cursor: "41", status: "completed" });
    expect(loads).toBe(1);
  });

  it("bounds retries with exponential backoff and returns the durable retry schedule", async () => {
    let attempts = 0;
    const deps = dependencies({
      acquire: async (_mode, cursor) => ({ acquired: true, runId: "run-retry", cursor, attempt: 1 }),
      loadSnapshot: async () => { attempts += 1; throw new Error("provider unavailable"); },
    });
    const result = await reconcileFeishuDirectory(deps);
    expect(attempts).toBe(3);
    expect(result).toMatchObject({ runId: "run-retry", status: "retry", retryAfter: expect.any(String) });
  });
});
