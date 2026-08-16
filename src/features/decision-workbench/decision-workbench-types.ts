import type { MemberSummary, TaskPriority } from "@/features/projects/types";

export type DecisionStage = "draft" | "review" | "issued";
export type DecisionTaskStatus = "pending" | "in_progress" | "in_review" | "done";
export type WorkTagTone = "strength" | "watch" | "capacity" | "skill";

export type WorkTag = {
  label: string;
  tone: WorkTagTone;
  evidence: string;
};

export type DecisionTalentProfile = {
  memberId: string;
  skills: readonly string[];
  onTimeRate: number;
  activeTasks: number;
  workload: number;
  averageResponseHours: number;
  recentDelayCount: number;
  updatedAt: string;
  tags: readonly WorkTag[];
};

export type AssigneeRecommendation = {
  member: MemberSummary;
  profile: DecisionTalentProfile;
  score: number;
  matchedSkills: readonly string[];
  reasons: readonly string[];
  risks: readonly string[];
  mitigation: string;
  isDepartmentMatch: boolean;
};

export type DecisionInput = {
  goal: string;
  deadline: string;
  budget: string;
  constraints: string;
};

export type DecisionTask = {
  id: string;
  phase: string;
  departmentId: string;
  title: string;
  description: string;
  requiredSkills: readonly string[];
  assignee: MemberSummary;
  priority: TaskPriority;
  startDate: string;
  dueDate: string;
  acceptance: string;
  dependencies: readonly string[];
  status: DecisionTaskStatus;
};

export type DepartmentPlan = {
  id: string;
  name: string;
  objective: string;
  owner: MemberSummary;
  tasks: readonly DecisionTask[];
};

export type DecisionPlan = {
  id: string;
  createdAt: string;
  expectedDays: number;
  departments: readonly DepartmentPlan[];
  ai?: {
    provider: "deepseek";
    model: string;
    summary: string;
    risks: readonly string[];
    managerDecisions: readonly string[];
    repaired: boolean;
  };
};

export type StoredDecision = {
  version: 1;
  stage: DecisionStage;
  input: DecisionInput;
  plan?: DecisionPlan;
  projectId?: string;
};

export type DecisionProgress = {
  total: number;
  pending: number;
  inProgress: number;
  inReview: number;
  done: number;
  completionRate: number;
};
