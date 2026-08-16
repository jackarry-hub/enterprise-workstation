import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LoginCard } from "@/features/auth/login-card";

describe("LoginCard", () => {
  it("shows exactly one clear Feishu login action", () => {
    render(<LoginCard action={vi.fn()} errorCode={null} />);

    expect(
      screen.getByRole("heading", { name: "登录量子智枢" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "使用飞书登录" }),
    ).toBeVisible();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByLabelText(/邮箱|密码/)).not.toBeInTheDocument();
    expect(screen.getByText("仅限量子星河内部员工使用")).toBeVisible();
  });

  it("shows only approved plain-language errors", () => {
    const { rerender } = render(
      <LoginCard action={vi.fn()} errorCode="login_unavailable" />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "登录服务暂时不可用，请稍后重试。",
    );

    rerender(
      <LoginCard
        action={vi.fn()}
        errorCode="OAuth RPC JWT open_id union_id tenant_key provider_token SQL"
      />,
    );

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(
      /OAuth|RPC|JWT|open_id|union_id|tenant_key|provider[_ ]token|SQL/i,
    );
  });

  it.each(["constructor", "toString", "__proto__", "unknown_error"])(
    "renders no technical error for non-whitelisted code %s",
    (errorCode) => {
      expect(() => {
        render(<LoginCard action={vi.fn()} errorCode={errorCode} />);
      }).not.toThrow();

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(document.body).not.toHaveTextContent(
        /function Object|native code|\[object Object\]/i,
      );
    },
  );
});
