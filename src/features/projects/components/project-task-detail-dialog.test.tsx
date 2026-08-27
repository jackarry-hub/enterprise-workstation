import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ProjectTaskDetailDialog } from "@/features/projects/components/project-task-detail-dialog";
import { getProjectDetailMock, mockProjects } from "@/features/projects/mock-data";
import { executiveWorkspaceSession } from "@/test/workspace-session-test-utils";

describe("ProjectTaskDetailDialog idempotency", () => {
  it("keeps comment and workflow retry identities independent after an unconfirmed comment", async () => {
    const user = userEvent.setup();
    const detail = getProjectDetailMock(mockProjects[0].id)!;
    const task = {
      ...detail.tasks.find(({ status, assigneeId }) => status === "in_progress" && assigneeId)!,
      version: 3,
    };
    const onComment = vi.fn()
      .mockRejectedValueOnce(new Error("评论响应未确认"))
      .mockResolvedValueOnce(undefined);
    const onTransition = vi.fn().mockResolvedValue(undefined);
    const actor = { ...executiveWorkspaceSession.actor, memberId: task.assigneeId! };

    render(<ProjectTaskDetailDialog
      actor={actor}
      task={task}
      detail={detail}
      open
      onOpenChange={vi.fn()}
      onComment={onComment}
      onTransition={onTransition}
      workflowManaged
    />);

    await user.type(screen.getByLabelText("任务评论内容"), "需要保留同一幂等键的评论");
    await user.click(screen.getByRole("button", { name: "添加评论" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("评论响应未确认");

    await user.click(screen.getByRole("button", { name: "保存进度" }));
    await waitFor(() => expect(onTransition).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "添加评论" }));
    await waitFor(() => expect(onComment).toHaveBeenCalledTimes(2));

    expect(onComment.mock.calls[0]?.[2]).toBe(onComment.mock.calls[1]?.[2]);
    expect(onTransition.mock.calls[0]?.[2]).not.toBe(onComment.mock.calls[0]?.[2]);
  });
});
