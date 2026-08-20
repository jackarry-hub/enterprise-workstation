import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const externalDependencies = vi.hoisted(() => ({
  createClient: vi.fn(),
  getFeishuTaskNotificationEnv: vi.fn(),
  getSupabaseEnv: vi.fn(),
  rpc: vi.fn(),
  sendFeishuTaskNotification: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: externalDependencies.createClient,
}));

vi.mock("@/features/feishu/task-notification", () => ({
  getFeishuTaskNotificationEnv:
    externalDependencies.getFeishuTaskNotificationEnv,
  sendFeishuTaskNotification:
    externalDependencies.sendFeishuTaskNotification,
}));

vi.mock("@/lib/supabase/env", () => ({
  getSupabaseEnv: externalDependencies.getSupabaseEnv,
}));

import {
  createTaskNotificationDispatcher,
  dispatchTaskAssignedNotification,
} from "@/features/workstation/task-notification";

const scope = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  organizationId: "22222222-2222-4222-8222-222222222222",
  taskId: "33333333-3333-4333-8333-333333333333",
};
const notificationId = "44444444-4444-4444-8444-444444444444";
const context = {
  notificationId,
  recipientOpenId: "ou_employee",
  taskId: scope.taskId,
  taskTitle: "Complete directory integration",
  projectName: "Enterprise workstation",
  reporterName: "Task owner",
  priority: "high",
  dueDate: "2026-08-25",
  acceptanceCriteria: "Owner approves the result",
  status: "pending" as const,
  attemptCount: 2,
};
const messageInput = {
  taskId: scope.taskId,
  recipientOpenId: "ou_employee",
  taskTitle: "Complete directory integration",
  projectName: "Enterprise workstation",
  reporterName: "Task owner",
  priority: "high",
  dueDate: "2026-08-25",
  acceptanceCriteria: "Owner approves the result",
};

