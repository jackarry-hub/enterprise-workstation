"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

import { useWorkspaceSession } from "@/features/auth/workspace-session-provider";
import { getModuleCapabilities } from "@/features/commercial/module-capabilities";
import { canRoleAccessPath } from "@/features/operations/role-access";

function RedirectToLanding({ href }: { href: string }) {
  const router = useRouter();

  useEffect(() => {
    router.replace(href);
  }, [href, router]);

  return (
    <main className="grid min-h-screen place-items-center px-6 text-center">
      <div>
        <p className="text-sm font-semibold text-primary">正在进入你的工作台</p>
        <p className="mt-1 text-xs text-muted-foreground">当前页面不属于该岗位的工作范围。</p>
      </div>
    </main>
  );
}

export function RoleAccessGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/dashboard";
  const session = useWorkspaceSession();
  const { actor } = session;
  const capabilities = getModuleCapabilities(session);
  const allowed = canRoleAccessPath(session, pathname);

  if (!allowed) {
    return <RedirectToLanding href={capabilities.help ? "/help" : actor.landingPath} />;
  }

  return children;
}
