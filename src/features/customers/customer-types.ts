import type { MemberSummary } from "@/features/projects/types";

export type CustomerStatus = "lead" | "following" | "proposal" | "negotiating" | "won" | "lost";
export type CustomerSource = "consulting" | "referral" | "event" | "outbound" | "other";
export type OpportunityStage = "lead" | "qualified" | "proposal" | "won" | "lost";
export type FollowUpKind = "call" | "meeting" | "email" | "message" | "visit" | "note";

export interface CustomerContact {
  id: string;
  version: number;
  name: string;
  phone: string | null;
  email: string | null;
  title: string;
  visibility: "assigned" | "managers";
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerOpportunity {
  id: string;
  version: number;
  name: string;
  owner: MemberSummary;
  stage: OpportunityStage;
  amount: string;
  currency: string;
  expectedCloseOn: string | null;
  lossReason: string | null;
  createdAt: string;
  updatedAt: string;
  projectId?: string;
}

export interface CustomerActivity {
  id: string;
  opportunityId: string | null;
  kind: FollowUpKind;
  content: string;
  actor: MemberSummary;
  occurredAt: string;
  nextFollowUpAt: string | null;
}

export interface CustomerProjectLink {
  id: string;
  projectId: string | null;
  projectName: string | null;
  projectProgress: number | null;
  opportunityId: string | null;
  linkType: "delivery" | "support" | "renewal";
  createdAt: string;
}

export interface Customer {
  id: string;
  version: number;
  name: string;
  registrationCode: string | null;
  contact?: CustomerContact;
  contacts: CustomerContact[];
  owner: MemberSummary;
  status: CustomerStatus;
  source: CustomerSource;
  industry: string;
  region: string;
  lastContactAt: string | null;
  nextFollowUpAt: string | null;
  dealProgress: number;
  dealAmount: string;
  createdAt: string;
  updatedAt: string;
  relatedProjects: CustomerProjectLink[];
  opportunities: CustomerOpportunity[];
  activities: CustomerActivity[];
  detailState: "summary" | "complete";
  truncatedResources?: Array<"contacts" | "opportunities" | "followUps" | "projectLinks">;
}

export interface CustomerFilters {
  query: string;
  status: CustomerStatus | "all";
  source: CustomerSource | "all";
  industry: string;
}

export interface CustomerStats {
  total: number;
  pageCount: number;
  following: number;
  won: number;
  dealAmount: string;
}

export interface CustomerDistributionItem {
  label: string;
  value: number;
  percentage: number;
}

export interface CreateCustomerInput {
  name: string;
  registrationCode: string;
  contactName: string;
  contactTitle: string;
  phone: string;
  email: string;
  industry: string;
  source: CustomerSource;
  region: string;
  ownerEmployeePublicId: string;
}

export type CustomerWorkspaceResult = {
  source: "supabase";
  data: {
    customers: Customer[];
    availableOwners: MemberSummary[];
    canManage: boolean;
    canConvertToProject: boolean;
    filters: CustomerFilters;
    industryOptions: string[];
    pagination: {
      page: number;
      pageSize: number;
      total: number;
      hasPrevious: boolean;
      hasNext: boolean;
    };
    loadError?: string;
  };
};

export type CustomerDetailResult = {
  source: "supabase";
  customer?: Customer;
  loadError?: string;
};
