import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CustomersPage } from "@/features/customers/customers-page";
import type { CustomerWorkspaceResult } from "@/features/customers/customer-types";

const refresh = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push }) }));

const result: CustomerWorkspaceResult = {
  source: "supabase",
  data: {
    canManage: true,
    canConvertToProject: true,
    filters: { query: "", status: "all", source: "all", industry: "all" },
    industryOptions: ["企业服务"],
    pagination: { page: 1, pageSize: 30, total: 1, hasPrevious: false, hasNext: false },
    availableOwners: [{
      id: "20000000-0000-4000-8000-000000000001",
      employeePublicId: "20000000-0000-4000-8000-000000000002",
      commandId: "m10", displayName: "真实负责人", department: "客户成功部", title: "客户经理",
    }],
    customers: [{
      id: "10000000-0000-4000-8000-000000000001", version: 2, name: "数据库真实客户",
      registrationCode: "91310000REAL", owner: {
        id: "20000000-0000-4000-8000-000000000001",
        employeePublicId: "20000000-0000-4000-8000-000000000002",
        commandId: "m10", displayName: "真实负责人", department: "客户成功部", title: "客户经理",
      },
      contact: {
        id: "30000000-0000-4000-8000-000000000001", version: 1, name: "陈总", title: "信息总监",
        phone: "13800000000", email: "chen@example.com", visibility: "assigned", isPrimary: true,
        createdAt: "2026-08-28T01:00:00Z", updatedAt: "2026-08-28T01:00:00Z",
      },
      contacts: [{
        id: "30000000-0000-4000-8000-000000000001", version: 1, name: "陈总", title: "信息总监",
        phone: "13800000000", email: "chen@example.com", visibility: "assigned", isPrimary: true,
        createdAt: "2026-08-28T01:00:00Z", updatedAt: "2026-08-28T01:00:00Z",
      }],
      status: "following", source: "consulting", industry: "企业服务", region: "上海",
      lastContactAt: "2026-08-28T02:00:00Z", nextFollowUpAt: "2026-08-29T02:00:00Z",
      dealProgress: 40, dealAmount: "0.00", createdAt: "2026-08-28T00:00:00Z", updatedAt: "2026-08-28T02:00:00Z",
      relatedProjects: [], opportunities: [], activities: [], detailState: "summary",
    }],
  },
};

