import type { MemberSummary } from "@/features/projects/types";

export type CustomerStatus = "lead" | "following" | "proposal" | "negotiating" | "won";
export type CustomerSource = "consulting" | "referral" | "event" | "outbound";
export type CustomerIndustry = "technology" | "manufacturing" | "finance" | "retail";

export interface CustomerContact {
  name: string;
  phone: string;
  email: string;
  title: string;
}

export interface CustomerActivity {
  id: string;
  content: string;
  createdAt: string;
}

export interface Customer {
  id: string;
  name: string;
  contact: CustomerContact;
  owner: MemberSummary;
  status: CustomerStatus;
  source: CustomerSource;
  industry: CustomerIndustry;
  region: string;
  lastContactAt: string;
  nextFollowUpAt: string;
  dealProgress: number;
  dealAmount: number;
  createdAt: string;
  relatedProjectIds: string[];
  activities: CustomerActivity[];
}

export interface CustomerFilters {
  query: string;
  status: CustomerStatus | "all";
  source: CustomerSource | "all";
  industry: CustomerIndustry | "all";
}

export interface CustomerStats {
  total: number;
  addedThisMonth: number;
  following: number;
  won: number;
  dealAmount: number;
}

export interface CustomerDistributionItem {
  label: string;
  value: number;
  percentage: number;
}

export interface CreateCustomerInput {
  name: string;
  contactName: string;
  phone: string;
  industry: CustomerIndustry;
  source: CustomerSource;
}
