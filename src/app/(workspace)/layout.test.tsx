import { describe, expect, it, vi } from "vitest";

import { executiveWorkspaceSession } from "@/test/workspace-session-test-utils";

const dependencies = vi.hoisted(() => ({
  headers: vi.fn(),
  redirect: vi.fn((href: string) => {
    throw new Error(`NEXT_REDIRECT:${href}`);
  }),
  requireWorkspaceSession: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: dependencies.headers }));
vi.mock("next/navigation", () => ({ redirect: dependencies.redirect }));
vi.mock("@/features/auth/workspace-session", () => ({
  requireWorkspaceSession: dependencies.requireWorkspaceSession,
}));
vi.mock("@/components/shell/workspace-shell", () => ({
  WorkspaceShell: ({ children }: { children: React.ReactNode }) => children,
}));

import WorkspaceLayout from "@/app/(workspace)/layout";

describe("workspace server layout", () => {
  it("rejects a direct workspace URL the verified session cannot access", async () => {
    dependencies.requireWorkspaceSession.mockResolvedValue({
      ...executiveWorkspaceSession,
      roleCodes: ["employee"],
      primaryRole: "employee",
      landingPath: "/execution",
      permissionCodes: ["task.execute"],
      actor: {
        ...executiveWorkspaceSession.actor,
        role: "employee",
        landingPath: "/execution",
      },
    });
    dependencies.headers.mockResolvedValue(new Headers({
      "x-quantxy-workspace-path": "/settings",
    }));

    await expect(WorkspaceLayout({ children: <p>private</p> })).rejects
      .toThrow("NEXT_REDIRECT:/access-pending?reason=no_access");
    expect(dependencies.redirect).toHaveBeenCalledWith("/access-pending?reason=no_access");
  });
});
