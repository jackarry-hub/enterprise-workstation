import type { Metadata } from "next";

import { CustomersPage } from "@/features/customers/customers-page";
import { loadCustomerWorkspaceData, normalizeCustomerFilters } from "@/features/customers/customer-data";
import { requireWorkspaceSession } from "@/features/auth/workspace-session";

export const metadata: Metadata = {
  title: "客户管理 | 企业工作站",
};

export const dynamic = "force-dynamic";

export default async function CustomersRoute({ searchParams }: { searchParams: Promise<{
  page?: string;
  q?: string;
  status?: string;
  source?: string;
  industry?: string;
}> }) {
  const session = await requireWorkspaceSession();
  const params = await searchParams;
  const requestedPage = Number(params.page ?? "1");
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 && requestedPage <= 100_000
    ? requestedPage : 1;
  const canManage = session.permissionCodes.includes("customer.manage");
  const canConvertToProject = canManage && session.permissionCodes.some((permission) =>
    permission === "project.manage" || permission === "organization.manage");
  const filters = normalizeCustomerFilters({
    query: params.q,
    status: params.status,
    source: params.source,
    industry: params.industry,
  });
  const result = await loadCustomerWorkspaceData(undefined, { canManage, canConvertToProject, page, filters });
  return <CustomersPage result={result} />;
}
