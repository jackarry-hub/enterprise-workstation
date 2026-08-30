export type ApprovalType = "leave" | "reimbursement" | "purchase" | "contract";
export type ApprovalStatus = "draft" | "pending" | "approved" | "rejected" | "returned" | "cancelled";
export type ApprovalPriority = "low" | "medium" | "high";
export type ApprovalQueue = "all" | "pending" | "mine" | "completed";

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
  status: "pending" | "approved" | "rejected" | "returned" | "skipped";
  actedAt?: string;
  comment?: string;
};

export type ApprovalAction = {
  id: string;
  actor: ApprovalPerson;
  actionType: "submit" | "approve" | "reject" | "return" | "cancel" | "comment";
  content: string;
  createdAt: string;
};

export type ApprovalExpense = {
  id: string;
  version: number;
  status: "draft" | "submitted" | "approved" | "rejected" | "paid" | "cancelled";
  paymentReference?: string;
};

export type Approval = {
  id: string;
  version: number;
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
  actionableByViewer: boolean;
  fields: Array<{ label: string; value: string }>;
  steps: ApprovalStep[];
  actions: ApprovalAction[];
  expense?: ApprovalExpense;
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
