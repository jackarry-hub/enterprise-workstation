"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { LockKeyhole } from "lucide-react";

import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { Tabs } from "@/components/ui/tabs";
import { CreateMilestoneDialog } from "@/features/projects/components/create-milestone-dialog";
import { CreateTaskDialog } from "@/features/projects/components/create-task-dialog";
import { EditProjectDialog, type EditProjectInput } from "@/features/projects/components/edit-project-dialog";
import { ProjectFilesTab } from "@/features/projects/components/project-files-tab";
import { ProjectGanttTab } from "@/features/projects/components/project-gantt-tab";
import { ProjectDetailHeader } from "@/features/projects/components/project-detail-header";
import { ProjectDetailTabs, projectDetailTabs, type ProjectDetailTab } from "@/features/projects/components/project-detail-tabs";
import { ProjectMilestonesTab } from "@/features/projects/components/project-milestones-tab";
import { ProjectMobileNav } from "@/features/projects/components/project-mobile-nav";
import { ProjectOverviewTab } from "@/features/projects/components/project-overview-tab";
import { ProjectReportsTab, type DailyReportInput } from "@/features/projects/components/project-reports-tab";
import { ProjectRetrospectiveTab } from "@/features/projects/components/project-retrospective-tab";
import { ProjectTasksTab } from "@/features/projects/components/project-tasks-tab";
import { useWorkspaceSession } from "@/features/auth/workspace-session-provider";
import {
  downloadProjectFileBlob,
  downloadVerifiedProjectFile,
  storeProjectFileBlob,
  uploadVerifiedProjectFile,
  type VerifiedFileUploadPhase,
} from "@/features/operations/file-storage";
import { syncProjectTasksToOperations } from "@/features/operations/operations-data";
import { useOperations } from "@/features/operations/use-operations";
import { findLocalProject, PROJECTS_CHANGED_EVENT, saveLocalProject } from "@/features/projects/data/mock-project-repository";
import {
  createMockTask,
  addMockTaskComment,
  updateMockTaskStatus,
  type CreateMockTaskInput,
  type TaskExecutionStatus,
} from "@/features/projects/data/project-task-operations";
import {
  createBusinessTask,
  createBusinessTaskComment,
  publicTaskPriority,
  submitBusinessProjectReport,
  updateBusinessProject,
} from "@/features/projects/data/business-command-client";
import { formatDateInputInTimeZone } from "@/lib/date";
import { useWorkspaceRouter } from "@/lib/navigation/use-workspace-router";
import type { DailyReport, FileRelation, Milestone, ProjectActivity, ProjectDetailData, ProjectDetailResult, ProjectFile, ProjectRetrospective, ProjectRiskStatus } from "@/features/projects/types";

