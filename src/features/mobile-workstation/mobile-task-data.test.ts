import { describe, expect, it } from "vitest";

import {
  mergeMobileTasks,
  selectMobileTasksForScope,
} from "@/features/mobile-workstation/mobile-task-data";
import type { MobileTaskItem } from "@/features/mobile-workstation/mobile-workstation-types";

const task = (id: string, initiatedByViewer: boolean): MobileTaskItem => ({
  id,
  title: id,
  assigneeName: "Demo",
  dueDate: "2026-08-14",
  status: "pending",
  priority: "high",
  progress: 0,
  href: "/tasks",
  initiatedByViewer,
});

describe("mobile task scope", () => {
  it("keeps an empty assigned scope instead of inventing mobile-only tasks", () => {
    expect(selectMobileTasksForScope([task("initiated", true)], "assigned")).toEqual([]);
    expect(selectMobileTasksForScope([task("initiated", true)], "initiated")).toEqual([task("initiated", true)]);
  });

  it("keeps the repository-backed action when a projected project repeats the task", () => {
    const repositoryTask = { ...task("shared", false), href: "/execution#task-shared" };
    const projectedTask = { ...task("shared", false), href: "/projects/project-1?tab=tasks&task=shared" };

    expect(mergeMobileTasks([repositoryTask], [projectedTask])).toEqual([repositoryTask]);
  });
});
