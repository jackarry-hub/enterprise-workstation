import { describe, expect, it, vi } from "vitest";

import {
  handleExpenseCancel,
  handleExpenseCollection,
  handleExpensePayment,
  handleExpenseSubmission,
} from "@/features/expenses/expense-command-handler";

const expenseId = "10000000-0000-4000-8000-000000000001";
const projectId = "20000000-0000-4000-8000-000000000001";
const receiptId = "30000000-0000-4000-8000-000000000001";
const approvalId = "40000000-0000-4000-8000-000000000001";
const ownerEmployeeId = "50000000-0000-4000-8000-000000000001";
const idempotencyKey = "60000000-0000-4000-8000-000000000001";
const requestId = "70000000-0000-4000-8000-000000000001";
const activeSession = { member: { status: "active" }, permissionCodes: ["expense.submit"] };

function request(method: string, body: unknown, path = "/api/workstation/expenses", key = idempotencyKey) {
  return new Request(`http://local${path}`, {
    method,
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(body),
  });
}

function dependencies(data: unknown, session: typeof activeSession | null = activeSession) {
  return {
    session,
    rpc: vi.fn().mockResolvedValue({ data, error: null }),
    createRequestId: () => requestId,
  };
}

function success(status = "draft", version = 1, overrides: Record<string, unknown> = {}) {
  const submitted = status === "submitted";
  const paid = status === "paid";
  return {
    outcome: "success", resource: "expense", id: expenseId, version,
    entity: {
      id: expenseId,
      version,
      expenseCode: "EXP-10000000000040008000",
      status,
      projectId,
      expenseType: "travel",
      amount: "1280.50",
      currency: "CNY",
      expenseDate: "2026-08-28",
      description: "客户现场差旅",
      receiptFileIds: [receiptId],
      approvalId: submitted || paid ? approvalId : null,
      ownerEmployeeId: submitted ? ownerEmployeeId : null,
      paidAt: paid ? "2026-08-28T08:00:00.000Z" : null,
      paymentReference: paid ? "PAY-20260828-001" : null,
      updatedAt: paid ? "2026-08-28T08:00:00.000Z" : "2026-08-28T07:00:00.000Z",
      ...overrides,
    },
  };
}

const draftInput = {
  projectId,
  expenseType: "travel",
  amount: "1280.50",
  expenseDate: "2026-08-28",
  description: "客户现场差旅",
  receiptFileIds: [receiptId],
};

