type SessionInput = {
  memberId: number;
  displayName: string;
  departmentName: string;
  jobTitle: string;
  avatarUrl: string | null;
  permissionCodes: readonly string[];
};

export type WorkstationMemberRow = {
  id: number;
  displayName: string;
  departmentName: string;
  jobTitle: string;
  skills: readonly string[];
};

export type WorkstationProjectRow = {
  id: number;
  publicId: string;
  name: string;
  ownerMemberId: number;
  status: string;
  health: string;
  progress: number;
  priority: string;
  updatedAt: string;
};

export type WorkstationTaskRow = {
  publicId: string;
  projectId: number;
  title: string;
  description: string;
  assigneeMemberId: number | null;
  reporterMemberId: number;
  status: string;
  priority: string;
  startDate: string | null;
  dueDate: string | null;
  progress: number;
  acceptanceCriteria: string;
  blocker: string | null;
  reviewNote: string | null;
  nextStep?: string | null;
  resultSummary?: string | null;
  resultLink?: string | null;
  resultFiles?: readonly string[] | null;
  acceptedAt?: string | null;
  submittedAt?: string | null;
  reviewedAt?: string | null;
  notification: {
    status: string;
    errorCode: string;
  };
};

export type WorkstationSalaryRow = {
  payrollMonth: string;
  baseSalary: number;
  bonus: number;
  performanceBonus?: number;
  projectBonus?: number;
  otherBonus?: number;
  socialSecurity?: number;
  individualIncomeTax?: number;
  otherDeduction?: number;
  deductions: number;
  netSalary: number;
  status: string;
  paidAt: string | null;
};

type BootstrapRows = {
  members: readonly WorkstationMemberRow[];
  projects: readonly WorkstationProjectRow[];
  tasks: readonly WorkstationTaskRow[];
  salary: readonly WorkstationSalaryRow[];
};

const projectStatuses: Record<string, string> = {
  planning: "规划中",
  active: "进行中",
  on_hold: "风险",
  completed: "已完成",
  cancelled: "已取消",
};

const projectHealth: Record<string, number> = {
  on_track: 90,
  at_risk: 65,
  off_track: 35,
};

const taskStatuses: Record<string, string> = {
  backlog: "待处理",
  todo: "待处理",
  in_progress: "进行中",
  in_review: "待验收",
  done: "已完成",
  cancelled: "已取消",
};

const taskPriorities: Record<string, string> = {
  urgent: "P0",
  high: "P1",
  medium: "P2",
  low: "P2",
};

const notificationErrorCodes = new Set([
  "token_unavailable",
  "recipient_unavailable",
  "send_failed",
  "configuration_unavailable",
  "queue_unavailable",
  "delivery_unconfirmed",
]);

function publicTaskNotification(notification: WorkstationTaskRow["notification"]) {
  const errorCode = notificationErrorCodes.has(notification.errorCode)
    ? notification.errorCode
    : "";
  if (errorCode === "recipient_unavailable") {
    return { status: "unavailable" as const, errorCode };
  }
  if (notification.status === "pending" || notification.status === "sent") {
    return { status: notification.status, errorCode };
  }
  if (notification.status === "failed") {
    return { status: "failed" as const, errorCode: errorCode || "send_failed" };
  }
  return {
    status: "unavailable" as const,
    errorCode: errorCode || "recipient_unavailable",
  };
}

function memberId(value: number | null) {
  return value === null ? "" : `m${value}`;
}

function month(value: string) {
  return value.slice(0, 7);
}

export function buildServerBootstrap(
  session: SessionInput,
  rows: BootstrapRows,
) {
  const projectPublicIds = new Map(
    rows.projects.map((project) => [project.id, project.publicId]),
  );
  const memberRoles = new Map(
    rows.members.map((member) => [member.id, member.jobTitle]),
  );
  const ownMemberId = memberId(session.memberId);

  return {
    mode: "server",
    session: {
      authenticated: true,
      authMode: "feishu",
      dataMode: "server",
      memberId: ownMemberId,
      permissions: [...session.permissionCodes],
    },
    members: rows.members.map((member) => ({
      id: memberId(member.id),
      n: member.displayName,
      r: member.jobTitle,
      sk: member.skills.join(" · "),
      dept: member.departmentName,
      rate: 0,
      cap: 1,
      lv: member.id === session.memberId ? 3 : 2,
    })),
    projects: rows.projects.map((project) => ({
      id: project.publicId,
      n: project.name,
      own: memberId(project.ownerMemberId),
      cat: "企业项目",
      pr: Number(project.progress),
      bud: 0,
      health: projectHealth[project.health] ?? 70,
      st: projectStatuses[project.status] ?? "进行中",
      up: project.updatedAt,
    })),
    tasks: rows.tasks.map((task) => ({
      id: task.publicId,
      n: task.title,
      p: projectPublicIds.get(task.projectId) ?? "",
      own: memberId(task.assigneeMemberId),
      createdBy: memberId(task.reporterMemberId),
      reviewer: memberId(task.reporterMemberId),
      role: memberRoles.get(task.assigneeMemberId ?? -1) ?? "待领取",
      pri: taskPriorities[task.priority] ?? "P2",
      st: taskStatuses[task.status] ?? "待处理",
      s: task.startDate ?? "",
      e: task.dueDate ?? "",
      pr: Number(task.progress),
      description: task.description,
      ac: task.acceptanceCriteria,
      blocker: task.blocker ?? "",
      reviewNote: task.reviewNote ?? "",
      nextStep: task.nextStep ?? "",
      resultText: task.resultSummary ?? "",
      resultLink: task.resultLink ?? "",
      resultFiles: task.resultFiles ? [...task.resultFiles] : [],
      acceptedAt: task.acceptedAt ?? "",
      submittedAt: task.submittedAt ?? "",
      reviewedAt: task.reviewedAt ?? "",
      notification: publicTaskNotification(task.notification),
      timeline: [],
      src: "飞书工作站",
      dep: [],
    })),
    payroll: {
      [ownMemberId]: rows.salary.map((salary) => {
        const hasComponents = Number(salary.performanceBonus) > 0
          || Number(salary.projectBonus) > 0
          || Number(salary.otherBonus) > 0;
        return ({
        month: month(salary.payrollMonth),
        base: Number(salary.baseSalary),
        performance: hasComponents ? Number(salary.performanceBonus) : Number(salary.bonus),
        projectBonus: Number(salary.projectBonus ?? 0),
        otherBonus: Number(salary.otherBonus ?? 0),
        social: Number(salary.socialSecurity ?? 0),
        tax: Number(salary.individualIncomeTax ?? salary.deductions),
        otherDeduction: Number(salary.otherDeduction ?? 0),
        gross: Number(salary.baseSalary) + Number(salary.bonus),
        deductions: Number(salary.deductions),
        net: Number(salary.netSalary),
        status: salary.status === "paid" ? "已发放" : "待发放",
        payDate: salary.paidAt?.slice(0, 10) ?? "",
      }); }),
    },
    kb: [],
    depts: [...new Set(rows.members.map((member) => member.departmentName).filter(Boolean))],
    customers: [],
    activities: [],
    decisions: [],
    agents: [],
    runs: [],
    reqs: [],
    appr: [],
    features: { identitySwitch: false, demoReset: false },
  };
}
