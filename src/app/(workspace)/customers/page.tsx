import type { Metadata } from "next";

import { CustomersPage } from "@/features/customers/customers-page";

export const metadata: Metadata = {
  title: "客户管理 | 企业工作站",
};

export default function CustomersRoute() {
  return <CustomersPage />;
}
