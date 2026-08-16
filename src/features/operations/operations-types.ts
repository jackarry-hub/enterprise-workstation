import type {
  WorkspaceActor,
  WorkspaceRole,
} from "@/features/auth/workspace-session-types";
import type { AiExecutionSummary } from "@/features/ai-dispatch/summary-contract";

export type OperationFixtureActor = WorkspaceActor;
export type OperationRole = WorkspaceRole;

export type CommandStatus = "executing" | "review" | "accepted" | "archived";
export type OperationTaskStatus = "assigned" | "accepted" | "todo" | "in_progress" | "blocked" | "review" | "done";
export type WorkstreamSource = "department_mock" | "ai_dispatch";
export type TaskEscalationLevel = "none" | "manager" | "executive";
export type OperationActionPriority = "normal" | "warning" | "critical";
export type OperationActionKind = "task_ready" | "task_return" | "task_blocked" | "task_review" | "task_overdue" | "support" | "approval" | "executive_decision";
export type OperationNotificationSeverity = "info" | "warning" | "critical";
export type OperationNotificationCategory = "task" | "approval" | "collaboration" | "system";
export type SupportRequestStatus = "pending" | "approved" | "in_progress" | "completed" | "rejected";
export type SupportRequestType = "finance" | "staffing" | "training";
export type FileProvider = "indexeddb" | "supabase";
export type LeaveRequestStatus = "pending_manager" | "pending_hr" | "approved" | "rejected" | "cancelled";
export type PayrollRunStatus = "draft" | "calculated" | "verified" | "approved" | "paid";
export type AttendancePunchKind = "check_in" | "check_out";
export type AttendancePunchMethod = "mobile_gps" | "office_wifi" | "web";
export type AttendanceIssueType = "late" | "early_leave" | "missing_in" | "missing_out";
export type AttendanceReviewStatus = "pending_manager" | "pending_hr" | "approved" | "rejected";
export type AttendancePeriodStatus = "open" | "review" | "locked";

export type OperationWorkstream = {
  id: string;
  source: WorkstreamSource;
  title: string;
  ownerId: string;
  projectId: string;
  status: "active" | "completed" | "archived";
  createdAt: string;
  updatedAt: string;
};

export type OperationCommand = {
  id: string;
  title: string;
  summary: string;
  ownerId: string;
  status: CommandStatus;
  deadline: string;
  budgetWan: number;
  projectId?: string;
  createdAt: string;
  updatedAt: string;
  aiSummary?: AiExecutionSummary;
  summaryModel?: string;
  summaryGeneratedAt?: string;
  archivedAt?: string;
};

export type DispatchHistoryEntry = {
  commandId: string;
  goal: string;
  creatorId: string;
  taskCount: number;
  participantCount: number;
  rejectionCount: number;
  completedAt: string;
  archivedAt: string;
  aiSummary: AiExecutionSummary;
  summaryModel: string;
  tasks: OperationTask[];
};

export type OperationTask = {
  id: string;
  code: string;
  commandId: string;
  workstreamId: string;
  projectId: string;
  runtimeSource: WorkstreamSource;
  department: string;
  departmentOwnerId: string;
  assigneeId: string;
  title: string;
  summary: string;
  acceptance: string;
  dueDate: string;
  priority: "medium" | "high" | "urgent";
  status: OperationTaskStatus;
  progress: number;
  deliverableRequired: boolean;
  dependencyIds: string[];
  blocker?: string;
  reviewNote?: string;
  reviewDueAt?: string;
  blockerDueAt?: string;
  escalationLevel: TaskEscalationLevel;
  escalatedAt?: string;
  updatedAt: string;
  projectName?: string;
  creatorId?: string;
  responsiblePersonId?: string;
  estimatedHours?: number;
  aiReason?: string;
  acceptedAt?: string;
  startedAt?: string;
  submission?: {
    description: string;
    url?: string;
    attachmentName?: string;
    note?: string;
    submittedAt: string;
  };
  reviewStatus?: "not_submitted" | "pending" | "approved" | "rejected";
  reviewComment?: string;
  reviewedById?: string;
  reviewedAt?: string;
  rejectionCount?: number;
};

export type OperationActionItem = {
  id: string;
  kind: OperationActionKind;
  entityId: string;
  title: string;
  description: string;
  priority: OperationActionPriority;
  dueAt?: string;
  href: string;
};

export type OperationNotification = {
  id: string;
  actorId: string;
  title: string;
  description: string;
  severity: OperationNotificationSeverity;
  category: OperationNotificationCategory;
  href: string;
  createdAt: string;
  read: boolean;
};

export type OperationWeeklySummary = {
  actorId: string;
  scopeLabel: string;
  periodLabel: string;
  total: number;
  completed: number;
  completionRate: number;
  inProgress: number;
  reviewing: number;
  blocked: number;
  overdue: number;
  dependencyRisks: number;
  openSupport: number;
  pendingApprovals: number;
  narrative: string;
  highlights: string[];
  decisions: string[];
  nextFocus: string[];
};

