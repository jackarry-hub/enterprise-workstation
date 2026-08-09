import { customersMockData } from "@/features/customers/customer-mock-data";
import type { Customer } from "@/features/customers/customer-types";

export const CUSTOMERS_STORAGE_KEY = "enterprise-workspace.customers.v1";
export const CUSTOMERS_CHANGED_EVENT = "enterprise-workspace:customers-changed";

export function readCustomers(storage?: Pick<Storage, "getItem">): Customer[] {
  const target = storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
  if (!target) return [...customersMockData];
  try {
    const parsed = JSON.parse(target.getItem(CUSTOMERS_STORAGE_KEY) ?? "null") as { version?: number; customers?: Customer[] } | null;
    return parsed?.version === 1 && Array.isArray(parsed.customers) ? parsed.customers : [...customersMockData];
  } catch {
    return [...customersMockData];
  }
}

export function saveCustomers(customers: readonly Customer[], storage?: Pick<Storage, "setItem">) {
  const target = storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
  target?.setItem(CUSTOMERS_STORAGE_KEY, JSON.stringify({ version: 1, customers }));
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(CUSTOMERS_CHANGED_EVENT));
  return [...customers];
}
