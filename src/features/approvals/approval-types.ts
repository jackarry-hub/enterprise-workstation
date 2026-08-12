export type ApprovalType = "leave" | "reimbursement" | "purchase" | "contract";
export type ApprovalStatus = "draft" | "pending" | "approved" | "rejected";
export type ApprovalPriority = "low" | "medium" | "high";
export type ApprovalQueue = "all" | "pending" | "mine" | "completed" | "approved" | "rejected";

export type ApprovalPerson = {
  id: string;
  displayName: string;
  department: string;
  jobTitle?: string;
  avatarUrl?: string;
};

export type ApprovalStep = {
  id: string;
  name: string;
  approver?: ApprovalPerson;
  status: "pending" | "approved" | "rejected" | "skipped";
  actedAt?: string;
  comment?: string;
};

export type ApprovalAction = {
  id: string;
  actor: ApprovalPerson;
  actionType: "submit" | "approve" | "reject" | "comment";
  content: string;
  createdAt: string;
};

export type Approval = {
  id: string;
  code: string;
  type: ApprovalType;
  title: string;
  summary: string;
  applicant: ApprovalPerson;
  owner: ApprovalPerson;
  submittedAt: string;
  status: ApprovalStatus;
  currentStep: string;
  priority: ApprovalPriority;
  initiatedByViewer: boolean;
  fields: Array<{ label: string; value: string }>;
  steps: ApprovalStep[];
  actions: ApprovalAction[];
};

export type ApprovalStats = {
  pending: number;
  initiated: number;
  approved: number;
  rejected: number;
};

export type ApprovalFilters = {
  query: string;
  queue: ApprovalQueue;
  type: ApprovalType | "all";
};

export type ApprovalResult = {
  source: "mock" | "supabase";
  data: {
    approvals: Approval[];
    stats: ApprovalStats;
    loadError?: string;
  };
};