describe("expense draft commands", () => {
  it("creates one server-owned draft with a fixed decimal amount and verified file identifiers", async () => {
    const deps = dependencies(success());
    const response = await handleExpenseCollection(request("POST", draftInput), deps);
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      resource: "expense", expense: { id: expenseId, status: "draft", amount: "1280.50" },
    });
    expect(deps.rpc).toHaveBeenCalledWith("create_current_expense", {
      project_public_id: projectId,
      expense_type: "travel",
      amount: "1280.50",
      expense_date: "2026-08-28",
      description: "客户现场差旅",
      receipt_file_ids: [receiptId],
      idempotency_key: idempotencyKey,
      request_id: requestId,
    });
  });

  it.each([
    ["1", "1.00"],
    ["1.2", "1.20"],
  ])("normalizes valid amount %s to the PostgreSQL numeric scale %s", async (input, canonical) => {
    const deps = dependencies(success("draft", 1, { amount: canonical }));
    const response = await handleExpenseCollection(request("POST", { ...draftInput, amount: input }), deps);
    expect(response.status).toBe(201);
    expect(deps.rpc).toHaveBeenCalledWith("create_current_expense", expect.objectContaining({
      amount: canonical,
    }));
  });

  it.each(["12.345", "01.00", "0", "1000000000000.00"])(
    "rejects a non-commercial decimal amount %s before the RPC",
    async (amount) => {
      const deps = dependencies(null);
      const response = await handleExpenseCollection(request("POST", { ...draftInput, amount }), deps);
      expect(response.status).toBe(400);
      expect(deps.rpc).not.toHaveBeenCalled();
    },
  );

  it("rejects requester and owner spoofing instead of accepting ownership fields", async () => {
    const deps = dependencies(null);
    const response = await handleExpenseCollection(request("PATCH", {
      expenseId,
      expectedVersion: 1,
      expenseType: "travel", amount: "1280.50", expenseDate: "2026-08-28",
      description: "客户现场差旅", receiptFileIds: [receiptId],
      requesterId: ownerEmployeeId,
      ownerId: ownerEmployeeId,
    }), deps);
    expect(response.status).toBe(400);
    expect(deps.rpc).not.toHaveBeenCalled();
  });

  it("updates only a request-bound draft version", async () => {
    const deps = dependencies(success("draft", 2));
    const response = await handleExpenseCollection(request("PATCH", {
      expenseId, expectedVersion: 1,
      expenseType: "travel", amount: "1280.50", expenseDate: "2026-08-28",
      description: "客户现场差旅", receiptFileIds: [receiptId],
    }), deps);
    expect(response.status).toBe(200);
    expect(deps.rpc).toHaveBeenCalledWith("update_current_expense", expect.objectContaining({
      expense_public_id: expenseId, expected_version: 1, request_id: requestId,
    }));
  });

  it("maps an unverified receipt to a safe validation failure", async () => {
    const deps = dependencies({ outcome: "failure", error: "invalid_receipt" });
    const response = await handleExpenseCollection(request("POST", draftInput), deps);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "invalid_receipt" });
  });

  it("rejects create responses that drift from the requested draft payload", async () => {
    const wrongStatus = dependencies(success("paid", 1));
    expect((await handleExpenseCollection(request("POST", draftInput), wrongStatus)).status).toBe(503);
    const wrongAmount = dependencies(success("draft", 1, { amount: "1280.51" }));
    expect((await handleExpenseCollection(request("POST", draftInput), wrongAmount)).status).toBe(503);
    const wrongReceipts = dependencies(success("draft", 1, { receiptFileIds: [] }));
    expect((await handleExpenseCollection(request("POST", draftInput), wrongReceipts)).status).toBe(503);
  });

  it("rejects PostgreSQL-incompatible year zero at the API boundary", async () => {
    const deps = dependencies(null);
    const response = await handleExpenseCollection(request("POST", {
      ...draftInput, expenseDate: "0000-01-01",
    }), deps);
    expect(response.status).toBe(400);
    expect(deps.rpc).not.toHaveBeenCalled();
  });
});

