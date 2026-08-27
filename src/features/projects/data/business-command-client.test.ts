import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createBusinessProject,
  createBusinessTask,
  createBusinessTaskComment,
  publicTaskPriority,
  submitBusinessProjectReport,
  updateBusinessProject,
} from "@/features/projects/data/business-command-client";

const key = "a1000000-0000-4000-8000-000000000001";
const projectId = "a1000000-0000-4000-8000-000000000002";
const taskId = "a1000000-0000-4000-8000-000000000003";

describe("business command browser client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("creates a project with a strict idempotent request", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ project: { id: projectId, version: 1 } }, { status: 201 }));
    vi.stubGlobal("fetch", fetch);

    await expect(createBusinessProject({
      ownerPublicId: "a1000000-0000-4000-8000-000000000004",
      name: "客户门户",
      category: "企业项目",
      description: "正式项目",
      startsOn: "2026-08-27",
      dueOn: "2026-09-30",
      budgetAmount: "10000.00",
      priority: "high",
      status: "planning",
      reason: "创建项目",
    }, key)).resolves.toEqual({ id: projectId, version: 1 });

    expect(fetch).toHaveBeenCalledWith("/api/workstation/projects", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "Idempotency-Key": key }),
    }));
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({ version: 0, budgetAmount: "10000.00" });
  });

  it("does not report an ambiguous network failure as success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
    await expect(updateBusinessProject(projectId, {
      version: 2,
      reason: "更新项目",
      name: "客户门户二期",
      description: "更新",
      category: "企业项目",
      ownerPublicId: "a1000000-0000-4000-8000-000000000004",
      budgetAmount: "10000.00",
      priority: "high",
      startsOn: "2026-08-27",
      dueOn: "2026-10-30",
    }, key)).rejects.toThrow("结果未确认");
  });

  it("creates a task through the durable task command", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ task: { id: taskId, p: projectId }, notification: { status: "queued" } }, { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    await expect(createBusinessTask({
      projectId,
      assigneeMemberId: "m42",
      title: "完成联调",
      description: "覆盖核心流程",
      acceptanceCriteria: "端到端测试通过",
      dueDate: "2026-09-02",
      priority: "P1",
    }, key)).resolves.toEqual({ id: taskId });
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({ assigneeMemberId: "m42", acceptanceCriteria: "端到端测试通过" });
  });

  it("validates durable report confirmations and maps comments back to the UI model", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ resource: "report", entity: {
        id: "a1000000-0000-4000-8000-000000000005", projectId,
        authorPublicId: "a1000000-0000-4000-8000-000000000006", reportDate: "2026-08-27",
        summary: "完成联调", nextPlan: "开始验收", blockers: "", supportNeeded: "", status: "submitted", version: 1,
        updatedAt: "2026-08-27T10:00:00.000Z",
      } }, { status: 201 }))
      .mockResolvedValueOnce(Response.json({ resource: "comment", entity: {
        id: "a1000000-0000-4000-8000-000000000007", taskId, projectId,
        authorPublicId: "a1000000-0000-4000-8000-000000000006", body: "已核对",
        version: 1, createdAt: "2026-08-27T10:01:00.000Z", updatedAt: "2026-08-27T10:01:00.000Z",
      } }, { status: 201 }));
    vi.stubGlobal("fetch", fetch);

    const report = await submitBusinessProjectReport(projectId, {
      reportDate: "2026-08-27", summary: "完成联调", nextPlan: "开始验收",
      blockers: "", supportNeeded: "", reason: "提交日报",
    }, key);
    const comment = await createBusinessTaskComment({ id: taskId, projectId }, "已核对", key);

    expect(report).toMatchObject({ projectId, summary: "完成联调", version: 1, updatedAt: "2026-08-27T10:00:00.000Z" });
    expect(report).not.toHaveProperty("createdAt");
    expect(report).not.toHaveProperty("submittedAt");
    expect(comment).toMatchObject({ taskId, projectId, body: "已核对" });
  });

  it("rejects malformed successful DTOs instead of fabricating a confirmed result", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ resource: "report", entity: {
      id: "not-a-uuid", projectId, authorPublicId: "also-not-a-uuid",
      reportDate: "2026-02-31", status: "submitted", summary: 42,
      nextPlan: "继续", blockers: "", supportNeeded: "", version: "1",
      updatedAt: "today",
    } }, { status: 201 })));

    await expect(submitBusinessProjectReport(projectId, {
      reportDate: "2026-08-27", summary: "完成联调", nextPlan: "开始验收",
      blockers: "", supportNeeded: "", reason: "提交日报",
    }, key)).rejects.toThrow("结果无法确认");
  });

  it("preserves low priority as the P3 command protocol", () => {
    expect(publicTaskPriority("urgent")).toBe("P0");
    expect(publicTaskPriority("high")).toBe("P1");
    expect(publicTaskPriority("medium")).toBe("P2");
    expect(publicTaskPriority("low")).toBe("P3");
  });
});
