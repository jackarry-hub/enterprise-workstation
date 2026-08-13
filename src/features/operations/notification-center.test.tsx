import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { NotificationCenter } from "@/features/operations/notification-center";
import { renderWithWorkspaceSession as render } from "@/test/workspace-session-test-utils";

describe("NotificationCenter", () => {
  beforeEach(() => window.localStorage.clear());

  it("removes the bulk action after every notification is read", async () => {
    const user = userEvent.setup();
    render(<NotificationCenter />);

    await user.click(screen.getByRole("button", { name: "全部标为已读" }));

    expect(screen.queryByRole("button", { name: "全部标为已读" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "未读通知已清零" })).toBeVisible();
  });
});
