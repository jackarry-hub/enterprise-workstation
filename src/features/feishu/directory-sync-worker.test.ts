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
    heartbeat: async () => true,
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

  it("fails a malformed incremental cursor before claiming work", async () => {
    let claims = 0;
    expect(() => resumeFeishuIncrementalSync("event:41", dependencies({
      acquire: async () => { claims += 1; throw new Error("must not claim"); },
    }))).toThrow("directory_cursor_invalid");
    expect(claims).toBe(0);
  });

  it("preserves the durable no-work reason without inventing a run", async () => {
    const result = await startFeishuFullSync(dependencies({
      acquire: async () => ({ acquired: false, runId: null, cursor: null, attempt: 0, reason: "no_connection", retryAfter: null }),
    }));
    expect(result).toEqual({ runId: null, cursor: null, status: "no_work", retryAfter: null, reason: "no_connection" });
  });

  it("heartbeats the exact lease before fetch and before fenced apply", async () => {
    const calls: string[] = [];
    const result = await startFeishuFullSync(dependencies({
      acquire: async () => ({ acquired: true, runId: "run-fenced", cursor: null, attempt: 1, organizationId: "org-1" }),
      heartbeat: async (lease) => { calls.push(`heartbeat:${lease.runId}:${lease.organizationId}`); return true; },
      applySnapshot: async (_snapshot, lease) => { calls.push(`apply:${lease.runId}:${lease.organizationId}`); },
      complete: async (runId, cursor) => ({ runId, cursor, status: "completed", retryAfter: null }),
    }));
    expect(result.status).toBe("completed");
    expect(calls).toEqual([
      "heartbeat:run-fenced:org-1",
      "heartbeat:run-fenced:org-1",
      "apply:run-fenced:org-1",
    ]);
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
