import { describe, expect, it } from "vitest";

import { getMobilePriorityMeta, sortMobileTasksByPriority } from "@/features/mobile-workstation/mobile-priority";
import type { MobileTaskItem } from "@/features/mobile-workstation/mobile-workstation-types";

const item = (id: string, priority: MobileTaskItem["priority"], dueDate: string, status: MobileTaskItem["status"] = "pending"): MobileTaskItem => ({
  id, title: id, assigneeName: "张伟", dueDate, status, priority, progress: 0, href: `/tasks#${id}`, initiatedByViewer: false,
});

describe("mobile task priority", () => {
  it("sorts overdue first, then urgent, high, and remaining work by deadline", () => {
    const tasks = [item("normal-later", "medium", "2026-08-20"), item("high", "high", "2026-08-18"), item("urgent-later", "urgent", "2026-08-19"), item("overdue-normal", "low", "2026-08-12"), item("urgent-sooner", "urgent", "2026-08-16")];
    expect(sortMobileTasksByPriority(tasks, "2026-08-13").map(({ id }) => id)).toEqual(["overdue-normal", "urgent-sooner", "urgent-later", "high", "normal-later"]);
  });

  it("does not mark completed work overdue", () => {
    expect(getMobilePriorityMeta("low", true, "done")).toMatchObject({ label: "普通", tone: "normal" });
  });
});

