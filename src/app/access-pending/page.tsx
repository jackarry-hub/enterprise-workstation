import Link from "next/link";

import { GlassCard } from "@/components/ui/glass-card";

const accessMessages = {
  not_provisioned: "你的飞书账号尚未开通企业工作站，请联系管理员。",
  suspended: "你的工作站访问已暂停或撤销，请联系人事或管理员。",
  departed: "该员工账号已停用，无法进入工作站。",
  identity_error: "账号身份信息异常，请联系管理员处理。",
  auth_error: "登录没有完成，请返回后重新尝试。",
  configuration_error: "登录服务暂时不可用，请联系管理员。",
} as const;

type AccessReason = keyof typeof accessMessages;

export default async function AccessPendingPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const safeReason = reason && reason in accessMessages
    ? reason as AccessReason
    : "identity_error";

  return (
    <main
      id="main-content"
      className="workspace-mesh grid min-h-screen place-items-center px-4 py-10"
    >
      <GlassCard className="w-full max-w-md p-7 text-center sm:p-9">
        <h1 className="text-2xl font-semibold tracking-tight">暂时无法进入</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {accessMessages[safeReason]}
        </p>
        <Link
          href="/login"
          className="mt-7 inline-flex min-h-10 items-center justify-center rounded-xl border border-border bg-background px-5 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          返回登录
        </Link>
      </GlassCard>
    </main>
  );
}