export type SupportRequest = {
  id: string;
  commandId: string;
  sourceTaskId: string;
  type: SupportRequestType;
  title: string;
  description: string;
  requesterId: string;
  handlerId: string;
  amountWan?: number;
  status: SupportRequestStatus;
  result?: string;
  updatedAt: string;
};

export type OperationFile = {
  id: string;
  commandId: string;
  entityType: "task" | "support" | "knowledge" | "attendance";
  entityId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  version: number;
  uploadedById: string;
  provider: FileProvider;
  objectPath: string;
  createdAt: string;
};

export type AttendancePolicy = {
  id: string;
  name: string;
  effectiveDate: string;
  workdays: number[];
  workStart: string;
  workEnd: string;
  breakStart: string;
  breakEnd: string;
  dailyHours: number;
  graceMinutes: number;
  earliestCheckIn: string;
  latestCheckOut: string;
  correctionDeadlineDays: number;
  overtimeStartsAfter: string;
  overtimeMinimumMinutes: number;
  clockMethods: AttendancePunchMethod[];
  locationName: string;
  geofenceMeters: number;
  wifiName: string;
  updatedAt: string;
  updatedById: string;
};

export type AttendanceShift = {
  id: string;
  employeeId: string;
  date: string;
  dayType: "workday" | "rest_day" | "holiday";
  policyId: string;
  scheduledStart?: string;
  scheduledEnd?: string;
};

export type AttendancePunch = {
  id: string;
  employeeId: string;
  date: string;
  kind: AttendancePunchKind;
  time: string;
  occurredAt: string;
  method: AttendancePunchMethod;
  locationName: string;
  verified: boolean;
};

export type AttendanceCorrectionRequest = {
  id: string;
  code: string;
  employeeId: string;
  managerId: string;
  date: string;
  issueType: AttendanceIssueType;
  correctedTime: string;
  reason: string;
  attachmentFileIds: string[];
  status: AttendanceReviewStatus;
  managerComment?: string;
  hrComment?: string;
  submittedAt: string;
  updatedAt: string;
};

export type AttendanceOvertimeRequest = {
  id: string;
  code: string;
  employeeId: string;
  managerId: string;
  date: string;
  startTime: string;
  endTime: string;
  hours: number;
  reason: string;
  status: AttendanceReviewStatus;
  managerComment?: string;
  hrComment?: string;
  submittedAt: string;
  updatedAt: string;
};

export type AttendancePeriod = {
  month: string;
  status: AttendancePeriodStatus;
  scheduledWorkdays: number;
  headcount: number;
  adjustmentCount: number;
  lockedAt?: string;
  lockedById?: string;
};

export type AttendanceOperations = {
  demoDate: string;
  policy: AttendancePolicy;
  shifts: AttendanceShift[];
  punches: AttendancePunch[];
  corrections: AttendanceCorrectionRequest[];
  overtimeRequests: AttendanceOvertimeRequest[];
  period: AttendancePeriod;
};

export type KnowledgeEntry = {
  id: string;
  commandId: string;
  sourceTaskId?: string;
  title: string;
  summary: string;
  category: "项目成果" | "流程制度" | "财务资料" | "人事资料";
  tags: string[];
  fileIds: string[];
  status: "draft" | "published";
  createdById: string;
  updatedAt: string;
};

export type OperationEvent = {
  id: string;
  commandId: string;
  actorId: string;
  actorName?: string;
  action: string;
  detail: string;
  createdAt: string;
};

export type LeaveRequest = {
  id: string;
  code: string;
  employeeId: string;
  managerId: string;
  leaveType: "annual" | "sick" | "personal" | "compensatory";
  startDate: string;
  endDate: string;
  days: number;
  reason: string;
  handover: string;
  status: LeaveRequestStatus;
  managerComment?: string;
  hrComment?: string;
  submittedAt: string;
  updatedAt: string;
};

export type PayrollRun = {
  id: string;
  month: string;
  status: PayrollRunStatus;
  headcount: number;
  grossAmount: number;
  deductionAmount: number;
  netAmount: number;
  attendanceLocked: boolean;
  exceptionCount: number;
  calculatedAt?: string;
  verifiedAt?: string;
  approvedAt?: string;
  paidAt?: string;
  updatedAt: string;
};

export type OperationsState = {
  version: 2;
  workstreams: OperationWorkstream[];
  activeAiWorkstreamId?: string;
  command: OperationCommand;
  tasks: OperationTask[];
  supportRequests: SupportRequest[];
  files: OperationFile[];
  knowledge: KnowledgeEntry[];
  leaveRequests: LeaveRequest[];
  attendance: AttendanceOperations;
  payrollRun: PayrollRun;
  events: OperationEvent[];
  notificationReads: Record<string, string[]>;
  dispatchHistory: DispatchHistoryEntry[];
};
