import Image from "next/image";

import demoAvatarSprite from "../../../../public/dashboard/demo-avatar-sprite-v1.png";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { WorkspaceSession } from "@/features/auth/workspace-session-types";
import { cn } from "@/lib/utils";

const demoAvatarOrder = [
  "demo-executive",
  "demo-product-head",
  "demo-engineer",
  "demo-qa",
  "demo-market-head",
  "demo-design-head",
  "demo-customer-head",
  "demo-operations",
  "demo-finance",
  "demo-hr",
] as const;

function demoPersonId(session: WorkspaceSession) {
  const prefix = "customer-demo:";
  return session.identity.providerSubject.startsWith(prefix)
    ? session.identity.providerSubject.slice(prefix.length)
    : null;
}

export function DashboardAvatar({
  session,
  className,
}: {
  session: WorkspaceSession;
  className?: string;
}) {
  const realAvatarUrl = session.profile.avatarUrl;
  const index = demoAvatarOrder.indexOf(demoPersonId(session) as (typeof demoAvatarOrder)[number]);
  const hasDemoPortrait = index >= 0;
  const column = hasDemoPortrait ? index % 5 : 0;
  const row = hasDemoPortrait ? Math.floor(index / 5) : 0;
  const avatarSource = realAvatarUrl ? "real" : hasDemoPortrait ? "mock" : "placeholder";

  return (
    <Avatar
      data-testid="dashboard-identity-avatar"
      data-avatar-source={avatarSource}
      className={cn("size-16 overflow-hidden border-2 border-white shadow-[0_12px_28px_rgba(47,105,190,0.22)] sm:size-20", className)}
    >
      {realAvatarUrl ? (
        <Image
          src={realAvatarUrl}
          alt={`${session.profile.displayName}的头像`}
          width={96}
          height={96}
          unoptimized
          className="size-full rounded-full object-cover"
        />
      ) : hasDemoPortrait ? (
        <span
          role="img"
          aria-label={`${session.profile.displayName}的AI演示头像`}
          className="size-full rounded-full bg-cover bg-no-repeat"
          style={{
            // Let Next.js fingerprint and prefix this asset. A root-relative
            // `/dashboard/...` URL skips the repository base path on GitHub Pages.
            backgroundImage: `url('${demoAvatarSprite.src}')`,
            backgroundSize: "500% 200%",
            backgroundPosition: `${column * 25}% ${row * 100}%`,
          }}
        />
      ) : (
        <AvatarFallback className="bg-linear-to-br from-primary to-chart-3 text-lg font-semibold text-white">
          {session.profile.displayName.slice(0, 1)}
        </AvatarFallback>
      )}
    </Avatar>
  );
}
