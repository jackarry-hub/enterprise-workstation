import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { CustomersPage } from "@/features/customers/customers-page";

describe("CustomersPage", () => {
  beforeEach(() => window.localStorage.clear());
  it("renders the approved customer management structure", () => {
    render(<CustomersPage />);

    expect(screen.getByRole("heading", { name: "客户管理" })).toBeVisible();
    expect(screen.getByRole("button", { name: "新建客户" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "客户列表" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "销售漏斗" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "待跟进提醒" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "客户动态" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "客户来源分布" })).toBeVisible();
  });

  it("creates a persistent customer and saves follow-up activity", async () => {
    const user = userEvent.setup();
    render(<CustomersPage />);
    const initialCount = screen.getByTestId("customer-total").textContent;

    await user.click(screen.getByRole("button", { name: "新建客户" }));
    const dialog = screen.getByRole("dialog", { name: "新建客户" });
    await user.type(within(dialog).getByLabelText("客户名称"), "新客户科技");
    await user.type(within(dialog).getByLabelText("联系人"), "陈敏");
    await user.click(within(dialog).getByRole("button", { name: "保存客户" }));

    expect(screen.getAllByText("新客户科技").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId("customer-total").textContent).not.toBe(initialCount);
    expect(window.localStorage.getItem("enterprise-workspace.customers.v1")).toContain("新客户科技");

    await user.click(screen.getAllByRole("button", { name: "查看客户详情：新客户科技" })[0]);
    const detailDialog = screen.getByRole("dialog");
    await user.type(within(detailDialog).getByLabelText("新增客户跟进记录"), "已完成需求访谈，周五提交方案");
    await user.click(within(detailDialog).getByRole("button", { name: "保存跟进" }));
    expect(within(detailDialog).getByText("已完成需求访谈，周五提交方案")).toBeVisible();
    expect(window.localStorage.getItem("enterprise-workspace.customers.v1")).toContain("已完成需求访谈");
  });

  it("keeps the create dialog open when required fields are missing", async () => {
    const user = userEvent.setup();
    render(<CustomersPage />);

    await user.click(screen.getByRole("button", { name: "新建客户" }));
    const dialog = screen.getByRole("dialog", { name: "新建客户" });
    await user.click(within(dialog).getByRole("button", { name: "保存客户" }));

    expect(within(dialog).getByRole("alert")).toHaveTextContent("请填写客户名称和联系人");
  });

  it("renders a completed deal as status instead of an unusable action", async () => {
    const user = userEvent.setup();
    render(<CustomersPage />);

    await user.click(screen.getAllByRole("button", { name: "查看客户详情：博远软件股份有限公司" })[0]);
    const dialog = screen.getByRole("dialog");

    expect(within(dialog).getByText("已成交")).toBeVisible();
    expect(within(dialog).queryByRole("button", { name: "已成交" })).not.toBeInTheDocument();
  });
});
