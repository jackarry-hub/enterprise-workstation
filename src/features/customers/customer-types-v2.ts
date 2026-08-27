export type CustomerLifecycleStatus =
  | "lead"
  | "following"
  | "proposal"
  | "negotiating"
  | "won"
  | "lost";

export type CustomerSource = "consulting" | "referral" | "event" | "outbound" | "other";
export type OpportunityStage = "lead" | "qualified" | "proposal" | "won" | "lost";
export type ContactVisibility = "assigned" | "managers";

export type CustomerRecordV2 = {
  id: string;
  name: string;
  registrationCode: string | null;
  ownerEmployeePublicId: string;
  ownerName: string;
  industry: string;
  source: CustomerSource;
  region: string;
  status: CustomerLifecycleStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type CustomerContactV2 = {
  id: string;
  customerId: string;
  name: string;
  title: string;
  phone: string | null;
  email: string | null;
  visibility: ContactVisibility;
  isPrimary: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type CustomerOpportunityV2 = {
  id: string;
  customerId: string;
  ownerEmployeePublicId: string;
  ownerName: string;
  name: string;
  stage: OpportunityStage;
  amount: string;
  currency: string;
  expectedCloseOn: string | null;
  lossReason: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type CustomerFollowUpV2 = {
  id: string;
  customerId: string;
  opportunityId: string | null;
  actorEmployeePublicId: string;
  actorName: string;
  kind: "call" | "meeting" | "email" | "message" | "visit" | "note";
  content: string;
  occurredAt: string;
  nextFollowUpAt: string | null;
};

export type CustomerProjectLinkV2 = {
  id: string;
  customerId: string;
  opportunityId: string | null;
  projectId: string;
  linkType: "delivery" | "support" | "renewal";
  createdAt: string;
  archivedAt: string | null;
};
