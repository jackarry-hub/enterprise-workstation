import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  revalidatePath: vi.fn(),
  hasSupabaseEnv: vi.fn(() => true),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/supabase/env", () => ({ hasSupabaseEnv: mocks.hasSupabaseEnv }));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: async () => ({ rpc: mocks.rpc }),
}));

import { createProjectMilestone } from "@/features/projects/actions/create-project-milestone";

const projectId = "87000000-0000-4000-8000-000000000001";
const employeeId = "87000000-0000-4000-8000-000000000002";
const key = "87000000-0000-4000-8000-000000000003";
const milestoneId = "87000000-0000-4000-8000-000000000004";

const input = {
  projectPublicId: projectId,
  ownerPublicId: employeeId,
  idempotencyKey: key,
  name: "商业验收",
  startDate: "2026-09-01",
  dueDate: "2026-09-30",
  progress: 0,
};

function successResponse(overrides: Record<string, unknown> = {}) {
  const entity = {
    id: milestoneId,
    organizationId: "9",
    projectId,
    ownerPublicId: employeeId,
    name: "商业验收",
    description: "",
    status: "pending",
    startDate: "2026-09-01",
    dueDate: "2026-09-30",
    progress: 0,
    sortOrder: 1,
    version: 1,
    createdAt: "2026-08-27T10:00:00.000Z",
    updatedAt: "2026-08-27T10:00:00.000Z",
    ...overrides,
  };
  return {
    data: { outcome: "success", resource: "milestone", id: milestoneId, version: 1, entity },
    error: null,
  };
}

describe("createProjectMilestone", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.hasSupabaseEnv.mockReturnValue(true);
  });

  it("uses the employee profile public id and accepts only a bound canonical response", async () => {
    mocks.rpc.mockResolvedValue(successResponse());

    const result = await createProjectMilestone(input);

    expect(result).toEqual({
      ok: true,
      milestone: expect.objectContaining({ id: milestoneId, projectId, ownerId: employeeId, status: "pending" }),
    });
    expect(mocks.rpc).toHaveBeenCalledWith("create_current_project_milestone", expect.objectContaining({
      p_project_public_id: projectId,
      p_owner_employee_public_id: employeeId,
      idempotency_key: key,
    }));
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/projects/${projectId}`);
  });

  it("rejects coercible progress and impossible calendar dates before RPC", async () => {
    const coerced = await createProjectMilestone({ ...input, progress: "10" } as never);
    const impossible = await createProjectMilestone({ ...input, dueDate: "2026-02-30" });

    expect(coerced).toEqual(expect.objectContaining({ ok: false, reason: "invalid" }));
    expect(impossible).toEqual(expect.objectContaining({ ok: false, reason: "invalid" }));
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("returns a definitive business failure separately from an ambiguous response", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { outcome: "failure", error: "not_found" }, error: null });
    const missing = await createProjectMilestone(input);
    mocks.rpc.mockResolvedValueOnce(successResponse({ id: "87000000-0000-4000-8000-000000000099" }));
    const malformed = await createProjectMilestone(input);

    expect(missing).toEqual(expect.objectContaining({ ok: false, reason: "not_found" }));
    expect(malformed).toEqual(expect.objectContaining({ ok: false, reason: "ambiguous" }));
  });

  it("does not coerce an array-shaped status into a canonical enum", async () => {
    mocks.rpc.mockResolvedValue(successResponse({ status: ["pending"] }));

    const result = await createProjectMilestone(input);

    expect(result).toEqual(expect.objectContaining({ ok: false, reason: "ambiguous" }));
  });

  it("keeps formal mode explicit when Supabase is unconfigured", async () => {
    mocks.hasSupabaseEnv.mockReturnValue(false);

    const result = await createProjectMilestone(input);

    expect(result).toEqual(expect.objectContaining({ ok: false, reason: "unavailable" }));
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
