import { CustomersWorkspace } from "@/features/customers/customers-workspace";
import type { CustomerWorkspaceResult } from "@/features/customers/customer-types";

const emptyResult: CustomerWorkspaceResult = {
  source: "supabase",
  data: { customers: [], availableOwners: [], canManage: false, canConvertToProject: false,
    canImport: false, canExport: false, canExportPii: false,
    filters: { query: "", status: "all", source: "all", industry: "all" }, industryOptions: [],
    pagination: { page: 1, pageSize: 30, total: 0, hasPrevious: false, hasNext: false } },
};

export function CustomersPage({ result = emptyResult }: { result?: CustomerWorkspaceResult }) {
  return <CustomersWorkspace result={result} />;
}
