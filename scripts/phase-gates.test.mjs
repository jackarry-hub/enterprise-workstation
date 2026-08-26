import assert from "node:assert/strict";
import test from "node:test";

import { runPhaseGate } from "./phase-gates.mjs";

test("marks a blocked RLS database dependency as BLOCKED and exits non-zero", async () => {
  await assert.rejects(
    () => runPhaseGate({
      gate: "rls",
      environment: "Local",
      databaseUrl: "postgresql://postgres:password@127.0.0.1:54322/postgres",
      runDbCommandImpl: async () => ({ outcome: "BLOCKED", status: 1 }),
    }),
    /phase_gate_blocked/,
  );
});

test("passes a security gate only when its real command reports success", async () => {
  const invocations = [];
  const result = await runPhaseGate({
    gate: "security",
    spawnProcess: (executable, args, options) => {
      invocations.push({ executable, args, options });
      return { status: 0 };
    },
  });

  assert.deepEqual(result, { gate: "security", outcome: "PASSED", status: 0 });
  assert.equal(invocations.length, 1);
  assert.equal(invocations[0].options.shell, false);
  assert.equal(invocations[0].options.stdio, "inherit");
  assert.ok(invocations[0].args.includes("audit"));
});

test("rejects a coverage process failure instead of treating it as a pass", async () => {
  await assert.rejects(
    () => runPhaseGate({
      gate: "coverage",
      spawnProcess: () => ({ status: 1 }),
    }),
    /phase_gate_blocked/,
  );
});

test("runs real V8 coverage over the application unit-test root rather than Node-only phase scripts", async () => {
  const invocations = [];

  const result = await runPhaseGate({
    gate: "coverage",
    spawnProcess: (executable, args, options) => {
      invocations.push({ executable, args, options });
      return { status: 0 };
    },
  });

  assert.deepEqual(result, { gate: "coverage", outcome: "PASSED", status: 0 });
  assert.equal(invocations[0].options.stdio, "inherit");
  assert.deepEqual(invocations[0].args.slice(-5), ["vitest", "run", "src", "--coverage", "--maxWorkers=4"]);
});
