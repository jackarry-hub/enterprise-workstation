import assert from "node:assert/strict";
import test from "node:test";

import * as phaseGates from "./phase-gates.mjs";
import { runDbCommand } from "./db-command-runner.mjs";

const { runPhaseGate } = phaseGates;

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

test("formats propagated runner evidence for npm test:rls without URL, host, credential, or secret output", async () => {
  const runnerFailure = await runDbCommand({
    command: "db:test",
    environment: "Local",
    databaseUrl: "postgresql://postgres:local-password@127.0.0.1:54322/postgres",
    spawnProcess: () => ({
      status: 1,
      stdout: "1..2\nApplying migration 202608260010_guard.sql\nnot ok 2 - agent_policy_rls\n",
      stderr: "ERROR: SQLSTATE 42501 host=203.0.113.9 password=local-password token=unknown-secret",
    }),
  });
  let blockedError;
  try {
    await runPhaseGate({
      gate: "rls",
      environment: "Local",
      databaseUrl: "postgresql://postgres:local-password@127.0.0.1:54322/postgres",
      runDbCommandImpl: async () => runnerFailure,
    });
  } catch (error) {
    blockedError = error;
  }

  assert.equal(blockedError?.category, "database_cli_failed");
  assert.deepEqual(blockedError?.evidence, {
    errorSummary: "test_failed:42501",
    failedTest: "test_2",
    failedTestNumber: 2,
    migration: "202608260010_guard.sql",
    testCount: 2,
  });
  assert.equal(typeof phaseGates.formatPhaseGateBlocked, "function");
  const output = phaseGates.formatPhaseGateBlocked("rls", blockedError);
  assert.match(output, /BLOCKED phase_gate=rls category=database_cli_failed tests=2 failed_test_number=2 failed_test=test_2 migration=202608260010_guard\.sql error=test_failed:42501/);
  assert.doesNotMatch(output, /postgresql:|local-password|127\.0\.0\.1|203\.0\.113\.9|unknown-secret/);
});

test("formats an unknown phase gate as unknown without echoing its caller-controlled value", () => {
  const output = phaseGates.formatPhaseGateBlocked("rls?token=unknown-secret", {
    category: "database_cli_failed",
    evidence: { errorSummary: "cli_failed" },
  });

  assert.equal(output, "BLOCKED phase_gate=unknown category=database_cli_failed error=cli_failed");
  assert.equal(output.includes("unknown-secret"), false);
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
