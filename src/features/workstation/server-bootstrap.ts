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
  publicId?: string;
  profileId?: number;
  departmentId?: number | null;
  displayName: string;
  departmentName: string;
  jobTitle: string;
  salaryGradeCode?: string | null;
  jobLevel?: number | null;
  skills: readonly string[];
  verifiedSkills?: readonly {
    name: string;
    level: number | null;
    yearsExperience: number | null;
    verified: boolean;
  }[];
  workProfile?: {
    summary: string;
    preferredTaskTypes: readonly string[];
    growthGoals: readonly string[];
    weeklyCapacityHours: number;
    selfSkills: readonly { name: string; level: number }[];
    updatedAt: string;
  } | null;
  salaryPolicy?: {
    publicId: string;
    baseSalary: number;
    salaryBandMin: number;
    salaryBandMax: number;
    performanceWeight: number;
    effectiveFrom: string;
    effectiveTo: string | null;
    matchedDepartment: boolean;
  } | null;
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
  category?: string;
  budgetAmount?: number | string;
  startsOn?: string | null;
  dueOn?: string | null;
  version?: number;
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
  completedAt?: string | null;
  submissionCount?: number;
  rejectionCount?: number;
  version: number;
  createdAt?: string;
  updatedAt?: string;
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
  otherIncome?: number;
  grossSalary?: number;
  socialBase?: number;
  housingFundBase?: number;
  pensionEmployee?: number;
  medicalEmployee?: number;
  unemploymentEmployee?: number;
  housingFundEmployee?: number;
  socialSecurity?: number;
  taxExemptIncome?: number;
  specialAdditionalDeduction?: number;
  otherStatutoryDeduction?: number;
  taxRelief?: number;
  cumulativeTaxableIncome?: number;
  individualIncomeTax?: number;
  otherDeduction?: number;
  manualAdjustmentReason?: string;
  deductions: number;
  netSalary: number;
  calculationVersion?: string | null;
  status: string;
  paidAt: string | null;
};

export type WorkstationAgentRow = {
  id: number;
  publicId: string;
  name: string;
  departmentName: string | null;
  icon: string;
  description: string;
  modelCode: string | null;
  promptVersion: string;
  capabilities: readonly string[];
  visibilityScope: string;
  minJobLevel: number;
  allowedDepartmentNames: readonly string[];
  allowedMemberIds: readonly number[];
  invocationCount: number;
  successRate: number;
  status: string;
  canInvoke: boolean;
  denialReason: string;
};

export type WorkstationAgentInvocationRow = {
  agentId: number;
  agentName: string;
  departmentName: string | null;
  actorMemberId: number | null;
  actorName: string | null;
  status: string;
  latencyMs: number | null;
  outputSummary: string | null;
  startedAt: string;
};

export type WorkstationKnowledgeRow = {
  publicId: string;
  title: string;
  category: string;
  summary: string;
  tags: readonly string[];
  version: number;
  publishedAt: string | null;
};

