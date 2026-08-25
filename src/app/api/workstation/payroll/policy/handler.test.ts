import { describe, expect, it, vi } from "vitest";

import {
  buildPayrollActivationExample,
  createPayrollPolicyHandler,
  type PayrollPolicyPersistenceInput,
  type PayrollPolicyRecord,
} from "@/app/api/workstation/payroll/policy/handler";

const policyBody = {
  effectiveMonth: "2026-08",
  pensionEmployeeRate: "8",
  medicalEmployeeRate: "2",
  medicalEmployeeFixedAmount: "2.00",
  unemploymentEmployeeRate: "0.5",
  housingFundEmployeeRate: "7",
  socialBaseMin: "4000.00",
  socialBaseMax: "22000.00",
  housingBaseMin: "4000.00",
  housingBaseMax: "22000.00",
};

const draftPolicy: PayrollPolicyRecord = {
  publicId: "11111111-1111-4111-8111-111111111111",
  status: "draft",
  effectiveMonth: "2026-08",
  pensionEmployeeRate: "0.080000",
  medicalEmployeeRate: "0.020000",
  medicalEmployeeFixedAmount: "2.00",
  unemploymentEmployeeRate: "0.005000",
  housingFundEmployeeRate: "0.070000",
  socialBaseMin: "4000.00",
  socialBaseMax: "22000.00",
  housingBaseMin: "4000.00",
  housingBaseMax: "22000.00",
  createdAt: "2026-08-21T08:00:00.000Z",
  activatedAt: null,
};

const normalizedPolicy: PayrollPolicyPersistenceInput = {
  actorMemberId: 7,
  action: "saveDraft",
  ...policyBody,
  pensionEmployeeRate: "0.080000",
  medicalEmployeeRate: "0.020000",
  unemploymentEmployeeRate: "0.005000",
  housingFundEmployeeRate: "0.070000",
  exampleConfirmationHash: null,
};

function activationExample(confirmationHash: string) {
  return {
    ...buildPayrollActivationExample(normalizedPolicy),
    confirmationHash,
  };
}

