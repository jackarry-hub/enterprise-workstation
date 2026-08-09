import type { Metadata } from "next";

import { loadEmployeeDirectory } from "@/features/hr/employee-data";
import { PeoplePage } from "@/features/hr/people-page";

export const metadata: Metadata = {
  title: "组织人事 | 企业工作站",
};

export default async function PeopleRoute() {
  const result = await loadEmployeeDirectory();
  return <PeoplePage result={result} />;
}