type BootstrapRows = {
  members: readonly WorkstationMemberRow[];
  projects: readonly WorkstationProjectRow[];
  tasks: readonly WorkstationTaskRow[];
  salary: readonly WorkstationSalaryRow[];
  agents?: readonly WorkstationAgentRow[];
  agentInvocations?: readonly WorkstationAgentInvocationRow[];
  knowledge?: readonly WorkstationKnowledgeRow[];
  moduleErrors?: Partial<Record<
    "agents" | "directory" | "knowledge" | "projects" | "salary" | "tasks",
    { code: "workstation_module_unavailable"; requestId: string }
  >>;
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

function minuteTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return value.slice(0, 16).replace("T", " ");
  }
  const pad = (part: number) => `${part}`.padStart(2, "0");
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
  ].join("-")
    + ` ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

function agentScope(value: string) {
  if (value === "dept" || value === "list" || value === "all") return value;
  return "all";
}

function uniqueSkillNames(member: WorkstationMemberRow) {
  const names: string[] = [];
  const seen = new Set<string>();
  const candidates = [
    ...(member.verifiedSkills ?? []).map((skill) => skill.name),
    ...(member.workProfile?.selfSkills ?? []).map((skill) => skill.name),
    ...member.skills,
  ];
  for (const candidate of candidates) {
    const name = candidate.trim();
    const key = name.toLocaleLowerCase("zh-CN");
    if (name && !seen.has(key)) {
      seen.add(key);
      names.push(name);
    }
  }
  return names;
}

function workEvidence(member: WorkstationMemberRow, tasks: readonly WorkstationTaskRow[]) {
  const assigned = tasks.filter((task) => task.assigneeMemberId === member.id);
  const active = assigned.filter((task) => ["backlog", "todo", "in_progress", "in_review"]
    .includes(task.status));
  const today = new Date().toISOString().slice(0, 10);
  const overdueTaskCount = active.filter((task) => task.dueDate && task.dueDate < today).length;
  const completed = assigned.filter((task) => task.status === "done");
  const measurable = completed.filter((task) => task.dueDate && task.reviewedAt);
  const onTime = measurable.filter((task) => task.reviewedAt!.slice(0, 10) <= task.dueDate!).length;
  const performanceTasks = completed.filter((task) =>
    task.acceptedAt && task.submittedAt && task.dueDate
    && (task.startDate || task.acceptedAt));
  const firstPass = performanceTasks.filter((task) =>
    (task.submissionCount ?? 0) <= 1 && (task.rejectionCount ?? 0) === 0).length;
  const qualityScores = performanceTasks.map((task) =>
    Math.max(40, 100 - (task.rejectionCount ?? 0) * 20));
  const efficiencyScores = performanceTasks.map((task) => {
    const acceptedAt = new Date(task.acceptedAt!).getTime();
    const submittedAt = new Date(task.submittedAt!).getTime();
    const planStart = new Date(`${task.startDate ?? task.acceptedAt!.slice(0, 10)}T00:00:00Z`).getTime();
    const planEnd = new Date(`${task.dueDate}T00:00:00Z`).getTime();
    const dayMs = 86_400_000;
    const actualDays = Math.max(1, Math.ceil((submittedAt - acceptedAt) / dayMs));
    const plannedDays = Math.max(1, Math.ceil((planEnd - planStart) / dayMs));
    return Math.max(50, Math.min(120, Math.round((plannedDays / actualDays) * 100)));
  });
  const average = (values: readonly number[]) => values.length
    ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
    : null;
  const weeklyCapacityHours = member.workProfile?.weeklyCapacityHours ?? 40;
  const workloadPercent = Math.min(
    100,
    Math.round((active.length * 8 / weeklyCapacityHours) * 100),
  );
  return {
    activeTaskCount: active.length,
    overdueTaskCount,
    completedTaskCount: completed.length,
    onTimeRate: measurable.length ? Math.round((onTime / measurable.length) * 100) : null,
    firstPassRate: performanceTasks.length
      ? Math.round((firstPass / performanceTasks.length) * 100)
      : null,
    qualityScore: average(qualityScores),
    efficiencyScore: average(efficiencyScores),
    performanceSampleCount: performanceTasks.length,
    workloadPercent,
  };
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
  const agentPublicIds = new Map(
    (rows.agents ?? []).map((agent) => [agent.id, agent.publicId]),
  );
  const ownMemberId = memberId(session.memberId);
  const canManageSalary = session.permissionCodes.includes("salary.manage");

  return {
    mode: "server",
    session: {
      authenticated: true,
      authMode: "feishu",
      dataMode: "server",
      memberId: ownMemberId,
      permissions: [...session.permissionCodes],
    },
    members: rows.members.map((member) => {
      const evidence = workEvidence(member, rows.tasks);
      const mayReadSalaryClassification = canManageSalary || member.id === session.memberId;
      const bootstrapMember = {
        id: memberId(member.id),
        ...(member.publicId ? { employeePublicId: member.publicId } : {}),
        n: member.displayName,
        r: member.jobTitle,
        sk: uniqueSkillNames(member).join(" · "),
        dept: member.departmentName,
        rate: 0,
        cap: Math.max(0.05, Math.round(100 - evidence.workloadPercent) / 100),
        workProfile: {
          summary: member.workProfile?.summary ?? "",
          preferredTaskTypes: [...(member.workProfile?.preferredTaskTypes ?? [])],
          growthGoals: [...(member.workProfile?.growthGoals ?? [])],
          weeklyCapacityHours: member.workProfile?.weeklyCapacityHours ?? 40,
          verifiedSkills: (member.verifiedSkills ?? []).map((skill) => ({ ...skill })),
          selfSkills: (member.workProfile?.selfSkills ?? []).map((skill) => ({ ...skill })),
          ...evidence,
          updatedAt: member.workProfile?.updatedAt ?? "",
        },
      };
      if (mayReadSalaryClassification) {
        return {
          ...bootstrapMember,
          ...(member.salaryGradeCode && member.jobLevel !== null && member.jobLevel !== undefined
            ? { grade: member.salaryGradeCode, lv: member.jobLevel }
            : {}),
          salaryBand: member.salaryPolicy
          ? {
            source: "server" as const,
            policyId: member.salaryPolicy.publicId,
            base: Number(member.salaryPolicy.baseSalary),
            min: Number(member.salaryPolicy.salaryBandMin),
            max: Number(member.salaryPolicy.salaryBandMax),
            performanceWeight: Number(member.salaryPolicy.performanceWeight),
            effectiveFrom: member.salaryPolicy.effectiveFrom,
            effectiveTo: member.salaryPolicy.effectiveTo ?? "",
            matchedDepartment: member.salaryPolicy.matchedDepartment,
          }
          : {
            source: "missing" as const,
            policyId: "",
            base: 0,
            min: 0,
            max: 0,
            performanceWeight: 0,
            effectiveFrom: "",
            effectiveTo: "",
            matchedDepartment: false,
          },
        };
      }
      return bootstrapMember;
    }),
    projects: rows.projects.map((project) => ({
      id: project.publicId,
      n: project.name,
      own: memberId(project.ownerMemberId),
      cat: project.category ?? "企业项目",
      pr: Number(project.progress),
      bud: Number(project.budgetAmount ?? 0) / 10_000,
      health: projectHealth[project.health] ?? 70,
      st: projectStatuses[project.status] ?? "进行中",
      ...(project.startsOn !== undefined ? { s: project.startsOn ?? "" } : {}),
      ...(project.dueOn !== undefined ? { e: project.dueOn ?? "" } : {}),
      ...(project.version !== undefined ? { version: project.version } : {}),
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
      completedAt: task.completedAt ?? "",
      version: task.version,
      createdAt: task.createdAt ?? "",
      updatedAt: task.updatedAt ?? "",
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
        otherIncome: Number(salary.otherIncome ?? 0),
        grossSalary: salary.calculationVersion
          ? Number(salary.grossSalary ?? 0)
          : Number(salary.baseSalary) + Number(salary.bonus),
        socialBase: Number(salary.socialBase ?? 0),
        housingFundBase: Number(salary.housingFundBase ?? 0),
        pensionEmployee: Number(salary.pensionEmployee ?? 0),
        medicalEmployee: Number(salary.medicalEmployee ?? 0),
        unemploymentEmployee: Number(salary.unemploymentEmployee ?? 0),
        housingFundEmployee: Number(salary.housingFundEmployee ?? 0),
        social: Number(salary.socialSecurity ?? 0),
        taxExemptIncome: Number(salary.taxExemptIncome ?? 0),
        specialAdditionalDeduction: Number(
          salary.specialAdditionalDeduction ?? 0,
        ),
        otherStatutoryDeduction: Number(
          salary.otherStatutoryDeduction ?? 0,
        ),
        taxRelief: Number(salary.taxRelief ?? 0),
        cumulativeTaxableIncome: Number(salary.cumulativeTaxableIncome ?? 0),
        tax: Number(salary.individualIncomeTax ?? salary.deductions),
        otherDeduction: Number(salary.otherDeduction ?? 0),
        manualAdjustmentReason: salary.manualAdjustmentReason ?? "",
        gross: salary.calculationVersion
          ? Number(salary.grossSalary ?? 0)
          : Number(salary.baseSalary) + Number(salary.bonus),
        deductions: Number(salary.deductions),
        net: Number(salary.netSalary),
        calculationVersion: salary.calculationVersion ?? "",
        status: salary.status === "paid" ? "已发放" : "待发放",
        payDate: salary.paidAt?.slice(0, 10) ?? "",
      }); }),
    },
    kb: (rows.knowledge ?? []).map((document) => ({
      id: document.publicId,
      n: document.title,
      c: document.category,
      v: `v${document.version}`,
      l: document.summary.length,
      sum: document.summary,
      tags: [...document.tags],
      publishedAt: document.publishedAt ?? "",
    })),
    depts: [...new Set(rows.members.map((member) => member.departmentName).filter(Boolean))],
    customers: [],
    activities: [],
    decisions: [],
    agents: (rows.agents ?? []).map((agent) => ({
      id: agent.publicId,
      n: agent.name,
      dept: agent.departmentName ?? "企业级",
      ic: agent.icon || "bot",
      model: agent.modelCode ?? "",
      on: agent.status === "enabled" ? 1 : 0,
      runs: Number(agent.invocationCount),
      ok: Number(agent.successRate),
      scope: agentScope(agent.visibilityScope),
      minLv: agent.minJobLevel,
      grant: agent.allowedMemberIds.map(memberId),
      depts: [...agent.allowedDepartmentNames],
      d: agent.description,
      sys: "企业内部 Agent，由权限和职级统一管理。",
      f: [
        { k: "input", n: "输入目标或任务", t: "ta" },
        { k: "context", n: "补充上下文（可选）", t: "ta" },
      ],
      abilities: [...agent.capabilities],
      promptVersion: agent.promptVersion,
      canInvoke: agent.canInvoke,
      denialReason: agent.denialReason,
    })),
    runs: (rows.agentInvocations ?? []).map((run) => ({
      id: agentPublicIds.get(run.agentId) ?? "",
      n: run.agentName,
      dept: run.departmentName ?? "企业级",
      by: run.actorName ?? memberId(run.actorMemberId),
      at: minuteTime(run.startedAt),
      status: run.status,
      ok: run.status === "succeeded" ? 1 : 0,
      ms: run.latencyMs ?? 0,
      out: run.outputSummary ?? "",
    })).filter((run) => run.id),
    reqs: [],
    appr: [],
    features: { identitySwitch: false, demoReset: false },
    moduleErrors: rows.moduleErrors ?? {},
  };
}
