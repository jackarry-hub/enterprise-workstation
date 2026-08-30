import { render, screen } from "@testing-library/react";
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

import LoginPage from "@/app/login/page";

describe("LoginPage", () => {
  beforeEach(() => {
    dependencies.getWorkspaceSession.mockReset();
    dependencies.redirect.mockClear();
  });

  it("renders a safe login error when session lookup fails", async () => {
    dependencies.getWorkspaceSession.mockRejectedValue(
      new Error("database provider token detail"),
    );

    render(await LoginPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "登录服务暂时不可用，请稍后重试。",
    );
    expect(
      screen.getByRole("link", { name: "使用飞书登录" }),
    ).toBeVisible();
    expect(document.body).not.toHaveTextContent(
      /database|provider token/i,
    );
    expect(dependencies.redirect).not.toHaveBeenCalled();
  });

  it("does not swallow the redirect for an existing session", async () => {
    dependencies.getWorkspaceSession.mockResolvedValue({
      landingPath: "/finance",
    });

    await expect(
      LoginPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow(
      "NEXT_REDIRECT:/finance",
    );
  });
});
