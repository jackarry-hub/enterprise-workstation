import { afterEach, describe, expect, it, vi } from "vitest";

import { getProjectHref } from "@/features/projects/project-navigation";

afterEach(() => vi.unstubAllEnvs());

describe("getProjectHref", () => {
  it("keeps generated project routes on the full service build", () => {
    vi.stubEnv("NEXT_PUBLIC_STATIC_AI_DEMO", "false");
    expect(getProjectHref("runtime-project", { tab: "tasks", task: "task-1" }))
      .toBe("/projects/runtime-project?tab=tasks&task=task-1");
  });

  it("uses the static projects page for runtime projects on GitHub Pages", () => {
    vi.stubEnv("NEXT_PUBLIC_STATIC_AI_DEMO", "true");
    expect(getProjectHref("runtime-project", { tab: "tasks", task: "task-1" }))
      .toBe("/projects?project=runtime-project&tab=tasks&task=task-1");
  });

  it("keeps statically generated project detail routes on GitHub Pages", () => {
    vi.stubEnv("NEXT_PUBLIC_STATIC_AI_DEMO", "true");
    expect(getProjectHref("40000000-0000-4000-8000-000000000001"))
      .toBe("/projects/40000000-0000-4000-8000-000000000001");
  });
});