function policyRequest(value: unknown) {
  return new Request("https://workspace.test/api/workstation/payroll/policy", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
}

function authorized(overrides: Partial<{
  loadPolicies: () => Promise<PayrollPolicyRecord[]>;
  buildActivationExample: (
    policy: PayrollPolicyPersistenceInput,
  ) => Promise<ReturnType<typeof buildPayrollActivationExample>>;
  savePolicy: (input: PayrollPolicyPersistenceInput) => Promise<unknown>;
}> = {}) {
  return createPayrollPolicyHandler({
    loadSession: async () => ({
      member: { id: 7 },
      permissionCodes: ["salary.manage"],
    }),
    loadPolicies: overrides.loadPolicies ?? (async () => []),
    buildActivationExample: overrides.buildActivationExample
      ?? (async (policy) => buildPayrollActivationExample(policy)),
    savePolicy: overrides.savePolicy ?? (async () => ({ status: "saved" })),
  });
}

describe("payroll policy API", () => {
  it("requires an authenticated salary manager", async () => {
    const loadPolicies = vi.fn();
    const savePolicy = vi.fn();
    const anonymous = createPayrollPolicyHandler({
      loadSession: async () => null,
      loadPolicies,
      buildActivationExample: async (policy) => buildPayrollActivationExample(policy),
      savePolicy,
    });
    const employee = createPayrollPolicyHandler({
      loadSession: async () => ({
        member: { id: 8 },
        permissionCodes: ["salary.self"],
      }),
      loadPolicies,
      buildActivationExample: async (policy) => buildPayrollActivationExample(policy),
      savePolicy,
    });

    expect((await anonymous.GET()).status).toBe(401);
    expect((await employee.GET()).status).toBe(403);
    expect((await employee.PUT(policyRequest({
      action: "saveDraft",
      ...policyBody,
    }))).status).toBe(403);
    expect(loadPolicies).not.toHaveBeenCalled();
    expect(savePolicy).not.toHaveBeenCalled();
  });

  it("returns UI percentages, version history, and a draft activation example", async () => {
    const buildActivationExample = vi.fn(async () => (
      activationExample("a".repeat(64))
    ));
    const handler = authorized({
      loadPolicies: async () => [
        draftPolicy,
        {
          ...draftPolicy,
          publicId: "22222222-2222-4222-8222-222222222222",
          status: "active",
          createdAt: "2026-08-20T08:00:00.000Z",
          activatedAt: "2026-08-20T09:00:00.000Z",
        },
      ],
      buildActivationExample,
    });

    const response = await handler.GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body.active).toMatchObject({
      status: "active",
      pensionEmployeeRate: "8",
      unemploymentEmployeeRate: "0.5",
    });
    expect(body.history).toHaveLength(2);
    expect(body.draftExample).toMatchObject({ confirmationHash: "a".repeat(64) });
    expect(buildActivationExample).toHaveBeenCalledTimes(1);
  });

  it("normalizes percentage rates and money before saving a draft", async () => {
    const buildActivationExample = vi.fn(async () => (
      activationExample("c".repeat(64))
    ));
    const savePolicy = vi.fn().mockResolvedValue({
      status: "draft",
      publicId: draftPolicy.publicId,
    });
    const handler = authorized({ buildActivationExample, savePolicy });

    const response = await handler.PUT(policyRequest({
      action: "saveDraft",
      ...policyBody,
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(savePolicy).toHaveBeenCalledWith({
      actorMemberId: 7,
      action: "saveDraft",
      ...policyBody,
      pensionEmployeeRate: "0.080000",
      medicalEmployeeRate: "0.020000",
      unemploymentEmployeeRate: "0.005000",
      housingFundEmployeeRate: "0.070000",
      exampleConfirmationHash: null,
    });
    expect(buildActivationExample).toHaveBeenCalledWith(expect.objectContaining({
      actorMemberId: 7,
      action: "saveDraft",
    }));
    expect(body).toMatchObject({
      status: "draft",
      publicId: draftPolicy.publicId,
      draftExample: { confirmationHash: "c".repeat(64) },
    });
  });

  it("rejects activation when the example confirmation does not match", async () => {
    const savePolicy = vi.fn();
    const handler = authorized({
      buildActivationExample: async () => ({
        ...activationExample("a".repeat(64)),
      }),
      savePolicy,
    });

    const response = await handler.PUT(policyRequest({
      action: "activate",
      exampleConfirmationHash: "b".repeat(64),
      ...policyBody,
    }));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "activation_example_mismatch" });
    expect(savePolicy).not.toHaveBeenCalled();
  });

  it("activates a validated policy version", async () => {
    const savePolicy = vi.fn().mockResolvedValue({ status: "active" });
    const handler = authorized({
      buildActivationExample: async () => ({
        ...activationExample("a".repeat(64)),
      }),
      savePolicy,
    });

    const response = await handler.PUT(policyRequest({
      action: "activate",
      exampleConfirmationHash: "a".repeat(64),
      ...policyBody,
    }));

    expect(response.status).toBe(200);
    expect(savePolicy).toHaveBeenCalledWith(expect.objectContaining({
      actorMemberId: 7,
      action: "activate",
      pensionEmployeeRate: "0.080000",
      exampleConfirmationHash: "a".repeat(64),
    }));
  });

  it.each([
    [{ ...policyBody, pensionEmployeeRate: "100.0001" }, "invalid_rate"],
    [{ ...policyBody, socialBaseMin: "23000.00" }, "invalid_base_range"],
    [{ ...policyBody, effectiveMonth: "2026-13" }, "invalid_month"],
  ])("rejects invalid policy input", async (body, error) => {
    const savePolicy = vi.fn();
    const response = await authorized({ savePolicy }).PUT(policyRequest({
      action: "saveDraft",
      ...body,
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error });
    expect(savePolicy).not.toHaveBeenCalled();
  });

  it("builds a deterministic example without exposing employee data", () => {
    const first = buildPayrollActivationExample(normalizedPolicy);
    const second = buildPayrollActivationExample(normalizedPolicy);

    expect(first.confirmationHash).toMatch(/^[0-9a-f]{64}$/);
    expect(first).toEqual(second);
    expect(first.sample).toMatchObject({ grossSalary: "10000.00" });
    expect(JSON.stringify(first)).not.toContain("memberId");
  });
});
