export type DemoRole = "executive" | "department_head" | "employee" | "finance" | "hr";

export type DemoActor = {
  id: string;
  memberId: string;
  name: string;
  role: DemoRole;
  roleLabel: string;
  department: string;
  title: string;
  landingPath: string;
};

export type CommandStatus = "executing" | "review" | "accepted" | "archived";
export type OperationTaskStatus = "todo" | "in_progress" | "blocked" | "review" | "done";
export type TaskEscalationLevel = "none" | "manager" | "executive";
export type OperationActionPriority = "normal" | "warning" | "critical";
export type OperationActionKind = "task_ready" | "task_blocked" | "task_review" | "task_overdue" | "support" | "approval" | "executive_decision";
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
};

export type OperationTask = {
  id: string;
  code: string;
  commandId: string;
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
  version: 1;
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
};