export function ProjectDetailWorkspace({ result }: { result: ProjectDetailResult }) {
  const router = useWorkspaceRouter();
  const session = useWorkspaceSession();
  const auditActor = session.actor;
  const {
    state: operationsState,
    context,
    actor,
    isFixtureBound,
  } = useOperations(session);
  const [detail, setDetail] = useState<ProjectDetailData>(result.detail);
  const [activeTab, setActiveTab] = useState<ProjectDetailTab>("overview");
  const [isMilestoneOpen, setIsMilestoneOpen] = useState(false);
  const [isTaskOpen, setIsTaskOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [initialTaskId, setInitialTaskId] = useState<string | undefined>();
  const nextSortOrder = useMemo(
    () => detail.milestones.reduce((maximum, milestone) => Math.max(maximum, milestone.sortOrder), -1) + 1,
    [detail.milestones],
  );
  const canViewProject = result.source === "supabase" || isFixtureBound && (actor.role === "executive" || detail.project.ownerId === actor.memberId || detail.members.some(({ member }) => member.id === actor.memberId));
  const actorProjectRole = detail.members.find(({ member }) => member.id === actor.memberId)?.role;
  const localCanManage = isFixtureBound && (
    actor.role === "executive"
    || detail.project.ownerId === actor.memberId
    || actorProjectRole === "owner"
    || actorProjectRole === "manager"
  );
  const canManageProject = result.source === "supabase"
    ? result.access?.canManage ?? localCanManage
    : localCanManage;
  const workflowManaged = result.source === "supabase" || operationsState.command.projectId === detail.project.id;

  useEffect(() => {
    if (result.source === "mock") {
      const persistedDetail = findLocalProject(context, result.detail.project.id);
      if (persistedDetail) setDetail(persistedDetail);
    } else {
      setDetail(result.detail);
    }

    const params = new URLSearchParams(window.location.search);
    const requestedTab = params.get("tab");
    if (projectDetailTabs.some(({ value }) => value === requestedTab)) setActiveTab(requestedTab as ProjectDetailTab);
    const requestedTask = params.get("task");
    if (requestedTask) { setActiveTab("tasks"); setInitialTaskId(requestedTask); }
  }, [context, result.detail, result.detail.project.id, result.source]);

  useEffect(() => {
    if (result.source !== "mock") return;
    const refresh = () => {
      const persistedDetail = findLocalProject(context, result.detail.project.id);
      if (persistedDetail) setDetail(persistedDetail);
    };
    window.addEventListener(PROJECTS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(PROJECTS_CHANGED_EVENT, refresh);
  }, [context, result.detail.project.id, result.source]);

  function addMilestone(milestone: Milestone) {
    const next = {
      ...detail,
      milestones: [...detail.milestones, milestone].sort((left, right) => left.sortOrder - right.sortOrder),
    };
    if (result.source === "mock") {
      saveLocalProject(context, next);
    }
    setDetail(next);
  }

  function persistDetail(next: ProjectDetailData) {
    if (result.source !== "mock") throw new Error("正式数据必须通过服务端业务接口更新");
    saveLocalProject(context, next);
    setDetail(next);
  }

  function openTaskDialog() {
    setActiveTab("tasks");
    setIsTaskOpen(true);
  }

  async function addTask(input: CreateMockTaskInput & { acceptanceCriteria: string }, idempotencyKey: string) {
    if (!canManageProject) throw new Error("只有项目负责人可以新建任务");
    if (result.source === "supabase") {
      const assignee = detail.members.find(({ member }) => member.id === input.assigneeId)?.member;
      if (!assignee?.commandId) throw new Error("所选负责人缺少有效成员身份，请刷新组织数据后重试");
      await createBusinessTask({
        projectId: detail.project.id,
        assigneeMemberId: assignee.commandId,
        title: input.title,
        description: input.description,
        acceptanceCriteria: input.acceptanceCriteria,
        dueDate: input.dueDate,
        priority: publicTaskPriority(input.priority),
      }, idempotencyKey);
      router.refresh();
      return;
    }
    const next = createMockTask(detail, input, auditActor);
    persistDetail(next);
    syncProjectTasksToOperations(context, next, actor.id, auditActor);
  }

  function updateTaskStatus(taskId: string, status: TaskExecutionStatus) {
    if (!canManageProject) throw new Error("只有项目负责人可以调整任务状态");
    if (workflowManaged) throw new Error("该任务由执行与验收流程统一管理，请前往对应角色工作台操作");
    const next = updateMockTaskStatus(detail, taskId, status, auditActor);
    persistDetail(next);
    syncProjectTasksToOperations(context, next, actor.id, auditActor);
  }

  async function addTaskComment(taskId: string, body: string, idempotencyKey: string) {
    if (result.source === "supabase") {
      const task = detail.tasks.find(({ id }) => id === taskId);
      if (!task) throw new Error("任务不存在或已被移除");
      const comment = await createBusinessTaskComment(task, body, idempotencyKey);
      setDetail((current) => {
        const authorId = current.members.find(({ member }) => member.employeePublicId === comment.authorEmployeePublicId)?.member.id
          ?? result.access?.viewerMemberId
          ?? auditActor.memberId;
        return {
          ...current,
          comments: [...current.comments, { ...comment, authorId, organizationId: current.project.organizationId }],
        };
      });
      return;
    }
    persistDetail(addMockTaskComment(detail, taskId, body, auditActor));
  }

  async function editProject(input: EditProjectInput, idempotencyKey: string) {
    if (!canManageProject) throw new Error("只有项目负责人可以编辑项目");
    if (result.source === "supabase") {
      const ownerPublicId = detail.owner.employeePublicId;
      const version = detail.project.version;
      if (!ownerPublicId || !version) throw new Error("项目版本或负责人身份缺失，请刷新后重试");
      const updated = await updateBusinessProject(detail.project.id, {
        version,
        reason: "从项目详情更新项目资料",
        name: input.name,
        description: input.description,
        category: detail.project.category ?? "企业项目",
        ownerPublicId,
        budgetAmount: detail.project.budgetAmount ?? "0.00",
        priority: detail.project.priority,
        startsOn: detail.project.startDate,
        dueOn: input.dueDate,
      }, idempotencyKey);
      setDetail((current) => ({
        ...current,
        project: {
          ...current.project,
          name: input.name,
          description: input.description,
          dueDate: input.dueDate,
          version: updated.version,
          updatedAt: new Date().toISOString(),
        },
      }));
      router.refresh();
      return;
    }
    const now = new Date().toISOString();
    persistDetail({ ...detail, project: { ...detail.project, ...input, updatedAt: now }, activities: [{ id: `activity-${Date.now()}`, organizationId: detail.project.organizationId, projectId: detail.project.id, userId: auditActor.id, actionType: "project_updated", content: `${auditActor.name}更新了项目基本信息。`, createdAt: now }, ...detail.activities] });
  }

  async function uploadFile(
    file: globalThis.File,
    idempotencyKey: string,
    onProgress: (phase: VerifiedFileUploadPhase) => void,
  ) {
    if (result.source === "supabase") {
      const projectFile = await uploadVerifiedProjectFile({
        projectId: detail.project.id,
        file,
        idempotencyKey,
        onProgress,
      });
      setDetail((current) => ({
        ...current,
        files: [projectFile, ...current.files.filter(({ id }) => id !== projectFile.id)],
      }));
      return;
    }
    onProgress("uploading");
    const now = new Date().toISOString();
    const id = `file-${Date.now()}`;
    const objectPath = await storeProjectFileBlob(context, id, file);
    const projectFile: ProjectFile = { id, organizationId: detail.project.organizationId, projectId: detail.project.id, bucket: "indexeddb-project-files", objectPath, originalName: file.name, mimeType: file.type || "application/octet-stream", sizeBytes: file.size, accessScope: "restricted", uploadedById: auditActor.memberId, createdAt: now };
    const relation: FileRelation = { id: `relation-${Date.now()}`, organizationId: detail.project.organizationId, projectId: detail.project.id, fileId: id, relationType: "project", createdById: auditActor.memberId, createdAt: now };
    const activity: ProjectActivity = { id: `activity-${Date.now()}`, organizationId: detail.project.organizationId, projectId: detail.project.id, userId: auditActor.id, actionType: "file_uploaded", content: `${auditActor.name}上传了《${file.name}》。`, createdAt: now };
    persistDetail({ ...detail, files: [projectFile, ...detail.files], fileRelations: [relation, ...detail.fileRelations], activities: [activity, ...detail.activities], project: { ...detail.project, updatedAt: now } });
    onProgress("completed");
  }

  async function downloadFile(file: ProjectFile) {
    if (result.source === "supabase") {
      await downloadVerifiedProjectFile(file.id);
      return;
    }
    await downloadProjectFileBlob(context, file.objectPath, file.originalName);
  }

  async function submitDailyReport(input: DailyReportInput, idempotencyKey: string) {
    if (result.source === "supabase") {
      await submitBusinessProjectReport(detail.project.id, {
        reportDate: formatDateInputInTimeZone(),
        ...input,
        reason: "从项目详情提交项目日报",
      }, idempotencyKey);
      router.refresh();
      return;
    }
    const now = new Date().toISOString();
    const report: DailyReport = { id: `report-${Date.now()}`, organizationId: detail.project.organizationId, projectId: detail.project.id, authorId: auditActor.memberId, reportDate: now.slice(0, 10), status: "submitted", summary: input.summary, nextPlan: input.nextPlan, blockers: input.blockers || undefined, supportNeeded: input.supportNeeded || undefined, submittedAt: now, createdAt: now, updatedAt: now };
    const activity: ProjectActivity = { id: `activity-${Date.now()}`, organizationId: detail.project.organizationId, projectId: detail.project.id, userId: auditActor.id, actionType: "daily_report_submitted", content: `${auditActor.name}提交了 ${report.reportDate} 项目日报。`, createdAt: now };
    persistDetail({ ...detail, dailyReports: [report, ...detail.dailyReports], activities: [activity, ...detail.activities], project: { ...detail.project, updatedAt: now } });
  }

  function saveRetrospective(input: Omit<ProjectRetrospective, "updatedById" | "updatedAt">) {
    const now = new Date().toISOString();
    const retrospective: ProjectRetrospective = { ...input, updatedById: auditActor.memberId, updatedAt: now };
    const activity: ProjectActivity = { id: `activity-${Date.now()}`, organizationId: detail.project.organizationId, projectId: detail.project.id, userId: auditActor.id, actionType: "project_updated", content: `${auditActor.name}更新了项目复盘。`, createdAt: now };
    persistDetail({ ...detail, retrospective, activities: [activity, ...detail.activities], project: { ...detail.project, updatedAt: now } });
  }

  function updateRiskStatus(riskId: string, status: ProjectRiskStatus) {
    const now = new Date().toISOString();
    const risk = detail.risks.find(({ id }) => id === riskId);
    if (!risk) return;
    const activity: ProjectActivity = { id: `activity-${Date.now()}`, organizationId: detail.project.organizationId, projectId: detail.project.id, userId: auditActor.id, actionType: "risk_updated", content: `${auditActor.name}将风险“${risk.title}”更新为${status === "mitigated" ? "已缓解" : "监控中"}。`, createdAt: now };
    persistDetail({ ...detail, risks: detail.risks.map((item) => item.id === riskId ? { ...item, status, updatedAt: now } : item), activities: [activity, ...detail.activities], project: { ...detail.project, updatedAt: now } });
  }

  if (!canViewProject) {
    return <main className="mx-auto w-full max-w-3xl px-4 py-16"><GlassCard className="p-8 text-center"><LockKeyhole className="mx-auto size-8 text-primary" /><h1 className="mt-3 text-xl font-semibold">该项目不在你的工作范围内</h1><p className="mt-2 text-sm text-muted-foreground">负责人只能查看自己负责或参与的项目。</p><Button asChild className="mt-5"><Link href={actor.landingPath}>返回我的工作台</Link></Button></GlassCard></main>;
  }

  return (
    <main className="mx-auto flex w-full max-w-420 flex-col gap-4 px-3 pt-4 pb-26 sm:px-4 lg:px-5 lg:pt-6 lg:pb-8">
      <ProjectDetailHeader detail={detail} onAddTask={openTaskDialog} onEdit={() => setIsEditOpen(true)} canManage={canManageProject} />

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as ProjectDetailTab)} className="gap-4">
        <ProjectDetailTabs />
        {activeTab === "overview" ? <ProjectOverviewTab detail={detail} /> : null}
        {activeTab === "milestones" ? (
          <ProjectMilestonesTab detail={detail} milestones={detail.milestones} onCreate={() => setIsMilestoneOpen(true)} canManage={canManageProject} />
        ) : null}
        {activeTab === "tasks" ? (
          <ProjectTasksTab actor={auditActor} detail={detail} onCreate={() => setIsTaskOpen(true)} onStatusChange={updateTaskStatus} onComment={addTaskComment} initialTaskId={initialTaskId} canManage={canManageProject} workflowManaged={workflowManaged} />
        ) : null}
        {activeTab === "gantt" ? <ProjectGanttTab detail={detail} /> : null}
        {activeTab === "files" ? <ProjectFilesTab detail={detail} formal={result.source === "supabase"} onUpload={uploadFile} onDownload={downloadFile} /> : null}
        {activeTab === "reports" ? <ProjectReportsTab detail={detail} canSubmit={canViewProject} onSubmit={submitDailyReport} /> : null}
        {activeTab === "retrospective" ? <ProjectRetrospectiveTab detail={detail} canManage={canManageProject && result.source === "mock"} readOnlyReason={result.source === "supabase" ? "正式项目复盘与风险维护接口尚未接入，当前仅展示已存数据。" : undefined} onSave={saveRetrospective} onRiskStatusChange={updateRiskStatus} /> : null}
      </Tabs>

      <EditProjectDialog detail={detail} open={isEditOpen} onOpenChange={setIsEditOpen} onSave={editProject} allowStatusChange={result.source === "mock"} />

      <CreateMilestoneDialog
        detail={detail}
        open={isMilestoneOpen}
        nextSortOrder={nextSortOrder}
        allowLocalFallback={result.source === "mock"}
        onClose={() => setIsMilestoneOpen(false)}
        onCreated={addMilestone}
      />
      <CreateTaskDialog
        detail={detail}
        open={isTaskOpen}
        onClose={() => setIsTaskOpen(false)}
        onCreated={addTask}
        requireAcceptanceCriteria={result.source === "supabase"}
      />
      <ProjectMobileNav />
    </main>
  );
}