function deferred<T>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", " service-role-secret ");
  externalDependencies.createClient.mockReset();
  externalDependencies.getFeishuTaskNotificationEnv.mockReset();
  externalDependencies.getSupabaseEnv.mockReset();
  externalDependencies.rpc.mockReset();
  externalDependencies.sendFeishuTaskNotification.mockReset();

  externalDependencies.createClient.mockReturnValue({
    rpc: externalDependencies.rpc,
  });
  externalDependencies.getSupabaseEnv.mockReturnValue({
    url: "https://project.supabase.co",
    publishableKey: "sb_publishable_example",
  });
  externalDependencies.getFeishuTaskNotificationEnv.mockReturnValue({
    appId: "cli_test",
    appSecret: "app-secret",
    appUrl: "https://brain.example",
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("task notification delivery state", () => {
  it("coalesces concurrent deliveries for the same task scope", async () => {
    const pendingSend = deferred<{ messageId: string }>();
    const loadContext = vi.fn().mockResolvedValue(context);
    const sendMessage = vi.fn().mockReturnValue(pendingSend.promise);
    const recordResult = vi.fn().mockResolvedValue(undefined);
    const dispatch = createTaskNotificationDispatcher({
      loadContext,
      sendMessage,
      recordResult,
    });

    const first = dispatch(scope);
    const second = dispatch({ ...scope });
    await Promise.resolve();
    pendingSend.resolve({ messageId: "om_concurrent" });

    await expect(Promise.all([first, second])).resolves.toEqual([
      { status: "sent" },
      { status: "sent" },
    ]);
    expect(loadContext).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(recordResult).toHaveBeenCalledTimes(1);
    expect(recordResult).toHaveBeenCalledWith(scope, notificationId, {
      status: "sent",
      messageId: "om_concurrent",
    });
  });

  it("allows different task scopes to deliver concurrently", async () => {
    const otherScope = {
      ...scope,
      taskId: "55555555-5555-4555-8555-555555555555",
    };
    const pendingSend = deferred<{ messageId: string }>();
    const loadContext = vi.fn().mockImplementation(
      async (loadedScope: typeof scope) => ({
        ...context,
        notificationId: loadedScope.taskId === scope.taskId
          ? notificationId
          : "66666666-6666-4666-8666-666666666666",
        taskId: loadedScope.taskId,
      }),
    );
    const sendMessage = vi.fn().mockReturnValue(pendingSend.promise);
    const recordResult = vi.fn().mockResolvedValue(undefined);
    const dispatch = createTaskNotificationDispatcher({
      loadContext,
      sendMessage,
      recordResult,
    });

    const first = dispatch(scope);
    const second = dispatch(otherScope);
    await Promise.resolve();

    expect(loadContext).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls.map(([input]) => input.taskId)).toEqual([
      scope.taskId,
      otherScope.taskId,
    ]);

    pendingSend.resolve({ messageId: "om_parallel" });
    await expect(Promise.all([first, second])).resolves.toEqual([
      { status: "sent" },
      { status: "sent" },
    ]);
    expect(recordResult).toHaveBeenCalledTimes(2);
  });

  it("loads fresh state after an operation for the scope settles", async () => {
    const pendingSend = deferred<{ messageId: string }>();
    const loadContext = vi.fn()
      .mockResolvedValueOnce(context)
      .mockResolvedValueOnce({ ...context, status: "sent" });
    const sendMessage = vi.fn().mockReturnValue(pendingSend.promise);
    const recordResult = vi.fn().mockResolvedValue(undefined);
    const dispatch = createTaskNotificationDispatcher({
      loadContext,
      sendMessage,
      recordResult,
    });

    const first = dispatch(scope);
    await Promise.resolve();
    pendingSend.resolve({ messageId: "om_settled" });
    await expect(first).resolves.toEqual({ status: "sent" });
    await expect(dispatch(scope)).resolves.toEqual({ status: "sent" });

    expect(loadContext).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(recordResult).toHaveBeenCalledTimes(1);
  });

  it.each([
    [null, false],
    [{ ...context, recipientOpenId: null }, true],
    [{ ...context, recipientOpenId: "   " }, true],
  ])(
    "does not call Feishu without a recipient identity",
    async (loadedContext, recordsUnavailable) => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(
        () => undefined,
      );
      const sendMessage = vi.fn();
      const recordResult = vi.fn();
      const dispatch = createTaskNotificationDispatcher({
        loadContext: vi.fn().mockResolvedValue(loadedContext),
        sendMessage,
        recordResult,
      });

      await expect(dispatch(scope)).resolves.toEqual({
        status: "unavailable",
        errorCode: "recipient_unavailable",
      });
      expect(sendMessage).not.toHaveBeenCalled();
      if (recordsUnavailable) {
        expect(recordResult).toHaveBeenCalledWith(scope, notificationId, {
          status: "failed",
          errorCode: "recipient_unavailable",
        });
        expect(consoleError).toHaveBeenCalledWith({
          taskId: scope.taskId,
          notificationId,
          attemptCount: 3,
          errorCode: "recipient_unavailable",
        });
      } else {
        expect(recordResult).not.toHaveBeenCalled();
        expect(consoleError).not.toHaveBeenCalled();
      }
    },
  );

  it.each([null, "   "])(
    "does not mutate or resend a sent notification without a recipient",
    async (recipientOpenId) => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(
        () => undefined,
      );
      const sendMessage = vi.fn();
      const recordResult = vi.fn();
      const dispatch = createTaskNotificationDispatcher({
        loadContext: vi.fn().mockResolvedValue({
          ...context,
          recipientOpenId,
          status: "sent",
        }),
        sendMessage,
        recordResult,
      });

      await expect(dispatch(scope)).resolves.toEqual({ status: "sent" });
      expect(sendMessage).not.toHaveBeenCalled();
      expect(recordResult).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
    },
  );

  it("records the provider message ID after a successful attempt", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ messageId: "om_123" });
    const recordResult = vi.fn().mockResolvedValue(undefined);
    const dispatch = createTaskNotificationDispatcher({
      loadContext: vi.fn().mockResolvedValue(context),
      sendMessage,
      recordResult,
    });

    await expect(dispatch(scope)).resolves.toEqual({ status: "sent" });
    expect(sendMessage).toHaveBeenCalledWith(messageInput);
    expect(recordResult).toHaveBeenCalledWith(scope, notificationId, {
      status: "sent",
      messageId: "om_123",
    });
  });

  it("returns an unconfirmed result without a second record after delivery was sent", async () => {
    const rawPersistenceError = "database response leaked after Feishu success";
    const consoleError = vi.spyOn(console, "error").mockImplementation(
      () => undefined,
    );
    const recordResult = vi.fn().mockRejectedValue(
      new Error(rawPersistenceError),
    );
    const sendMessage = vi.fn().mockResolvedValue({ messageId: "om_123" });
    const dispatch = createTaskNotificationDispatcher({
      loadContext: vi.fn().mockResolvedValue(context),
      sendMessage,
      recordResult,
    });

    const result = await dispatch(scope);

    expect(result).toEqual({
      status: "unavailable",
      errorCode: "delivery_unconfirmed",
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(recordResult).toHaveBeenCalledTimes(1);
    expect(recordResult).toHaveBeenCalledWith(scope, notificationId, {
      status: "sent",
      messageId: "om_123",
    });
    expect(consoleError).toHaveBeenCalledWith({
      taskId: scope.taskId,
      notificationId,
      attemptCount: 3,
      errorCode: "delivery_unconfirmed",
    });
    expect(JSON.stringify([result, consoleError.mock.calls])).not.toContain(
      rawPersistenceError,
    );
  });

  it("reconciles an unconfirmed delivery without sending the message again", async () => {
    const recordResult = vi.fn()
      .mockRejectedValueOnce(new Error("first persistence response leaked"))
      .mockResolvedValueOnce(undefined);
    const sendMessage = vi.fn().mockResolvedValue({ messageId: "om_123" });
    const dispatch = createTaskNotificationDispatcher({
      loadContext: vi.fn().mockResolvedValue(context),
      sendMessage,
      recordResult,
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(dispatch(scope)).resolves.toEqual({
      status: "unavailable",
      errorCode: "delivery_unconfirmed",
    });
    await expect(dispatch(scope)).resolves.toEqual({ status: "sent" });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(recordResult).toHaveBeenCalledTimes(2);
    expect(recordResult).toHaveBeenNthCalledWith(
      2,
      scope,
      notificationId,
      { status: "sent", messageId: "om_123" },
    );
  });

  it("maps a context dependency failure to a stable queue result", async () => {
    const rawContextError = "context row and database details leaked";
    const sendMessage = vi.fn();
    const recordResult = vi.fn();
    const dispatch = createTaskNotificationDispatcher({
      loadContext: vi.fn().mockRejectedValue(new Error(rawContextError)),
      sendMessage,
      recordResult,
    });

    const result = await dispatch(scope);

    expect(result).toEqual({
      status: "unavailable",
      errorCode: "queue_unavailable",
    });
    expect(JSON.stringify(result)).not.toContain(rawContextError);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(recordResult).not.toHaveBeenCalled();
  });

  it("maps a no-recipient recording failure to a stable queue result", async () => {
    const rawRecordError = "recipient record database response leaked";
    const consoleError = vi.spyOn(console, "error").mockImplementation(
      () => undefined,
    );
    const recordResult = vi.fn().mockRejectedValue(new Error(rawRecordError));
    const dispatch = createTaskNotificationDispatcher({
      loadContext: vi.fn().mockResolvedValue({
        ...context,
        recipientOpenId: null,
      }),
      sendMessage: vi.fn(),
      recordResult,
    });

    const result = await dispatch(scope);

    expect(result).toEqual({
      status: "unavailable",
      errorCode: "queue_unavailable",
    });
    expect(recordResult).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith({
      taskId: scope.taskId,
      notificationId,
      attemptCount: 3,
      errorCode: "queue_unavailable",
    });
    expect(JSON.stringify([result, consoleError.mock.calls])).not.toContain(
      rawRecordError,
    );
  });

  it("maps a failed-delivery recording failure without leaking either error", async () => {
    const rawProviderError = "provider response body leaked";
    const rawRecordError = "record RPC response leaked";
    const consoleError = vi.spyOn(console, "error").mockImplementation(
      () => undefined,
    );
    const recordResult = vi.fn().mockRejectedValue(new Error(rawRecordError));
    const dispatch = createTaskNotificationDispatcher({
      loadContext: vi.fn().mockResolvedValue(context),
      sendMessage: vi.fn().mockRejectedValue(new Error(rawProviderError)),
      recordResult,
    });

    const result = await dispatch(scope);

    expect(result).toEqual({
      status: "failed",
      errorCode: "queue_unavailable",
    });
    expect(recordResult).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith({
      taskId: scope.taskId,
      notificationId,
      attemptCount: 3,
      errorCode: "queue_unavailable",
    });
    const publicOutput = JSON.stringify([result, consoleError.mock.calls]);
    expect(publicOutput).not.toContain(rawProviderError);
    expect(publicOutput).not.toContain(rawRecordError);
  });

  it.each([
    ["token_unavailable", "token_unavailable"],
    ["configuration_unavailable", "configuration_unavailable"],
    ["recipient_unavailable", "recipient_unavailable"],
    ["provider body leaked: ou_employee", "send_failed"],
    ["send_failed", "send_failed"],
  ] as const)(
    "records only a stable code when delivery fails with %s",
    async (providerMessage, expectedCode) => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(
        () => undefined,
      );
      const recordResult = vi.fn().mockResolvedValue(undefined);
      const dispatch = createTaskNotificationDispatcher({
        loadContext: vi.fn().mockResolvedValue(context),
        sendMessage: vi.fn().mockRejectedValue(new Error(providerMessage)),
        recordResult,
      });

      await expect(dispatch(scope)).resolves.toEqual({
        status: "failed",
        errorCode: expectedCode,
      });
      expect(recordResult).toHaveBeenCalledWith(scope, notificationId, {
        status: "failed",
        errorCode: expectedCode,
      });
      expect(consoleError).toHaveBeenCalledWith({
        taskId: scope.taskId,
        notificationId,
        attemptCount: 3,
        errorCode: expectedCode,
      });
      const publicOutput = JSON.stringify([
        recordResult.mock.calls,
        consoleError.mock.calls,
      ]);
      if (providerMessage !== expectedCode) {
        expect(publicOutput).not.toContain(providerMessage);
      }
      expect(publicOutput).not.toContain(context.recipientOpenId);
      expect(publicOutput).not.toContain(context.taskTitle);
    },
  );
});

describe("default service-role delivery dependencies", () => {
  it("uses scoped RPCs and the non-persistent admin client", async () => {
    externalDependencies.rpc
      .mockResolvedValueOnce({
        data: [{
          notification_public_id: notificationId,
          task_public_id: scope.taskId,
          recipient_open_id: "ou_employee",
          task_title: "Complete directory integration",
          project_name: "Enterprise workstation",
          reporter_name: "Task owner",
          priority: "high",
          due_date: "2026-08-25",
          acceptance_criteria: "Owner approves the result",
          status: "pending",
          attempt_count: 2,
        }],
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: null });
    externalDependencies.sendFeishuTaskNotification.mockResolvedValue({
      messageId: "om_123",
    });

    await expect(dispatchTaskAssignedNotification(scope)).resolves.toEqual({
      status: "sent",
    });

    expect(externalDependencies.createClient).toHaveBeenCalledTimes(2);
    for (const call of externalDependencies.createClient.mock.calls) {
      expect(call).toEqual([
        "https://project.supabase.co",
        "service-role-secret",
        { auth: { persistSession: false, autoRefreshToken: false } },
      ]);
    }
    expect(externalDependencies.rpc).toHaveBeenNthCalledWith(
      1,
      "get_task_notification_delivery_context",
      {
        p_tenant_public_id: scope.tenantId,
        p_organization_public_id: scope.organizationId,
        p_task_public_id: scope.taskId,
      },
    );
    expect(externalDependencies.sendFeishuTaskNotification).toHaveBeenCalledWith(
      messageInput,
      {
        appId: "cli_test",
        appSecret: "app-secret",
        appUrl: "https://brain.example",
      },
    );
    expect(externalDependencies.rpc).toHaveBeenNthCalledWith(
      2,
      "record_task_notification_delivery",
      {
        p_tenant_public_id: scope.tenantId,
        p_organization_public_id: scope.organizationId,
        p_notification_public_id: notificationId,
        p_status: "sent",
        p_feishu_message_id: "om_123",
        p_last_error_code: null,
      },
    );
  });

  it.each([
    ["missing service-role key", "missing-key"],
    ["invalid Supabase configuration", "invalid-config"],
  ])("maps %s to configuration_unavailable", async (_case, setup) => {
    if (setup === "missing-key") {
      vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    } else {
      externalDependencies.getSupabaseEnv.mockImplementation(() => {
        throw new Error("Supabase URL and secret details leaked");
      });
    }

    const result = await dispatchTaskAssignedNotification(scope);

    expect(result).toEqual({
      status: "unavailable",
      errorCode: "configuration_unavailable",
    });
    expect(JSON.stringify(result)).not.toContain("secret details leaked");
    expect(externalDependencies.sendFeishuTaskNotification).not
      .toHaveBeenCalled();
  });

  it("maps a context RPC error to queue_unavailable", async () => {
    externalDependencies.rpc.mockResolvedValue({
      data: null,
      error: { message: "context database response leaked" },
    });

    const result = await dispatchTaskAssignedNotification(scope);

    expect(result).toEqual({
      status: "unavailable",
      errorCode: "queue_unavailable",
    });
    expect(JSON.stringify(result)).not.toContain("database response leaked");
    expect(externalDependencies.sendFeishuTaskNotification).not
      .toHaveBeenCalled();
  });

  it("returns delivery_unconfirmed when the result RPC fails after sending", async () => {
    const unconfirmedNotificationId =
      "55555555-5555-4555-8555-555555555555";
    const consoleError = vi.spyOn(console, "error").mockImplementation(
      () => undefined,
    );
    externalDependencies.rpc
      .mockResolvedValueOnce({
        data: [{
          notification_public_id: unconfirmedNotificationId,
          task_public_id: scope.taskId,
          recipient_open_id: "ou_employee",
          task_title: "Complete directory integration",
          project_name: "Enterprise workstation",
          reporter_name: "Task owner",
          priority: "high",
          due_date: "2026-08-25",
          acceptance_criteria: "Owner approves the result",
          status: "pending",
          attempt_count: 2,
        }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: null,
        error: { message: "result database response leaked" },
      });
    externalDependencies.sendFeishuTaskNotification.mockResolvedValue({
      messageId: "om_123",
    });

    const result = await dispatchTaskAssignedNotification(scope);

    expect(result).toEqual({
      status: "unavailable",
      errorCode: "delivery_unconfirmed",
    });
    expect(externalDependencies.sendFeishuTaskNotification).toHaveBeenCalledTimes(
      1,
    );
    expect(externalDependencies.rpc).toHaveBeenCalledTimes(2);
    expect(JSON.stringify([result, consoleError.mock.calls])).not.toContain(
      "database response leaked",
    );
  });

  it("maps a nullable due date to a concise card display value", async () => {
    externalDependencies.rpc
      .mockResolvedValueOnce({
        data: [{
          notification_public_id: notificationId,
          task_public_id: scope.taskId,
          recipient_open_id: "ou_employee",
          task_title: "Complete directory integration",
          project_name: "Enterprise workstation",
          reporter_name: "Task owner",
          priority: "high",
          due_date: null,
          acceptance_criteria: "Owner approves the result",
          status: "pending",
          attempt_count: 2,
        }],
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: null });
    externalDependencies.sendFeishuTaskNotification.mockResolvedValue({
      messageId: "om_123",
    });

    await dispatchTaskAssignedNotification(scope);

    expect(externalDependencies.sendFeishuTaskNotification).toHaveBeenCalledWith(
      { ...messageInput, dueDate: "无截止日期" },
      {
        appId: "cli_test",
        appSecret: "app-secret",
        appUrl: "https://brain.example",
      },
    );
  });
});