describe("CustomersPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    refresh.mockReset();
    push.mockReset();
    vi.restoreAllMocks();
  });

  it("renders only server-provided customers and never reads business local storage", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    render(<CustomersPage result={result} />);

    expect(screen.getByRole("heading", { name: "客户管理" })).toBeVisible();
    expect(screen.getAllByText("数据库真实客户").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("星河科技有限公司")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建客户" })).toBeVisible();
    expect(getItem).not.toHaveBeenCalled();
  });

  it("submits customer-name search through the server URL", async () => {
    const user = userEvent.setup();
    render(<CustomersPage result={result} />);
    await user.type(screen.getByRole("searchbox", { name: "搜索客户" }), "数据库");
    await waitFor(() => expect(push).toHaveBeenLastCalledWith("/customers?q=%E6%95%B0%E6%8D%AE%E5%BA%93"));
  });

  it("waits for both customer and primary-contact commands before reporting success", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        outcome: "success", resource: "customer", customer: { id: "40000000-0000-4000-8000-000000000001", version: 1 },
      }), { status: 201, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        outcome: "success", resource: "customer_contact", contact: {
          id: "50000000-0000-4000-8000-000000000001", customerId: "40000000-0000-4000-8000-000000000001", version: 1,
        },
      }), { status: 201, headers: { "Content-Type": "application/json" } }));
    render(<CustomersPage result={result} />);

    await user.click(screen.getByRole("button", { name: "新建客户" }));
    const dialog = screen.getByRole("dialog", { name: "新建客户" });
    await user.type(within(dialog).getByLabelText("客户名称"), "新增真实客户");
    await user.type(within(dialog).getByLabelText("所属行业"), "专业服务");
    await user.type(within(dialog).getByLabelText("联系人"), "王经理");
    await user.type(within(dialog).getByLabelText("联系电话"), "13900000000");
    await user.click(within(dialog).getByRole("button", { name: "保存客户" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/workstation/customers");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/workstation/customers/40000000-0000-4000-8000-000000000001/contacts");
    expect(refresh).toHaveBeenCalledOnce();
    expect(window.localStorage.length).toBe(0);
  });

  it("keeps the dialog open when required real fields are missing", async () => {
    const user = userEvent.setup();
    render(<CustomersPage result={result} />);
    await user.click(screen.getByRole("button", { name: "新建客户" }));
    const dialog = screen.getByRole("dialog", { name: "新建客户" });
    await user.click(within(dialog).getByRole("button", { name: "保存客户" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("请完整填写客户");
  });

  it("reuses the idempotency key after an ambiguous network failure", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("socket closed"))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        outcome: "success", resource: "customer", customer: { id: "60000000-0000-4000-8000-000000000001", version: 1 },
      }), { status: 201, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ outcome: "success", resource: "customer_contact", contact: {
        id: "70000000-0000-4000-8000-000000000001", customerId: "60000000-0000-4000-8000-000000000001", version: 1,
      } }), { status: 201, headers: { "Content-Type": "application/json" } }));
    render(<CustomersPage result={result} />);
    await user.click(screen.getByRole("button", { name: "新建客户" }));
    const dialog = screen.getByRole("dialog", { name: "新建客户" });
    await user.type(within(dialog).getByLabelText("客户名称"), "网络重试客户");
    await user.type(within(dialog).getByLabelText("所属行业"), "企业服务");
    await user.type(within(dialog).getByLabelText("联系人"), "赵经理");
    await user.type(within(dialog).getByLabelText("联系电话"), "13700000000");
    await user.click(within(dialog).getByRole("button", { name: "保存客户" }));
    await screen.findByText("网络响应中断，保存结果尚未确认；请保持内容不变并重试核对。");
    await user.click(within(dialog).getByRole("button", { name: "保存客户" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    const firstHeaders = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    const retryHeaders = fetchMock.mock.calls[1][1]?.headers as Record<string, string>;
    expect(retryHeaders["Idempotency-Key"]).toBe(firstHeaders["Idempotency-Key"]);
  });

  it("does not accept an empty 2xx body as a completed customer command", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    render(<CustomersPage result={result} />);
    await user.click(screen.getByRole("button", { name: "新建客户" }));
    const dialog = screen.getByRole("dialog", { name: "新建客户" });
    await user.type(within(dialog).getByLabelText("客户名称"), "异常响应客户");
    await user.type(within(dialog).getByLabelText("所属行业"), "企业服务");
    await user.type(within(dialog).getByLabelText("联系人"), "钱经理");
    await user.type(within(dialog).getByLabelText("联系电话"), "13600000000");
    await user.click(within(dialog).getByRole("button", { name: "保存客户" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("服务响应不完整");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes a partially-created customer so contact recovery remains available", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        outcome: "success", resource: "customer", customer: { id: "80000000-0000-4000-8000-000000000001", version: 1 },
      }), { status: 201, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "customer_command_unavailable" }), {
        status: 503, headers: { "Content-Type": "application/json" },
      }));
    render(<CustomersPage result={result} />);
    await user.click(screen.getByRole("button", { name: "新建客户" }));
    const dialog = screen.getByRole("dialog", { name: "新建客户" });
    await user.type(within(dialog).getByLabelText("客户名称"), "待补联系人客户");
    await user.type(within(dialog).getByLabelText("所属行业"), "企业服务");
    await user.type(within(dialog).getByLabelText("联系人"), "孙经理");
    await user.type(within(dialog).getByLabelText("联系电话"), "13500000000");
    await user.click(within(dialog).getByRole("button", { name: "保存客户" }));
    await within(dialog).findByText("客户基础档案已锁定。请重试保存主联系人；也可以关闭后从客户详情补充。");
    await user.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(refresh).toHaveBeenCalledOnce();
    expect(await screen.findByRole("status")).toHaveTextContent("主联系人待补充");
  });

  it("rejects a valid-shaped contact response bound to another customer", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        outcome: "success", resource: "customer", customer: {
          id: "90000000-0000-4000-8000-000000000001", version: 1,
        },
      }), { status: 201, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        outcome: "success", resource: "customer_contact", contact: {
          id: "91000000-0000-4000-8000-000000000001",
          customerId: "92000000-0000-4000-8000-000000000001", version: 1,
        },
      }), { status: 201, headers: { "Content-Type": "application/json" } }));
    render(<CustomersPage result={result} />);
    await user.click(screen.getByRole("button", { name: "新建客户" }));
    const dialog = screen.getByRole("dialog", { name: "新建客户" });
    await user.type(within(dialog).getByLabelText("客户名称"), "交叉响应客户");
    await user.type(within(dialog).getByLabelText("所属行业"), "企业服务");
    await user.type(within(dialog).getByLabelText("联系人"), "周经理");
    await user.type(within(dialog).getByLabelText("联系电话"), "13400000000");
    await user.click(within(dialog).getByRole("button", { name: "保存客户" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("服务响应不完整");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("aborts an old detail request and ignores its late failure", async () => {
    const user = userEvent.setup();
    const secondCustomer = {
      ...result.data.customers[0],
      id: "10000000-0000-4000-8000-000000000002",
      name: "第二家真实客户",
    };
    let resolveFirst!: (response: Response) => void;
    let resolveSecond!: (response: Response) => void;
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveSecond = resolve; }));
    render(<CustomersPage result={{
      ...result,
      data: { ...result.data, customers: [...result.data.customers, secondCustomer],
        pagination: { ...result.data.pagination, total: 2 } },
    }} />);

    await user.click(screen.getAllByRole("button", { name: "查看客户详情：数据库真实客户" })[0]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const firstSignal = fetchMock.mock.calls[0][1]?.signal as AbortSignal;
    await user.keyboard("{Escape}");
    await waitFor(() => expect(firstSignal.aborted).toBe(true));
    await user.click(screen.getAllByRole("button", { name: "查看客户详情：第二家真实客户" })[0]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    resolveFirst(new Response(JSON.stringify({ error: "customer_read_unavailable" }), {
      status: 503, headers: { "Content-Type": "application/json" },
    }));
    await Promise.resolve();
    expect(screen.queryByText("客户详情暂时不可用，请重试。")).not.toBeInTheDocument();

    resolveSecond(new Response(JSON.stringify({
      outcome: "success", resource: "customer_detail",
      customer: { ...secondCustomer, detailState: "complete" },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveTextContent("第二家真实客户"));
    expect(screen.queryByText("客户详情暂时不可用，请重试。")).not.toBeInTheDocument();
  });

  it("renders an explicit unavailable state without presenting an empty business success", () => {
    render(<CustomersPage result={{ ...result, data: { ...result.data, customers: [], loadError: "客户查询失败" } }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("客户查询失败");
    expect(screen.getByRole("button", { name: "重新加载" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "客户列表" })).not.toBeInTheDocument();
  });
});
