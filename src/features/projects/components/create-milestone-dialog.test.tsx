import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getProjectDetailMock, mockProjects } from "@/features/projects/mock-data";

const mocks = vi.hoisted(() => ({ createProjectMilestone: vi.fn() }));

vi.mock("@/features/projects/actions/create-project-milestone", () => ({
  createProjectMilestone: mocks.createProjectMilestone,
}));

import { CreateMilestoneDialog } from "@/features/projects/components/create-milestone-dialog";

const baseDetail = getProjectDetailMock(mockProjects[0].id);
const employeeId = "87000000-0000-4000-8000-000000000021";

if (!baseDetail) throw new Error("Expected project fixture.");

const detail = {
  ...baseDetail,
  members: baseDetail.members.map((membership, index) => ({
    ...membership,
    member: {
      ...membership.member,
      employeePublicId: index === 0
        ? employeeId
        : `87000000-0000-4000-8000-${String(index + 22).padStart(12, "0")}`,
    },
  })),
};

function renderDialog() {
  const onClose = vi.fn();
  const onCreated = vi.fn();
  render(
    <CreateMilestoneDialog
      detail={detail}
      open
      nextSortOrder={3}
      allowLocalFallback={false}
      onClose={onClose}
      onCreated={onCreated}
    />,
  );
  return { onClose, onCreated };
}

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  const dialog = screen.getByRole("dialog", { name: "新增里程碑" });
  await user.type(within(dialog).getByLabelText("阶段名称"), "正式验收");
  await user.type(within(dialog).getByLabelText("截止时间"), "2026-09-30");
  await user.click(within(dialog).getByRole("button", { name: "创建里程碑" }));
  return dialog;
}

describe("CreateMilestoneDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("submits the employee profile public id instead of the organization member id", async () => {
    const user = userEvent.setup();
    mocks.createProjectMilestone.mockResolvedValue({
      ok: true,
      milestone: {
        id: "87000000-0000-4000-8000-000000000031",
        organizationId: "1",
        projectId: detail.project.id,
        ownerId: employeeId,
        name: "正式验收",
        description: "",
        status: "pending",
        startDate: undefined,
        dueDate: "2026-09-30",
        progress: 0,
        sortOrder: 3,
        createdAt: "2026-08-27T10:00:00.000Z",
        updatedAt: "2026-08-27T10:00:00.000Z",
      },
    });
    const { onCreated } = renderDialog();

    await fillAndSubmit(user);

    expect(mocks.createProjectMilestone).toHaveBeenCalledWith(expect.objectContaining({
      ownerPublicId: employeeId,
    }));
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: detail.members[0].member.id,
    }));
  });

  it("keeps the dialog and the same key during an ambiguous retry", async () => {
    const user = userEvent.setup();
    mocks.createProjectMilestone.mockResolvedValue({
      ok: false,
      reason: "ambiguous",
      message: "未能确认本次保存结果，请保持页面打开并使用原请求重试。",
    });
    renderDialog();

    const dialog = await fillAndSubmit(user);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("未能确认");
    const firstKey = mocks.createProjectMilestone.mock.calls[0]?.[0].idempotencyKey;

    await user.click(within(dialog).getByRole("button", { name: "创建里程碑" }));

    expect(mocks.createProjectMilestone).toHaveBeenCalledTimes(2);
    expect(mocks.createProjectMilestone.mock.calls[1]?.[0].idempotencyKey).toBe(firstKey);
  });

  it("prevents dismissal while pending and rotates the key after a definitive failure", async () => {
    const user = userEvent.setup();
    let resolvePending: (value: unknown) => void = () => undefined;
    mocks.createProjectMilestone.mockReturnValueOnce(new Promise((resolve) => {
      resolvePending = resolve;
    }));
    const { onClose } = renderDialog();
    const dialog = screen.getByRole("dialog", { name: "新增里程碑" });
    await user.type(within(dialog).getByLabelText("阶段名称"), "正式验收");
    await user.type(within(dialog).getByLabelText("截止时间"), "2026-09-30");
    await user.click(within(dialog).getByRole("button", { name: "创建里程碑" }));
    const firstKey = mocks.createProjectMilestone.mock.calls[0]?.[0].idempotencyKey;

    expect(within(dialog).getByRole("button", { name: "取消" })).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();

    resolvePending({ ok: false, reason: "not_found", message: "项目或负责人已变更，请刷新后重试。" });
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("已变更");
    mocks.createProjectMilestone.mockResolvedValueOnce({
      ok: false,
      reason: "not_found",
      message: "项目或负责人已变更，请刷新后重试。",
    });
    await user.click(within(dialog).getByRole("button", { name: "创建里程碑" }));

    expect(mocks.createProjectMilestone.mock.calls[1]?.[0].idempotencyKey).not.toBe(firstKey);
  });
});
