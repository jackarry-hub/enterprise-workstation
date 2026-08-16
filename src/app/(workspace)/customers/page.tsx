import type { Metadata } from "next";

import { CustomersPage } from "@/features/customers/customers-page";

export const metadata: Metadata = {
  title: "客户管理 | 量子智枢",
};

export default function CustomersRoute() {
  return <CustomersPage />;
}
