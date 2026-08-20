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

  it("does not resend a notification already marked sent", async () => {
    const sendMessage = vi.fn();
    const recordResult = vi.fn();
    const dispatch = createTaskNotificationDispatcher({
      loadContext: vi.fn().mockResolvedValue({ ...context, status: "sent" }),
      sendMessage,
      recordResult,
    });

    await expect(dispatch(scope)).resolves.toEqual({ status: "sent" });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(recordResult).not.toHaveBeenCalled();
  });

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
});
