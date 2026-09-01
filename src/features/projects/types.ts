export const objectiveScopes = ["company", "department", "team"] as const;
export type ObjectiveScope = (typeof objectiveScopes)[number];

export const objectiveStatuses = ["draft", "active", "completed", "cancelled"] as const;
export type ObjectiveStatus = (typeof objectiveStatuses)[number];

export const projectStatuses = [
  "planning",
  "active",
  "on_hold",
  "completed",
  "cancelled",
] as const;
export type ProjectStatus = (typeof projectStatuses)[number];

export const projectHealthStates = ["on_track", "at_risk", "off_track"] as const;
export type ProjectHealth = (typeof projectHealthStates)[number];

export const projectPriorities = ["low", "medium", "high", "critical"] as const;
export type ProjectPriority = (typeof projectPriorities)[number];

export const projectMemberRoles = ["owner", "manager", "member", "viewer"] as const;
export type ProjectMemberRole = (typeof projectMemberRoles)[number];

export const milestoneStatuses = ["pending", "in_progress", "completed", "overdue"] as const;
export type MilestoneStatus = (typeof milestoneStatuses)[number];

export const taskStatuses = [
  "backlog",
  "todo",
  "in_progress",
  "blocked",
  "in_review",
  "done",
  "cancelled",
] as const;
export type TaskStatus = (typeof taskStatuses)[number];

export const taskPriorities = ["low", "medium", "high", "urgent"] as const;
export type TaskPriority = (typeof taskPriorities)[number];

export const fileAccessScopes = ["organization", "restricted", "private"] as const;
export type FileAccessScope = (typeof fileAccessScopes)[number];

export const dailyReportStatuses = ["draft", "submitted"] as const;
export type DailyReportStatus = (typeof dailyReportStatuses)[number];

export const projectActivityActionTypes = [
  "project_created",
  "project_updated",
  "member_added",
  "member_role_changed",
  "member_removed",
  "project_archived",
  "project_restored",
  "milestone_updated",
  "task_updated",
  "file_uploaded",
  "daily_report_submitted",
  "risk_updated",
  "project_note_added",
] as const;
export type ProjectActivityActionType =
  (typeof projectActivityActionTypes)[number];

export const projectRiskLevels = ["low", "medium", "high", "critical"] as const;
export type ProjectRiskLevel = (typeof projectRiskLevels)[number];

export const projectRiskStatuses = [
  "open",
  "monitoring",
  "mitigated",
  "closed",
] as const;
export type ProjectRiskStatus = (typeof projectRiskStatuses)[number];

export const fileRelationTypes = [
  "project",
  "task",
  "milestone",
  "daily_report",
  "task_comment",
] as const;
export type FileRelationType = (typeof fileRelationTypes)[number];

export const projectListGroups = [
  "all",
  "responsible",
  "involved",
  "following",
  "completed",
] as const;
export type ProjectListGroup = (typeof projectListGroups)[number];

export type ProjectDeadlineFilter = "all" | "this_month" | "next_month" | "overdue";
export type ProjectListStatusFilter = ProjectStatus | "all";
export type ProjectListPriorityFilter = ProjectPriority | "all";

export interface MemberSummary {
  id: string;
  employeePublicId?: string;
  /** Browser-safe command identifier used by task endpoints (for example, m42). */
  commandId?: string;
  displayName: string;
  department: string;
  title: string;
  avatarUrl?: string;
}

