import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import AccessPendingPage from "@/app/access-pending/page";

describe("AccessPendingPage", () => {
  it.each([
    ["not_provisioned", "你的飞书账号尚未开通企业工作站，请联系管理员。"],
    ["suspended", "你的工作站账号已暂停，请联系人事或管理员。"],
    ["departed", "该员工账号已停用，无法进入工作站。"],
  ])("shows the distinct %s access reason", async (reason, message) => {
    render(
      await AccessPendingPage({
        searchParams: Promise.resolve({ reason }),
      }),
    );

    expect(screen.getByText(message)).toBeVisible();
  });

  it("shows a distinct human message for revoked access", async () => {
    render(
      await AccessPendingPage({
        searchParams: Promise.resolve({ reason: "revoked" }),
      }),
    );

    expect(
      screen.getByText("你的工作站访问已撤销，请联系管理员。"),
    ).toBeVisible();
    expect(document.body).not.toHaveTextContent("已暂停或撤销");
  });

  it.each(["constructor", "toString", "__proto__", "unknown"])(
    "uses safe human fallback copy for non-whitelisted reason %s",
    async (reason) => {
      render(
        await AccessPendingPage({
          searchParams: Promise.resolve({ reason }),
        }),
      );

      expect(
        screen.getByText("账号身份信息异常，请联系管理员处理。"),
      ).toBeVisible();
      expect(screen.getByRole("link", { name: "返回登录" })).toBeVisible();
    },
  );
});
