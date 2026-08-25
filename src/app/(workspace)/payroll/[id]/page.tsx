import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { RealDataUnavailable } from "@/components/ui/real-data-boundary";
import { requireWorkspaceSession } from "@/features/auth/workspace-session";
import { createOperationFixtureContext } from "@/features/operations/operation-actor-compat";
import { PayrollDetailPage } from "@/features/salary/payroll-detail-page";
import { hasSupabaseEnv } from "@/lib/supabase/env";

export const metadata: Metadata = { title: "工资详情 | 企业工作站" };

function canManageSalary(session: Awaited<ReturnType<typeof requireWorkspaceSession>>) {
  return session.isAdmin
    || session.roleCodes.some((role) => ["owner", "admin", "finance"].includes(role))
    || session.permissionCodes.includes("salary.manage");
}

export default async function PayrollDetailRoute({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireWorkspaceSession();
  const { id } = await params;
  const fixtureContext = createOperationFixtureContext(session);
  if (!fixtureContext.actor && !hasSupabaseEnv()) {
    return (
      <RealDataUnavailable
        title="薪资数据暂不可用"
        description="当前账号不会显示演示工资单。真实薪资核算接入后，只会展示你有权查看的工资记录。"
        backHref="/payroll"
        backLabel="返回薪资中心"
      />
    );
  }

  const { loadSalaryDetail } = await import("@/features/salary/salary-data");
  const record = fixtureContext.actor
    ? await loadSalaryDetail(id)
    : await loadSalaryDetail(id, undefined, {
      allowMockFallback: false,
      viewerEmployeeProfileId: session.member.employeeProfileId,
      canManageSalary: canManageSalary(session),
    });
  if (!record) notFound();
  return <PayrollDetailPage record={record} dataSource={fixtureContext.actor ? "mock" : "supabase"} />;
}
