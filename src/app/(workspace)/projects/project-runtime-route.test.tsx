import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  loadProjectDetail: vi.fn(),
}));

vi.mock("@/features/demo/customer-demo-mode", () => ({
  isCustomerDemoMode: () => true,
}));

vi.mock("@/features/projects/data/project-detail-data", () => ({
  loadProjectDetail: dependencies.loadProjectDetail,
}));

import ProjectDetailRoute from "@/app/(workspace)/projects/[id]/page";

describe("runtime demo project route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("leaves dynamic workstream details to the browser repository", async () => {
    const output = await ProjectDetailRoute({
      params: Promise.resolve({ id: "project-dept-knowledge-base" }),
    });

    expect(dependencies.loadProjectDetail).not.toHaveBeenCalled();
    expect(output.props.initialResult).toBeUndefined();
  });
});