export interface Objective {
  id: string;
  organizationId: string;
  parentObjectiveId?: string;
  ownerId: string;
  createdById: string;
  title: string;
  description: string;
  scope: ObjectiveScope;
  status: ObjectiveStatus;
  periodStart: string;
  periodEnd: string;
  progress: number;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  organizationId: string;
  objectiveId?: string;
  code: string;
  name: string;
  description: string;
  category?: string;
  budgetAmount?: string;
  ownerId: string;
  createdById: string;
  status: ProjectStatus;
  health: ProjectHealth;
  priority: ProjectPriority;
  startDate: string;
  dueDate: string;
  actualEndDate?: string;
  progress: number;
  version?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectMember {
  id: string;
  organizationId: string;
  projectId: string;
  member: MemberSummary;
  role: ProjectMemberRole;
  allocationPercent: number;
  joinedAt: string;
  leftAt?: string;
  version?: number;
}

export interface Milestone {
  id: string;
  organizationId: string;
  projectId: string;
  ownerId?: string;
  name: string;
  description: string;
  status: MilestoneStatus;
  startDate?: string;
  dueDate: string;
  completedAt?: string;
  progress: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectTask {
  id: string;
  organizationId: string;
  projectId: string;
  milestoneId?: string;
  parentTaskId?: string;
  title: string;
  description: string;
  acceptanceCriteria?: string;
  assigneeId?: string;
  reporterId: string;
  status: TaskStatus;
  priority: TaskPriority;
  startDate?: string;
  dueDate?: string;
  completedAt?: string;
  progress: number;
  estimatedHours?: number;
  sortOrder: number;
  version?: number;
  resultText?: string;
  resultLink?: string;
  resultFiles?: readonly string[];
  reviewNote?: string;
  submittedAt?: string;
  reviewedAt?: string;
  acceptedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskComment {
  id: string;
  organizationId: string;
  projectId: string;
  taskId: string;
  authorId: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectFile {
  id: string;
  organizationId: string;
  projectId: string;
  taskId?: string;
  bucket: string;
  objectPath: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256?: string;
  accessScope: FileAccessScope;
  uploadedById: string;
  verifiedAt?: string;
  createdAt: string;
}

export interface TaskAcceptanceEvent {
  id: string;
  taskId: string;
  eventType: "submitted" | "review_passed" | "review_rejected" | "reopened";
  actorEmployeePublicId: string;
  actorName: string;
  taskVersion: number;
  resultText?: string;
  resultLink?: string;
  resultFiles: readonly string[];
  decision?: "pass" | "reject";
  note?: string;
  occurredAt: string;
}

export interface DailyReport {
  id: string;
  organizationId: string;
  projectId: string;
  authorId: string;
  reportDate: string;
  status: DailyReportStatus;
  summary: string;
  nextPlan: string;
  blockers?: string;
  supportNeeded?: string;
  submittedAt?: string;
  createdAt: string;
  updatedAt: string;
  version?: number;
}

export interface ProjectActivity {
  id: string;
  organizationId: string;
  projectId: string;
  userId: string;
  actionType: ProjectActivityActionType;
  content: string;
  createdAt: string;
}

export interface ProjectRisk {
  id: string;
  organizationId: string;
  projectId: string;
  title: string;
  level: ProjectRiskLevel;
  ownerId: string;
  status: ProjectRiskStatus;
  deadline: string;
  version?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectRetrospective {
  id?: string;
  outcome: string;
  wins: string;
  lessons: string;
  followUps: string;
  updatedById: string;
  version?: number;
  updatedAt: string;
}

export type ProjectSopStepKind = "human" | "agent" | "approval" | "system";
export type ProjectSopRunStatus = "running" | "waiting_human" | "completed" | "failed" | "cancelled";

export interface ProjectSopStep {
  key: string;
  name: string;
  description: string;
  kind: ProjectSopStepKind;
  requiresHuman: boolean;
}

export interface ProjectSopDefinition {
  id: string;
  code: string;
  name: string;
  description: string;
  status: "draft" | "active" | "retired";
  version: number;
  versionId?: string;
  revision?: number;
  lifecycle?: "draft" | "published" | "retired";
  steps: readonly ProjectSopStep[];
  updatedAt: string;
}

export interface ProjectSopRun {
  id: string;
  definitionId: string;
  definitionName: string;
  versionId: string;
  revision: number;
  steps: readonly ProjectSopStep[];
  taskId?: string;
  assignedEmployeeId: string;
  assignedName: string;
  status: ProjectSopRunStatus;
  currentStepIndex: number;
  version: number;
  startedAt: string;
  completedAt?: string;
  updatedAt: string;
}

export type ProjectDecisionType = "decision" | "risk" | "lesson" | "action";
export type ProjectDecisionStatus = "proposed" | "accepted" | "archived";

export interface ProjectDecisionCitation {
  type: "task" | "report" | "knowledge" | "file" | "link";
  id: string;
  label: string;
}

export interface ProjectDecision {
  id: string;
  type: ProjectDecisionType;
  title: string;
  summary: string;
  citations: readonly ProjectDecisionCitation[];
  ownerEmployeeId: string;
  ownerName: string;
  status: ProjectDecisionStatus;
  version: number;
  createdAt: string;
  acceptedAt?: string;
  updatedAt: string;
}

export interface ProjectExecutionTraceItem {
  id: string;
  source: "project" | "acceptance" | "sop";
  eventType: string;
  title: string;
  actorName: string;
  occurredAt: string;
  taskId?: string;
  runId?: string;
}

export interface ProjectOperatingModel {
  canManage: boolean;
  sops: readonly ProjectSopDefinition[];
  sopRuns: readonly ProjectSopRun[];
  decisions: readonly ProjectDecision[];
  retrospective?: ProjectRetrospective;
  trace: readonly ProjectExecutionTraceItem[];
}

export interface FileRelation {
  id: string;
  organizationId: string;
  projectId: string;
  fileId: string;
  relationType: FileRelationType;
  taskId?: string;
  milestoneId?: string;
  dailyReportId?: string;
  taskCommentId?: string;
  createdById: string;
  createdAt: string;
}

export interface ProjectListItem {
  id: string;
  code: string;
  name: string;
  objectiveTitle?: string;
  owner: MemberSummary;
  members: readonly MemberSummary[];
  memberCount: number;
  progress: number;
  status: ProjectStatus;
  health: ProjectHealth;
  priority: ProjectPriority;
  startDate: string;
  dueDate: string;
  viewerRole: ProjectMemberRole | "none";
  isFollowed: boolean;
}

export interface ProjectListFilters {
  group: ProjectListGroup;
  query: string;
  status: ProjectListStatusFilter;
  priority: ProjectListPriorityFilter;
  ownerId: string | "all";
  deadline: ProjectDeadlineFilter;
}

export interface ProjectPortfolioStat {
  id: "all" | "active" | "completed" | "risk";
  label: string;
  value: number;
  trendLabel: string;
  trend: string;
  tone: "blue" | "green" | "purple" | "orange" | "red";
}

export interface ProjectMilestoneReminder {
  id: string;
  projectName: string;
  milestoneName: string;
  dueDate: string;
  status: "upcoming" | "urgent" | "completed";
}

export interface ProjectDetailData {
  project: Project;
  objective?: Objective;
  owner: MemberSummary;
  members: readonly ProjectMember[];
  milestones: readonly Milestone[];
  tasks: readonly ProjectTask[];
  comments: readonly TaskComment[];
  files: readonly ProjectFile[];
  dailyReports: readonly DailyReport[];
  activities: readonly ProjectActivity[];
  risks: readonly ProjectRisk[];
  fileRelations: readonly FileRelation[];
  retrospective?: ProjectRetrospective;
  acceptanceEvents?: readonly TaskAcceptanceEvent[];
  operatingModel?: ProjectOperatingModel;
}

export interface ArchivedProjectSummary {
  id: string;
  code: string;
  name: string;
  statusBeforeArchive?: ProjectStatus;
  version: number;
  archivedAt: string;
  ownerEmployeePublicId?: string;
  ownerName: string;
}

export interface ProjectDetailResult {
  detail: ProjectDetailData;
  source: "supabase" | "mock";
  access?: {
    canManage: boolean;
    viewerMemberId?: string;
  };
  availableMembers?: readonly MemberSummary[];
}

export type CreateMockProjectInput = {
  name: string;
  description: string;
  category?: string;
  budgetAmount?: string;
  ownerId: string;
  memberIds: readonly string[];
  startDate: string;
  dueDate: string;
  priority: ProjectPriority;
  status: "planning" | "active";
};

export interface ProjectPermissionSnapshot {
  canCreateProject: boolean;
  canManageProject: boolean;
  canExecuteAssignedTasks: boolean;
  canContribute: boolean;
  canView: boolean;
}