describe("expense lifecycle commands", () => {
  it("submits a draft through a server-owned approval link", async () => {
    const deps = dependencies(success("submitted", 2));
    const response = await handleExpenseSubmission(request(
      "POST", { expectedVersion: 1 }, `/api/workstation/expenses/${expenseId}/submit`,
    ), expenseId, deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      expense: { status: "submitted", approvalId, ownerEmployeeId },
    });
    expect(deps.rpc).toHaveBeenCalledWith("submit_current_expense", {
      expense_public_id: expenseId,
      expected_version: 1,
      idempotency_key: idempotencyKey,
      request_id: requestId,
    });
  });

  it("forbids payment without expense.manage before invoking the RPC", async () => {
    const deps = dependencies(null);
    const response = await handleExpensePayment(request(
      "POST", { expectedVersion: 2, paymentReference: "PAY-20260828-001" },
      `/api/workstation/expenses/${expenseId}/payment`,
    ), expenseId, deps);
    expect(response.status).toBe(403);
    expect(deps.rpc).not.toHaveBeenCalled();
  });

  it("lets finance mark an approved expense paid with auditable metadata", async () => {
    const deps = dependencies(success("paid", 4), {
      member: { status: "active" }, permissionCodes: ["expense.manage"],
    });
    const response = await handleExpensePayment(request(
      "POST", { expectedVersion: 3, paymentReference: "PAY-20260828-001" },
      `/api/workstation/expenses/${expenseId}/payment`,
    ), expenseId, deps);
    expect(response.status).toBe(200);
    expect(deps.rpc).toHaveBeenCalledWith("mark_current_expense_paid", {
      expense_public_id: expenseId,
      expected_version: 3,
      payment_reference: "PAY-20260828-001",
      idempotency_key: idempotencyKey,
      request_id: requestId,
    });
  });

  it("rejects payment responses with a wrong status or payment reference", async () => {
    const finance = { member: { status: "active" }, permissionCodes: ["expense.manage"] };
    const wrongStatus = dependencies(success("submitted", 4), finance);
    const payment = { expectedVersion: 3, paymentReference: "PAY-20260828-001" };
    expect((await handleExpensePayment(request(
      "POST", payment, `/api/workstation/expenses/${expenseId}/payment`,
    ), expenseId, wrongStatus)).status).toBe(503);
    const wrongReference = dependencies(success("paid", 4, {
      paymentReference: "PAY-TAMPERED",
    }), finance);
    expect((await handleExpensePayment(request(
      "POST", payment, `/api/workstation/expenses/${expenseId}/payment`,
    ), expenseId, wrongReference)).status).toBe(503);
    const wrongPaidAt = dependencies(success("paid", 4, {
      paidAt: "2026-08-28T07:59:59.000Z",
    }), finance);
    expect((await handleExpensePayment(request(
      "POST", payment, `/api/workstation/expenses/${expenseId}/payment`,
    ), expenseId, wrongPaidAt)).status).toBe(503);
  });

  it("requires a bounded cancellation reason and never accepts an actor", async () => {
    const deps = dependencies(null);
    const response = await handleExpenseCancel(request(
      "POST", { expectedVersion: 1, reason: "  ", actorEmployeeId: ownerEmployeeId },
      `/api/workstation/expenses/${expenseId}/cancel`,
    ), expenseId, deps);
    expect(response.status).toBe(400);
    expect(deps.rpc).not.toHaveBeenCalled();
  });

  it("maps optimistic conflicts to refresh-required status", async () => {
    const deps = dependencies({ outcome: "failure", error: "conflict" });
    const response = await handleExpenseSubmission(request(
      "POST", { expectedVersion: 1 }, `/api/workstation/expenses/${expenseId}/submit`,
    ), expenseId, deps);
    expect(response.status).toBe(409);
  });

  it("accepts only a cancelled terminal response for cancellation", async () => {
    const cancelled = dependencies(success("cancelled", 2));
    const response = await handleExpenseCancel(request(
      "POST", { expectedVersion: 1, reason: "重复提交" },
      `/api/workstation/expenses/${expenseId}/cancel`,
    ), expenseId, cancelled);
    expect(response.status).toBe(200);
    const drift = dependencies(success("draft", 2));
    expect((await handleExpenseCancel(request(
      "POST", { expectedVersion: 1, reason: "重复提交" },
      `/api/workstation/expenses/${expenseId}/cancel`,
    ), expenseId, drift)).status).toBe(503);
  });

  it("rejects a draft response to a successful submit command", async () => {
    const deps = dependencies(success("draft", 2));
    const response = await handleExpenseSubmission(request(
      "POST", { expectedVersion: 1 }, `/api/workstation/expenses/${expenseId}/submit`,
    ), expenseId, deps);
    expect(response.status).toBe(503);
  });

  it("rejects noncanonical padded descriptions in lifecycle responses", async () => {
    const deps = dependencies(success("submitted", 2, {
      description: ` ${"x".repeat(500)} `,
    }));
    const response = await handleExpenseSubmission(request(
      "POST", { expectedVersion: 1 }, `/api/workstation/expenses/${expenseId}/submit`,
    ), expenseId, deps);
    expect(response.status).toBe(503);
  });

  it("fails closed when a successful response is not bound to the requested version", async () => {
    const deps = dependencies(success("submitted", 3));
    const response = await handleExpenseSubmission(request(
      "POST", { expectedVersion: 1 }, `/api/workstation/expenses/${expenseId}/submit`,
    ), expenseId, deps);
    expect(response.status).toBe(503);
  });

  it("distinguishes missing authentication from an inactive workspace member", async () => {
    const noSession = dependencies(null, null);
    const unauthorized = await handleExpenseCollection(request("POST", draftInput), noSession);
    expect(unauthorized.status).toBe(401);
    const inactive = dependencies(null, { member: { status: "suspended" }, permissionCodes: [] });
    const forbidden = await handleExpenseCollection(request("POST", draftInput), inactive);
    expect(forbidden.status).toBe(403);
    expect(inactive.rpc).not.toHaveBeenCalled();
  });
});
