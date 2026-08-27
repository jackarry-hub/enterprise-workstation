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

export interface CustomerContract {
  id: string;
  opportunityId: string | null;
  projectId: string | null;
  contractNumber: string;
  title: string;
  status: "draft" | "active" | "completed" | "terminated";
  amount: string;
  currency: string;
  signedOn: string | null;
  startsOn: string;
  endsOn: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerSourceLink {
  id: string;
  contactId: string | null;
  opportunityId: string | null;
  projectId: string | null;
  targetKind: "customer" | "contact" | "opportunity" | "project";
  sourceSystem: "feishu" | "import" | "external_crm" | "n8n" | "other";
  externalRecordId: string;
  sourceUrl: string | null;
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
  contracts: CustomerContract[];
  sourceLinks: CustomerSourceLink[];
  opportunities: CustomerOpportunity[];
  activities: CustomerActivity[];
  detailState: "summary" | "complete";
  truncatedResources?: Array<"contacts" | "opportunities" | "followUps" | "projectLinks" | "contracts" | "sourceLinks">;
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
    canImport: boolean;
    canExport: boolean;
    canExportPii: boolean;
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
