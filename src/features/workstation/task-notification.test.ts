import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const external = vi.hoisted(() => ({
  createClient: vi.fn(),
  getFeishuTaskNotificationEnv: vi.fn(),
  getSupabaseEnv: vi.fn(),
  rpc: vi.fn(),
  sendFeishuTaskNotification: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({ createClient: external.createClient }));
vi.mock("@/features/feishu/task-notification", () => ({
  getFeishuTaskNotificationEnv: external.getFeishuTaskNotificationEnv,
  sendFeishuTaskNotification: external.sendFeishuTaskNotification,
}));
vi.mock("@/lib/supabase/env", () => ({ getSupabaseEnv: external.getSupabaseEnv }));

import {
  createTaskNotificationDispatcher,
  dispatchTaskAssignedNotification,
  type TaskNotificationDependencies,
  type TaskNotificationDeliveryClaim,
} from "@/features/workstation/task-notification";

const scope = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  organizationId: "22222222-2222-4222-8222-222222222222",
  taskId: "33333333-3333-4333-8333-333333333333",
};
const notificationId = "44444444-4444-4444-8444-444444444444";
const attemptToken = "55555555-5555-4555-8555-555555555555";
const providerRequestId = "66666666-6666-4666-8666-666666666666";
const leaseToken = "77777777-7777-4777-8777-777777777777";

function sendClaim(overrides: Partial<Extract<TaskNotificationDeliveryClaim, { action: "send" }>> = {}) {
  return {
    action: "send",
    notificationId,
    attemptToken,
    providerRequestId,
    leaseToken,
    leaseGeneration: 1,
    isFresh: true,
    attemptCount: 1,
    recipientOpenId: "ou_employee",
    taskId: scope.taskId,
    taskTitle: "完成目录集成",
    projectName: "企业工作站",
    reporterName: "负责人",
    priority: "high",
    dueDate: "2026-08-25",
    acceptanceCriteria: "负责人验收通过",
    ...overrides,
  } satisfies Extract<TaskNotificationDeliveryClaim, { action: "send" }>;
}

function dependencies(overrides: Partial<TaskNotificationDependencies> = {}): TaskNotificationDependencies {
  return {
    createAttemptToken: () => attemptToken,
    claim: vi.fn().mockResolvedValue(sendClaim()),
    sendMessage: vi.fn().mockResolvedValue({ messageId: "om_123" }),
    recordProviderAcceptance: vi.fn().mockResolvedValue(undefined),
    complete: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue({ state: "failed" }),
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", " service-role-secret ");
  for (const mock of Object.values(external)) mock.mockReset();
  external.createClient.mockReturnValue({ rpc: external.rpc });
  external.getSupabaseEnv.mockReturnValue({
    url: "https://project.supabase.co",
    publishableKey: "sb_publishable_example",
  });
  external.getFeishuTaskNotificationEnv.mockReturnValue({
    appId: "cli_test",
    appSecret: "app-secret",
    appUrl: "https://brain.example",
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("durable task notification dispatcher", () => {
  it("coalesces same-process calls while database claims remain authoritative", async () => {
    let settle: ((value: { messageId: string }) => void) | undefined;
    const pending = new Promise<{ messageId: string }>((resolve) => { settle = resolve; });
    const deps = dependencies({ sendMessage: vi.fn().mockReturnValue(pending) });
    const dispatch = createTaskNotificationDispatcher(deps);

    const first = dispatch(scope);
    const second = dispatch({ ...scope });
    await Promise.resolve();
    settle?.({ messageId: "om_123" });

    await expect(Promise.all([first, second])).resolves.toEqual([
      { status: "sent" }, { status: "sent" },
    ]);
    expect(deps.claim).toHaveBeenCalledTimes(1);
    expect(deps.sendMessage).toHaveBeenCalledTimes(1);
    expect(deps.recordProviderAcceptance).toHaveBeenCalledTimes(1);
    expect(deps.complete).toHaveBeenCalledTimes(1);
  });

  it("restarts by finalizing a durable provider acceptance without resending", async () => {
    const complete = vi.fn().mockRejectedValueOnce(new Error("db unavailable")).mockResolvedValueOnce(undefined);
    const firstDeps = dependencies({ complete });
    const first = createTaskNotificationDispatcher(firstDeps);

    await expect(first(scope)).resolves.toEqual({
      status: "unavailable", errorCode: "delivery_unconfirmed",
    });

    const restartedDeps = dependencies({
      claim: vi.fn().mockResolvedValue({
        action: "finalize", notificationId, attemptToken, providerRequestId,
        leaseToken, leaseGeneration: 2, messageId: "om_123",
      }),
      complete,
    });
    const restarted = createTaskNotificationDispatcher(restartedDeps);
    await expect(restarted(scope)).resolves.toEqual({ status: "sent" });

    expect(firstDeps.sendMessage).toHaveBeenCalledTimes(1);
    expect(restartedDeps.sendMessage).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("reuses the same provider UUID after a lost response and process restart", async () => {
    const firstDeps = dependencies({
      sendMessage: vi.fn().mockRejectedValue(new Error("delivery_unconfirmed")),
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(createTaskNotificationDispatcher(firstDeps)(scope)).resolves.toEqual({
      status: "unavailable", errorCode: "delivery_unconfirmed",
    });
    expect(firstDeps.fail).not.toHaveBeenCalled();

    const resumedClaim = sendClaim({ isFresh: false });
    const restartedDeps = dependencies({ claim: vi.fn().mockResolvedValue(resumedClaim) });
    await expect(createTaskNotificationDispatcher(restartedDeps)(scope)).resolves.toEqual({ status: "sent" });

    expect(firstDeps.sendMessage).toHaveBeenCalledWith(expect.any(Object), providerRequestId);
    expect(restartedDeps.sendMessage).toHaveBeenCalledWith(expect.any(Object), providerRequestId);
  });

  it("does not send while another server lease is active", async () => {
    const deps = dependencies({
      claim: vi.fn().mockResolvedValue({ action: "in_progress", notificationId }),
    });
    await expect(createTaskNotificationDispatcher(deps)(scope)).resolves.toEqual({
      status: "unavailable", errorCode: "delivery_unconfirmed",
    });
    expect(deps.sendMessage).not.toHaveBeenCalled();
  });

  it("records a missing recipient without calling Feishu", async () => {
    const deps = dependencies({ claim: vi.fn().mockResolvedValue(sendClaim({ recipientOpenId: null })) });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(createTaskNotificationDispatcher(deps)(scope)).resolves.toEqual({
      status: "unavailable", errorCode: "recipient_unavailable",
    });
    expect(deps.fail).toHaveBeenCalledWith(scope, expect.objectContaining({ attemptToken }), "recipient_unavailable");
    expect(deps.sendMessage).not.toHaveBeenCalled();
  });

  it("persists provider acceptance before the terminal sent transition", async () => {
    const order: string[] = [];
    const deps = dependencies({
      recordProviderAcceptance: vi.fn().mockImplementation(async () => { order.push("accepted"); }),
      complete: vi.fn().mockImplementation(async () => { order.push("sent"); }),
    });
    await expect(createTaskNotificationDispatcher(deps)(scope)).resolves.toEqual({ status: "sent" });
    expect(order).toEqual(["accepted", "sent"]);
  });

  it("keeps an accepted delivery retryable when final completion fails", async () => {
    const deps = dependencies({ complete: vi.fn().mockRejectedValue(new Error("db unavailable")) });
    await expect(createTaskNotificationDispatcher(deps)(scope)).resolves.toEqual({
      status: "unavailable", errorCode: "delivery_unconfirmed",
    });
    expect(deps.fail).not.toHaveBeenCalled();
  });
});

describe("default service-role delivery boundary", () => {
  it("claims, sends with the SDK UUID, records acceptance, then completes", async () => {
    external.rpc
      .mockResolvedValueOnce({ data: {
        outcome: "success", action: "send", notificationId, attemptToken,
        providerRequestId, leaseToken, leaseGeneration: 1, isFresh: true, attemptCount: 1,
        recipientOpenId: "ou_employee", taskId: scope.taskId,
        taskTitle: "完成目录集成", projectName: "企业工作站", reporterName: "负责人",
        priority: "high", dueDate: null, acceptanceCriteria: "负责人验收通过",
      }, error: null })
      .mockResolvedValueOnce({ data: { outcome: "success", state: "provider_accepted", messageId: "om_123" }, error: null })
      .mockResolvedValueOnce({ data: { outcome: "success", state: "sent", messageId: "om_123" }, error: null });
    external.sendFeishuTaskNotification.mockResolvedValue({ messageId: "om_123" });

    await expect(dispatchTaskAssignedNotification(scope)).resolves.toEqual({ status: "sent" });

    expect(external.rpc.mock.calls.map(([name]) => name)).toEqual([
      "claim_task_notification_delivery_v2",
      "record_task_notification_provider_acceptance_v2",
      "complete_task_notification_delivery_v2",
    ]);
    expect(external.rpc.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      p_attempt_token: attemptToken,
      p_lease_token: leaseToken,
      p_lease_generation: 1,
      p_provider_request_id: providerRequestId,
    }));
    expect(external.rpc.mock.calls[2]?.[1]).toEqual(expect.objectContaining({
      p_attempt_token: attemptToken,
      p_lease_token: leaseToken,
      p_lease_generation: 1,
    }));
    expect(external.sendFeishuTaskNotification).toHaveBeenCalledWith(
      expect.objectContaining({ recipientOpenId: "ou_employee", dueDate: "无截止日期" }),
      expect.objectContaining({ appId: "cli_test" }),
      { idempotencyKey: providerRequestId },
    );
    expect(external.createClient).toHaveBeenCalledTimes(3);
    for (const call of external.createClient.mock.calls) {
      expect(call).toEqual([
        "https://project.supabase.co",
        "service-role-secret",
        { auth: { persistSession: false, autoRefreshToken: false } },
      ]);
    }
  });

  it("fails closed when the service-role configuration is absent", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    await expect(dispatchTaskAssignedNotification(scope)).resolves.toEqual({
      status: "unavailable", errorCode: "configuration_unavailable",
    });
    expect(external.sendFeishuTaskNotification).not.toHaveBeenCalled();
  });

  it("rejects a drifted task context before invoking Feishu", async () => {
    external.rpc.mockResolvedValue({ data: {
      outcome: "success", action: "send", notificationId, attemptToken,
      providerRequestId, leaseToken, leaseGeneration: 1, isFresh: true, attemptCount: 1,
      recipientOpenId: "ou_employee", taskId: "33333333-3333-4333-8333-333333333399",
      taskTitle: "错误任务", projectName: "企业工作站", reporterName: "负责人",
      priority: "high", dueDate: "2026-08-25", acceptanceCriteria: "验收",
    }, error: null });
    await expect(dispatchTaskAssignedNotification(scope)).resolves.toEqual({
      status: "unavailable", errorCode: "queue_unavailable",
    });
    expect(external.sendFeishuTaskNotification).not.toHaveBeenCalled();
  });

  it("rejects an array-shaped RPC state instead of coercing it to sent", async () => {
    external.rpc
      .mockResolvedValueOnce({ data: {
        outcome: "success", action: "send", notificationId, attemptToken,
        providerRequestId, leaseToken, leaseGeneration: 1, isFresh: true, attemptCount: 1,
        recipientOpenId: "ou_employee", taskId: scope.taskId,
        taskTitle: "完成目录集成", projectName: "企业工作站", reporterName: "负责人",
        priority: "high", dueDate: null, acceptanceCriteria: "负责人验收通过",
      }, error: null })
      .mockResolvedValueOnce({
        data: { outcome: "success", state: ["provider_accepted"], messageId: "om_123" },
        error: null,
      });
    external.sendFeishuTaskNotification.mockResolvedValue({ messageId: "om_123" });

    await expect(dispatchTaskAssignedNotification(scope)).resolves.toEqual({
      status: "unavailable", errorCode: "delivery_unconfirmed",
    });
    expect(external.rpc).toHaveBeenCalledTimes(2);
  });

  it("rejects a task priority outside the database enum", async () => {
    external.rpc.mockResolvedValue({ data: {
      outcome: "success", action: "send", notificationId, attemptToken,
      providerRequestId, leaseToken, leaseGeneration: 1, isFresh: true, attemptCount: 1,
      recipientOpenId: "ou_employee", taskId: scope.taskId,
      taskTitle: "完成目录集成", projectName: "企业工作站", reporterName: "负责人",
      priority: "P0", dueDate: null, acceptanceCriteria: "负责人验收通过",
    }, error: null });

    await expect(dispatchTaskAssignedNotification(scope)).resolves.toEqual({
      status: "unavailable", errorCode: "queue_unavailable",
    });
    expect(external.sendFeishuTaskNotification).not.toHaveBeenCalled();
  });
});
