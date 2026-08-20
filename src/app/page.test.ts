import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  getWorkspaceSession: vi.fn(),
  redirect: vi.fn((href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`);
  }),
}));

vi.mock("@/features/auth/workspace-session", () => ({
  getWorkspaceSession: dependencies.getWorkspaceSession,
}));

vi.mock("next/navigation", () => ({ redirect: dependencies.redirect }));

import Home from "@/app/page";

describe("Home", () => {
  beforeEach(() => {
    dependencies.getWorkspaceSession.mockReset();
    dependencies.redirect.mockClear();
  });

  it("redirects session lookup failures to a safe configuration status", async () => {
    dependencies.getWorkspaceSession.mockRejectedValue(
      new Error("database provider token detail"),
    );

    await expect(Home()).rejects.toThrow(
      "NEXT_REDIRECT:/access-pending?reason=configuration_error",
    );
    expect(dependencies.redirect).toHaveBeenCalledWith(
      "/access-pending?reason=configuration_error",
    );
  });

  it("does not swallow the redirect to an authenticated landing page", async () => {
    dependencies.getWorkspaceSession.mockResolvedValue({
      landingPath: "/execution",
    });

    await expect(Home()).rejects.toThrow(
      "NEXT_REDIRECT:/quantxy-ai-workbench-fused.html?formal=1",
    );
  });
});
