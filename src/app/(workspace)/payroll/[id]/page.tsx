import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PayrollDetailPage } from "@/features/salary/payroll-detail-page";
import { loadSalaryDetail } from "@/features/salary/salary-data";

export const metadata: Metadata = { title: "工资详情 | 企业工作站" };

export default async function PayrollDetailRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = await loadSalaryDetail(id);
  if (!record) notFound();
  return <PayrollDetailPage record={record} />;
}
